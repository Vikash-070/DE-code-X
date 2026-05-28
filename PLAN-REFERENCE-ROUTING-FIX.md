# PLAN — Reference Intelligence: Routing + Prompt Assembly Fix

**Status:** ✅ Shipped — 2026-05-27. TypeScript: 0 errors.
**Type:** Targeted bugfix (2 confirmed bugs, 3 files)
**Session:** autoplan
**Created:** 2026-05-27

---

## Bug Report

### Bug 1 — Intent Routing Failure

**File:** `server/ai/reference-intent.ts`
**Root cause:** `UNDERSTANDING_RE` uses `what\s+is\s+this` — requires exact adjacency of "is" and "this". Phrases with a word between them ("what is **in** this video") produce zero match → defaults to `evaluation` mode.

Missing patterns:
- "what is in this video" — "in" between "is" and "this" breaks the match
- "elaborate" — not in regex at all
- "teach me" — not in regex at all

**Confirmed failing inputs:**
- `"what is in this video? https://youtu.be/abc"` → `evaluation` (WRONG — should be `understanding`)
- `"elaborate this https://youtu.be/abc"` → `evaluation` (WRONG)
- `"teach me this https://youtu.be/abc"` → `evaluation` (WRONG)

### Bug 2 — Prompt Composition: Missing Transcript in Evaluation Path

**File:** `server/ai/vhash-prompt.ts` + `app/api/orchestrate/route.ts`
**Root cause:** `buildVHashSystemPromptWithEvaluation()` receives structured `intent` (extracted by Stage 3 LLM) and `evaluation` results — but NOT the raw transcript text. V# has no content to work with when a user asks a content question while routing was `evaluation`. The `buildVHashSystemPromptForReferenceUnderstanding()` function correctly injects `refContent.text` — the evaluation path never does.

**Consequence:** Even when transcript fetch succeeds, if Stage 3 (intent extraction) fails (no key, timeout, decrypt error), system falls to `hasReference` failure prompt. Worse, even on success, evaluation prompt omits raw content → V# correctly says "I can't access video content" because it genuinely wasn't given the content.

---

## Fix Scope: 5 Phases

| Phase | File | Change |
|-------|------|--------|
| 1 | `reference-intent.ts` | Expand `UNDERSTANDING_RE`: add `(in\s+)?` to `what\s+is\s+this`, add `elaborate`, `teach\s+me` |
| 2 | `vhash-prompt.ts` | Strengthen anti-contamination language in `buildVHashSystemPromptForReferenceUnderstanding()` |
| 3 | `route.ts` | Add `[reference] transcript_injected`, `evaluation_prompt_selected`, `hybrid_prompt_selected`, `understanding_prompt_selected` telemetry |
| 4 | `route.ts` | Audit prompt cascade — verify no path allows `intent && evaluation` to fire in understanding mode |
| 5 | `route.ts` | Fail-safe guard: when `refContent?.text.length > 0`, append transcript-available directive to final `systemPrompt` |

---

## Decision Audit Trail

| # | Decision | Classification | Rationale |
|---|----------|----------------|-----------|
| 1 | Expand UNDERSTANDING_RE with `(in\s+)?` | Mechanical | Minimal regex change — preserves all existing matches, adds the "in" optional group |
| 2 | Add `elaborate` + `teach\s+me` to UNDERSTANDING_RE | Mechanical | Clear understanding signals — no evaluation ambiguity |
| 3 | Strengthen understanding prompt anti-contamination | Quality | Prevents V# from slipping into "I can't access" when transcript IS present |
| 4 | Phase 5 fail-safe appended after prompt selection | Safety | Blanket protection regardless of which prompt path activated |
| 5 | All 5 phases in one commit | Scope | Bugs are related — fixing routing without the fail-safe leaves evaluation path vulnerable |

---

## GSTACK REVIEW REPORT

| Run | Phase | Status | Findings |
|-----|-------|--------|---------|
| 2026-05-27 | D1 gate | approved | All 5 phases confirmed |
| 2026-05-27 | Eng verification | confirmed | Both bugs verified from source code |
| 2026-05-27 | Implementation | shipped | All 5 phases. TypeScript: 0 errors. |
