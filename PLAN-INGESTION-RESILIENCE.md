<!-- /autoplan restore point: /c/Users/VIKASH/.gstack/projects/De-codex/unknown-autoplan-restore-20260527-001143.md -->

# PLAN — Reference Ingestion Resilience Hardening

**Status:** In planning
**Session:** autoplan (ingestion edge-case hardening)
**Created:** 2026-05-27

---

## Problem Statement

The semantic evaluation pipeline functions end-to-end, BUT the reference ingestion
layer collapses on real-world conversational input before evaluation even activates.

**Confirmed failure:** `https://youtu.be/YXkOdWBwqaA?si=kS768PaNOLYeJHGU.`
(trailing period causes parser miss → V# responds "I can't access external content")

Root cause: the URL parser and client-side regex assume clean, isolated URLs.
Real users paste URLs with:
- Trailing punctuation (`.`, `,`, `)`, `]`)
- Markdown wrapping (`[text](url)`, `[url]`)
- Prose context (`"check this: https://youtu.be/... — looks interesting"`)
- Share link parameters (`?si=`, `?feature=`, `?t=`)
- Mobile share variants

**Pipeline collapse point:** Pre-evaluation. The pipeline is:
1. Client: `extractReferenceUrl()` → finds URL in text
2. Server route: `parseReferenceUrl()` → classifies URL
3. Server: `fetchReferenceContent()` → fetches transcript
4. Server: `extractImplementationIntent()` → Stage 3
5. Server: `evaluateRepoCompatibility()` → Stage 4
6. Server: V# synthesis

Failure is at steps 1 and 2. Fix must be at the parsing layer.

---

## What We Are NOT Building

- Embeddings or semantic matching for URL detection
- Additional LLM calls
- Network-based URL validation
- Complex URL canonicalization services

---

## What We ARE Building

A **resilience layer** at the ingestion boundary:

```
raw user input (messy)
  → Phase 1: sanitizeReferenceUrl() — strip trailing punctuation/wrappers
  → Phase 2: extractReferenceUrl() regex match (now on sanitized text)
  → Phase 3: parseReferenceUrl() — normalized URL
  → Phase 4: fail-open UX if platform detected but URL malformed
  → Phase 5: full normalization across all platform variants
  → Phase 6: telemetry at every stage
```

---

## Phase 1 — URL Sanitization

Add `sanitizeReferenceUrl(raw: string): string` to `url-parser.ts`.

Strips common real-world contamination:
- Leading: `(`, `[`, markdown `[text](`, whitespace
- Trailing: `.`, `,`, `!`, `?`, `;`, `:`, `)`, `]`, `>`, whitespace

```typescript
export function sanitizeReferenceUrl(raw: string): string {
  return raw
    .trim()
    // Remove markdown link wrapper: [text](url) → url
    .replace(/^\[.*?\]\(/, "").replace(/\)$/, "")
    // Remove leading brackets/parens
    .replace(/^[\[(]/, "")
    // Remove trailing punctuation and closing brackets
    .replace(/[.,!?;:\)>\]]+$/, "")
    .trim();
}
```

Applied in:
- `extractReferenceUrl()` — sanitize candidates extracted from text before returning
- `parseReferenceUrl()` — sanitize before calling `new URL()`

---

## Phase 2 — Probable Reference Detection

Even if parsing fails, a platform keyword scan can detect PROBABLE references.

New function: `detectProbableReference(text: string): string | null`

```typescript
const PROBABLE_PLATFORM_RE =
  /\b(youtu\.be|youtube\.com|youtu|loom\.com|twitter\.com|x\.com\/\w+\/status)\b/i;

export function detectProbableReference(text: string): string | null {
  const m = PROBABLE_PLATFORM_RE.exec(text);
  return m ? m[0] : null;
}
```

Return value: the matched platform fragment (e.g. `"youtu.be"`, `"youtube.com"`)
Used by: client (workspace-session.tsx) and server route (orchestrate/route.ts)

---

## Phase 3 — Fail-Open UX for Malformed URLs

New prompt in `vhash-prompt.ts`:
`buildVHashSystemPromptWithMalformedReference(ctx, platformHint, rawFragment)`

Tells V#:
- A probable platform reference was detected in the user's message
- The URL could not be parsed correctly (malformed, truncated, or ambiguously formatted)
- V# should acknowledge this and ask the user to paste the URL cleanly

NOT the same as `buildVHashSystemPromptWithReferenceFailure()` (which covers
"URL parsed correctly, content fetch failed"). This is for "couldn't even parse it."

---

## Phase 4 — Multi-URL Handling

Current `extractReferenceUrl()` returns the FIRST match only. Users may paste:
- `"check this https://youtu.be/abc and this https://loom.com/share/xyz"`
- `"https://youtu.be/abc. can we build this?"`

Change: `extractReferenceUrl()` uses `REFERENCE_URL_RE` globally and returns first
valid (sanitized) match. The current implementation already does exec-first-match,
but the sanitization layer means the first match is now cleaned before returning.

For truly multiple URLs: return only the first supported one (keep existing single-URL
pipeline contract — no orchestration change needed).

---

## Phase 5 — Normalization Hardening

Canonical URL stored as normalized https form. Current state already normalizes
`http://` → `https://`. Additional hardening:

YouTube canonical: `https://www.youtube.com/watch?v={videoId}`
- All youtu.be, shorts, embed, live, m.youtube.com variants → canonical watch URL
- Stored in `ParsedReferenceUrl.url` as canonical

Twitter/X canonical: `https://x.com/{user}/status/{id}`
- twitter.com → x.com (platform canonical)

Loom: unchanged (share URL is already canonical)

---

## Phase 6 — Telemetry Expansion

```
[reference] raw_url_candidate raw=...         (when extractReferenceUrl finds a match)
[reference] sanitized_url before=... after=... (when sanitization changes the URL)
[reference] malformed_url_detected fragment=...  (when probable detected but parse fails)
[reference] probable_reference_detected platform=... (Phase 2 hit)
[reference] parser_failed raw=...             (parse returns unsupported for known platform)
[reference] fallback_reference_mode           (malformed UX activated)
```

---

## File Scope (4 files, all modifications)

| File | Change |
|------|--------|
| `services/reference/url-parser.ts` | Add `sanitizeReferenceUrl()`, `detectProbableReference()`; apply sanitization in `extractReferenceUrl()` and `parseReferenceUrl()`; canonical URL normalization; telemetry |
| `features/workspace/workspace-session.tsx` | Apply sanitization client-side; add probable-reference fallback so `referenceUrl` is sent even when `extractReferenceUrl` returns null but platform keywords detected |
| `server/ai/vhash-prompt.ts` | Add `buildVHashSystemPromptWithMalformedReference()` |
| `app/api/orchestrate/route.ts` | Handle `malformedReference` flag; route to malformed-UX prompt when URL detected but parse failed |

---

## Revised Plan (post-review)

Based on CEO + Eng review, Phase 4 (multi-URL) is dead scope. Phase 3 (new V# prompt) is
simplified to an update of the existing `buildVHashSystemPromptWithReferenceFailure` messaging.
Phase 2 (probable reference detection) moves server-side only — no client keyword scan.

**File scope (revised):**

| File | Change |
|------|--------|
| `services/reference/url-parser.ts` | Add `sanitizeReferenceUrl()`; apply in `parseReferenceUrl()` only (NOT extractReferenceUrl); canonical URL normalization for YouTube + Twitter; `[reference]` telemetry |
| `app/api/orchestrate/route.ts` | Update `buildVHashSystemPromptWithReferenceFailure` call to distinguish malformed URL vs content fetch failure in log message; pass sanitized URL |

**`sanitizeReferenceUrl()` specification:**
```typescript
export function sanitizeReferenceUrl(raw: string): string {
  return raw
    .trim()
    // Unwrap markdown link: [text](url) → url (then trailing ) stripped below)
    .replace(/^\[.*?\]\(/, "").replace(/\)$/, "")
    // Strip leading angle bracket, paren, or square bracket
    .replace(/^[<\[(]/, "")
    // Strip trailing punctuation and closing wrappers (NOT `?` — query param separator)
    .replace(/[.,!;:\)>\]`]+$/, "")
    // Strip backtick (markdown code inline)
    .replace(/^`/, "")
    .trim();
}
```

**Canonical URL normalization (Phase 5):**
- YouTube: `https://www.youtube.com/watch?v={videoId}` — stored in `parsed.url`
- Twitter: `https://x.com/{user}/status/{id}` — stored in `parsed.url`
- NOTE: `parsed.url` is UNUSED by the transcript fetcher (which uses `parsed.id`).
  Normalizing for future-proofing; document with explicit comment.

**Telemetry additions (Phase 6):**
```
[reference] raw_url_received raw=...         (entry point of parseReferenceUrl)
[reference] sanitized_url before=... after=... (only emitted when sanitization changes URL)
```

---

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale |
|---|-------|----------|----------------|-----------|-----------|
| 1 | CEO | Apply sanitization in parseReferenceUrl() ONLY, not in extractReferenceUrl() | Mechanical | P5 | Client fn contract is "detect URL in text"; server fn contract is "validate URL". Mixing them creates double-sanitization ambiguity and changes extractReferenceUrl return contract |
| 2 | CEO | Phase 4 (multi-URL handling) → DEFERRED | Mechanical | P4 | Current code already takes first match via REFERENCE_URL_RE; multi-URL is already handled; no new code needed |
| 3 | CEO | Phase 3 (new V# prompt variant) → SIMPLIFIED to messaging update | Mechanical | P5 | buildVHashSystemPromptWithReferenceFailure() already fires when URL detected but parsing fails; adding third prompt variant adds maintenance surface with no behavioral gain |
| 4 | CEO | Phase 2 (probable reference detection) → server-side only | Mechanical | P3 | Client keyword scan creates false positives on "check youtube.com for tutorials"; server already has the parsed result to detect failure mode |
| 5 | Eng | Add `<` to leading-strip set | Mechanical | P1 | Angle-bracket wrapping is common in Slack auto-links; missing from original plan |
| 6 | Eng | Add backtick to strip set | Mechanical | P1 | Markdown code inline wrapping is common in developer messages |
| 7 | Eng | Exclude `?` from trailing-strip set | Mechanical | P3 | `?` is the query-string separator; rarely appears as trailing sentence punctuation; excluding reduces risk of corrupting valid URLs |
| 8 | Eng | Document that canonical parsed.url is unused by transcript fetcher | Mechanical | P5 | Fetcher uses parsed.id; explicit comment prevents future engineers from assuming canonical URL affects fetch behavior |

---

## GSTACK REVIEW REPORT

| Run | Skill | Status | Findings |
|-----|-------|--------|---------|
| 2026-05-27 | plan-ceo-review | issues_open (4 scope decisions) | Phase 4 dead scope; Phase 3 redundant; Phase 2 needs false-positive guard; sanitize server-side only |
| 2026-05-27 | plan-eng-review | issues_open (3 resolved) | Apply sanitization in parseReferenceUrl only; add `<` and backtick to strip set; exclude `?`; document canonical URL unused |
| 2026-05-27 | autoplan-voices | subagent-only (Codex unavailable) | CEO: 6/6 confirmed. Eng: 6/6 confirmed |
