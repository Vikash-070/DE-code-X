# Contributing to DE-code X

## Adding a New Intelligence Module

DE-code X has a 5-step pattern for adding intelligence modules. Follow this exactly — the pattern exists to prevent silent data loss, prompt injection, and untestable pipelines.

**Estimated time to hello world: ~2 hours.**

---

### Step 1 — Implement `IntelligenceModule`

Create `apps/web/src/server/repo/<name>-analyzer.ts`.

Every file-scoped module (cipher, sentinel, pulse) follows the same pipeline via `shared-file-analyzer.ts`. Repo-scoped modules (atlas, forge) are standalone.

**File-scoped module (recommended starting point):**

```typescript
// apps/web/src/server/repo/example-analyzer.ts

import { analyzeFileWithModule } from "@/server/repo/shared-file-analyzer";
import type { AgentResult, ModuleInput } from "@/types/intelligence";

const EXAMPLE_SYSTEM_PROMPT = `
You are Example, a [describe what this module does] intelligence module for DE-code X.

[Write your analysis instructions here. Be specific about what evidence to look for.]

OUTPUT FORMAT — respond ONLY with a JSON array of findings:
[
  {
    "id": "unique-id",
    "type": "implementation|integrity|pressure|dependency|security-signal",
    "title": "Short finding title (≤80 chars)",
    "description": "What was found and why it matters",
    "confidence": "confirmed|inferred|speculative",
    "agentReasoning": "MUST reference specific line numbers or code patterns",
    "evidenceLines": { "start": 10, "end": 15 }
  }
]

RULES:
- confirmed findings MUST have evidenceLines with specific line numbers
- agentReasoning MUST reference specific code patterns or line numbers, never vague
- Return [] if no findings — never invent findings
`.trim();

export interface ExampleAnalyzeParams {
  owner:        string;
  repo:         string;
  filePath:     string;
  branch:       string;
  githubToken:  string;
  aiConfig:     import("@/types/intelligence").ModuleInput["aiConfig"];
  dryRun?:      boolean;
}

export async function analyzeFileWithExample(
  params: ExampleAnalyzeParams
): Promise<AgentResult> {
  return analyzeFileWithModule({
    agentId:      "example",           // must match AgentId union (Step 2)
    systemPrompt: EXAMPLE_SYSTEM_PROMPT,
    owner:        params.owner,
    repo:         params.repo,
    filePath:     params.filePath,
    branch:       params.branch,
    githubToken:  params.githubToken,
    aiConfig:     params.aiConfig,
    dryRun:       params.dryRun,
  });
}
```

**Post-processor (optional, strongly recommended for security modules):**

If your module can produce false positives (e.g. "all clear" claims), add a `postProcess` hook:

```typescript
function examplePostProcess(findings: CipherFinding[], filePath: string): CipherFinding[] {
  return findings.filter(f => {
    // Strip false positives
    const text = f.description.toLowerCase();
    if (text.includes("no issues found")) return false;
    // Strip confirmed findings without line reference
    if (f.confidence === "confirmed" && !f.evidenceLines) return false;
    return true;
  });
}

// Pass to analyzeFileWithModule:
return analyzeFileWithModule({
  // ...
  postProcess: examplePostProcess,
});
```

---

### Step 2 — Register in `AGENT_REGISTRY`

Open `apps/web/src/server/repo/agent-registry.ts` and add your module:

```typescript
example: {
  agentId:     "example",
  displayName: "Example",
  description: "One-line description of what this module analyses",
  scope:       "file",       // "file" or "repo"
  requiresAI:  true,
  intentPatterns: [
    // Phrases a user might type that should route to this module in V# chat
    "example question",
    "another trigger phrase",
  ],
},
```

**`intentPatterns` are critical** — they determine when V# injects your module's stored findings into answers. Choose phrases that uniquely signal your module's domain.

---

### Step 3 — Add `agentId` to the union type

Open `apps/web/src/types/intelligence.ts` and add your id:

```typescript
export type AgentId = "cipher" | "atlas" | "sentinel" | "pulse" | "forge" | "example";
```

This is a one-line change that unlocks TypeScript type safety across the entire system: DB queries, prompt builders, API responses, UI components.

---

### Step 4 — Write tests

Create `apps/web/src/server/repo/__tests__/<name>.test.ts`.

**Minimum required tests:**

```typescript
// 1. Post-processor strips false positives
it("post-processor strips 'no issues found' claims", () => { ... });

// 2. Post-processor strips confirmed findings without line reference  
it("strips confirmed findings without evidenceLines", () => { ... });

// 3. Module does NOT call another module's system prompt internally
// (verified by checking which prompt is passed to analyzeFileWithModule)

// 4. V# routing: intent phrase → your module
it("'[your trigger phrase]?' → delegates to Example", () => {
  const result = matchIntentToAgent("[your trigger phrase]");
  expect(result?.agentId).toBe("example");
});
```

See `__tests__/multi-module-intelligence.test.ts` for the full test pattern (10 tests covering all modules).

---

### Step 5 — Wire V# routing (automatic)

No extra work needed. V# routing is automatic once Step 2 is done:

1. `matchIntentToAgent(userMessage)` matches your `intentPatterns`
2. `getModuleContext(repoFullName, branch, "example")` fetches stored findings
3. `formatModuleContextForPrompt(ctx)` formats them as a compact block
4. Block is injected into `repositoryContext.moduleIntelligence` in `orchestrate/route.ts`
5. V# answers questions grounded in your module's real findings

The routing fires automatically on every V# chat message. No manual wiring needed.

---

## Module Architecture

```
User message
    │
    ▼
matchIntentToAgent()          ← agent-registry.ts
    │ intent match
    ▼
getModuleContext()             ← module-context.ts
    │ top 5 findings from DB
    ▼
formatModuleContextForPrompt() ← module-context.ts
    │ compact block
    ▼
repositoryContext.moduleIntelligence
    │
    ▼
buildVHashSystemPrompt()       ← vhash-prompt.ts
    │ injected into system prompt
    ▼
V# response (grounded in stored intelligence)
```

```
analyzeFileWithModule()        ← shared-file-analyzer.ts
    │ shared pipeline (cache, AI call, post-process, persist)
    ├── cipher-analyzer.ts     ← agentId: "cipher"
    ├── sentinel-analyzer.ts   ← agentId: "sentinel"  
    └── pulse-analyzer.ts      ← agentId: "pulse"

analyzeRepoWithAtlas()         ← atlas-analyzer.ts     (no AI, tree-derived)
createImplementationPlan()     ← forge-planner.ts      (aggregates all modules)
```

---

## DB Migration Prerequisite

**Before any new module writes to `FileIntelligence`**, the 4-field unique key migration must be deployed:

```sql
-- Already shipped in: packages/config/prisma/migrations/20260528103000_add_agentid_to_file_intelligence_unique/
CREATE UNIQUE INDEX "file_intelligence_repoFullName_filePath_branch_agentId_key"
  ON "file_intelligence"("repoFullName", "filePath", "branch", "agentId");
```

**Without this migration**: Sentinel's `upsertFileIntelligence()` silently overwrites Cipher findings for the same file. This is data loss.

Run `npx prisma migrate deploy` against your Supabase instance before shipping any new module.

---

## Finding Schema

All modules share `CipherFinding` from `types/intelligence.ts`:

```typescript
interface CipherFinding {
  id:             string;             // unique, kebab-case: "repo-type-description"
  type:           FindingType;        // "implementation" | "integrity" | "pressure" | "dependency" | "security-signal"
  title:          string;             // ≤80 chars, action-oriented
  description:    string;             // what was found and why it matters
  confidence:     "confirmed" | "inferred" | "speculative";
  agentReasoning: string;             // MUST reference specific line numbers or patterns
  evidenceLines?: { start: number; end: number };
  metadata?:      Record<string, unknown>;  // per-module extension point
}
```

**Confidence rules:**
- `confirmed` — MUST have `evidenceLines` with specific line numbers
- `inferred` — strong circumstantial evidence; line reference recommended
- `speculative` — pattern-based; no line reference required

**Never add custom confidence tiers.** Use `metadata` for per-module extra fields.

---

## Checklist

Before opening a PR for a new module:

- [ ] `<name>-analyzer.ts` created with system prompt and post-processor
- [ ] `AGENT_REGISTRY` entry added with `intentPatterns`
- [ ] `AgentId` union updated in `types/intelligence.ts`
- [ ] Tests written (minimum 4 per module — see Step 4)
- [ ] V# routing tested: `matchIntentToAgent("<trigger phrase>")` returns your module
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] DB migration deployed to staging before testing persistence
