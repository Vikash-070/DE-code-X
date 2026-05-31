/**
 * Shared file analysis pipeline — used by Sentinel and Pulse.
 *
 * Extracts the common infrastructure from cipher-analyzer.ts:
 *   - Provider dispatch (anthropic / openai / openrouter)
 *   - Finding parsing + normalization
 *   - Staleness check / cache hit
 *   - Node ID derivation from domain map
 *   - Persistence (non-fatal on error)
 *   - Fire-and-forget embedding (OpenAI only)
 *
 * Each module passes its own agentId + systemPrompt.
 * The post-processor hook lets modules strip false positives before persistence.
 *
 * SECURITY: githubToken never leaves this module. Not included in any response.
 * AI provider apiKey is decrypted server-side by the caller.
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
import type { CipherFinding, AgentId, AgentResult } from "@/types/intelligence";

// ─── Types ────────────────────────────────────────────────────

type ProviderConfig = {
  provider: "anthropic" | "openai" | "openrouter" | "gemini";
  apiKey:   string;
  model?:   string;
};

export interface SharedAnalyzerParams {
  owner:       string;
  repo:        string;
  filePath:    string;
  branch:      string;
  githubToken: string;
  aiConfig:    ProviderConfig;
  dryRun?:     boolean;
  /** The intelligence module running this analysis. */
  agentId:     AgentId;
  /** The system prompt for this module. */
  systemPrompt: string;
  /**
   * Optional post-processor applied to parsed findings before persistence.
   * Use this to strip false positives specific to this module (e.g. Sentinel
   * strips "application is secure" claims that have no line evidence).
   */
  postProcess?: (findings: CipherFinding[], filePath: string) => CipherFinding[];
}

// ─── Provider call ────────────────────────────────────────────

async function callModuleAI(
  fileContent:  string,
  filePath:     string,
  repoFullName: string,
  config:       ProviderConfig,
  systemPrompt: string,
  agentId:      AgentId
): Promise<CipherFinding[]> {
  const userPrompt = `Analyze this file from the repository ${repoFullName}.

File: ${filePath}

\`\`\`
${fileContent}
\`\`\`

Return a JSON array of findings. Return [] if nothing notable.`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type CompletionOpts = { system: string; model?: any; temperature: number; maxTokens: number };
  const opts: CompletionOpts = { system: systemPrompt, model: config.model, temperature: 0.1, maxTokens: ANALYZER_MAX_TOKENS };

  let raw: string;

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

  return parseFindings(raw, filePath, agentId);
}

// ─── Finding normalization ────────────────────────────────────

function parseFindings(raw: string, filePath: string, agentId: AgentId): CipherFinding[] {
  const stripped = raw
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\[[\s\S]*\]/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { return []; }
    } else {
      console.warn(`[${agentId}] parse_failed file=${filePath} raw_length=${raw.length}`);
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(isValidFinding)
    .map(f => normalizeFinding(f, filePath));
}

function isValidFinding(f: unknown): f is Record<string, unknown> {
  if (!f || typeof f !== "object") return false;
  const obj = f as Record<string, unknown>;
  return (
    typeof obj.type         === "string" &&
    typeof obj.title        === "string" &&
    typeof obj.description  === "string" &&
    typeof obj.confidence   === "string" &&
    typeof obj.agentReasoning === "string" &&
    obj.agentReasoning.length > 10
  );
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

  if (f.metadata && typeof f.metadata === "object" && !Array.isArray(f.metadata)) {
    finding.metadata = f.metadata as Record<string, unknown>;
  }

  return finding;
}

// ─── Node ID derivation ───────────────────────────────────────

function deriveNodeIds(filePath: string, domainMap: ReturnType<typeof buildDomainMap> | null): string[] {
  if (!domainMap) return [];

  const nodeIds: string[] = [];

  for (const domain of domainMap.domains) {
    if (domain.prefix && filePath.startsWith(domain.prefix)) {
      nodeIds.push(`domain-${domain.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
      nodeIds.push("section-domains");
      break;
    }
  }

  return nodeIds;
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Shared pipeline for file-level intelligence modules (Sentinel, Pulse, etc.).
 * All modules that analyse individual repository files can use this function.
 *
 * The caller provides: agentId, systemPrompt, and an optional postProcess hook.
 * Everything else (staleness check, provider call, parsing, persistence, embedding)
 * is handled here.
 */
export async function analyzeFileWithModule(
  params: SharedAnalyzerParams
): Promise<AgentResult> {
  const {
    owner, repo, filePath, branch, githubToken, aiConfig,
    dryRun = false, agentId, systemPrompt, postProcess
  } = params;
  const repoFullName = `${owner}/${repo}`;

  // 1. Fetch tree to get current blobSHA (uses 10-min in-process cache)
  const tree = await fetchRepoTree(owner, repo, branch, githubToken);
  const treeNode = tree.nodes.find(
    (n: { path: string; type: string }) => n.path === filePath && n.type === "blob"
  );

  if (!treeNode) {
    throw new Error(`File not found in tree: ${filePath}`);
  }

  const currentBlobSHA = treeNode.sha;

  // 2. Check for fresh cached intelligence (scoped to this agentId)
  const cached = await getFreshIntelligence(
    repoFullName, filePath, branch, currentBlobSHA, agentId
  );
  if (cached) {
    console.log(`[${agentId}] cache_hit file=${filePath} blobSHA=${currentBlobSHA.slice(0, 8)}`);
    return {
      agentId,
      repoFullName,
      filePath,
      blobSHA:         currentBlobSHA,
      findings:        cached.findings,
      persistedAt:     cached.analyzedAt.toISOString(),
      nodeAttachments: cached.nodeIds,
      wasDeduped:      true,
    };
  }

  if (dryRun) {
    return {
      agentId,
      repoFullName,
      filePath,
      blobSHA:         currentBlobSHA,
      findings:        [],
      persistedAt:     null,
      nodeAttachments: [],
      wasDeduped:      false,
    };
  }

  // 3. Fetch file content
  const file = await fetchFileContent(owner, repo, filePath, githubToken, branch);

  console.log(
    `[${agentId}] analyze_start file=${filePath}` +
    ` blobSHA=${currentBlobSHA.slice(0, 8)}` +
    ` size=${file.size}b truncated=${file.truncated}`
  );

  // 4. Call AI
  let findings = await callModuleAI(file.content, filePath, repoFullName, aiConfig, systemPrompt, agentId);

  // 5. Post-process (strip false positives, etc.)
  if (postProcess) {
    const before = findings.length;
    findings = postProcess(findings, filePath);
    const stripped = before - findings.length;
    if (stripped > 0) {
      console.log(`[${agentId}] post_process_stripped=${stripped} file=${filePath}`);
    }
  }

  // 6. Derive node IDs
  const domainMap = buildDomainMap(tree);
  const nodeIds   = deriveNodeIds(filePath, domainMap);

  const confidence = findings.some(f => f.confidence === "confirmed") ? "strong" : "partial";

  // 7. Persist (non-fatal on error)
  let persistedAt: string | null = null;
  let wasDeduped = false;

  try {
    const { record, wasDeduped: duped } = await upsertFileIntelligence({
      repoFullName,
      filePath,
      blobSHA:    currentBlobSHA,
      branch,
      agentId,
      findings,
      nodeIds,
      confidence,
    });
    persistedAt = record.analyzedAt.toISOString();
    wasDeduped  = duped;
    console.log(
      `[${agentId}] persisted file=${filePath}` +
      ` findings=${findings.length}` +
      ` deduped=${wasDeduped}` +
      ` nodeIds=${nodeIds.join(",")}`
    );
  } catch (err) {
    console.error(`[${agentId}] persist_failed file=${filePath}`, err);
  }

  // 8. Generate and store semantic embedding (OpenAI only, fire-and-forget)
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
          `[${agentId}] embedding_stored file=${filePath}` +
          ` dims=${vector.length}` +
          ` domain=${domainName ?? "unknown"}`
        );
      } catch (err) {
        console.warn(
          `[${agentId}] embedding_failed file=${filePath}`,
          err instanceof Error ? err.message : String(err)
        );
      }
    })();
  }

  return {
    agentId,
    repoFullName,
    filePath,
    blobSHA:         currentBlobSHA,
    findings,
    persistedAt,
    nodeAttachments: nodeIds,
    wasDeduped,
  };
}
