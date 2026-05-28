# PLAN — Repository-Aware Implementation Evaluation ("Inspire" Mode)

**Status:** Implemented ✓  
**Session:** autoplan  
**Created:** 2026-05-26

---

## Problem Statement

V# currently responds only to typed questions. Users discover implementation ideas from
YouTube tutorials, Loom walkthroughs, and X/Twitter demos — but there is no way to
ground those ideas against their actual repository. They must manually bridge the gap
between "I saw this in a video" and "can my codebase actually support this?"

This feature closes that gap: paste a reference URL → V# evaluates implementation
feasibility against the actual repository, then explains what's compatible, what's
missing, and how complex the work would be.

---

## What We Are NOT Building

- Video summarization ("here's what the video says")
- Visible agent chains
- Vector embeddings or semantic search
- Autonomous multi-agent orchestration
- Giant implementation documents on first pass
- Full video transcription pipelines
- Scraping infrastructure for arbitrary URLs

---

## What We ARE Building

A 5-stage compression pipeline that produces **implementation intelligence grounded in
repository understanding**:

```
URL in chat
  → Stage 1: URL classification + content fetch
  → Stage 2: Transcript/metadata extraction (capped at 3000 chars)
  → Stage 3: extractImplementationIntent() → compact JSON (250 tokens)
  → Stage 4: evaluateRepoCompatibility() + identifyMissingSystems() [internal, not streamed]
  → Stage 5: buildVHashSystemPromptWithEvaluation() → stream synthesis via OpenRouter
```

Target V# response:
> "I checked your current workspace orchestration and streaming architecture.
>  You already support: streaming SSE, auth middleware, Prisma ORM.
>  Missing systems: job queue, video transcript API wrapper, rate-limit middleware.
>  Implementation complexity is moderate because your OpenRouter abstraction already
>  handles the AI call pattern — you'd be extending it, not rebuilding it."

---

## URL Support (Phase 1 MVP)

| Platform  | Content available        | Method                              |
|-----------|--------------------------|-------------------------------------|
| YouTube   | Auto-transcript          | `youtube-transcript` npm package    |
| Loom      | OG description + title   | oEmbed / public metadata endpoint   |
| X/Twitter | Tweet text               | oEmbed API (no video transcript)    |

---

## File Plan

### NEW files

| File | Purpose |
|------|---------|
| `services/reference/url-parser.ts` | URL type detection, normalisation, validation |
| `services/reference/youtube.ts` | YouTube transcript fetch + chunking |
| `services/reference/loom.ts` | Loom metadata fetch |
| `server/ai/reference-evaluator.ts` | Stages 3+4: intent extraction + compatibility |

### MODIFIED files

| File | Change |
|------|--------|
| `app/api/orchestrate/route.ts` | Accept optional `referenceUrl` field; run reference pipeline |
| `server/ai/vhash-prompt.ts` | Add `buildVHashSystemPromptWithEvaluation()` |
| `features/workspace/workspace-session.tsx` | URL detection; reference pipeline state |
| `features/workspace/vhash-surface.tsx` | "Reference detected" UI indicator |

---

## Data Shapes

```typescript
// Stage 3 output — compact implementation intent
interface ImplementationIntent {
  patterns:     string[];   // e.g. ["drag-and-drop reordering", "inline comment threads"]
  stackHints:   string[];   // e.g. ["React", "WebSocket", "S3"]
  coreFeatures: string[];   // e.g. ["real-time sync", "file upload"]
  uiPatterns:   string[];   // e.g. ["activity feed", "kanban board"]
  sourceType:   "youtube" | "loom" | "twitter";
  sourceTitle?: string;
}

// Stage 4 output — internal evaluation (never streamed to client as JSON)
interface ReferenceEvaluation {
  alreadySupported: string[];   // architecture already present in repo
  missingSystems:   string[];   // required systems not found
  complexity:       "low" | "medium" | "high";
  complexityReason: string;     // one sentence
  architectureFit:  "good" | "partial" | "poor";
}

// Injected into orchestrate route request body
interface OrchestrationRequest {
  message:           string;
  history?:          ConversationTurn[];
  repositoryContext: RepoContextInput;
  referenceUrl?:     string;          // NEW — optional
}
```

---

## Stage Details

### Stage 1 — URL Parser (`services/reference/url-parser.ts`)
```
parseReferenceUrl(url: string): { type: "youtube"|"loom"|"twitter"|"unsupported"; id: string }
```
- Regex-based. Pure function. No network calls.
- YouTube: `youtube.com/watch?v=ID` | `youtu.be/ID`
- Loom: `loom.com/share/ID`
- X: `twitter.com/*/status/ID` | `x.com/*/status/ID`

### Stage 2 — Content Fetch
```
fetchReferenceContent(parsed: ParsedUrl, maxChars: 3000): Promise<{ text: string; title?: string }>
```
- Hard 5s timeout
- YouTube: `youtube-transcript` → transcript chunks joined → slice to 3000 chars
- Loom: fetch `https://www.loom.com/v1/oembed?url=...` → description + title
- X: fetch `https://publish.twitter.com/oembed?url=...` → html text stripped

### Stage 3 — Intent Extraction (`extractImplementationIntent()`)
```
extractImplementationIntent(content: string, apiKey: string): Promise<ImplementationIntent>
```
- Single OpenRouter call: max_tokens=250, temperature=0
- Specialized system prompt instructing compact JSON extraction
- Cached by SHA-256 of content string; 30-min TTL
- Fallback: returns minimal intent if JSON parse fails

### Stage 4 — Repo Compatibility (`evaluateRepoCompatibility()`)
```
evaluateRepoCompatibility(
  intent: ImplementationIntent,
  repoCtx: RepoContextInput,
  codeCtx: CodeContext | null
): ReferenceEvaluation
```
- NO AI call — pure analysis against known repo metadata + retrieved files
- Checks `architecturePatterns`, `authSystem`, `apiPattern`, file paths
- `estimateImplementationComplexity()` is a sub-function counting missing systems

### Stage 5 — Synthesis Prompt (`buildVHashSystemPromptWithEvaluation()`)
```
buildVHashSystemPromptWithEvaluation(
  ctx:        RepoContextInput,
  intent:     ImplementationIntent,
  evaluation: ReferenceEvaluation,
  code?:      CodeContext
): string
```
- Extends `buildVHashSystemPrompt()` base
- Injects compact evaluation block (not raw JSON — formatted prose directives)
- V# told to: acknowledge what's already there, name missing systems, estimate complexity, give sequenced first step

---

## Client-Side Changes

### URL Detection (workspace-session.tsx)
```typescript
const REFERENCE_URL_RE = /https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|loom\.com\/share\/|twitter\.com\/\S+\/status\/|x\.com\/\S+\/status\/)\S+/i;

function extractReferenceUrl(text: string): string | null {
  const match = REFERENCE_URL_RE.exec(text);
  return match ? match[0] : null;
}
```
- If URL detected in user message → send `referenceUrl` in request body
- Thinking messages updated: "Analyzing reference…", "Evaluating compatibility…"
- No separate UI flow — URL is sent as part of normal chat

### Reference indicator (vhash-surface.tsx)
- When `referenceUrl` is being processed → thinking state shows "Analyzing reference…"
- THINKING_MESSAGES array gets reference-specific entries conditionally
- No new UI components needed — uses existing `thinking` stream state

---

## Security Constraints (inherited from project)

- Reference URLs are fetched SERVER-SIDE only
- No raw transcript content is ever sent to the client
- YouTube/Loom/X APIs called from `/api/orchestrate` — not browser
- Content extraction uses the user's OpenRouter key (same auth path as existing)
- Reference content is NOT stored in the database — in-memory only
- 30-min in-process cache only (same pattern as repo summary plan)

---

## Token Budget Analysis

| Stage | Input tokens | Output tokens |
|-------|-------------|--------------|
| Stage 3 intent extraction | ~700 (3000 chars ÷ 4) | 250 max |
| Stage 5 synthesis (additional context) | +200 (evaluation block) | existing budget |
| Total overhead per reference | ~950 tokens | negligible |

Existing MAX_TOKENS=2000 is unchanged. The reference evaluation adds ~950 input tokens
once per reference URL, then uses the existing streaming budget for synthesis.

---

## Latency Model

```
Client submits URL-containing message (t=0)
  t+0ms  → auth + body parse (existing)
  t+0ms  → URL detected → referenceUrl extracted
  t+0ms  → keyPromise + contentFetchPromise kicked off concurrently
  t+2s   → transcript/metadata received (5s hard timeout)
  t+3s   → intent extraction from OpenRouter (single call, 250 tokens)
  t+3s   → compatibility evaluation (CPU only, <5ms)
  t+3s   → HTTP 200 headers + stream start
  t+3.1s → first synthesis tokens arriving
```

Total additional latency vs baseline: ~2-3s (content fetch + intent extraction).
Users see the "Analyzing reference…" thinking state during this window.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| YouTube `youtube-transcript` fails (no captions) | Graceful fallback: "Could not extract transcript — describe what you want to implement instead" |
| Loom transcript unavailable | oEmbed description-only fallback |
| Intent extraction JSON parse failure | Return `{ patterns: [], stackHints: [], ... }` minimal intent → evaluation still runs |
| Reference fetch timeout (>5s) | Hard timeout → skip reference, process as normal message |
| Content too large | Hard cap at 3000 chars; always slice before AI call |
| X/Twitter 403 on oEmbed | Return tweet URL as plain text in message instead |

---

## Decision Audit Trail

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Product direction | Confirmed | Implementation intelligence, not video summarization. Tight MVP scope. |
| D2 | Reference UX | Transparent (updated thinking messages) | No new UI chrome. Intelligence in response quality, not chrome. |
| D3 | URL extraction location | Client-side + clean server boundary | Client extracts URL, sends both `message` + `referenceUrl`. Enables immediate thinking state update. |
| D4 | YouTube transcript | `youtube-transcript` npm package | Production-tested, handles XML parse + edge cases, no API key needed. |
| D5 | Intent extraction | Single AI call (max_tokens=250, temp=0) | Deterministic + cacheable. SHA-256 cache key, 30-min TTL. Falls back gracefully on JSON parse failure. |
| D6 | Compatibility evaluation | RepoContextInput + retrieved files, no extra AI call | Pure logic. Zero additional tokens. Deterministic. Uses already-available data. |

---

## Implementation Order

1. `services/reference/url-parser.ts` — pure, testable, no deps
2. `services/reference/youtube.ts` — install `youtube-transcript`
3. `services/reference/loom.ts` — fetch-based, no npm dep
4. `server/ai/reference-evaluator.ts` — intent extraction + compatibility
5. `server/ai/vhash-prompt.ts` — add `buildVHashSystemPromptWithEvaluation`
6. `app/api/orchestrate/route.ts` — wire reference pipeline
7. `features/workspace/workspace-session.tsx` — URL detection + referenceUrl in request
8. `features/workspace/vhash-surface.tsx` — thinking state update
