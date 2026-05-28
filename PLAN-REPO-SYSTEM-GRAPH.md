<!-- /autoplan restore point: /c/Users/VIKASH/.gstack/projects/testing/master-autoplan-restore-20260527-111022.md -->

# PLAN — Repository Identity + System Intelligence Graph

**Status:** ✅ Review complete — 2026-05-27. Direction approved.
**Type:** Strategic architectural direction review
**Session:** autoplan
**Created:** 2026-05-27

---

## Brief

DE-code X currently has transactional intelligence: special orchestration (reference URL, code retrieval) activates depth temporarily. Conversational mode still collapses to generic assistant behavior.

**Proposed direction:** Build a Repository System Graph — persistent, structured, repo-specific knowledge. Not embeddings. Not vector chaos. Compact system intelligence.

The graph should model:
- Implementation systems (Auth, Realtime, Reference Intelligence, etc.)
- Architecture groups and ownership
- Infra dependencies
- System maturity
- Implementation evidence (file links)

Goal: When a repo is selected, V# automatically knows the stack, architecture style, major systems, strengths, weaknesses, infra patterns — WITHOUT special orchestration triggers.

---

## Questions to Resolve

1. Is Repository System Graph the correct direction?
2. What should the FIRST graph version contain?
3. What should NOT be included yet?
4. What graph structures are most useful for implementation intelligence?
5. How should systems and relationships be modeled?
6. How do we avoid noisy graphs, graph explosion, orchestration chaos, stale intelligence, fake confidence?
7. What lightweight techniques are best for system extraction, dependency mapping, implementation ownership, architecture grouping — WITHOUT embeddings/vector DB?
8. How would you architect repository identity persistence for DE-code X specifically?
9. What hidden flaws exist in this direction?
10. What implementation-intelligence capabilities become possible AFTER this graph exists?

---

---

## Architectural Findings

### Rename: Graph → Registry
The "graph" framing invites over-engineering (graph databases, traversal algorithms, edge topology). What DE-code X needs is a flat typed system registry. Rename throughout.

### v1 Data Model
```typescript
interface RepoSystem {
  name:            string;       // canonical vocabulary only (see below)
  maturity:        "exists" | "partial" | "missing";
  evidenceFiles:   string[];     // MINIMUM 2 files for "exists"
  stackComponents: string[];     // ["Clerk", "JWT"]
  infraDeps:       string[];     // ["Redis", "Postgres"]
}
interface RepoSystemMap {
  repoFullName: string;
  generatedAt:  string;
  systems:      RepoSystem[];    // 8 max in v1
  primaryStack: string;
  buildSource:  "package_json" | "tree_scan" | "hybrid";
}
```

### Canonical System Vocabulary (v1 — 15 names)
`Authentication`, `Database`, `ORM Layer`, `Realtime Messaging`, `Background Jobs`, `Caching`, `Storage`, `Payments`, `AI Integration`, `Email`, `Search`, `API Layer`, `Analytics`, `Auth Guard Middleware`, `Feature Flags`

Package.json keywords map TO these names. No free-form LLM naming.

### Extraction Pipeline (no embeddings)
1. `package.json` parse → 60% of signal (1 file read)
2. `searchTree()` extended with domain keyword table → evidence files
3. README/CLAUDE.md first 200 chars → stack confirmation
4. Top-level directory structure → fallback heuristics

### Persistence Architecture
- **Storage:** Supabase Storage blob, NOT Postgres row
- **Path:** `/repos/{userId}/{owner}/{repo}/system-map.json`
- **Build trigger:** On repo selection (background, non-blocking)
- **Cold start:** Build synchronously if < 2s; async if > 2s (stale base prompt until map ready)
- **Freshness:** Rebuild if `generatedAt` age > 7 days OR manual trigger
- **Integration:** `fetchSystemMap()` runs parallel with DB key lookup in route.ts

### Prompt Integration
Extend `RepoContextInput` — it already has `architecturePatterns[]` and `authSystem?`. Populate these from the system map instead of leaving them undefined.

### DX Requirement (non-negotiable)
System map MUST be surfaced in V# responses when it influences an answer:
```
Based on your repo's system map:
  ✅ Authentication (Clerk, 4 files)
  ⚠️ Realtime (partial, 2 files)
  ❌ Payments (missing)
```
Without this surface, wrong system map entries create confidently wrong answers. Trust death.

### 6 Hidden Flaws (acknowledged)
1. Cold-start: build BEFORE first message, not triggered by it
2. System name instability: fixed canonical vocabulary solves this
3. Missing > exists: detecting absence is harder than presence — v2 concern
4. Injection pollution: 2-file evidence minimum prevents false positives
5. Token creep: 8-system hard cap, compact injection format (not prose)
6. Monorepo: not supported in v1 — document as known limitation

---

## Cross-Check: What DE-code X Actually Is

**What it is:**
A streaming AI engineering assistant that understands both a developer's specific repository AND external technical references (videos, posts, code). It bridges the gap between "I found this cool implementation" and "can my codebase actually support it" — without manual code archaeology.

**What problem it solves:**
Developer finds an implementation pattern (YouTube video, blog post, GitHub reference). The question isn't "what is this" — it's "can I build this in MY repo, with MY stack, given what I already have?" Current tools give generic answers. DE-code X gives repo-grounded answers.

**What differentiates it:**
- Intent-aware reference routing (understanding vs evaluation vs hybrid)
- Repository-grounded implementation feasibility (not generic pattern matching)
- Transcript-to-evaluation pipeline (video → intent → code evidence → feasibility)
- No embeddings = deterministic, low-cost, inspectable

**Where the architecture is strong:**
- Reference pipeline: transcript extraction → Stage 3 intent → Stage 3.5 retrieval → Stage 4 evaluation → V# prompt. End-to-end, no leaky abstraction.
- Streaming architecture: headers arrive in ~30ms, content streams immediately
- Fail-open behavior: every stage has graceful fallback, no hard failures
- Telemetry: every pipeline stage emits structured logs — debugging is tractable
- Token discipline: no embeddings, no giant prompts, LLM called once per reference

**Where the architecture is weak:**
1. First-message intelligence collapse: no persistent repo context → generic answers until reference URL or code reference detected
2. Retrieval is path grep, not content search: `searchTree()` matches file names, not what's inside them
3. No feedback loop: V# gives a wrong answer → no correction path → trust erodes silently
4. Confidence scoring is disconnected from evidence: `confidence = "high"` currently tied to file retrieval count, not content verification
5. `evaluateRepoCompatibility()` is string matching on thin metadata — frequently inverted (prior architecture review, Flaw confirmed)

**Biggest product risks:**
1. **Competition:** Cursor/Copilot Workspace is building "can we build X?" features. 12-month window.
2. **Frontier model risk:** Long-context multimodal models may make the orchestration layer redundant — GPT-5 + full repo in context eliminates the pipeline.
3. **Trust death:** One confidently wrong answer to a senior engineer = reputation damage. No correction path = recurring vulnerability.
4. **Video transcript quality:** YouTube auto-captions are often poor for technical content. The whole reference pipeline degrades when transcripts are noisy.

**Where the strongest moat is:**
**Repository System Model.** If DE-code X builds persistent, structured understanding of each customer's specific engineering systems BEFORE competitors, the moat is:
- Structured understanding of your specific repo (not generic patterns)
- Cross-session learning ("you've asked about WebSockets 3 times — your Realtime system is partial")
- Implementation graph ("what this repo can and cannot do, as of today")

This is not replicable from a LLM alone. It requires the intentional build. That's the moat window.

---

## What to Build Next (Priority Order)

| # | Item | Effort | Signal gain |
|---|------|--------|-------------|
| 1 | `package.json` parsing → `RepoContextInput.dependencies` | 1 file read | Eliminates most false negatives in system detection |
| 2 | Canonical system vocabulary + extraction table | ~50 lines | Foundation for everything else |
| 3 | `buildRepoSystemMap()` — package.json + tree scan | ~100 lines | Persistent identity |
| 4 | Supabase Storage blob persistence | ~50 lines | Survives sessions |
| 5 | Inject into `buildVHashSystemPrompt()` | ~20 lines | V# uses it immediately |
| 6 | Surface map in V# responses (DX trust) | Prompt change | Trust layer |
| 7 | Content-based retrieval (GitHub Search API) | Medium | Fixes path-grep limitation |
| 8 | Feedback loop (thumbs up/down on V# analysis) | Medium | Closes trust death risk |

---

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale |
|---|-------|----------|----------------|-----------|-----------|
| 1 | CEO | Rename "graph" to "system registry" | Mechanical | P5 | Graph framing invites traversal complexity DE-code X doesn't need yet |
| 2 | CEO | Fixed canonical system vocabulary (15 names) | Mechanical | P5 | Prevents name instability across map rebuilds |
| 3 | CEO | Supabase Storage (not Postgres) for persistence | Mechanical | P5 | Blob artifact, not relational record |
| 4 | Eng | 2-file evidence minimum for maturity="exists" | Mechanical | P1 | 1-file is too fragile; false positive → injection pollution |
| 5 | Eng | 8-system hard cap in v1 | Mechanical | P5 | Token discipline + prevents scope creep |
| 6 | DX | System map must be surfaced in V# responses | Mechanical | P1 | Hidden influence on answers = trust liability |

---

## GSTACK REVIEW REPORT

| Run | Skill | Status | Findings |
|-----|-------|--------|---------|
| 2026-05-27 | plan-ceo-review | issues_open (1) | "Graph" framing wrong; cold-start risk; 6-month competition window |
| 2026-05-27 | plan-eng-review | issues_open (6) | 6 hidden flaws identified, all addressable; v1 scope clear |
| 2026-05-27 | plan-devex-review | issues_open (1) | System map must be surfaced — trust requirement |
| 2026-05-27 | autoplan-voices | subagent-only (Codex unavailable) | CEO: 5 findings. Eng: 6 flaws. DX: 1 critical. |
