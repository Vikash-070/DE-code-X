<!-- /autoplan restore point: /c/Users/VIKASH/.gstack/projects/De-codex/main-autoplan-restore-20260526-174131.md -->

# DE-code X — Multi-File Implementation Intelligence

**Feature:** Repository-Aware Multi-File Reasoning for V#
**Branch:** main
**Status:** Planning → Implementation

---

## Problem Statement

V# currently retrieves isolated single-file context. When users ask cross-cutting questions ("Why is streaming laggy?" / "How does auth flow across the codebase?"), V# can only surface one file at a time. This breaks the core product promise: *V# understands your codebase*.

The missing capability: **multi-file implementation reasoning** — where V# understands how files relate, which files are relevant together, and how to synthesize insights across an implementation graph rather than a single file.

---

## Product Goal

User asks: *"Why is workspace streaming laggy?"*

V# automatically retrieves:
- `workspace-session.tsx` (stream consumption loop)
- `vhash-surface.tsx` (rendering layer)
- `api/orchestrate/route.ts` (stream source)
- `services/github/tree.ts` (tree cache)

Then synthesizes:
- Render bottlenecks
- State machine issues
- Architecture weaknesses
- Phased implementation recommendations

The experience must feel: **contextual, intentional, implementation-aware** — not random file retrieval.

---

## Current Architecture (as built)

### Working infrastructure
- `services/github/tree.ts` — full repo tree fetch + 10-min in-process TTL cache + fuzzy `searchTree()`
- `services/github/file.ts` — file content fetch + 5-min TTL cache + binary guard + 8KB truncation
- `api/repo/tree/route.ts` — Clerk-authed tree endpoint
- `api/repo/search/route.ts` — Clerk-authed search endpoint
- `api/repo/file/route.ts` — Clerk-authed file content endpoint
- `app/api/orchestrate/route.ts` — stream pipeline with `resolveCodeContext()` + `extractCodeRefs()`
- `server/ai/vhash-prompt.ts` — `buildVHashSystemPromptWithContext()` for context injection

### Current retrieval flow
```
User message
  ↓ extractCodeRefs() — regex: file extensions, explicit patterns, PascalCase names
  ↓ resolveCodeContext() — tree search → file fetch → CodeContext
  ↓ buildVHashSystemPromptWithContext() — fenced code injection
  ↓ OpenRouter (gpt-4o-mini, MAX_TOKENS=800)
  ↓ streamed response
```

### Current gaps
1. **No import expansion** — files retrieved in isolation, no neighbor traversal
2. **No ranked multi-file selection** — up to 3 files, ordered by search score only
3. **No context budget** — 8KB × 3 files = 24KB raw; no token estimation
4. **No retrieval telemetry** — no visibility into what was retrieved, why, or how long
5. **No conversational relevance** — doesn't consider prior turns in retrieval
6. **PascalCase extraction is noisy** — many false positives from natural language

---

## Proposed Architecture

### Phase 1 — Relationship-aware retrieval

**Goal:** When a file is retrieved, expand to its immediate import graph neighbors.

**Approach:** Server-side static import parsing from cached file content.
- Parse `import`/`require` statements from already-fetched file content (no new API calls)
- Map relative imports to tree paths
- Retrieve 1-2 import neighbors if budget allows

**Files to create/modify:**
- `services/github/imports.ts` — new: parse imports from content → relative paths
- `services/github/tree.ts` — add `resolveImportPath(treePaths, importStatement, fromPath)`
- `services/github/retrieval.ts` — new: orchestrate multi-file retrieval with expansion
- `app/api/orchestrate/route.ts` — swap `resolveCodeContext()` for new `buildRetrievalContext()`

### Phase 2 — Ranked retrieval system

**Goal:** Score candidate files by multiple relevance signals, pick best N within budget.

**Scoring signals:**
- Search score (existing)
- Import graph proximity (1 hop = high, 2 hops = medium)
- Filename specificity (exact > prefix > contains)
- File role heuristics (route files, hook files, service files score differently for different query types)
- Conversation relevance (files mentioned in recent turns score higher)

**Files to modify:**
- `services/github/retrieval.ts` — add `rankCandidates(candidates[], message, history)`

### Phase 3 — Context budget system

**Goal:** Hard limits on tokens injected into V# prompt.

**Budget:**
- Max files: 4
- Max chars per file: 6,000 (reduced from 8,000)
- Max total context: 20,000 chars (~5K tokens at 4 chars/token)
- Truncation: prefer truncating less-relevant files over primary match

**Files to modify:**
- `services/github/retrieval.ts` — `applyContextBudget(files[], budget)`
- `server/ai/vhash-prompt.ts` — update `buildVHashSystemPromptWithContext()` to report budget used

### Phase 4 — Retrieval telemetry

**Goal:** Full visibility into retrieval quality, latency, and token consumption.

**Log events (server console):**
```
[repo] tree_cache_hit owner=X repo=Y branch=Z
[repo] search_start query=X candidates=N
[repo] search_results top=path1,path2,path3
[repo] import_expansion seed=path imports=[path1,path2]
[repo] retrieval_ranked files=[path1,path2] scores=[90,60]
[repo] context_budget total_chars=N max=20000 files=N
[repo] files_injected paths=[...] chars_each=[...]
[repo] injected_tokens estimated=N
[repo] retrieval_ms total=Nms
```

**Files to modify:**
- `services/github/retrieval.ts` — emit telemetry at each stage
- `services/github/tree.ts` — add `[repo] tree_cache_hit/miss` logs

---

## Engineering Constraints

- NO embeddings, NO vector DB
- NO new infrastructure dependencies
- All retrieval happens server-side only
- GitHub token never exposed to client
- 5s hard timeout on entire retrieval pipeline
- Graceful degradation: retrieval failure → prompt-only mode (never error)
- MAX_TOKENS stays at 800 (OpenRouter)

---

## Test Plan

- Unit: `parseImports()` with various import patterns (ESM, CJS, re-exports, dynamic)
- Unit: `rankCandidates()` with mock candidates and known priority ordering
- Unit: `applyContextBudget()` enforces limits correctly
- Integration: `buildRetrievalContext()` with real tree fixture, verifies 5s timeout
- Manual: "Why is streaming laggy?" → should retrieve workspace-session + vhash-surface + orchestrate
- Manual: "How does the auth system work?" → should retrieve middleware + clerk patterns
- Manual: Empty/casual message → no retrieval triggered, no latency added

---

## NOT in scope

- Vector DB / semantic search
- Persistent per-user file relevance memory
- Code execution or mutation
- PR diff analysis
- Cross-repository retrieval
- Autonomous agent retrieval loops

---

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|---------|
| 1 | Gate | MAX_TOKENS: 800 → 2,000 | USER CHALLENGE | Coherence | 5K token context injection with 800-token response cap is architecturally incoherent; both eng reviews agree | Keep 800 (OpenRouter cost only) |
| 2 | Gate | Phase ordering: Telemetry first, then import expansion → ranking → budget | TASTE DECISION | Observability | Instrument before you optimize; telemetry makes each subsequent phase immediately observable | Keep original 1→2→3→4 order |
| 3 | Phase 1 | Validate resolved import paths against tree.nodes | SECURITY | Defense in depth | Prevents path traversal via malicious repo content (e.g. imports ../../../../etc/passwd) | Trust relative paths naively |
| 4 | Phase 1 | Use already-fetched seed content for import parsing (no extra API calls) | ARCHITECTURE | Budget control | Import expansion must not create unbounded GitHub API calls inside fixed 5s timeout | Fetch each seed file again for parsing |
| 5 | Phase 1 | Circular import guard via visitedPaths Set | RELIABILITY | Correctness | Circular imports are common in real repos; must not loop | No guard |
| 6 | All | Timeout race returns partial results, not null | RELIABILITY | Graceful degradation | Dropping entire context on timeout is worse than returning seed files already fetched | null (current behavior) |
| 7 | All | Remove chunk_forwarded log from streaming hot path | PERFORMANCE | Production safety | ~100 console.log calls per response saturates event loop at 10× load | Keep for debugging |
