export type AgentId = "echo" | "atlas" | "cipher" | "sage" | "aegis" | "vhash" | "forge";

export type AgentStatus = "idle" | "running" | "complete" | "error";

export interface AgentState {
  id: AgentId;
  status: AgentStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface EchoOutput {
  featureName: string;
  featureIntent: string;
  uiPatterns: string[];
  architectureConcepts: string[];
  implementationBehaviors: string[];
  technologiesDetected: string[];
  complexitySignal: "low" | "medium" | "high";
}

export interface AtlasOutput {
  repositoryName: string;
  primaryLanguage: string;
  architecturePatterns: string[];
  authSystem: string;
  stateManagement: string;
  apiPattern: string;
  estimatedImpactFiles: number;
  serviceBoundaries: string[];
  dependencyConflicts: string[];
}

export interface CipherOutput {
  overallRisk: "low" | "medium" | "high";
  riskScore: number;
  securityFindings: Array<{ title: string; severity: "low" | "medium" | "high"; detail: string }>;
  scalabilityFindings: Array<{ title: string; impact: "low" | "medium" | "high"; detail: string }>;
  attackSurface: "none" | "minimal" | "moderate" | "expanded";
  authDrift: boolean;
}

export interface SageOutput {
  validationStatus: "approved" | "concerns" | "rejected";
  bestPracticesScore: number;
  antiPatternsDetected: string[];
  recommendedApproach: string;
  alternativePatterns: string[];
  industryPrecedents: string[];
}

export interface AegisOutput {
  governanceDecision: "proceed" | "conditional" | "hold";
  architectureFit: number;
  rolloutStrategy: string;
  migrationSteps: string[];
  impactPrediction: string;
  requiredApprovals: string[];
}

export interface VHashOutput {
  recommendation: "implement" | "implement-with-caution" | "defer" | "reject";
  confidenceScore: number;
  executiveSummary: string;
  keyTradeoffs: string[];
  implementationPriority: "critical" | "high" | "medium" | "low";
  estimatedComplexity: string;
}

export interface ForgeOutput {
  codexPrompt: string;
  claudeContext: string;
  affectedFiles: string[];
  dependencyChanges: string[];
  executionSteps: string[];
  payloadSize: string;
  executionReadiness: "ready" | "pending-approval" | "blocked";
}

export interface AgentOutputs {
  echo: EchoOutput;
  atlas: AtlasOutput;
  cipher: CipherOutput;
  sage: SageOutput;
  aegis: AegisOutput;
  vhash: VHashOutput;
  forge: ForgeOutput;
}

export interface PipelineInput {
  rawInput: string;
  sourceUrl?: string;
  repositoryFullName?: string;
  repositoryLanguage?: string;
}

export interface PipelineResult {
  sessionId: string;
  status: "complete" | "error";
  agents: AgentState[];
  outputs: AgentOutputs;
}
