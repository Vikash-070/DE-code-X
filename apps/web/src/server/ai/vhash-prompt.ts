/**
 * V# system prompt builder.
 *
 * Keep this tight — it is injected on every orchestration call.
 * Verbosity here costs tokens on every user message.
 *
 * Circular dep note: reference-evaluator.ts imports RepoContextInput + CodeContext
 * from this file. To avoid the cycle, buildVHashSystemPromptWithEvaluation() uses
 * local interfaces (EvalIntent, EvalResult) that are structurally compatible with
 * ImplementationIntent + ReferenceEvaluation — no import required.
 */

import type { RepoSystem } from "@/server/repo/system-vocabulary";

export interface RepoContextInput {
  fullName:   string;
  name:       string;
  language:   string | null;
  forks?:     number;
  openIssues?: number;
  /** Default branch name — used for tree/file retrieval (falls back to "main") */
  defaultBranch?: string;
  /** Enriched by prior Atlas analysis (optional) */
  architecturePatterns?: string[];
  authSystem?:           string;
  stateManagement?:      string;
  apiPattern?:           string;
  /**
   * V1 system map: detected engineering systems from package.json analysis.
   * Populated by system-registry.ts in route.ts before prompt assembly.
   * Injected as a compact system-map block in buildVHashSystemPrompt().
   * Absent for conversational messages and reference pipeline calls.
   */
  systems?: RepoSystem[];
  /**
   * T2.3: Architectural domain map — structural shape of the repository.
   * Pre-formatted by formatDomainMap() from domain-map.ts.
   * Injected into buildVHashSystemPrompt() so V# knows which domains exist
   * and how many files each contains, without reading individual files.
   * Example: "Heavy: Feature Modules (47 files), API Routes (31 files)"
   */
  domainMap?: string;
  /**
   * Module intelligence context — top stored findings from the intelligence module
   * most relevant to the user's current message.
   *
   * Populated by matchIntentToAgent() + getModuleContext() in orchestrate/route.ts.
   * Absent for conversational messages and when no findings are stored yet.
   * Pre-formatted by formatModuleContextForPrompt() from module-context.ts.
   *
   * Example:
   *   "=== Sentinel Intelligence — 3 stored security findings ===
   *   • route.ts — SQL injection risk (confirmed, line 42): ..."
   */
  moduleIntelligence?: string;
}

// ─── System map formatting ────────────────────────────────────

/**
 * Format the V1 system map as a compact, token-efficient block for system prompts.
 *
 * Format:
 *   Detected systems:
 *     ⚠️ Authentication — Clerk
 *     ⚠️ Database — Prisma, Supabase
 *
 * Status icons:
 *   ✅ strong  (v2 — package + evidence files confirmed)
 *   ⚠️ partial (v1 default — package.json signal only)
 *   ❌ missing (excluded from v1 output — absence adds noise, not signal)
 *
 * Only name + status + stackComponents are injected.
 * evidenceFiles are for debugging and UI display — not the system prompt.
 */
function formatSystemMap(systems: RepoSystem[] | undefined): string | null {
  if (!systems?.length) return null;

  const detected = systems.filter(s => s.status !== "missing");
  if (!detected.length) return null;

  const strongCount  = detected.filter(s => s.status === "strong").length;
  const partialCount = detected.filter(s => s.status === "partial").length;

  const lines = detected.map(s => {
    const icon = s.status === "strong" ? "✅" : "⚠️";
    const components = s.stackComponents.length
      ? ` — ${s.stackComponents.join(", ")}`
      : "";

    // v2: strong systems show compact evidence paths (up to 3 files, basename only to save tokens)
    // Full paths are in evidenceFiles if needed — basenames are enough to orient V#.
    const evidenceSuffix = s.status === "strong" && s.evidenceFiles.length > 0
      ? ` [${s.evidenceFiles.map(p => p.split("/").pop()).join(", ")}]`
      : "";

    return `  ${icon} ${s.name}${components}${evidenceSuffix}`;
  });

  // Evidence constraint differs by strength:
  //   strong  → source files confirmed; V# can cite them directly
  //   partial → package.json signal only; V# must not invent paths
  const hasStrong  = strongCount > 0;
  const hasPartial = partialCount > 0;

  const constraintParts: string[] = [];

  if (hasStrong) {
    constraintParts.push(
      `Systems marked ✅ have confirmed source file evidence (filenames shown in brackets). ` +
      `You may cite these paths in your response — they are real.`
    );
  }
  if (hasPartial) {
    constraintParts.push(
      `Systems marked ⚠️ were detected from package.json only — source files not yet scanned. ` +
      `You do NOT know which file configures them, what env variable names are used, ` +
      `or what queue/table/channel names are defined. ` +
      `If asked about a ⚠️ system, say: ` +
      `"I can see [package] is in your dependencies but haven't read the source files yet — ` +
      `ask me to search for the specific file and I'll retrieve it."`
    );
  }

  const headerLine = hasStrong
    ? `Detected systems (✅ source-confirmed · ⚠️ package.json only):`
    : `Detected systems (package.json — source files not yet read):`;

  return (
    `${headerLine}\n` +
    `${lines.join("\n")}\n\n` +
    `Evidence constraint: ${constraintParts.join(" ")}`
  );
}

export function buildVHashSystemPrompt(ctx: RepoContextInput): string {
  const lang = ctx.language ?? "TypeScript";

  const facts = [
    `Repository: ${ctx.fullName}`,
    `Stack: ${lang}`,
    ctx.architecturePatterns?.length
      ? `Architecture: ${ctx.architecturePatterns.join(", ")}`
      : null,
    ctx.authSystem       ? `Auth: ${ctx.authSystem}`             : null,
    ctx.stateManagement  ? `State: ${ctx.stateManagement}`       : null,
    ctx.apiPattern       ? `API pattern: ${ctx.apiPattern}`      : null,
    ctx.openIssues && ctx.openIssues > 0
      ? `Open issues: ${ctx.openIssues}`
      : null,
    formatSystemMap(ctx.systems),
    // T2.3: domain map — structural shape, injected when architectureTree is available.
    // Gives V# knowledge of which top-level directories exist and how heavy they are,
    // so it can answer "what auth files are there?" without explicit file path mentions.
    ctx.domainMap
      ? `\n${ctx.domainMap}\n\nDomain map constraint: The domain names above are structural — they reflect directory layout, not file semantics. You know WHICH domains exist and their size. You do NOT know exact file names unless you have retrieved them. When the user asks about files in a domain, use the domain name to reason directionally (e.g. "there are 12 files in the Auth Layer domain") but say you need to retrieve the specific files to go deeper.`
      : null,
    // Module intelligence — top stored findings from the most relevant intelligence module.
    // Injected when the user's message matches a module's intentPatterns (sentinel, pulse, etc.).
    // Grounds V# answers in persisted analysis rather than generic reasoning.
    ctx.moduleIntelligence
      ? `\n${ctx.moduleIntelligence}\n\nModule intelligence constraint: The findings above are from stored analysis of actual source files. Use them as ground truth. If the user asks about a finding, reason from the stored evidence. If no findings are listed for a topic, say the relevant files haven't been analyzed yet.`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `You are V#, an AI systems engineer and technical co-founder embedded in ${ctx.name}.

${facts}

Personality: senior engineer who has seen every pattern, made every mistake, and fixed it. Confident, calm, direct. Not corporate. Not chatbot-y. Slightly futuristic in framing. You think in architecture, speak in plain language.

Conversation handling:
- If the user sends a casual or conversational message (greeting, check-in, vibe), respond naturally in 1-2 sentences. Reference the repo or current context. Invite the next move. Do NOT refuse or explain your purpose at length.
- If the message is technical, respond with precision — dense, direct, action-oriented.
- Never output: "No relevant changes detected", "I cannot assist with", or any compliance-style refusal unless the request is genuinely impossible or harmful.

For technical responses — use only what's needed:
- Lead with the key architectural fact
- Which systems are affected (specific, not generic)
- Ordered implementation steps
- Security or sequencing risk if present

Rules: No emoji. No preamble. No restating the question. Start your response at the point. Short paragraphs. If context is sparse, reason from the stack and domain map — but NEVER invent file paths. If you don't have source files for a question, say what domain they live in (if you know from the domain map) and offer to retrieve the specific file.`;
// Note: V# may reason from detected systems (package.json) + domain map (directory structure),
// but must never fabricate file paths. Domain map gives structural awareness without file reads.
}

/**
 * Lightweight prompt for casual, conversational, non-technical messages.
 * Used when the routing layer detects a greeting or short non-technical input.
 * Returns a short response that stays in character and invites technical work.
 */
export function buildConversationalPrompt(ctx: RepoContextInput): string {
  const lang = ctx.language ?? "TypeScript";
  const issueNote = ctx.openIssues && ctx.openIssues > 10
    ? ` ${ctx.openIssues} open issues in the tracker.`
    : "";

  return `You are V#, an AI systems engineer embedded in ${ctx.name} (${lang}).${issueNote}

The user sent a casual or conversational message — a greeting, a check-in, or short nontechnical phrase.

Respond in 1-2 sentences maximum. Be direct and warm. Sound like a technical co-founder checking in at the start of a work session. Reference the repository or a concrete technical area if it adds context. Close with an open invitation for the next technical move — but don't make it feel like a sales pitch.

Do not explain who you are at length. Do not list capabilities. Do not refuse. Just respond like a real engineer would when someone says "hey" at the start of a session.`;
}

// ─── Code context injection ───────────────────────────────

export interface CodeContextFile {
  path:      string;
  content:   string;
  truncated: boolean;
}

export interface CodeContext {
  files:           CodeContextFile[];
  treeQuery?:      string;    // what was searched to find these files
  /**
   * Folder listing mode — paths only, no file content fetched.
   * Populated when the query was a directory question ("what's in /api?").
   * When present, V# receives the path list and MUST NOT describe file contents
   * it hasn't read. Mutually exclusive with files[] having content.
   */
  folderListing?:  string[];  // file paths under the queried directory
  folderPrefix?:   string;    // the directory prefix (folder) or keyword (inventory) that was searched
  /**
   * How folderListing was produced:
   *   "folder"   — listFolderContents() prefix search ("what's in /api?")
   *   "keyword"  — searchTreeByKeyword() cross-repo search ("what auth files are there?") Phase 2
   *   "semantic" — pgvector cosine similarity ("what handles rate limiting?") Phase 3
   * Controls the header rendered in buildVHashSystemPromptWithContext().
   * Absent for file-content retrieval paths.
   */
  searchMode?:     "folder" | "keyword" | "semantic";
  /**
   * Retrieval status — injected into the system prompt so V# can
   * signal confidence honestly rather than inventing file paths.
   * "files_retrieved"   — source files were found and injected
   * "folder_listed"     — directory listing returned (paths only, no content)
   * "retrieval_failed"  — retrieval was attempted but returned nothing
   */
  retrievalStatus?: "files_retrieved" | "folder_listed" | "retrieval_failed";
}

/**
 * Full V# prompt with injected repository code context.
 *
 * Handles three injection modes:
 *   1. File content mode — actual source files retrieved, V# reasons from code
 *   2. Folder listing mode — paths-only listing from directory query
 *   3. Retrieval constraint — when code is null/empty, V# must NOT invent paths
 *
 * Token budget is preserved — V# is told to reason from the files, not pad.
 */
export function buildVHashSystemPromptWithContext(
  ctx:  RepoContextInput,
  code: CodeContext
): string {
  const base = buildVHashSystemPrompt(ctx);

  // ── Semantic search mode (pgvector cosine similarity) ─────────────────
  // Fires when no explicit file refs were found and pgvector has indexed files.
  // "what files handle rate limiting?", "what handles payment processing?"
  if (code.folderListing && code.folderListing.length > 0 && code.searchMode === "semantic") {
    const pathList = code.folderListing.map(p => `  ${p}`).join("\n");
    const countNote = `${code.folderListing.length} file${code.folderListing.length !== 1 ? "s" : ""}`;

    return `${base}

─── Semantic Search Results ───

Files semantically related to your query (${countNote}), ranked by relevance:

${pathList}

These are real file paths from the repository — confirmed by Cipher's analysis index.
You have NOT read their source content yet.
Rules for this response:
- These files were found by embedding similarity, not path keywords — they are likely relevant even if the query term doesn't appear in their names.
- For each file, reason about its likely purpose from its path and directory structure. Label it "likely" or "probably", not as fact.
- Do NOT describe file contents you haven't read.
- Offer to retrieve any of these files for deeper analysis — the user can ask about a specific one and you'll read it.
- If none of these look right, say so — the embedding index may not have full coverage yet (only analyzed files are indexed).`;
  }

  // ── Keyword search mode (cross-repo inventory) ────────────────────────
  // "what auth files are in our repo?", "show me all payment files"
  if (code.folderListing && code.folderListing.length > 0 && code.searchMode === "keyword") {
    const keyword   = code.folderPrefix ?? code.treeQuery ?? "unknown";
    const pathList  = code.folderListing.map(p => `  ${p}`).join("\n");
    const countNote = code.folderListing.length === 50
      ? `${code.folderListing.length} files (top results — more may exist)`
      : `${code.folderListing.length} file${code.folderListing.length !== 1 ? "s" : ""}`;

    return `${base}

─── Keyword Search Results ───

Files matching '${keyword}' across ${ctx.name} (${countNote}):

${pathList}

These are real file paths confirmed in the repository tree. You have NOT read their contents.
Rules for this response:
- List the key files and group them by directory if it aids clarity.
- For each file, you may infer its likely purpose from its name and path — but label this "likely" or "probably", not fact.
- Do NOT describe what any file contains — you haven't read them.
- If the user wants to go deeper on a specific file, tell them to ask about it and you'll retrieve it.
- If no file listed looks like what they need, say so honestly.`;
  }

  // ── Folder listing mode ────────────────────────────────────────────────
  if (code.folderListing && code.folderListing.length > 0) {
    const folderNote = code.folderPrefix
      ? `Contents of \`${code.folderPrefix}/\` in ${ctx.name} (${code.folderListing.length} files):`
      : `Directory listing from ${ctx.name}:`;

    const pathList = code.folderListing.map(p => `  ${p}`).join("\n");

    return `${base}

─── Directory Listing ───

${folderNote}

${pathList}

These are real file paths from the repository tree. You have NOT read their contents.
To answer questions about what a specific file does, ask the user to follow up with that filename and you'll retrieve it.
Do not describe file contents you haven't read. Do not invent what these files contain.
You may reason about what files likely do based on their names and paths alone — but label this as inference, not fact.`;
  }

  // ── File content mode ──────────────────────────────────────────────────
  if (code.files.length > 0) {
    const fileBlocks = code.files
      .map((f) => {
        const truncNote = f.truncated ? "\n// [truncated at 6KB — remaining content omitted]" : "";
        return `\`\`\`\n// File: ${f.path}${truncNote}\n${f.content}\n\`\`\``;
      })
      .join("\n\n");

    const retrievedPaths = code.files.map(f => f.path).join(", ");
    const contextNote = code.treeQuery
      ? `The following source file(s) from ${ctx.name} were retrieved based on the user's message (query: "${code.treeQuery}"):`
      : `The following source file(s) from ${ctx.name} were retrieved for this request:`;

    return `${base}

─── Retrieved Source Context ───

${contextNote}

${fileBlocks}

Retrieved files: ${retrievedPaths}
Confidence constraint: You have read these ${code.files.length} file(s). Only cite paths from the list above. For any other file the user asks about, say: "I haven't read that file yet — ask me to look it up and I'll retrieve it."
Reason directly from the code above. Reference specific line patterns, function names, or structural decisions where relevant.`;
  }

  // ── Fallback: return base prompt unchanged ─────────────────────────────
  return base;
}

// ─── Reference evaluation injection ──────────────────────

/**
 * Local structural aliases for ImplementationIntent + ReferenceEvaluation.
 * Avoids a circular import with reference-evaluator.ts (which imports
 * RepoContextInput and CodeContext from this file).
 * Structurally identical — TypeScript ensures compatibility at call sites.
 */
interface EvalIntent {
  patterns:             string[];
  systems:              string[];  // named engineering systems: "request throttling middleware"
  realtimeBehaviors:    string[];  // async/realtime behaviors: "burst protection"
  architectureConcerns: string[];  // architecture implications: "horizontal scaling"
  stackHints:           string[];
  coreFeatures:         string[];
  uiPatterns:           string[];
  sourceType:           string;
  sourceTitle?:         string;
}

interface EvalResult {
  alreadySupported: string[];
  missingSystems:   string[];
  complexity:       string;
  complexityReason: string;
  architectureFit:  string;
  confidence:       string;  // "high" | "medium" | "low"
  confidenceReason: string;  // explains basis for assessment
}

/**
 * V# prompt with injected reference evaluation context.
 *
 * Used when the Inspire pipeline has processed a reference URL (YouTube, Loom, X).
 * Injects a compact evaluation block directing V# to synthesize a
 * repository-aware implementation feasibility assessment.
 *
 * V# is told to respond conversationally — acknowledging what the
 * repo already supports, naming what's missing, and estimating complexity.
 * The raw evaluation data is formatted as natural-language directives,
 * never exposed as JSON to the client.
 */
export function buildVHashSystemPromptWithEvaluation(
  ctx:        RepoContextInput,
  intent:     EvalIntent,
  evaluation: EvalResult,
  code?:      CodeContext,
  options?:   { summarizeFirst?: boolean }
): string {
  const base = code?.files.length
    ? buildVHashSystemPromptWithContext(ctx, code)
    : buildVHashSystemPrompt(ctx);

  const sourceLabel = intent.sourceTitle
    ? `"${intent.sourceTitle.slice(0, 80)}"`
    : "the reference";

  const alreadyBlock = evaluation.alreadySupported.length
    ? `Already supported in ${ctx.name}: ${evaluation.alreadySupported.join(", ")}.`
    : `No direct capability overlap detected in ${ctx.name}.`;

  const missingBlock = evaluation.missingSystems.length
    ? `Missing systems: ${evaluation.missingSystems.join(", ")}.`
    : "No critical missing systems identified.";

  const complexityBlock =
    `Implementation complexity: ${evaluation.complexity}. ${evaluation.complexityReason}.`;

  const fitBlock =
    `Architecture fit: ${evaluation.architectureFit}. ` +
    (evaluation.architectureFit === "good"
      ? "The repository's existing architecture aligns well with this implementation."
      : evaluation.architectureFit === "partial"
      ? "Some architectural alignment exists but significant new work is required."
      : "This implementation would require substantial new infrastructure.");

  const patternsBlock = intent.patterns.length
    ? `Patterns from reference: ${intent.patterns.join("; ")}.`
    : "";

  const systemsBlock = intent.systems?.length
    ? `Engineering systems required: ${intent.systems.join("; ")}.`
    : "";

  const concernsBlock = intent.architectureConcerns?.length
    ? `Architecture concerns: ${intent.architectureConcerns.join("; ")}.`
    : "";

  const confidenceLevel = (evaluation.confidence ?? "low").toUpperCase();
  const confidenceBlock = `Evaluation confidence: ${confidenceLevel}. ${evaluation.confidenceReason ?? "Assessment based on available context."}.`;

  // Confidence changes V# BEHAVIOR, not just labels:
  // low  → ask user to describe their infrastructure, what they have for storage/caching
  // medium → qualify assessment as "based on what I could inspect"
  // high → speak directly from the code evidence retrieved
  const confidenceBehaviorDirective =
    evaluation.confidence === "high"
      ? `You have high confidence — speak directly from the code evidence. Reference specific file patterns, function names, or structural decisions where you found matches.`
      : evaluation.confidence === "medium"
      ? `You have medium confidence — qualify your assessment with "based on what I could inspect" or similar. Name the specific areas you were able to verify and the areas you couldn't.`
      : `You have low confidence — you have limited visibility into this repository's infrastructure. After your brief feasibility overview, ask the user one targeted question: what they currently use for [the most relevant missing system, e.g. caching/storage/middleware]. Do not speculate — invite them to fill the gap.`;

  const summarizeDirective = options?.summarizeFirst
    ? `\nStart with a 2-3 sentence plain-English summary of what this reference demonstrates, then give the full compatibility analysis below.`
    : "";

  return `${base}

─── Reference Evaluation Context ───

The user shared ${sourceLabel} as an implementation reference.
${patternsBlock}
${systemsBlock}
${concernsBlock}

${alreadyBlock}
${missingBlock}
${complexityBlock}
${fitBlock}
${confidenceBlock}

${confidenceBehaviorDirective}
${summarizeDirective}
Respond conversationally. Lead with what the repository already supports (be specific — name the actual systems/patterns, and where you found evidence if confidence is high). Then clearly state what engineering systems need to be built. Give the complexity assessment and why. Close with a concrete recommended first step. Do not generate a full implementation plan — that comes later if the user asks. Keep the tone of a senior engineer doing a quick feasibility check.`;
}

// ─── Reference understanding prompt ──────────────────────

/**
 * Lightweight prompt for understanding-mode reference messages.
 *
 * Used when `detectReferenceIntent()` returns "understanding" — the user
 * wants to know what the reference content IS, not whether they can build it.
 *
 * Skips the evaluation data entirely (no intent extraction, no repo compatibility
 * analysis). Passes the raw transcript + title directly to V# with a directive
 * to explain the content and relate it briefly to the repository.
 *
 * Latency win vs evaluation mode: ~550-850ms (no Stage 3 LLM call, no Stage 3.5
 * file retrieval, no Stage 4 compatibility evaluation).
 *
 * Anti-contamination: V# is explicitly told the transcript is present and must
 * never claim inability to access the content. This prevents the model from
 * falling back to "I cannot access external content" — a response that is
 * factually wrong when transcript fetch succeeded.
 */
export function buildVHashSystemPromptForReferenceUnderstanding(
  ctx:          RepoContextInput,
  title:        string | undefined,
  text:         string,
  platformType: string
): string {
  const base = buildVHashSystemPrompt(ctx);

  const platformLabel = platformType === "youtube" ? "YouTube video"
                      : platformType === "loom"    ? "Loom recording"
                      : platformType === "twitter" ? "X (Twitter) post"
                      : "reference";

  const titleLine = title ? `Title: "${title.slice(0, 120)}"` : "";

  // Cap transcript at 4KB for understanding mode — full detail not needed for a summary.
  const textSlice = text.slice(0, 4_000);
  const truncNote = text.length > 4_000
    ? "\n[transcript truncated at 4KB — full content omitted for conciseness]"
    : "";

  return `${base}

─── Reference Content ───

IMPORTANT: The transcript/content of the referenced ${platformLabel} has been successfully extracted and is provided below. You have full access to this content. Never say you cannot access the video, the link, or the referenced content — the extraction already happened server-side.

The user shared a ${platformLabel} for you to explain.
${titleLine}

Content:
${textSlice}${truncNote}

Your task: explain what this ${platformLabel} demonstrates. Cover:
1. What the content is about — the core technique, feature, or approach being shown
2. The technologies, tools, or patterns used (if identifiable from the content)
3. How this relates to ${ctx.name}'s architecture — a 1-2 sentence observation

Do NOT discuss whether the repository can build this — the user asked for explanation, not evaluation. Keep it concise. If the content is unclear or sparse, say so honestly and offer to explore a specific aspect if they can share more.`;
}

// ─── Reference failure prompt ─────────────────────────────

/**
 * Fail-open prompt for when a reference URL was detected but content
 * extraction failed (no captions, server-side block, network error, etc.).
 *
 * Without this, V# falls back to `buildVHashSystemPrompt`, which leaves the
 * raw YouTube URL in the user message body. The model correctly says
 * "I cannot access external content" — accurate to the wrong prompt.
 *
 * This prompt tells V# that an extraction attempt WAS made, what likely
 * failed, and how to guide the user to continue productively.
 */
export function buildVHashSystemPromptWithReferenceFailure(
  ctx:          RepoContextInput,
  platform:     string,
  referenceUrl: string
): string {
  const base          = buildVHashSystemPrompt(ctx);
  const platformLabel = platform === "youtube" ? "YouTube"
                      : platform === "loom"    ? "Loom"
                      : platform === "twitter" ? "X (Twitter)"
                      : platform;

  return `${base}

─── Reference Extraction Context ───

The user shared a ${platformLabel} link: ${referenceUrl}

Server-side extraction was attempted and failed. The failure is technical — no captions available, content blocked for server-side access, or the video is private/unavailable. This is NOT a capability limitation.

Your response must follow this exact structure — no deviation:
1. Open with: "I ran the transcript extraction for that ${platformLabel} but couldn't pull the content — "
2. Then give ONE specific likely reason (e.g. "no auto-generated captions on this video" or "YouTube is blocking server-side requests right now")
3. Then offer a concrete workaround in one sentence: suggest they paste the key timestamps, copy a code snippet from the video, or describe the implementation pattern they want to use
4. Close with what you CAN do once they give you that context

Do not say "I can't access that link." Do not say "I'm unable to." Do not claim a capability limitation. The extraction ran — it hit a technical wall, not an architectural one. Respond accordingly.`;
}

/** Infer likely framework hints from repository metadata */
export function inferStackHints(ctx: Pick<RepoContextInput, "name" | "language">): string[] {
  const hints: string[] = [];
  const name = ctx.name.toLowerCase();
  const lang = ctx.language?.toLowerCase() ?? "";

  if (name.includes("next") || name.includes("nextjs"))            hints.push("Next.js");
  if (name.includes("nest") && !hints.includes("Next.js"))         hints.push("NestJS");
  if (name.includes("expo") || name.includes("mobile"))            hints.push("React Native / Expo");
  if (name.includes("api") || name.includes("server"))             hints.push("API server");
  if (lang === "typescript" || lang === "javascript")              hints.push("Node.js ecosystem");
  if (lang === "python")  hints.push("Python");
  if (lang === "go")      hints.push("Go");
  if (lang === "rust")    hints.push("Rust");

  return hints;
}
