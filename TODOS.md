# DE-code X — Open Engineering TODOs

Post-implementation items that are out of scope for the current PR but should be tracked.

---

## High — address before next feature

### Pass `defaultBranch` from workspace to retrieval
- `RepoContextInput.defaultBranch` is now defined in `vhash-prompt.ts`
- It currently defaults to `"main"` inside `retrieval.ts` when not set
- **Fix:** `features/workspace/workspace-session.tsx` should include `defaultBranch` in the `repositoryContext` payload sent to `/api/orchestrate`
- Source of truth: the GitHub API returns `default_branch` on any repo object; it should already be available in workspace state

### Vitest test infrastructure
- No unit tests exist yet for the new retrieval pipeline
- Add: `vitest.config.ts` at repo root
- Add: `services/github/__tests__/imports.test.ts` — `parseImports()` coverage:
  - ESM named, default, namespace, re-export, side-effect imports
  - Dynamic imports should NOT be captured
  - `require()` should NOT be captured
  - Path aliases (`@/`, `~/`) should NOT be captured
- Add: `services/github/__tests__/retrieval.test.ts` — `rankCandidates()`, `applyContextBudget()` with mock fixtures
- Add: integration test for `buildRetrievalContext()` with a real tree fixture + 5s timeout enforcement

---

## Medium — quality / future-proofing

### Barrel export path resolution
- `import { foo } from '../components'` resolves to `components/index.ts`
  — the `resolveTreePath` function already handles this via `/index.<ext>` fallback
- Edge case: barrel re-exports (e.g. `components/index.ts` that re-exports from `components/Button.tsx`)
  — currently only resolved 1 level deep; 2-hop expansion is not implemented

### Keyword synonym expansion in `extractCodeRefs`
- "streaming lag" → should boost `workspace-session.tsx`, `orchestrate/route.ts`
- "auth" → should boost `middleware.ts`, clerk patterns
- Consider adding a small synonym map: `{ streaming: ["stream", "sse", "realtime"], auth: ["middleware", "clerk", "session"] }`

### Prompt injection defence for AI eval
- User messages containing `<system>`, `</system>`, `<|im_start|>`, or similar
  injection patterns should be sanitised before insertion into the system prompt
- Low risk with OpenAI models but worth gating before launch

### `treeResp.truncated` surfaced in CodeContext
- Currently logged in `tree.ts` but not exposed in `RepoTree` or `CodeContext`
- Add `treeWasTruncated: boolean` to `CodeContext` so V# can note "large repo — some paths may be missing" in its response

---

## Low — cleanup

### Extract mock stream to `server/ai/mock-stream.ts`
- `buildMockResponse()` and `streamMock()` are still inline in `orchestrate/route.ts`
- Move to `server/ai/mock-stream.ts` for testability and to reduce route file length

### Prisma migration still pending
- `npm run prisma:migrate` needs to run against Supabase to apply any pending schema changes
- Verify: `npx prisma migrate status` — check for unapplied migrations

---

## Decision pending

### MAX_TOKENS: 2,000 → test at production scale
- Raised from 800 based on architectural coherence (5K context injection needs room to respond)
- Monitor actual response quality and OpenRouter cost after first 100 conversations
- Reconsider if cost spikes; consider `1,500` as a middle-ground fallback

### 2-hop import expansion
- Currently capped at 1 hop to control GitHub API call count within the 5s timeout
- If V#'s responses consistently miss a "one more hop" file, consider adding 2-hop
  with a stricter budget (e.g. only expand if ≤2 seed files found)
