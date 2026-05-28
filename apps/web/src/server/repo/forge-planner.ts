/**
 * Forge — Implementation Planner Module.
 *
 * Aggregates findings from Cipher, Sentinel, Pulse, and Atlas into a
 * prioritised implementation roadmap. Forge is the synthesis layer —
 * it never analyses files directly; it reasons over upstream findings.
 *
 * CURRENT STATE: Schema stub with nil-path guard and budget cap.
 * The AI call and roadmap generation are TODO (Phase 2 of the build).
 *
 * Nil-path guard (P1 requirement):
 *   If totalFindingsAvailable === 0, Forge returns immediately with
 *   status: "insufficient_evidence". This prevents a Forge call being
 *   made when no upstream modules have run yet (cold start, dry-run repos).
 *
 * Budget cap:
 *   ForgeInput is limited to 20 findings total (5 per upstream module).
 *   This prevents context overflow when passing findings to the AI provider.
 *   Callers must trim findings to budget before calling createImplementationPlan().
 *
 * XML delimiters:
 *   When passing finding data to the AI prompt (Phase 2), agentReasoning
 *   fields will be wrapped in <evidence>...</evidence> XML tags to prevent
 *   prompt injection through finding content.
 *
 * SECURITY: agentReasoning fields from upstream modules may contain
 * user-controlled strings (file paths, variable names). XML delimiters
 * prevent these from being interpreted as prompt instructions.
 */

import type { ForgeInput, ForgeResult, ForgeRoadmapStep } from "@/types/intelligence";

// ─── Budget constants ─────────────────────────────────────────

/** Maximum total findings passed to Forge's AI prompt. */
export const FORGE_TOTAL_BUDGET = 20;

/** Maximum findings per upstream module. */
export const FORGE_PER_MODULE_BUDGET = 5;

// ─── Budget cap helper ────────────────────────────────────────

/**
 * Trim ForgeInput findings to budget before calling createImplementationPlan().
 * Prioritises findings by confidence: confirmed > inferred > speculative.
 * Within same confidence, preserves original order (caller ordering is preserved).
 *
 * @example
 *   const budgeted = applyForgeBudget(rawInput);
 *   const result = await createImplementationPlan(budgeted);
 */
export function applyForgeBudget(input: ForgeInput): ForgeInput {
  const CONFIDENCE_RANK = { confirmed: 0, inferred: 1, speculative: 2 };

  function trim<T extends { confidence: string }>(
    findings: T[] | undefined,
    cap: number
  ): T[] | undefined {
    if (!findings || findings.length === 0) return findings;
    const sorted = [...findings].sort(
      (a, b) =>
        (CONFIDENCE_RANK[a.confidence as keyof typeof CONFIDENCE_RANK] ?? 3) -
        (CONFIDENCE_RANK[b.confidence as keyof typeof CONFIDENCE_RANK] ?? 3)
    );
    return sorted.slice(0, cap);
  }

  const capped = {
    cipher:   trim(input.findingsByModule.cipher,   FORGE_PER_MODULE_BUDGET),
    sentinel: trim(input.findingsByModule.sentinel, FORGE_PER_MODULE_BUDGET),
    pulse:    trim(input.findingsByModule.pulse,    FORGE_PER_MODULE_BUDGET),
    atlas:    input.findingsByModule.atlas, // atlas is a tree, not a findings array
  };

  const total =
    (capped.cipher?.length   ?? 0) +
    (capped.sentinel?.length ?? 0) +
    (capped.pulse?.length    ?? 0);

  return {
    ...input,
    findingsByModule:       capped,
    totalFindingsAvailable: total,
  };
}

// ─── XML delimiter helper ─────────────────────────────────────

/**
 * Wrap agentReasoning in XML delimiters before injecting into AI prompts.
 * Prevents prompt injection through finding content.
 * Used in Phase 2 when the AI call is implemented.
 */
export function wrapReasoningForPrompt(reasoning: string): string {
  return `<evidence>${reasoning}</evidence>`;
}

// ─── Stub implementation ──────────────────────────────────────

/**
 * Create an implementation roadmap from upstream module findings.
 *
 * Currently a stub — returns "insufficient_evidence" for empty inputs
 * and a placeholder roadmap for non-empty inputs.
 *
 * Phase 2 will replace the stub body with a real AI call that produces
 * a prioritised list of ForgeRoadmapStep[].
 */
export async function createImplementationPlan(
  input: ForgeInput
): Promise<ForgeResult> {
  const { repoFullName, totalFindingsAvailable } = input;

  // ── Nil-path guard ────────────────────────────────────────
  if (totalFindingsAvailable === 0) {
    console.log(
      `[forge] insufficient_evidence repo=${repoFullName}` +
      ` reason="no upstream findings available"`
    );
    return {
      agentId:     "forge",
      repoFullName,
      status:      "insufficient_evidence",
      roadmap:     null,
      message:     "No upstream findings available. Run Cipher, Sentinel, Pulse, or Atlas on repository files before requesting an implementation plan.",
      persistedAt: null,
    };
  }

  // ── Budget enforcement ────────────────────────────────────
  const { cipher = [], sentinel = [], pulse = [] } = input.findingsByModule;
  const allFindings = [...cipher, ...sentinel, ...pulse];

  if (allFindings.length > FORGE_TOTAL_BUDGET) {
    console.warn(
      `[forge] budget_exceeded repo=${repoFullName}` +
      ` findings=${allFindings.length} budget=${FORGE_TOTAL_BUDGET}` +
      ` — caller should use applyForgeBudget() before calling createImplementationPlan()`
    );
  }

  // ── TODO: Phase 2 — AI call goes here ────────────────────
  // When implemented, this section will:
  // 1. Build the Forge system prompt (implementation planner persona)
  // 2. Format upstream findings with XML delimiters:
  //    allFindings.map(f => `<finding id="${f.id}">\n  ${wrapReasoningForPrompt(f.agentReasoning)}\n</finding>`)
  // 3. Call AI provider (provider config passed via params)
  // 4. Parse ForgeRoadmapStep[] from response
  // 5. Persist to FileIntelligence with filePath = "__forge__"
  // 6. Return ForgeResult with status: "success"
  //
  // For now, return a placeholder to unblock UI integration.

  const placeholderRoadmap: ForgeRoadmapStep[] = allFindings
    .slice(0, FORGE_TOTAL_BUDGET)
    .map((f, i) => ({
      priority:    i < 3 ? "P0" as const : i < 8 ? "P1" as const : "P2" as const,
      title:       f.title,
      description: `Address: ${f.description.slice(0, 200)}`,
      targetFiles: f.relatedFilePaths ?? [],
      sourcedFrom: [f.id],
    }));

  console.log(
    `[forge] stub_result repo=${repoFullName}` +
    ` findings_in=${allFindings.length}` +
    ` steps_out=${placeholderRoadmap.length}` +
    ` (phase 2 AI call not yet implemented)`
  );

  return {
    agentId:     "forge",
    repoFullName,
    status:      "success",
    roadmap:     placeholderRoadmap,
    persistedAt: null,
  };
}
