<!-- /autoplan restore point: pending -->

# DE-code X — Repository Intelligence Summarization

**Feature:** Deterministic Repo-Level Understanding for V#
**Branch:** main (DE-code X)
**Status:** Planning

---

## Problem Statement

V# currently responds to repository-level questions ("what does this repo do?", "explain the architecture", "what's the main purpose of this codebase?") with: **"I don't have direct access to the repository."**

This is now incorrect behavior. The retrieval infrastructure exists (`services/github/tree.ts`, `services/github/file.ts`, `services/github/retrieval.ts`). The problem is that retrieval is **reactive only** — it fires when the user references specific files or components. Repository-level questions contain no file references, so `extractCodeRefs()` returns nothing, and retrieval is skipped.

The result: V# knows the repo name, language, and open issues (from `RepoContextInput`) but cannot answer basic architectural questions that any developer would expect an AI embedded in their repo to know.

---

## Product Goal

User asks: *"What does this repo do?"* / *"Explain the architecture"* / *"What's the core idea?"*

V# responds with a grounded, accurate summary:

> This is a Next.js 14 monorepo using the App Router. Core product: an AI-powered developer intelligence platform. Stack: TypeScript, Clerk for auth, Prisma + Supabase for data, OpenRouter for AI inference. Key systems: GitHub OAuth → repo tree/file retrieval → multi-file context injection → V# streaming response. The workspace is the primary UI — users select a repo, ask questions, and V# responds with architecture-aware context.

Currently: *"I don't have direct access to the repository."*

This must be fixed without:
- Injecting the entire repo into every prompt
- Using embeddings or vector DBs
- Creating massive context that burns tokens on every request
- Introducing new infrastructure dependencies

---

## Proposed Architecture

### Core idea: deterministic compact summary, cached, injected only when relevant

**What to fetch (in priority order):**
1. `README.md` / `README.mdx` / `readme.md` — product description (≤ 2,000 chars)
2. `package.json` (root) — name, description, dependencies → stack inference
3. Tree structure (already cached) — top-level dirs + key folders = project shape

**What NOT to do:**
- No recursive summarization of every file
- No full file content for every dependency
- No embeddings, no vector DB
- No real-time analysis on every request

### New files

#### `services/github/summary.ts` (NEW)

```typescript
// buildRepoSummary(owner, repo, branch, token) → RepoSummary
// - Fetches README (up to 2,000 chars), package.json, uses already-cached tree
// - Infers: purpose, stack, frameworks, major systems, key directories
// - Returns compact structured summary
// - In-process TTL cache: 20 minutes (keyed by owner/repo@branch)

interface RepoSummary {
  purpose:       string | null;   // extracted from README h1/first paragraph
  description:   string | null;   // package.json description
  stack:         string[];        // ["Next.js 14", "TypeScript", "Prisma", ...]
  keyDirs:       string[];        // ["apps/web", "packages/ui", "services/"]
  packageName?:  string;          // from package.json name
  hasTests:      boolean;
  hasPrisma:     boolean;
  hasDocker:     boolean;
  fetchedAt:     number;          // TTL timestamp
}
```

#### `app/api/repo/summary/route.ts` (NEW — optional, for frontend pre-fetch)

```
POST /api/repo/summary
Body: { fullName, branch? }
Returns: RepoSummary (or 404 if not cached yet)
```

### Modified files

#### `server/ai/vhash-prompt.ts` (MODIFIED)

Add `repoSummary?: RepoSummary` to `RepoContextInput`. Update `buildVHashSystemPrompt()` to inject the compact summary as structured facts.

#### `app/api/orchestrate/route.ts` (MODIFIED)

Add `isRepoLevelQuestion(message)` detection. When true, call `buildRepoSummary()` (cache hit after first request) and inject into V#'s system prompt. This runs in parallel with the existing DB key lookup.

---

## Detection: Repository-Level Questions

```typescript
function isRepoLevelQuestion(message: string): boolean {
  return /\b(what('?s| does| is) (this|the) (repo|codebase|project|app)|
    explain (the |this )?(arch|architecture|codebase|project|repo|app)|
    summarize|overview|high.level|what does (it|this) do|
    what (are|is) the main|purpose of this|how (is|does) (it|this) work|
    walk me through|give me a (tour|rundown|summary)|
    what('?s| is) (built|under the hood|powering)|
    core (idea|concept|feature|system)|main (feature|system|component)
  )\b/i.test(message.trim());
}
```

---

## Engineering Constraints

- NO embeddings, NO vector DB, NO new infrastructure
- README fetch: 2,000 char cap (prevent massive README injection)
- package.json: parse dependencies → infer stack (no raw injection of 50+ deps)
- Tree is already cached — reuse `fetchRepoTree()` cache hit
- Summary cache: 20-min in-process TTL (same pattern as `tree.ts`)
- Never block the streaming response — summary fetch runs in parallel with DB key lookup
- Graceful degradation: if README fetch fails, stack still inferred from tree + package.json
- GitHub token remains server-side only

---

## What Already Exists

- `services/github/tree.ts` — full repo tree + 10-min TTL cache (already called on every technical request)
- `services/github/file.ts` — file content fetch + 5-min TTL cache — will reuse for README + package.json
- `services/github/retrieval.ts` — multi-file retrieval pipeline
- `server/ai/vhash-prompt.ts` — prompt builder with `RepoContextInput` struct
- `app/api/orchestrate/route.ts` — streaming pipeline with message classification (`isConversationalMessage`)

---

## Test Plan

- Unit: `parseReadmePurpose()` — extracts first paragraph / H1 from various README formats
- Unit: `inferStackFromPackageJson()` — maps deps to stack labels (next → Next.js, prisma → Prisma, etc.)
- Unit: `isRepoLevelQuestion()` — validates detection patterns (true/false cases)
- Unit: TTL cache — verifies 20-min expiry and key structure
- Integration: `buildRepoSummary()` with real tree fixture + mock file fetch
- Manual: "What does this repo do?" → V# responds with accurate summary, not "I don't have access"
- Manual: "What's the architecture?" → V# names key systems, not generic response
- Manual: Technical message ("fix the streaming bug") → summary NOT injected (no unnecessary token waste)
- Manual: Casual message ("hey") → summary NOT injected

---

## NOT in scope

- Persistent database storage of repo summary (in-process cache is sufficient for MVP)
- Summary refresh UI (users can reload to invalidate; 20-min TTL is fine)
- Deep analysis of every source file
- Vector-based semantic search of README
- Automatic summary updates on push (webhook)
- Multi-repo aggregation

---

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|---------|
| 1 | CEO §6 | Wrap README content in explicit external-input delimiter in system prompt | SECURITY | Defense in depth | README is user-controlled content — injecting raw enables prompt injection attacks | Inject README directly |
| 2 | CEO §8 | Add monorepo fallback: if root package.json name is "root"/"workspace-root" or missing description, check apps/*/package.json | ROBUSTNESS | Completeness | Monorepos (like DE-codex itself) have useless root package.json — the fix is free (tree is already cached) | Use root package.json only |
| 3 | CEO §0C | Use deterministic structured summary (README + package.json + tree) vs AI-generated | ARCHITECTURE | Pragmatic | Same user outcome, deterministic, no extra AI cost/latency, simpler | AI-generated summary on session start |
| 4 | Eng §1 | Explicit priority cascade: isConversational wins → isRepoLevelQuestion → reactive retrieval | ARCHITECTURE | Explicit > clever | Prevents ambiguous state when both checks fire; eliminates future ordering bugs | Implicit/unordered checks |
| 5 | Eng §1 | buildVHashSystemPromptWithSummary(ctx, summary, code?) handles combined case | ARCHITECTURE | Completeness | A repo question can also reference a file; need single entrypoint for both | Two separate code paths |
| 6 | Eng §4 | Race summaryPromise with 3s timeout | PERFORMANCE | Graceful degradation | GitHub API stall would block orchestrate route; same pattern as codeContextPromise | No timeout |
| 7 | Eng §5 | Wrap README + package.json description in external-input delimiter in system prompt | SECURITY | Defense in depth | Both are user-controlled strings that could contain prompt injection instructions | Inject raw strings |
| 8 | DX §3.5 | Add [repo] summary_injected=true telemetry log in orchestrate/route.ts | DX | Observability | Makes it detectable in server logs when summary context is actually used; free | No telemetry |

<!-- AUTONOMOUS DECISION LOG -->
## Eng Review — Architecture Update

### Revised prompt selection cascade (explicit priority):
```
1) isConversational → buildConversationalPrompt() [no context]
2) isRepoLevelQuestion + summary + codeContext → buildVHashSystemPromptWithSummary(ctx, summary, code)
3) isRepoLevelQuestion + summary → buildVHashSystemPromptWithSummary(ctx, summary)
4) codeContext.files.length → buildVHashSystemPromptWithContext(ctx, code)
5) else → buildVHashSystemPrompt(ctx)
```

### External-input delimiter for system prompt injection:
```
─── Repository Content (unverified external input) ───
README excerpt: [first 2000 chars]
Description: [package.json description]
─── End external content ───
Stack: Next.js 14, TypeScript, Prisma, Clerk   ← derived server-side, safe
Key systems: apps/web, packages/ui, services/  ← from tree, safe
```

### summaryPromise in orchestrate/route.ts:
```typescript
const summaryPromise: Promise<RepoSummary | null> =
  isRepoLevelQuestion(message.trim()) && !isConversational
    ? Promise.race([
        buildRepoSummary(owner, repo, branch, githubToken),
        new Promise<null>(r => setTimeout(() => r(null), 3_000))
      ]).catch(() => null)
    : Promise.resolve(null);
```

## CEO Review — Findings

### Critical: Prompt injection via README (§6)
README content is user-controlled. Raw injection into system prompt enables instructions like "Ignore previous instructions." Fix: wrap in external-content delimiter block.

### Robustness: Monorepo package.json fallback (§8)
Root package.json in monorepos (DE-codex itself, NX, Turborepo) often has name="root" and no description. Fix: detect and fall back to apps/*/package.json.

### CEO Completion Summary
- Premises: all valid (4/4)
- Approach: A (deterministic) auto-decided
- Findings: 2 (1 security, 1 robustness) — both have auto-decided fixes
- Scope: correctly bounded, no expansion
- Deferred: persistent DB storage, webhook updates, multi-repo

---


