/**
 * Sentinel — Security Intelligence Module.
 *
 * Analyses a single repository file for observable security patterns.
 * Built on the shared file analysis pipeline — 80% code reuse from Cipher.
 *
 * Sentinel is a Cipher variant with:
 *   1. A security-focused system prompt (OWASP Top 10, injection, secrets, auth)
 *   2. A post-processor that strips false-positive "all clear" claims
 *
 * Key difference from Cipher:
 *   - agentId: "sentinel" → separate FileIntelligence row per file (no overwrite)
 *   - Finding types focused on: security-signal, integrity, dependency
 *   - Post-processor enforces: no "application is secure" claims without line evidence
 *
 * Pipeline: identical to Cipher (see shared-file-analyzer.ts).
 *
 * SECURITY: githubToken never leaves this module. Not included in any response.
 * API keys are decrypted server-side by the caller.
 */

import { analyzeFileWithModule }  from "@/server/repo/shared-file-analyzer";
import type { CipherFinding, AgentResult } from "@/types/intelligence";

// ─── Sentinel system prompt ───────────────────────────────────

const SENTINEL_SYSTEM_PROMPT = `You are Sentinel, the Security Intelligence Module for DE-code X.

Your job is to analyze the provided source file for observable security patterns.

STRICT RULES — violations destroy user trust:
1. ONLY analyze what is in the provided file content.
2. NEVER claim a vulnerability exists without citing the exact line(s) that show it.
3. NEVER produce findings like "this application could be vulnerable to X" without line evidence.
4. For every finding, quote the specific line number(s) where you see the pattern.
5. If you cannot determine something without seeing other files, label it "speculative" and say so.
6. Do NOT produce generic findings like "input should be validated" without citing specific lines.
7. Surface at least 1 finding when the file touches security-relevant surfaces (auth, input handling,
   crypto, sessions, tokens, secrets, network I/O, file I/O, SQL, eval, exec). Empty arrays should
   be RARE — only for purely declarative files (types, constants) with no security-relevant code.
   For inferred/speculative observations, mark them as such — partial signal beats silence.

Confidence levels you MUST use correctly:
- "confirmed"   → you can quote the exact line(s) showing the security pattern
- "inferred"    → reasonable deduction from code structure (say "inferred from X at line N")
- "speculative" → possible concern, requires more context — MUST say what context is needed

Focus areas (in priority order):
1. Injection risks — SQL, command, template, LDAP injection observable in code
2. Authentication/authorization — missing auth guards, insecure token handling, privilege escalation
3. Secrets and credentials — hardcoded keys, tokens, passwords, or weak key generation
4. Input validation — missing validation on user-controlled data going into dangerous operations
5. Insecure data exposure — sensitive data in logs, error responses, or client-facing payloads
6. Dependency signals — use of known-vulnerable patterns, deprecated crypto, unsafe deserialization
7. Security misconfiguration — CORS wildcards, debug flags in production paths, permissive CSP

Finding type: ALWAYS use "security-signal" for security patterns.
Use "integrity" for logic flaws that have security implications.
Use "dependency" for dangerous imports or coupling to insecure libraries.

agentReasoning is REQUIRED on every finding. Be specific:
  Good: "Line 47 passes user.input directly to exec() without sanitization"
  Bad:  "This function may be vulnerable to injection"

Return a JSON array of findings. If you find nothing notable, return [].
Schema for each finding:
{
  "id": "<filePath-type-slugified-title>",
  "type": "security-signal",
  "title": "<≤80 chars>",
  "description": "<full description with OWASP reference if applicable>",
  "confidence": "<confirmed|inferred|speculative>",
  "evidenceLines": { "start": N, "end": N },
  "relatedFilePaths": [],
  "agentReasoning": "<specific, cite line numbers>",
  "metadata": { "owasp": "<category if applicable>", "cvePattern": "<pattern if applicable>" }
}`;

// ─── False-positive post-processor ───────────────────────────

/**
 * Strip findings that are security false positives.
 * Sentinel must never claim an application is secure — only flag observable risks.
 *
 * Strips findings where agentReasoning contains generic "all clear" language
 * without any specific line evidence (no "line N" or "Line N" reference).
 */
function sentinelPostProcess(findings: CipherFinding[], filePath: string): CipherFinding[] {
  const FALSE_POSITIVE_PHRASES = [
    "application is secure",
    "no security issues",
    "secure implementation",
    "no vulnerabilities found",
    "no security concerns",
    "properly secured",
    "security looks good",
    "no issues detected",
    "follows security best practices",
    "no sensitive data exposed",
  ];

  const LINE_REFERENCE_RE = /[Ll]ine\s+\d+|:\s*\d+/;

  return findings.filter(f => {
    const reasoning = f.agentReasoning.toLowerCase();

    // Strip findings that assert "all is fine" — these are not valid security findings
    for (const phrase of FALSE_POSITIVE_PHRASES) {
      if (reasoning.includes(phrase)) {
        console.log(
          `[sentinel] post_process_strip finding="${f.title}" file=${filePath}` +
          ` reason="false_positive_phrase: ${phrase}"`
        );
        return false;
      }
    }

    // Strip "confirmed" findings that have no line reference in their reasoning
    // (a confirmed finding without a line number is impossible by definition)
    if (f.confidence === "confirmed" && !LINE_REFERENCE_RE.test(f.agentReasoning)) {
      console.log(
        `[sentinel] post_process_strip finding="${f.title}" file=${filePath}` +
        ` reason="confirmed_without_line_reference"`
      );
      return false;
    }

    return true;
  });
}

// ─── Public API ───────────────────────────────────────────────

export interface SentinelAnalyzeParams {
  owner:       string;
  repo:        string;
  filePath:    string;
  branch:      string;
  githubToken: string;
  aiConfig: {
    provider: "anthropic" | "openai" | "openrouter" | "gemini";
    apiKey:   string;
    model?:   string;
  };
  dryRun?: boolean;
}

/**
 * Analyse a single repository file with Sentinel (security focus).
 *
 * Returns AgentResult with agentId: "sentinel".
 * Findings are stored separately from Cipher's — Sentinel never overwrites
 * Cipher's analysis of the same file.
 */
export async function analyzeFileWithSentinel(
  params: SentinelAnalyzeParams
): Promise<AgentResult> {
  return analyzeFileWithModule({
    ...params,
    agentId:      "sentinel",
    systemPrompt: SENTINEL_SYSTEM_PROMPT,
    postProcess:  sentinelPostProcess,
  });
}
