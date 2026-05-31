/**
 * Cipher — Code Intelligence Module.
 *
 * Analyzes a single repository file and produces structured findings.
 * Findings are grounded in what is directly observable in the provided
 * file content. Cipher never invents vulnerabilities.
 *
 * Pipeline:
 *   1. Load fresh intelligence from DB (skip AI call if blobSHA unchanged)
 *   2. Fetch file content via services/github/file.ts
 *   3. Derive current blobSHA from the repo tree
 *   4. If blobSHA matches stored record → return cached findings (no AI call)
 *   5. Call AI provider with Cipher's system prompt
 *   6. Normalize and validate CipherFinding[]
 *   7. Derive architecture node IDs from domain map
 *   8. Upsert to FileIntelligence table
 *   9. Return AgentResult
 *
 * SECURITY: githubToken never leaves this module. Not included in any response.
 * AI provider apiKey is decrypted server-side by the caller.
 *
 * Grounding guarantees:
 *   - Every finding requires agentReasoning (specific, not generic)
 *   - confidence: "speculative" for anything inferred without line evidence
 *   - The prompt explicitly forbids invented vulnerabilities
 */

import { fetchFileContent }       from "@/services/github/file";
import { fetchRepoTree }          from "@/services/github/tree";
import { buildDomainMap }         from "@/server/repo/domain-map";
import {
  getFreshIntelligence,
  upsertFileIntelligence,
} from "@/server/repo/intelligence-store";
import { generateEmbedding, buildEmbeddingText, EMBEDDING_MODEL } from "@/server/ai/providers/embeddings";
import { upsertFileEmbedding }    from "@/server/repo/embedding-store";
import { ANALYZER_MAX_TOKENS }    from "@/server/ai/constants";
import type { CipherFinding, AgentResult } from "@/types/intelligence";

// ─── Cipher prompt ────────────────────────────────────────────

const CIPHER_SYSTEM_PROMPT = `You are Cipher, the Code Intelligence Module for DE-code X.

Your job is to analyze the provided source file and produce structured findings.

STRICT RULES — violations destroy user trust:
1. ONLY analyze what is in the provided file content.
2. NEVER invent vulnerabilities not evidenced by the code.
3. NEVER claim certainty beyond what the code shows.
4. For every finding, quote the line number(s) where you see the evidence.
5. If you cannot determine something without seeing other files, label it "speculative" and say so.
6. Do NOT produce generic findings like "error handling could be improved" without citing specific lines.

Confidence levels you MUST use correctly:
- "confirmed"   → you can quote the exact line(s) proving this
- "inferred"    → reasonable deduction from code structure (say "inferred from X")
- "speculative" → possible concern, requires more context to confirm

Finding types:
- "implementation"   → how the feature is built
- "integrity"        → potential correctness issues you can see in the code
- "pressure"         → complexity / hotspot signals (cyclomatic, nesting, size)
- "dependency"       → imports, coupling, cross-file dependencies
- "security-signal"  → observable patterns only — NEVER claim a vulnerability exists without line evidence

agentReasoning is REQUIRED on every finding. Be specific:
  Good: "Line 47 calls verify(token, key) without an expiresIn option"
  Bad:  "Based on analysis of the authentication flow"

Return a JSON array of findings. If you find nothing notable, return [].
Schema for each finding:
{
  "id": "<filePath-type-slugified-title>",
  "type": "<finding type>",
  "title": "<≤80 chars>",
  "description": "<full description>",
  "confidence": "<confirmed|inferred|speculative>",
  "evidenceLines": { "start": N, "end": N },  // omit if not applicable
  "relatedFilePaths": [],                       // only files you know exist
  "pressureLevel": "<high|medium|low>",         // omit if not pressure type
  "agentReasoning": "<specific, cite line numbers>"
}`;

// ─── Provider call helper ─────────────────────────────────────

type ProviderConfig = {
  provider: "anthropic" | "openai" | "openrouter" | "gemini";
  apiKey:   string;
  model?:   string;
};

async function callCipherAI(
  fileContent: string,
  filePath:    string,
  repoFullName: string,
  config:       ProviderConfig
): Promise<{ findings: CipherFinding[]; raw: string }> {
  const userPrompt = `Analyze this file from the repository ${repoFullName}.

File: ${filePath}

\`\`\`
${fileContent}
\`\`\`

Respond with STRICT JSON in exactly this shape:
{ "findings": [ { "type": "...", "title": "...", "description": "...", "confidence": "...", "agentReasoning": "...", "evidenceLines": { "start": N, "end": N } } ] }

Rules:
- "findings" MUST be a non-empty array when the file has ANY runtime code worth describing.
- Cite line numbers in agentReasoning.
- No prose, no markdown, no code fences.`;

  let raw: string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type CompletionOpts = { system: string; model?: any; temperature: number; maxTokens: number; jsonMode?: boolean };
  const opts: CompletionOpts = { system: CIPHER_SYSTEM_PROMPT, model: config.model, temperature: 0.1, maxTokens: ANALYZER_MAX_TOKENS, jsonMode: true };

  if (config.provider === "anthropic") {
    const { runAnthropicCompletion } = await import("@/server/ai/providers/anthropic");
    raw = await runAnthropicCompletion(config.apiKey, userPrompt, opts);
  } else if (config.provider === "openai") {
    const { runOpenAICompletion } = await import("@/server/ai/providers/openai");
    raw = await runOpenAICompletion(config.apiKey, userPrompt, opts);
  } else if (config.provider === "gemini") {
    const { runGeminiCompletion } = await import("@/server/ai/providers/gemini");
    raw = await runGeminiCompletion(config.apiKey, userPrompt, opts);
  } else {
    const { runOpenRouterCompletion } = await import("@/server/ai/providers/openrouter");
    raw = await runOpenRouterCompletion(config.apiKey, userPrompt, opts);
  }

  console.log(`[cipher] ai_raw_response provider=${config.provider} chars=${raw.length} preview=${raw.slice(0, 240).replace(/\n/g, " ")}`);
  const findings = parseFindings(raw, filePath);
  console.log(`[cipher] ai_parsed_findings count=${findings.length} file=${filePath}`);
  return { findings, raw };
}

// ─── Finding normalization ────────────────────────────────────

function parseFindings(raw: string, filePath: string): CipherFinding[] {
  // Strip code fences (Gemini wraps with ```json … ``` often).
  const stripped = raw
    .replace(/```(?:json|jsonc)?/gi, "")
    .replace(/```/g, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    // Last-ditch: pull the outermost JSON array or object from the text.
    const arrMatch = stripped.match(/\[[\s\S]*\]/);
    const objMatch = stripped.match(/\{[\s\S]*\}/);
    const candidate = arrMatch?.[0] ?? objMatch?.[0];
    if (candidate) {
      try { parsed = JSON.parse(candidate); } catch {
        console.warn(`[cipher] parse_failed file=${filePath} raw_length=${raw.length} preview=${raw.slice(0, 180)}`);
        return [];
      }
    } else {
      console.warn(`[cipher] parse_failed file=${filePath} raw_length=${raw.length} preview=${raw.slice(0, 180)}`);
      return [];
    }
  }

  // Unwrap common object wrappers — Gemini often returns { findings: [...] }.
  const list: unknown[] = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === "object")
      ? (() => {
          const o = parsed as Record<string, unknown>;
          for (const k of ["findings", "results", "items", "analysis", "issues", "data"]) {
            if (Array.isArray(o[k])) return o[k] as unknown[];
          }
          if (typeof o.title === "string" || typeof o.description === "string") return [o];
          return [];
        })()
      : [];

  const accepted: CipherFinding[] = [];
  let dropped = 0;
  for (const item of list) {
    const normalized = tryNormalize(item, filePath);
    if (normalized) accepted.push(normalized);
    else dropped++;
  }
  if (dropped > 0) {
    console.warn(`[cipher] findings_dropped count=${dropped} kept=${accepted.length} file=${filePath}`);
  }
  return accepted;
}

/**
 * Normalize a single AI-returned finding into CipherFinding, accepting common
 * field-name aliases so Gemini / Claude / GPT all parse uniformly.
 */
function tryNormalize(item: unknown, filePath: string): CipherFinding | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const pickStr = (...keys: string[]): string => {
    for (const k of keys) {
      const v = o[k];
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
    }
    return "";
  };
  const title       = pickStr("title", "name", "summary", "heading");
  const description = pickStr("description", "details", "detail", "explanation", "body", "summary");
  if (!title && !description) return null;
  const agentReasoning = pickStr("agentReasoning", "reasoning", "rationale", "why", "evidence") || description;
  return normalizeFinding({
    ...o,
    title:          title || description.slice(0, 80),
    description:    description || title,
    agentReasoning,
  }, filePath);
}

function normalizeFinding(
  f: Record<string, unknown>,
  filePath: string
): CipherFinding {
  const title = String(f.title).slice(0, 80);
  const id = f.id
    ? String(f.id)
    : `${filePath}-${f.type}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;

  const validTypes = ["implementation", "integrity", "pressure", "dependency", "security-signal"];
  const type = validTypes.includes(String(f.type))
    ? (f.type as CipherFinding["type"])
    : "implementation";

  const validConfidence = ["confirmed", "inferred", "speculative"];
  const confidence = validConfidence.includes(String(f.confidence))
    ? (f.confidence as CipherFinding["confidence"])
    : "speculative";

  const finding: CipherFinding = {
    id,
    type,
    title,
    description:    String(f.description),
    confidence,
    agentReasoning: String(f.agentReasoning),
  };

  if (f.evidenceLines && typeof f.evidenceLines === "object") {
    const el = f.evidenceLines as Record<string, unknown>;
    if (typeof el.start === "number" && typeof el.end === "number") {
      finding.evidenceLines = { start: el.start, end: el.end };
    }
  }

  if (Array.isArray(f.relatedFilePaths)) {
    finding.relatedFilePaths = f.relatedFilePaths
      .filter((p): p is string => typeof p === "string")
      .slice(0, 10);
  }

  if (["high", "medium", "low"].includes(String(f.pressureLevel))) {
    finding.pressureLevel = f.pressureLevel as CipherFinding["pressureLevel"];
  }

  return finding;
}

// ─── Node ID derivation ───────────────────────────────────────

/**
 * Derive architecture node IDs for a file path using the domain map.
 * Matches the file's directory prefix against DOMAIN_PREFIXES and returns
 * the section + domain node IDs the finding attaches to.
 */
function deriveNodeIds(filePath: string, domainMap: ReturnType<typeof buildDomainMap> | null): string[] {
  if (!domainMap) return [];

  const nodeIds: string[] = [];

  for (const domain of domainMap.domains) {
    if (domain.prefix && filePath.startsWith(domain.prefix)) {
      // Domain node ID format from architecture-serializer.ts
      nodeIds.push(`domain-${domain.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
      nodeIds.push("section-domains"); // always include parent section
      break; // longest-match-wins via domainMap ordering
    }
  }

  return nodeIds;
}

// ─── Public API ───────────────────────────────────────────────

export interface CipherAnalyzeParams {
  owner:       string;
  repo:        string;
  filePath:    string;
  branch:      string;
  githubToken: string;
  aiConfig:    ProviderConfig;
  /** If true, skip AI call and only return cached findings (if fresh). */
  dryRun?:     boolean;
}

/**
 * Analyze a single repository file with Cipher.
 *
 * Returns AgentResult. Persist errors are non-fatal — findings are returned
 * even if the DB write fails.
 */
export async function analyzeFileWithCipher(
  params: CipherAnalyzeParams
): Promise<AgentResult> {
  const { owner, repo, filePath, branch, githubToken, aiConfig, dryRun = false } = params;
  const repoFullName = `${owner}/${repo}`;

  // 1. Fetch tree to get current blobSHA (uses 10-min in-process cache)
  const tree = await fetchRepoTree(owner, repo, branch, githubToken);
  const treeNode = tree.nodes.find((n: { path: string; type: string }) => n.path === filePath && n.type === "blob");

  if (!treeNode) {
    throw new Error(`File not found in tree: ${filePath}`);
  }

  const currentBlobSHA = treeNode.sha;

  // 2. Check for fresh cached intelligence (scoped to "cipher").
  //    Skip empty caches — likely a previous silent-parse failure. Re-run instead.
  const cached = await getFreshIntelligence(repoFullName, filePath, branch, currentBlobSHA, "cipher");
  if (cached && cached.findings.length > 0) {
    console.log(`[cipher] cache_hit file=${filePath} blobSHA=${currentBlobSHA.slice(0, 8)} findings=${cached.findings.length}`);
    return {
      agentId:        "cipher",
      repoFullName,
      filePath,
      blobSHA:        currentBlobSHA,
      findings:       cached.findings,
      persistedAt:    cached.analyzedAt.toISOString(),
      nodeAttachments: cached.nodeIds,
      wasDeduped:     true,
    };
  }
  if (cached) {
    console.log(`[cipher] cache_skip_empty file=${filePath} blobSHA=${currentBlobSHA.slice(0, 8)} reason=re-run_for_real_result`);
  }

  if (dryRun) {
    return {
      agentId:        "cipher",
      repoFullName,
      filePath,
      blobSHA:        currentBlobSHA,
      findings:       [],
      persistedAt:    null,
      nodeAttachments: [],
      wasDeduped:     false,
    };
  }

  // 3. Fetch file content
  const file = await fetchFileContent(owner, repo, filePath, githubToken, branch);

  console.log(
    `[cipher] analyze_start file=${filePath}` +
    ` blobSHA=${currentBlobSHA.slice(0, 8)}` +
    ` size=${file.size}b truncated=${file.truncated}`
  );

  // 4. Call AI
  const { findings, raw: rawResponse } = await callCipherAI(file.content, filePath, repoFullName, aiConfig);

  // 5. Derive node IDs
  const domainMap = buildDomainMap(tree);
  const nodeIds   = deriveNodeIds(filePath, domainMap);

  // Confidence is "strong" if findings include confirmed items, "partial" otherwise
  const confidence = findings.some(f => f.confidence === "confirmed") ? "strong" : "partial";

  // 6. Persist (non-fatal on error)
  let persistedAt: string | null = null;
  let wasDeduped = false;

  try {
    const { record, wasDeduped: duped } = await upsertFileIntelligence({
      repoFullName,
      filePath,
      blobSHA:    currentBlobSHA,
      branch,
      agentId:    "cipher",
      findings,
      nodeIds,
      confidence,
    });
    persistedAt = record.analyzedAt.toISOString();
    wasDeduped  = duped;
    console.log(
      `[cipher] persisted file=${filePath}` +
      ` findings=${findings.length}` +
      ` deduped=${wasDeduped}` +
      ` nodeIds=${nodeIds.join(",")}`
    );
  } catch (err) {
    console.error(`[cipher] persist_failed file=${filePath}`, err);
  }

  // 7. Generate and store semantic embedding (Phase 3).
  // Fire-and-forget — non-fatal. Does NOT block the analysis response.
  // Only runs when the user has an OpenAI key (embeddings require OpenAI).
  // Embeds a rich text combining filePath + domain + finding summaries,
  // enabling "what files handle rate limiting?" queries via pgvector cosine search.
  if (aiConfig.provider === "openai") {
    const domainName = domainMap?.domains
      .find(d => d.prefix && filePath.startsWith(d.prefix))
      ?.name;

    void (async () => {
      try {
        const embeddingText = buildEmbeddingText({ filePath, domain: domainName, findings });
        const vector        = await generateEmbedding(embeddingText, aiConfig.apiKey);

        await upsertFileEmbedding({
          repoFullName,
          filePath,
          branch,
          model:  EMBEDDING_MODEL,
          embeddingText,
          vector,
        });

        console.log(
          `[cipher] embedding_stored file=${filePath}` +
          ` dims=${vector.length}` +
          ` domain=${domainName ?? "unknown"}`
        );
      } catch (err) {
        // Non-fatal: analysis result is already returned; embedding failure is logged only.
        console.warn(
          `[cipher] embedding_failed file=${filePath}`,
          err instanceof Error ? err.message : String(err)
        );
      }
    })();
  }

  return {
    agentId:        "cipher",
    repoFullName,
    filePath,
    blobSHA:        currentBlobSHA,
    findings,
    persistedAt,
    nodeAttachments: nodeIds,
    wasDeduped,
    ...(findings.length === 0 ? { rawResponse } : {}),
  };
}
