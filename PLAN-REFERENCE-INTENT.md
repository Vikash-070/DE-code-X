<!-- /autoplan restore point: /c/Users/VIKASH/.gstack/projects/De-codex/reference-intent-autoplan-restore-20260527.md -->

# PLAN — Intent-Aware Reference Routing

**Status:** ✅ Shipped — 2026-05-27. TypeScript: 0 errors.
**Session:** autoplan (reference intent routing)
**Created:** 2026-05-27

---

## Problem Statement

The pipeline runs full repo evaluation for EVERY reference URL, even when the
user just wants to understand what the content is about.

**Confirmed waste pattern:**
- User: "what is this talking about? https://youtu.be/..."
- Pipeline: Stage 3 (LLM intent extraction) + Stage 3.5 (file retrieval) + Stage 4 (compatibility eval)
- Result: V# gives a compatibility analysis the user never asked for

Current behavior: `hasReference=true` → always full pipeline
Required behavior: route to the pipeline stage set appropriate for the user's *intent*

---

## Solution: `detectReferenceIntent(message)`

Deterministic keyword heuristic — no LLM calls, no network.
Runs at the route handler boundary before any pipeline stage activates.

**Modes:**

| Mode | Trigger | Pipeline | V# output |
|------|---------|----------|-----------|
| `"understanding"` | user wants content explained | Stage 2 only (fetch) | Explain what the reference demonstrates |
| `"evaluation"` | user wants to know if they can build it | Stages 2, 3, 3.5, 4 | Full compatibility analysis (current default) |
| `"hybrid"` | user wants both | Stages 2, 3, 3.5, 4 | Summary first, then compatibility analysis |

**Default:** `"evaluation"` — preserves current behavior when intent is unclear.

---

## What We Are NOT Building

- LLM-based intent classification (no additional API calls)
- UI-level mode selector (fully automatic, no user input required)
- Per-session mode memory
- Streaming partial results (one response, single pass)

---

## What We ARE Building

### 1. `detectReferenceIntent(message: string): ReferenceIntentMode`

New file: `server/ai/reference-intent.ts`

```typescript
export type ReferenceIntentMode = "understanding" | "evaluation" | "hybrid";

const UNDERSTANDING_RE = /\b(what\s+is\s+this|what'?s\s+this|what\s+are\s+they|what\s+is\s+he|what\s+is\s+she|explain|summarize|summary|overview|tell\s+me\s+about|what\s+does\s+this|what\s+technology|what\s+framework|what\s+tool|how\s+does\s+this\s+work|looking\s+at|watching)\b/i;

const EVALUATION_RE = /\b(can\s+we\s+build|can\s+i\s+build|build\s+this|implement\s+this|add\s+this|integrate|compatible|support\s+this|works?\s+with|does\s+our|should\s+we|estimate|complexity|effort|feasibility|fits|already\s+have|missing|how\s+long|can\s+this\s+be|how\s+hard)\b/i;

export function detectReferenceIntent(message: string): ReferenceIntentMode {
  const hasUnderstanding = UNDERSTANDING_RE.test(message);
  const hasEvaluation    = EVALUATION_RE.test(message);

  if (hasUnderstanding && hasEvaluation) return "hybrid";
  if (hasUnderstanding) return "understanding";
  return "evaluation"; // default — covers evaluation-only AND unclear/URL-only messages
}
```

### 2. `buildVHashSystemPromptForReferenceUnderstanding()`

New export in `server/ai/vhash-prompt.ts`. Minimal prompt — tells V# to
explain what the reference demonstrates and relate it to the repo architecture.
No evaluation data injected.

### 3. `orchestrate/route.ts` — Pipeline routing

```
hasReference=true
  → detectReferenceIntent(message) → mode

mode === "understanding":
  → Stage 2 (fetch) — get transcript/title
  → SKIP Stage 3 (no LLM extraction call — saves ~350ms + API credits)
  → SKIP Stage 3.5 (no file retrieval)
  → SKIP Stage 4 (no compatibility eval)
  → buildVHashSystemPromptForReferenceUnderstanding(ctx, title, text, platformType)

mode === "evaluation" (default):
  → Stage 2 (fetch)
  → Stage 3 (intent extraction)
  → Stage 3.5 (intent-derived retrieval)
  → Stage 4 (compatibility evaluation)
  → buildVHashSystemPromptWithEvaluation(...)  ← unchanged

mode === "hybrid":
  → Stage 2 (fetch)
  → Stage 3 (intent extraction)
  → Stage 3.5 (intent-derived retrieval)
  → Stage 4 (compatibility evaluation)
  → buildVHashSystemPromptWithEvaluation(..., { summarizeFirst: true })
```

**Note on hybrid:** `summarizeFirst` adds one directive sentence to the existing
evaluation prompt: "Start with a 2-3 sentence plain-English summary of what this
reference demonstrates, then give the full compatibility analysis below."

---

## File Scope (3 files)

| File | Change |
|------|--------|
| `server/ai/reference-intent.ts` | NEW — `ReferenceIntentMode` type, `UNDERSTANDING_RE`, `EVALUATION_RE`, `detectReferenceIntent()` |
| `server/ai/vhash-prompt.ts` | ADD `buildVHashSystemPromptForReferenceUnderstanding()` export; ADD `summarizeFirst?: boolean` param to `buildVHashSystemPromptWithEvaluation` |
| `app/api/orchestrate/route.ts` | ADD import; call `detectReferenceIntent()` after `hasReference` is confirmed; branch Stage 3+3.5+4 on mode; route to appropriate prompt builder |

---

## Telemetry

```
[reference] intent_mode_detected mode=... (emitted right after detectReferenceIntent)
[reference] pipeline_skipped_stages stages=3,3.5,4 mode=understanding (when understanding)
```

---

## Edge Cases

| Input | Expected mode |
|-------|--------------|
| `"https://youtu.be/abc"` (URL only, no question) | `"evaluation"` (default) |
| `"what is this https://youtu.be/abc"` | `"understanding"` |
| `"can we build this? https://youtu.be/abc"` | `"evaluation"` |
| `"explain this and tell me if we can build it https://youtu.be/abc"` | `"hybrid"` |
| `"check this out https://youtu.be/abc"` | `"evaluation"` (default — no strong signal) |
| `"what framework is this using? https://youtu.be/abc"` | `"understanding"` |

---

## Decision Audit Trail

| # | Decision | Classification | Principle | Rationale |
|---|----------|----------------|-----------|-----------|
| 1 | Default mode = "evaluation" | Mechanical | P5 | Preserves current pipeline behavior. URL-only messages (no question) get full analysis — correct default for an engineering assistant |
| 2 | Skip Stage 3 (LLM call) for understanding mode | Performance | P3 | Stage 3 extracts implementation patterns — unused in understanding mode. Raw transcript + title sufficient for V# to explain content. Saves ~350ms + API credits |
| 3 | hybrid runs full pipeline, adds summarizeFirst directive | Mechanical | P5 | Avoids a third code path; the evaluation data is already computed so summary is free (just a prompt directive). No extra LLM call |
| 4 | Deterministic regex, no LLM classification | Mechanical | P4 | An LLM call to classify intent defeats the purpose (cost, latency). Regex heuristics are fast, transparent, testable |
| 5 | detectReferenceIntent() is pure (no side effects) | Mechanical | P1 | Idempotent, zero I/O — can be called at route boundary without cost |

---

## GSTACK REVIEW REPORT

| Run | Skill | Status | Findings |
|-----|-------|--------|---------|
| 2026-05-27 | autoplan | plan_draft | 3-file scope, deterministic routing, default=evaluation |

