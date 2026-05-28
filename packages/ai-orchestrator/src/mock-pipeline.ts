import type {
  AegisOutput,
  AgentOutputs,
  AtlasOutput,
  CipherOutput,
  EchoOutput,
  ForgeOutput,
  PipelineInput,
  SageOutput,
  VHashOutput
} from "./schemas";

const realtimeTerms = ["socket", "websocket", "realtime", "live", "streaming", "presence", "collaboration"];
const authTerms = ["auth", "login", "jwt", "oauth", "session", "permission", "rbac", "role"];
const stateTerms = ["redux", "zustand", "context", "state management", "store", "signal"];
const dbTerms = ["database", "sql", "postgres", "mongodb", "prisma", "orm", "query", "migration"];
const apiTerms = ["api", "rest", "graphql", "endpoint", "route", "webhook", "fetch"];
const uiTerms = ["component", "modal", "form", "layout", "animation", "drag", "scroll", "input"];
const aiTerms = ["ai", "llm", "claude", "openai", "embedding", "vector", "prompt", "inference"];

function detectTerms(input: string, terms: string[]): boolean {
  const lower = input.toLowerCase();
  return terms.some((t) => lower.includes(t));
}

function extractRepoName(fullName?: string): string {
  if (!fullName) return "connected-repository";
  return fullName.split("/").pop() ?? fullName;
}

export function runMockPipeline(input: PipelineInput): AgentOutputs {
  const { rawInput, repositoryFullName, repositoryLanguage } = input;
  const isRealtime = detectTerms(rawInput, realtimeTerms);
  const isAuth = detectTerms(rawInput, authTerms);
  const isState = detectTerms(rawInput, stateTerms);
  const isDb = detectTerms(rawInput, dbTerms);
  const isApi = detectTerms(rawInput, apiTerms);
  const isUi = detectTerms(rawInput, uiTerms);
  const isAi = detectTerms(rawInput, aiTerms);
  const repoName = extractRepoName(repositoryFullName);
  const lang = repositoryLanguage ?? "TypeScript";

  const techsDetected: string[] = [];
  if (isRealtime) techsDetected.push("WebSocket / Socket.io");
  if (isAuth) techsDetected.push("Auth middleware");
  if (isState) techsDetected.push("State management");
  if (isDb) techsDetected.push("Database layer");
  if (isApi) techsDetected.push("REST / API routes");
  if (isUi) techsDetected.push("UI component system");
  if (isAi) techsDetected.push("AI / LLM integration");
  if (techsDetected.length === 0) techsDetected.push("Application logic", "Frontend components");

  const complexity = techsDetected.length >= 4 ? "high" : techsDetected.length >= 2 ? "medium" : "low";

  const echo: EchoOutput = {
    featureName: isRealtime
      ? "Realtime Collaboration Layer"
      : isAi
        ? "AI Integration Feature"
        : isAuth
          ? "Authentication Enhancement"
          : isDb
            ? "Data Persistence Feature"
            : "Application Feature",
    featureIntent: isRealtime
      ? "Enable multiple users to interact with shared state in real time with presence awareness and conflict resolution."
      : isAi
        ? "Integrate AI inference into the application workflow with context management and response handling."
        : isAuth
          ? "Strengthen authentication boundaries and session management with improved security guarantees."
          : "Extend the application with new user-facing functionality and supporting infrastructure.",
    uiPatterns: [
      ...(isRealtime ? ["Presence cursors", "Optimistic updates", "Reconnect affordances"] : []),
      ...(isUi ? ["Form validation", "Loading states", "Error boundaries"] : []),
      ...(isAi ? ["Streaming text output", "Loading skeleton"] : []),
      "Progressive disclosure"
    ].slice(0, 4),
    architectureConcepts: [
      ...(isRealtime ? ["Event-driven architecture", "CRDT / operational transform"] : []),
      ...(isState ? ["Unidirectional data flow", "Derived state"] : []),
      ...(isDb ? ["Optimistic concurrency", "Transaction boundaries"] : []),
      ...(isApi ? ["RESTful resource modeling", "API versioning"] : []),
      "Separation of concerns"
    ].slice(0, 4),
    implementationBehaviors: [
      ...(isRealtime ? ["Socket handshake and authentication", "State synchronization on reconnect"] : []),
      ...(isAuth ? ["Server-owned session validation", "Privilege boundary enforcement"] : []),
      ...(isDb ? ["Migration-safe schema change", "Rollback strategy"] : []),
      "Error handling and graceful degradation",
      "Automated test coverage for edge cases"
    ].slice(0, 4),
    technologiesDetected: techsDetected,
    complexitySignal: complexity
  };

  const architecturePatterns: string[] = [lang === "TypeScript" || lang === "JavaScript" ? "Node.js service layer" : `${lang} backend`];
  if (isApi) architecturePatterns.push("RESTful API design");
  if (isState) architecturePatterns.push("Flux/Redux pattern");
  if (isRealtime) architecturePatterns.push("Event-driven service");

  const atlas: AtlasOutput = {
    repositoryName: repoName,
    primaryLanguage: lang,
    architecturePatterns,
    authSystem: isAuth ? "Custom JWT / Session middleware" : "Clerk / OAuth provider",
    stateManagement: isState ? "Redux Toolkit / Zustand" : "React local state + Context",
    apiPattern: isApi ? "RESTful with versioned routes" : "Internal service calls",
    estimatedImpactFiles: complexity === "high" ? 12 : complexity === "medium" ? 7 : 4,
    serviceBoundaries: [
      "Authentication service (do not cross without approval)",
      "Data access layer (use existing ORM patterns)",
      ...(isRealtime ? ["Realtime transport layer (isolate from server render)"] : []),
      ...(isAi ? ["AI inference service (rate-limit and cache aggressively)"] : [])
    ].slice(0, 3),
    dependencyConflicts: [
      ...(isRealtime ? ["Socket.io version must align with existing transport"] : []),
      ...(isAi ? ["LLM SDK version conflict may exist with current bundler"] : []),
      ...(isState ? ["State library version should be pinned to avoid hydration mismatch"] : [])
    ].slice(0, 2)
  };

  const riskScore = isAuth ? 72 : isRealtime ? 78 : complexity === "high" ? 74 : 88;

  const cipher: CipherOutput = {
    overallRisk: riskScore < 75 ? "medium" : "low",
    riskScore,
    securityFindings: [
      {
        title: "Attack surface analysis",
        severity: "low",
        detail: isAuth
          ? "Auth boundary expansion detected — session validation must remain server-owned."
          : "No significant attack surface expansion. Standard input validation required."
      },
      {
        title: "Dependency vulnerability scan",
        severity: isRealtime || isAi ? "medium" : "low",
        detail: isRealtime
          ? "Socket transport layer introduces new dependency surface. Pin versions and audit transitive dependencies."
          : "Dependency risk is within acceptable bounds. Automated auditing recommended."
      },
      {
        title: "Authorization boundary check",
        severity: isAuth ? "medium" : "low",
        detail: isAuth
          ? "Role-based permission logic detected. Verify no client-side authorization bypass is possible."
          : "No privilege boundary changes detected. Standard review sufficient."
      }
    ],
    scalabilityFindings: [
      {
        title: isRealtime ? "Socket fanout pressure" : "Request concurrency",
        impact: isRealtime ? "high" : "low",
        detail: isRealtime
          ? "Socket broadcasts must be isolated from server-render paths. Consider Redis pub/sub for horizontal scaling."
          : "No significant concurrency concerns at current traffic projections."
      },
      {
        title: "State synchronization overhead",
        impact: isState ? "medium" : "low",
        detail: isState
          ? "Ensure derived state computations are memoized to prevent redundant renders under load."
          : "State management impact is localized and bounded."
      }
    ],
    attackSurface: isAuth ? "moderate" : isRealtime ? "minimal" : "none",
    authDrift: isAuth
  };

  const sage: SageOutput = {
    validationStatus: riskScore >= 80 ? "approved" : "concerns",
    bestPracticesScore: riskScore + 4,
    antiPatternsDetected: [
      ...(isAuth ? ["Client-owned authorization logic"] : []),
      ...(isRealtime ? ["Direct DOM mutation for realtime state"] : []),
      ...(isAi ? ["Unbounded LLM context without pruning"] : []),
      ...(complexity === "high" ? ["God component anti-pattern risk"] : [])
    ].slice(0, 2),
    recommendedApproach: isRealtime
      ? "Implement via a dedicated transport service with server-side session ownership. Use optimistic updates with server reconciliation."
      : isAi
        ? "Use a streaming response pattern with server-side context management. Cache embeddings aggressively."
        : "Implement as a focused, single-responsibility service with comprehensive test coverage.",
    alternativePatterns: [
      isRealtime ? "Server-Sent Events for unidirectional updates" : "Polling with exponential backoff",
      isState ? "Server state with React Query / SWR" : "Module-level singleton state",
      "Event sourcing for auditability"
    ].slice(0, 2),
    industryPrecedents: [
      isRealtime ? "Figma multiplayer (CRDT), Linear (optimistic sync)" : "Vercel dashboard, Linear",
      isAi ? "Cursor AI, GitHub Copilot streaming" : "Stripe API patterns",
      "Next.js App Router server components"
    ].slice(0, 2)
  };

  const architectureFit = Math.max(60, riskScore - (atlas.dependencyConflicts.length * 6));

  const aegis: AegisOutput = {
    governanceDecision: architectureFit >= 75 ? "proceed" : architectureFit >= 60 ? "conditional" : "hold",
    architectureFit,
    rolloutStrategy: isRealtime
      ? "Feature-flag behind experiment gate. Gradual rollout: internal → beta → 10% → full."
      : "Standard branch-based deployment with integration tests gate before merge.",
    migrationSteps: [
      "Create feature branch from main",
      ...(isDb ? ["Write and validate database migration in staging"] : []),
      "Implement core feature with unit tests",
      "Add integration tests for auth + service boundaries",
      "Security review sign-off",
      "Staged rollout via feature flag"
    ].slice(0, 4),
    impactPrediction: `${atlas.estimatedImpactFiles} files affected across ${architecturePatterns.length} service boundaries. Estimated ${complexity === "high" ? "4-6 day" : complexity === "medium" ? "2-3 day" : "1 day"} implementation cycle.`,
    requiredApprovals: [
      ...(isAuth ? ["Security team review"] : []),
      ...(isDb ? ["Database team migration review"] : []),
      "Architecture review (AI implementation governance)",
      "QA sign-off"
    ].slice(0, 3)
  };

  const confidenceScore = Math.round((architectureFit + riskScore) / 2);

  const vhash: VHashOutput = {
    recommendation:
      aegis.governanceDecision === "proceed"
        ? "implement"
        : aegis.governanceDecision === "conditional"
          ? "implement-with-caution"
          : "defer",
    confidenceScore,
    executiveSummary: `${echo.featureName} has ${confidenceScore >= 80 ? "strong" : "moderate"} architecture compatibility with ${repoName}. ${cipher.overallRisk === "low" ? "Security risk is low." : "Security requires conditional review."} ${aegis.governanceDecision === "proceed" ? "Recommend proceeding with standard implementation workflow." : "Recommend conditional implementation with staged rollout and security gate."}`,
    keyTradeoffs: [
      isRealtime ? "Real-time adds infrastructure complexity in exchange for UX quality" : "Feature scope vs. implementation velocity",
      isAuth ? "Auth hardening improves security at the cost of session flexibility" : "New dependency surface vs. implementation speed",
      "Test coverage investment vs. time-to-ship"
    ].slice(0, 3),
    implementationPriority: confidenceScore >= 85 ? "high" : confidenceScore >= 70 ? "medium" : "low",
    estimatedComplexity: `${atlas.estimatedImpactFiles} files · ${complexity === "high" ? "4-6 days" : complexity === "medium" ? "2-3 days" : "< 1 day"} · ${complexity === "high" ? "2 engineers" : "1 engineer"}`
  };

  const affectedFiles: string[] = [
    ...(isRealtime ? [`src/services/${repoName.toLowerCase()}-socket.ts`, "src/hooks/use-realtime.ts"] : []),
    ...(isAuth ? ["src/middleware/auth.ts", "src/lib/session.ts"] : []),
    ...(isDb ? [`src/db/migrations/${Date.now()}_feature.sql`, "src/models/index.ts"] : []),
    ...(isApi ? ["src/app/api/feature/route.ts", "src/services/feature-service.ts"] : []),
    ...(isUi ? ["src/components/feature/feature-panel.tsx", "src/features/feature/feature-page.tsx"] : []),
    "src/types/index.ts"
  ].slice(0, atlas.estimatedImpactFiles);

  const codexPrompt = `Implement ${echo.featureName.toLowerCase()} for ${repoName}.

Architecture constraints:
${atlas.serviceBoundaries.map((b) => `- ${b}`).join("\n")}

Requirements:
${echo.implementationBehaviors.map((b) => `- ${b}`).join("\n")}

Security requirements:
${cipher.securityFindings.map((f) => `- ${f.title}: ${f.detail}`).join("\n")}

Do not introduce client-side authorization logic. All permission checks must remain server-owned.
Write tests for: ${isRealtime ? "reconnect, optimistic state rollback, presence sync" : "error boundaries, edge cases, and integration paths"}.
Use existing patterns in ${repoName} — do not introduce new state management libraries.`;

  const payloadBytes = codexPrompt.length + affectedFiles.join("").length + 1200;

  const forge: ForgeOutput = {
    codexPrompt,
    claudeContext: `Repository: ${repositoryFullName ?? repoName}
Architecture: ${atlas.architecturePatterns.join(", ")}
Auth system: ${atlas.authSystem}
Risk profile: ${cipher.overallRisk} (score: ${cipher.riskScore})
Governance: ${aegis.governanceDecision}
V# recommendation: ${vhash.recommendation}

Implement with architecture-safe constraints. Preserve existing service boundaries.`,
    affectedFiles,
    dependencyChanges: [
      ...(isRealtime ? ["socket.io-client@^4.x (pin version)"] : []),
      ...(isAi ? ["@anthropic-ai/sdk@^0.x"] : []),
      ...(isDb ? ["prisma@latest (migration required)"] : [])
    ].slice(0, 3),
    executionSteps: aegis.migrationSteps,
    payloadSize: `${(payloadBytes / 1024).toFixed(1)} KB`,
    executionReadiness:
      aegis.governanceDecision === "proceed" ? "ready" : aegis.governanceDecision === "conditional" ? "pending-approval" : "blocked"
  };

  return { echo, atlas, cipher, sage, aegis, vhash, forge };
}
