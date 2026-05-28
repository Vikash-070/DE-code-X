<!-- /autoplan restore point: /c/Users/VIKASH/.gstack/projects/De-codex/master-autoplan-restore-20260526-233922.md -->

# PLAN — Semantic Implementation Intelligence Layer

**Status:** In planning
**Session:** autoplan (semantic quality upgrade)
**Created:** 2026-05-26

---

## Problem Statement

The Inspire pipeline executes end-to-end (URL detection, transcript extraction, intent extraction,
repo compatibility evaluation, synthesis). But the quality of implementation understanding is shallow.

**Confirmed failure:** A rate-limiting architecture reference produced "Use Redis + YAML + custom rate limiters."

Root cause trace:
1. `extractImplementationIntent()` produces 4 generic fields (patterns, stackHints, coreFeatures, uiPatterns)
   with a 5-line system prompt → outputs "rate limiting", "Redis" — not "sliding window limiting" or "middleware throttling"
2. `evaluateRepoCompatibility()` matches intent.coreFeatures against ctx.architecturePatterns (often null)
   and file PATHS — not file contents → nearly always reports "poor" fit with no supporting evidence
3. `buildVHashSystemPromptWithEvaluation()` injects shallow evaluation → model falls back to pretrained Redis advice

**This is not an AI capability problem. It is an extraction quality and evidence sourcing failure.**

---

## What We Are NOT Building

- Bigger prompts or higher token budgets
- Additional LLM calls (Stage 3 remains 1 call, max_tokens=250)
- Vector DB, embeddings, semantic search infrastructure
- Visible agent chains
- Autonomous multi-step orchestration

---

## What We ARE Building

A **Semantic Implementation Intelligence Layer** that produces engineering-domain-specific understanding:

```
reference transcript
  → Stage 3: deeper semantic extraction (7-field engineering schema, tighter prompt)
  → Stage 3.5: intent-derived retrieval (derive search targets from intent, fetch actual code files)
  → Stage 4: evidence-backed compatibility reasoning (match against file content, not just paths)
  → Stage 4.5: confidence model (express confidence based on retrieval coverage)
  → Stage 5: grounded synthesis prompt (reason from evidence, not pretrained patterns)
```

---

## New Extraction Schema (Stage 3)

Replace the 4-field generic schema with a 7-field engineering-domain schema:

```typescript
interface ImplementationIntent {
  // Engineering-specific NEW fields
  systems:              string[];  // named engineering systems: "API middleware layer", "Redis TTL cache"
  realtimeBehaviors:    string[];  // async/realtime behaviors: "burst protection", "request queuing"
  architectureConcerns: string[];  // architecture implications: "horizontal scaling", "edge consistency"

  // Existing fields (kept for backward compat + synthesis prompt)
  patterns:     string[];  // specific patterns: "sliding window limiting" not "rate limiting"
  stackHints:   string[];  // technology names
  coreFeatures: string[];  // product features
  uiPatterns:   string[];  // UI/UX patterns

  sourceType:   "youtube" | "loom" | "twitter" | "unknown";
  sourceTitle?: string;
}
```

New system prompt (replaces 5-line generic prompt):
```
Extract structured implementation engineering semantics.
Return ONLY valid JSON with these fields:
{
  "patterns": ["specific implementation patterns, max 5 — 'sliding window rate limiting' not 'rate limiting'"],
  "systems": ["named engineering systems required, max 5 — 'request throttling middleware', 'Redis TTL storage'"],
  "realtimeBehaviors": ["async/realtime behaviors, max 3 — 'burst protection', 'request queuing'"],
  "architectureConcerns": ["architecture implications, max 3 — 'horizontal scaling', 'stateless APIs'"],
  "stackHints": ["technology names only, max 5"],
  "coreFeatures": ["product features, max 5"],
  "uiPatterns": ["UI/UX patterns if applicable, max 3"]
}
Be domain-specific. Empty arrays OK. No nested objects.
```

---

## Intent-Derived Retrieval (Stage 3.5)

After intent extraction, derive retrieval search targets from the extracted semantic fields.
Search the cached tree (no extra GitHub API call — tree is already cached from session start) + fetch 2-3 targeted files.

**CRITICAL ENGINEERING NOTE:** `buildRetrievalContext()` cannot be used here.
It calls `extractCodeRefs()` internally which requires file extensions or explicit file references.
An intent-derived query like `"request throttling middleware"` produces zero `extractCodeRefs()` matches → function returns null.
`buildIntentRetrievalContext()` MUST call `searchTree()` and `fetchFileContent()` directly.

**Retrieval target derivation:**
- `intent.systems.slice(0, 3)` → direct search terms (most specific, e.g. "throttle middleware")
- `intent.patterns.slice(0, 2)` → fallback terms (e.g. "rate limit", "sliding window")
- Tokenize each term to 1-2 keywords before calling `searchTree()`

**New function in orchestrate/route.ts:**
```typescript
async function buildIntentRetrievalContext(
  intent:  ImplementationIntent,
  ctx:     RepoContextInput,
  clerkId: string
): Promise<CodeContext | null>
```

Internal implementation:
1. Get GitHub token via `clerkClient().users.getUserOauthAccessToken(clerkId, "github")`
2. Get tree via `fetchRepoTree(owner, repo, branch, token)` — always cache hit in reference flow
3. Derive search terms: `[...intent.systems, ...intent.patterns].slice(0, 4).map(tokenizeToKeyword)`
4. `searchTree(tree, term, 3)` for each term — collect and deduplicate paths
5. `fetchFileContent()` for top 2-3 paths concurrently
6. Return `{ files: budgeted, treeQuery: derivedTerms.join(" ") }`
7. Hard 3s timeout on the entire function (Promise.race)

**New imports needed in orchestrate/route.ts:**
- `clerkClient` from `@clerk/nextjs/server` (add to existing auth import)
- `fetchRepoTree, searchTree` from `@/services/github/tree`
- `fetchFileContent` from `@/services/github/file`

**codeContextPromise change:** When `hasReference=true`, skip the user-message-based
`codeContextPromise` entirely (set to `Promise.resolve(null)`). Intent-derived retrieval
runs sequentially after Stage 3 and replaces it.

---

## Evidence-Backed Compatibility (Stage 4)

Extend `evaluateRepoCompatibility()`:
1. Match `intent.systems` AND `intent.coreFeatures` against capabilities (currently only coreFeatures)
2. Content-based second pass: for each missing item, check if any `code.files[].content` contains evidence
   - Implementation: `terms = tokenize(system).filter(t => t.length >= 5)`; check `file.content.toLowerCase().includes(term)` for any term
   - If any term hit → move from `missingSystems` to `alreadySupported` with "(evidence from [file.path])"
3. Add confidence field: `high | medium | low` based on retrieval coverage

```typescript
interface ReferenceEvaluation {
  alreadySupported: string[];
  missingSystems:   string[];
  complexity:       "low" | "medium" | "high";
  complexityReason: string;
  architectureFit:  "good" | "partial" | "poor";
  confidence:       "high" | "medium" | "low";  // NEW
  confidenceReason: string;                      // NEW: explains basis for assessment
}
```

**Confidence rules:**
- `high`: code files retrieved AND content matched against specific systems
- `medium`: code files retrieved but generic/sparse content, OR ctx.architecturePatterns available
- `low`: no code files retrieved, matched against file paths only (or ctx is empty)

---

## Grounded Synthesis Prompt (Stage 5)

Update `buildVHashSystemPromptWithEvaluation()` to:
1. Expose confidence level explicitly to V#
2. Reference the `systems` field (not just patterns) in the evaluation block
3. Add `architectureConcerns` to the synthesis context

V# directive now includes:
```
Evaluation confidence: [HIGH/MEDIUM/LOW]. Reason: [confidenceReason]
[If LOW or MEDIUM]: Note that some systems may not have been inspected — acknowledge this uncertainty.
```

---

## File Scope (3 files, all modifications)

| File | Change |
|------|--------|
| `server/ai/reference-evaluator.ts` | 7-field schema + cache version bump (v2); tighter extraction prompt; `max_tokens=350`; iterate intent.systems in Stage 4; content-based second pass (substring in file.content); confidence model |
| `server/ai/vhash-prompt.ts` | Update `EvalIntent`/`EvalResult` aliases (+confidence, +confidenceReason, +systems, +realtimeBehaviors, +architectureConcerns); update synthesis prompt: confidence-as-behavior directive |
| `app/api/orchestrate/route.ts` | Add imports (clerkClient, fetchRepoTree, searchTree, fetchFileContent); add `buildIntentRetrievalContext()` (calls searchTree directly, NOT buildRetrievalContext); skip codeContextPromise when hasReference=true; wire Stage 3.5 between Stage 3 and 4; `[semantic]` telemetry |

---

## Required Telemetry

```
[semantic] extraction_started contentLen=... sourceType=...
[semantic] extraction_success patterns=N systems=N behaviors=N concerns=N
[semantic] retrieval_targets derived=["middleware", "rate-limit", ...]
[semantic] retrieval_complete files=N chars=N
[semantic] compatibility_reasoning_started systems=N features=N
[semantic] confidence=high|medium|low reason=...
[semantic] evaluation_complete supported=N missing=N complexity=...
```

---

## Target Response Quality

Before:
> "Use Redis + YAML + custom rate limiters."

After:
> "I inspected your current API orchestration and middleware structure.
>
> Your architecture already supports:
> - authenticated route handling
> - centralized request flow  
> - Prisma-backed persistence
>
> Missing systems:
> - distributed request coordination
> - request throttling middleware
> - shared abuse-protection persistence
>
> Because your APIs currently run statelessly, scalable rate limiting would require introducing
> shared coordination storage such as Redis.
>
> Implementation complexity is moderate because your current routing architecture is already centralized.
>
> Confidence: Medium (middleware layer inspected; infrastructure layer not visible from current retrieval)"

---

## Token Budget Analysis

| Stage | Change | Token impact |
|-------|--------|-------------|
| Stage 3 intent extraction | Larger system prompt (+120 tokens in) | +120 tokens input |
| Stage 3 output | 7 fields at 3-5 items each | **max_tokens raised 250→350** (7 fields cannot safely fit in 250; new fields appear last and get truncated silently) |
| Stage 3.5 retrieval | No LLM call | 0 tokens |
| Stage 4 evaluation | No LLM call | 0 tokens |
| Stage 5 synthesis prompt | Confidence + systems blocks | +120 tokens context |
| **Total overhead** | | **+340 tokens per reference** |

**Cache versioning:** Intent cache key bumped to `v2:sha256...` to invalidate stale 4-field entries.
This is a 40% token increase for the extraction call, 0% for non-reference calls.

---

## CEO Review Findings

**Premise challenge result:** PARTIAL — Schema expansion is valuable but secondary. Stage 3.5 (intent-derived retrieval) is the highest-impact change per strategic review. Schema improves the retrieval TARGET QUALITY, not just labels.

**Reframing accepted:** Implementation priority reordered to: Stage 3.5 retrieval first, schema enhancement second.

**Confidence model design refinement:** Confidence should change V# BEHAVIOR, not add labels:
- `confidence: "low"` → V# asks user to paste code snippets or describe their infrastructure
- `confidence: "medium"` → V# qualifies assessment with "based on what I could inspect"
- `confidence: "high"` → V# speaks directly from evidence

**buildRetrievalContext() dependency:** Acknowledged as critical path — eng review will audit it.

**Embeddings:** Explicitly prohibited by project constraints. Not a valid counter-premise.

**NOT in scope:**
- Vector embeddings (prohibited)
- Persistent capability model (12-month ideal, not this plan)
- `buildRetrievalContext()` changes (use as-is)

**What already exists:**
- `buildRetrievalContext()` in `services/github/retrieval.ts` — use unchanged
- `searchTree()` with substring matching — already handles "throttl*", "limit*"
- 5-min file cache, 10-min tree cache — retrieval is fast on second calls
- `semanticMatch()` with synonym expansion — extend, not replace

---

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale |
|---|-------|----------|----------------|-----------|-----------|
| 1 | CEO | Approach A: richer schema + evidence matching | Mechanical | P1 | B (bigger tokens) prohibited; C (repo summary) is separate; A is only valid option |
| 2 | CEO | Stage 3.5 retrieval is highest-priority change | Taste | P6 | Subagent correctly identifies retrieval as primary fix; schema feeds retrieval |
| 3 | CEO | Confidence model changes V# behavior, not just labels | Mechanical | P5 | Labels without behavior = hedging theater; behavior = useful |
| 4 | CEO | Embeddings not a valid counter-premise | Mechanical | P3 | Explicitly prohibited in CLAUDE.md and user brief |
| 5 | CEO | Audit buildRetrievalContext() in eng review | Mechanical | P2 | Hidden dependency in blast radius must be verified |
| 6 | Eng | buildIntentRetrievalContext() calls searchTree() directly, NOT buildRetrievalContext() | Mechanical | P5 | buildRetrievalContext() gates on extractCodeRefs() which requires file extensions — intent queries never match; must bypass |
| 7 | Eng | max_tokens raised 250→350 for extraction call | Mechanical | P1 | 7 fields can exceed 250 tokens at max capacity; new high-value fields appear last and silently truncate |
| 8 | Eng | Intent cache bumped to v2 | Mechanical | P1 | Old 4-field cache entries missing new fields; v2 prefix forces re-extraction for all live cache entries |
| 9 | Eng | evaluateRepoCompatibility() iterates intent.systems in addition to coreFeatures | Mechanical | P1 | Systems field is the highest-value new extraction; must be evaluated against repo capabilities |
| 10 | Eng | Content-based second pass: substring match on file.content | Mechanical | P5 | Specified as: tokenize system name, check content.includes(term) for terms ≥5 chars |

---

## GSTACK REVIEW REPORT

| Run | Skill | Status | Findings |
|-----|-------|--------|---------|
| 2026-05-26 | plan-ceo-review | issues_open (2 unresolved taste) | Premise refined: retrieval > schema; confidence model redesigned as behavior, not labels |
| 2026-05-26 | plan-eng-review | issues_open (1 critical resolved) | buildIntentRetrievalContext() must use searchTree() directly; max_tokens 250→350; cache v2; systems field evaluation added |
| 2026-05-26 | autoplan-voices | subagent-only (codex unavailable) | CEO: 2/6 confirmed. Eng: 5/6 confirmed |
