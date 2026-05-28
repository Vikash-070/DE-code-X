<!-- /autoplan restore point: /c/Users/VIKASH/.gstack/projects/testing/master-autoplan-restore-20260527-113105.md -->

# PLAN — V1 Repository System Registry

**Status:** ✅ Shipped — 2026-05-27. TypeScript: 0 errors. Phases 1–5 complete.
**Type:** Implementation plan
**Session:** autoplan
**Created:** 2026-05-27

---

## Goal

Persistent repository identity. When a repo is selected, V# automatically knows: stack, major systems, infra patterns, implementation maturity — without special orchestration triggers.

## V1 Phases

| Phase | File | Output |
|-------|------|--------|
| 1 | `server/repo/system-vocabulary.ts` | Canonical system definitions (8 max) |
| 2 | `server/repo/package-signals.ts` | package.json → system signals |
| 3 | `server/repo/system-registry.ts` | Build `RepositorySystemMap` |
| 4 | Supabase Storage / cache | Persist `system-map.json` per repo |
| 5 | `server/ai/vhash-prompt.ts` | Inject compact summary into system prompt |
| 6 | Frontend component | Display `✅/⚠️/❌` system map |

## Constraints

- No embeddings, no vector DB, no graph traversal
- Package.json = highest signal (1 file read)
- Tree scan via existing `searchTree()` + `fetchRepoTree()`
- 8-system hard cap, 2-file evidence minimum for "strong"
- Canonical system names only (no free-form)

## Files Shipped

| File | Status | Note |
|------|--------|------|
| `server/repo/system-vocabulary.ts` | NEW | `RepoSystem`, `RepositorySystemMap`, `SystemName`, `SystemStatus` types |
| `server/repo/package-signals.ts` | NEW | 80+ package → system signal mappings across 8 canonical systems |
| `server/repo/system-registry.ts` | NEW | `getOrBuildSystemMap()` + 60-min in-process cache + monorepo fallback |
| `server/ai/vhash-prompt.ts` | MODIFIED | Added `systems?` to `RepoContextInput`; added `formatSystemMap()` + injection |
| `app/api/orchestrate/route.ts` | MODIFIED | `systemMapPromise` parallel with DB lookup; injects into `repositoryContext.systems` |

## Architectural Critique Summary (9 questions answered pre-implementation)

1. **Scope** — Phase 6 UI deferred; Phases 1–5 fully defined and shipped
2. **Hidden flaws** — 4 identified: cold start timing, devDependencies false confidence, non-root package.json, path-grep vs content mismatch
3. **Simplifications** — Tree scan evidence cut from v1; `buildSource` field cut
4. **Future bottlenecks** — Vocabulary versioning, serverless cache death, token expiry visibility
5. **System-map.json sufficiency** — Yes; in-process Map cache correct for v1
6. **Highest ROI signals** — `dependencies` > top-level dirs > root config files
7. **Misleading signals** — `devDependencies`, lock file transitive deps, path-only auth matches
8. **Confidence scoring** — Two tiers: `partial` (package only, v1) and `strong` (+ evidence, v2)
9. **Mistakes to avoid** — Never throw from builder; never inject evidenceFiles; cache check first; typed signal table; always log

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale |
|---|-------|----------|----------------|-----------|-----------|
| 1 | CEO | Defer Phase 6 UI — text surface in V# satisfies DX requirement | Mechanical | P5 | Builds real feedback before designing UI component |
| 2 | Eng | Production dependencies only — never devDependencies | Mechanical | P1 | devDeps contain test tooling → false positive injection |
| 3 | Eng | Cut tree scan evidence in v1 — package.json only | Mechanical | P5 | Reduces blast radius; path-scan bugs > no scan in v1 |
| 4 | Eng | In-process Map cache + 3s build timeout in route | Mechanical | P1 | Protects stream startup latency; cache hit = zero network |
| 5 | Eng | Monorepo fallback — try apps/web/ if root has < 5 deps | Mechanical | P1 | Silent failure in monorepos is worse than an extra file read |
| 6 | DX | formatSystemMap injects only name+status+components — not evidenceFiles | Mechanical | P5 | Token discipline; evidence files are for debug/UI, not prompt |

## GSTACK REVIEW REPORT

| Run | Phase | Status | Findings |
|-----|-------|--------|---------|
| 2026-05-27 | D1 premises gate | approved | 4 files read, architecture grounded |
| 2026-05-27 | Architectural critique | 9/9 answered | Phase 6 deferred, 4 flaws identified, scope confirmed |
| 2026-05-27 | D2 final gate | approved | Proceed Phases 1–5 (Recommended) |
| 2026-05-27 | Implementation | shipped | 5 files. TypeScript: 0 errors. |
