export { agentConfigs } from "./agents";
export { runMockPipeline } from "./mock-pipeline";
export type {
  AegisOutput,
  AgentId,
  AgentOutputs,
  AgentState,
  AgentStatus,
  AtlasOutput,
  CipherOutput,
  EchoOutput,
  ForgeOutput,
  PipelineInput,
  PipelineResult,
  SageOutput,
  VHashOutput
} from "./schemas";

export const implementationRoadmap = [
  {
    title: "Extract feature intent",
    detail: "Convert tutorial actions into requirements, dependencies, and user-facing behavior."
  },
  {
    title: "Map repository impact",
    detail: "Locate affected services, UI boundaries, auth paths, and data contracts."
  },
  {
    title: "Generate safe execution context",
    detail: "Produce Codex-ready prompts with constraints, tests, and rollback guidance."
  }
];
