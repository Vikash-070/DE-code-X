/**
 * Reference intent detector — pure, no network calls, no LLM.
 *
 * Classifies the user's message intent when a reference URL is present,
 * so the orchestration pipeline activates only the stages that are needed.
 *
 * Three modes:
 *   "understanding" — user wants the reference content explained (skip eval)
 *   "evaluation"    — user wants to know if they can build it (full pipeline, default)
 *   "hybrid"        — user wants both: explain first, then evaluate compatibility
 *
 * Called at the route boundary in orchestrate/route.ts before any async pipeline
 * stage starts. O(n) regex scan — zero latency impact.
 *
 * Pipeline impact by mode:
 *   understanding → Stage 2 (content fetch) only. Stage 3+3.5+4 skipped.
 *                   Saves ~550-850ms and one LLM API call per message.
 *   evaluation    → Stages 2, 3, 3.5, 4. Current default behavior. Unchanged.
 *   hybrid        → Stages 2, 3, 3.5, 4. Same data as evaluation; V# opens
 *                   with a brief summary before the compatibility analysis.
 */

export type ReferenceIntentMode = "understanding" | "evaluation" | "hybrid";

// ─── Understanding signals ─────────────────────────────────
//
// User wants to know what the reference content is about.
// Trigger words: "what is", "explain", "summarize", "overview", "tell me about",
// content-inspection questions ("what framework", "how does this work").
//
// Regex design notes:
//   • `what\s+is\s+(in\s+)?this` — covers both "what is this" AND "what is in this video"
//     (the "in" between "is" and "this" was previously breaking the match)
//   • `what'?s\s+(in\s+)?this` — covers "what's in this" / "whats in this"
//   • `elaborate` — explicit content-explanation signal; not an evaluation keyword
//   • `teach\s+me` — learning-mode phrasing; user wants content understood, not built

const UNDERSTANDING_RE =
  /\b(what\s+is\s+(in\s+)?this|what'?s\s+(in\s+)?this|what\s+are\s+they|what\s+is\s+he|what\s+is\s+she|explain|summarize|summary|overview|elaborate|teach\s+me|tell\s+me\s+about|what\s+does\s+this|what\s+is\s+this\s+about|what\s+technology|what\s+framework|what\s+tool|how\s+does\s+this\s+work|looking\s+at|watching)\b/i;

// ─── Evaluation signals ────────────────────────────────────
//
// User wants to know if they can implement this in their repository.
// Trigger words: build intent, compatibility questions, feasibility.

const EVALUATION_RE =
  /\b(can\s+we\s+build|can\s+i\s+build|build\s+this|implement\s+this|add\s+this|integrate|compatible|support\s+this|works?\s+with|does\s+our|should\s+we|estimate|complexity|effort|feasibility|fits|already\s+have|missing|how\s+long|can\s+this\s+be\s+built|how\s+hard)\b/i;

/**
 * Classify the user's intent for a message that contains a reference URL.
 *
 * Rules (in priority order):
 * 1. Both understanding + evaluation signals present → "hybrid"
 * 2. Understanding signals only → "understanding"
 * 3. Evaluation signals only → "evaluation"
 * 4. No signals (URL-only, vague phrasing) → "evaluation" (default)
 *
 * Default = "evaluation" preserves the current full-pipeline behavior for all
 * cases where the user's intent is ambiguous or not explicitly stated.
 *
 * Examples:
 *   "what is this? https://youtu.be/abc"              → "understanding"
 *   "what is in this video? https://youtu.be/abc"     → "understanding"
 *   "elaborate this https://youtu.be/abc"             → "understanding"
 *   "teach me this https://youtu.be/abc"              → "understanding"
 *   "can we build this? https://youtu.be/abc"         → "evaluation"
 *   "explain this and tell me if we can add it"       → "hybrid"
 *   "https://youtu.be/abc" (URL only)                 → "evaluation" (default)
 *   "check this out https://youtu.be/abc"             → "evaluation" (default)
 */
export function detectReferenceIntent(message: string): ReferenceIntentMode {
  const hasUnderstanding = UNDERSTANDING_RE.test(message);
  const hasEvaluation    = EVALUATION_RE.test(message);

  if (hasUnderstanding && hasEvaluation) return "hybrid";
  if (hasUnderstanding)                  return "understanding";
  return "evaluation";
}
