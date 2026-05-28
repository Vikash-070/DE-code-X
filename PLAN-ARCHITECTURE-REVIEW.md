<!-- /autoplan restore point: /c/Users/VIKASH/.gstack/projects/testing/master-autoplan-restore-20260527-103247.md -->

# PLAN — DE-code X: Long-Term Architecture Direction Review

**Status:** ✅ Review complete — 2026-05-27
**Type:** Strategic architecture review (not a feature plan)
**Session:** autoplan
**Created:** 2026-05-27

---

## Input Brief

DE-code X is evolving into: **Repository + Reference + Architecture Intelligence**

Goal: implementation intelligence — not generic chat, not generic summaries.

### Already Implemented
OpenRouter orchestration, streaming chat pipeline, repo retrieval, GitHub tree indexing,
file retrieval, contextual code injection, transcript extraction, semantic extraction,
reference ingestion, implementation evaluation, telemetry, fail-open routing,
URL normalization, semantic retrieval targeting, intent-aware reference routing.

### Intentionally Avoided
Embeddings, vector DB, agent swarms, recursive orchestration, giant prompts.

### Architecture Priorities
Deterministic, observable, low-token, composable, grounded reasoning.

### Core Evolution
The moat is NOT transcript summaries. The moat IS implementation semantics understanding.
The same reference should produce DIFFERENT reasoning depending on the specific repository.

---

## Review Findings

### CEO Phase — Strategic Findings

**Premises:**
- P1 CHALLENGED: "Implementation semantics is the moat" → moat is "time-to-grounded-signal for YOUR specific repo"
- P2 CHALLENGED: "Video-first is right entry point" → valid for MVP, must expand (GitHub/blog/PR by month 3)
- P3 CHALLENGED: "No embeddings is principled" → cost avoidance for MVP, document as architectural debt
- P4 ACCEPTED (renamed): "Deterministic routing, observable outputs, grounded reasoning"
- P5 ACCEPTED as direction: "Same reference → different repo reasoning" — direction correct, implementation needs work

**Critical CEO findings:**
1. No feedback loop → trust death scenario (power user gets wrong answer, shares with colleagues)
2. 6-month regret: Copilot Workspace is building "can we build X?" — direct competition in 12 months
3. Frontier model risk: multimodal long-context agents may make the orchestration layer redundant
4. Video-first is too narrow: GitHub repos, blog posts, PRs all have better structured signal than transcripts

### Eng Phase — Architectural Findings

**Three Critical Weaknesses:**

1. **Stage 3.5 is a path grep, not code search** — `searchTree()` matches file PATH strings. Finds nothing in well-named repos where functionality is named by domain, not technology.
   - Fix: Search file contents (GitHub Search API or grep fetched content)

2. **No `package.json` parsing** — Whether a repo has `ioredis`, `socket.io`, `stripe`, or `@clerk/nextjs` is the highest-signal capability indicator. It's one file read away. Currently absent.
   - Fix: Fetch and parse `package.json` into `RepoContextInput.dependencies`

3. **Confidence = file retrieval count ≠ answer quality** — Retrieving a file named "redis-client.ts" scores high-confidence regardless of whether the file contains what the intent requires.
   - Fix: Evidence-grounded confidence — keyword found in FILE CONTENT, not just file path

**Additional findings:**
- `evaluateRepoCompatibility()` is pure string matching vs thin metadata — frequently inverted
- Stage 3 (LLM) has no hard timeout of its own (30s overall timeout catches it but too late)
- No eval harness for extraction accuracy — impossible to know how often Stage 3 hallucinates

### DX Phase — Developer Trust Findings

Root cause: **DE-code X is an evidence-based reasoning tool that hides its evidence.**

Three trust gaps:
1. No source citations — developer can't see which files V# used
2. No intent echo — hallucinated intent extraction is invisible until damage is done
3. No retrieval health signal — "found 4 relevant files" vs "no strong matches, this is inferred"

DX Overall: 4/10. Trust is the blocking issue.

### Three High-ROI Architectural Fixes (no new infrastructure)

| Fix | Change | Signal gain | Cost |
|-----|--------|-------------|------|
| F1 | Parse `package.json` into `RepoContextInput.dependencies` | Eliminates most false negatives in capability detection | 1 file read |
| F2 | Search file contents, not file paths (grep fetched content OR GitHub Search API) | 10x better retrieval recall | Medium — GitHub Search API quota |
| F3 | Evidence-grounded confidence (keyword in content, not just file retrieved) | Stops high-confidence labels on wrong evidence | Zero new I/O |

### Three High-ROI DX Fixes (surface what the pipeline knows)

| Fix | Change | Trust impact |
|-----|--------|--------------|
| D1 | Intent echo: "I understood this video to be about X — let me know if wrong" | Catches hallucinated intent before 200-word analysis |
| D2 | Source citations: "Based on src/middleware/api-guard.ts, src/lib/redis.ts..." | Makes retrieval failures visible |
| D3 | Retrieval health: "Found 4 relevant files" vs "No strong matches — analysis based on general patterns" | Calibrates developer trust |

### 12-Month Architecture Roadmap

**Now (shipped):**
- 3-mode intent routing ✓
- URL sanitization + canonical normalization ✓
- Semantic retrieval targeting (lexical) ✓
- Confidence-as-behavior directive ✓

**Month 1-2 (next evolution):**
- Fix F1: Parse package.json
- Fix F3: Evidence-grounded confidence
- Fix D1+D2+D3: Surface pipeline transparency to developer
- Add Stage 3 hard timeout (5s)

**Month 3-4 (differentiation layer):**
- Fix F2: Content-based retrieval (GitHub Search API)
- Add feedback mechanism (thumbs up/down on V# analysis)
- Expand reference types: GitHub repo URL, blog/MDX post
- Confidence calibration data collection begins

**Month 6-12 (moat building):**
- Repository System Model: persistent, structured understanding of each repo's engineering systems
- Cross-reference pattern accumulation: "you've asked about WebSockets in 3 different references"
- Implementation graph: visual representation of what the repo can and cannot do
- Feedback loop: correction path when V# is wrong

## Phase 1 CEO Review Findings

**Premises challenged:**
- P1: "Implementation semantics is the moat" → sharper claim: "time-to-grounded-signal for YOUR specific repo"
- P2: "Video-first is right entry point" → valid for MVP, must expand to GitHub/blog/PR
- P3: "No embeddings is principled" → temporary cost constraint, not philosophy

**Critical findings:**
1. No feedback loop = trust death scenario (CRITICAL)
2. Lexical keyword grep ≠ semantic retrieval (CRITICAL)
3. Transcript narration ≠ implementation specification (CRITICAL)
4. Frontier model risk in 12-18 months (HIGH)

---

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale |
|---|-------|----------|----------------|-----------|-----------|
| 1 | CEO | Video-first accepted as MVP entry point, must expand | Mechanical | P3+P6 | Real UX artifact; but GitHub/blog/PR must be added by month 3 |
| 2 | CEO | "No embeddings" labeled as temporary constraint, not permanent philosophy | Mechanical | P5 | Cost/complexity avoidance is valid for MVP; document as debt |
| 3 | CEO | "Deterministic" renamed to "deterministic routing, observable outputs" | Mechanical | P5 | LLM in Stage 3 makes the system non-deterministic; labeling matters |
| 4 | CEO | Feedback loop deferred to Phase 2 roadmap but must be designed now | Mechanical | P1+P2 | No correction path = the single highest trust-killing risk |
| 5 | CEO | Repo system model is Phase 2 (next evolution after current plan) | Mechanical | P2+P3 | Biggest differentiation gap; not in current scope |
| 6 | Eng | Fix F1 (package.json), F3 (evidence confidence) are Month 1-2 priorities | Mechanical | P1+P5 | Highest signal gain, lowest cost, no new infrastructure |
| 7 | Eng | Stage 3 needs dedicated 5s timeout | Mechanical | P5 | Current 30s timeout doesn't isolate Stage 3 failures |
| 8 | Eng | Fix F2 (content search) is Month 3-4 | Mechanical | P3 | GitHub Search API rate limits need careful design |
| 9 | DX | Intent echo + source citations are Month 1-2 priorities | Mechanical | P1 | Zero cost, massive trust gain |
| 10 | DX | Feedback mechanism is Month 3-4 | Mechanical | P2 | Must exist before production usage scales |

## GSTACK REVIEW REPORT

| Run | Skill | Status | Findings |
|-----|-------|--------|---------|
| 2026-05-27 | plan-ceo-review | issues_open (4) | Video-first narrow; no feedback loop; frontier model risk; moat needs sharpening |
| 2026-05-27 | plan-eng-review | issues_open (3 critical) | Path grep not content search; no package.json; confidence ≠ quality |
| 2026-05-27 | plan-devex-review | issues_open (3 critical) | Zero reasoning transparency; trust is blocking issue; DX 4/10 |
| 2026-05-27 | autoplan-voices | subagent-only (Codex unavailable) | CEO: 6 findings. Eng: 7 findings. DX: 5 findings. |
