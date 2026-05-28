# PLAN — Inspire Pipeline: Routing Hardening + Observability

**Status:** In planning  
**Session:** autoplan (bug fix track)

---

## Root Cause Analysis (confirmed via code trace)

| Stage | Finding | Evidence |
|-------|---------|---------|
| Stage 1: URL detection | `youtu.be/ID` detected ✓ | Regex test: match confirmed |
| Stage 1: URL detection | `youtube.com/shorts/ID` NOT detected ❌ | Regex test: `null` |
| Stage 1: URL detection | `m.youtube.com/watch?v=ID` NOT detected ❌ | Regex test: `null` |
| Stage 2: Content fetch | `youtube-transcript` silently returns `null` for many videos | No captions / server-side block |
| Stage 3: Fail-open path | When `refContent=null`, falls to `buildVHashSystemPrompt` | Code trace: no reference-aware fallback |
| Stage 5: UX | gpt-4o-mini receives raw YouTube URL in base technical prompt | Generates "I can't access external content" |

**The V# response is the model behaving correctly given the wrong prompt.**  
This is not an AI capability problem. It is a routing and observability failure.

---

## Three Bugs, Five Fixes

### Bug A — URL parser gaps
`REFERENCE_URL_RE` misses: `youtube.com/shorts/ID`, `m.youtube.com/`, `youtu.be/ID?t=60`, share URLs.

**Fix A:** Rewrite `url-parser.ts` to use `URL()` constructor for hostname/pathname parsing. Pure, testable, handles all variants. Zero regex fragility for platform detection.

### Bug B — Content fetch fails silently
`youtube-transcript` package: scrapes YouTube HTML, fails for videos without captions, gets blocked by YouTube in server environments, no User-Agent header set. No log output on failure path.

**Fix B1:** Add structured telemetry at every stage of the content fetch.  
**Fix B2:** Add `accept-language` + `User-Agent` header to transcript fetch attempt.  
**Fix B3:** Expand title-only fallback: if transcript fails but title succeeds → pass title as content to Stage 3. Intent extraction can still work from title alone ("Build a Stripe checkout flow" → intent extracted from title).

### Bug C — No fail-open UX when pipeline fails after URL detection
When `hasReference=true` but `intent=null`, the current code uses `buildVHashSystemPrompt`. The model has no context that a reference was attempted. It responds to the raw URL in the message body by saying it can't access external content.

**Fix C:** `buildVHashSystemPromptWithReferenceFailure(ctx, platform, referenceUrl)` — a purpose-built prompt for when URL was detected but content extraction failed. Tells V# to acknowledge the reference attempt, explain what failed specifically, and ask the user to paste implementation details as text.

---

## File Scope (5 files, all modifications — no new files)

| File | Change |
|------|--------|
| `services/reference/url-parser.ts` | Rewrite using URL() constructor; add Shorts, mobile YouTube, handle query params |
| `services/reference/youtube.ts` | Add structured telemetry; add User-Agent header; title-only fallback |
| `server/ai/vhash-prompt.ts` | Add `buildVHashSystemPromptWithReferenceFailure()` |
| `app/api/orchestrate/route.ts` | Add full telemetry; use reference-failure prompt; log `referenceUrl_present` |
| `features/workspace/workspace-session.tsx` | Add client-side telemetry log for `referenceUrl_detected` |

---

## Required Telemetry Points

```
[reference] url_detected platform=youtube normalized_url=...
[reference] content_fetch_started type=youtube videoId=...
[reference] transcript_fetch_started videoId=...
[reference] transcript_fetch_success chars=XXXX
[reference] transcript_fetch_failed reason=... (no fallback)
[reference] title_fetch_success title=...
[reference] title_fetch_failed
[reference] content_available text_len=XXXX title=...
[reference] content_unavailable type=youtube reason=...
[reference] intent_extraction_started content_len=...
[reference] intent_extraction_success patterns=N features=N
[reference] evaluation_complete complexity=... fit=...
[reference] evaluation_prompt_activated=true
[reference] failure_fallback platform=... reason=content_unavailable
```

---

## Fail-Open Prompt Design

When URL detected but content unavailable:
```
V# receives this directive:
The user shared a [YouTube/Loom/X] reference link: [URL]
Reference content extraction was attempted but [reason: no captions available / network error / content unavailable].
Do NOT say "I cannot access YouTube" — an extraction attempt WAS made. Tell the user specifically what happened and what they can do instead. Be direct. Suggest: paste key implementation details as text, share relevant timestamps, or describe the specific pattern they want to implement. Stay in character — you attempted the extraction, it failed on a technical basis, not a capability basis.
```

---

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale |
|---|-------|----------|----------------|-----------|-----------|
| 1 | CEO | Use URL() constructor instead of pure regex for platform detection | Mechanical | P5 (explicit over clever) | URL() is the right tool — built-in hostname parsing, handles all edge cases |
| 2 | CEO | Fix fail-open UX as highest priority (before parser hardening) | Mechanical | P6 (bias toward action) | Fail-open fixes the user-visible symptom immediately |
| 3 | Eng | No new files — all changes in existing 5 files | Mechanical | P3 (pragmatic) | Scope is tight, blast radius is small |
| 4 | Eng | Title-only fallback for videos without captions | Mechanical | P1 (completeness) | Partial signal is better than no signal — intent can be extracted from title |
| 5 | Eng | Add User-Agent to transcript fetch | Mechanical | P5 (explicit) | YouTube blocks headless requests; proper User-Agent reduces false negatives |
