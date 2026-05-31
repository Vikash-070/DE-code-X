/**
 * DE-code X AI Orchestrator — server-side only.
 *
 * Runs the Echo → Atlas → Cipher → Sage → Aegis → V# → Forge pipeline
 * against a real AI provider. Falls back to the mock pipeline if no
 * provider key is available.
 *
 * SECURITY: apiKey arrives here already decrypted from the DB.
 * It never leaves the server. Never pass it to the client.
 */

import {
  type AgentOutputs,
  type PipelineInput,
  agentConfigs,
  runMockPipeline
} from "@decode-x/ai-orchestrator";

import { runAnthropicCompletion, type AnthropicModel } from "./providers/anthropic";
import { runOpenAICompletion, type OpenAIModel }       from "./providers/openai";
import { runOpenRouterCompletion, type OpenRouterModel } from "./providers/openrouter";
import { runGeminiCompletion, type GeminiModel }       from "./providers/gemini";

export type AIProvider = "anthropic" | "openai" | "openrouter" | "gemini";

export interface OrchestratorConfig {
  provider: AIProvider;
  apiKey: string;
  /** Optional model override per provider */
  model?: string;
}

// ─── JSON extraction helper ───────────────────────────────

function extractJSON(raw: string): unknown {
  // Strip markdown code fences if present
  const stripped = raw
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // Try to find the first {...} block
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Could not parse JSON from response:\n${stripped.slice(0, 300)}`);
  }
}

// ─── Single-agent call ────────────────────────────────────

async function callAgent(
  agentId: keyof AgentOutputs,
  userPrompt: string,
  config: OrchestratorConfig
): Promise<unknown> {
  const agentCfg = agentConfigs.find((a) => a.id === agentId);
  if (!agentCfg) throw new Error(`Unknown agent: ${agentId}`);

  const systemPrompt = agentCfg.systemPrompt + "\n\nReturn ONLY valid JSON. No commentary.";

  let raw: string;

  switch (config.provider) {
    case "anthropic":
      raw = await runAnthropicCompletion(config.apiKey, userPrompt, {
        system:      systemPrompt,
        model:       config.model as AnthropicModel | undefined,
        temperature: 0.1
      });
      break;
    case "openai":
      raw = await runOpenAICompletion(config.apiKey, userPrompt, {
        system:      systemPrompt,
        model:       config.model as OpenAIModel | undefined,
        temperature: 0.1
      });
      break;
    case "openrouter":
      raw = await runOpenRouterCompletion(config.apiKey, userPrompt, {
        system:      systemPrompt,
        model:       config.model as OpenRouterModel | undefined,
        temperature: 0.1
      });
      break;
    case "gemini":
      raw = await runGeminiCompletion(config.apiKey, userPrompt, {
        system:      systemPrompt,
        model:       config.model as GeminiModel | undefined,
        temperature: 0.1
      });
      break;
  }

  return extractJSON(raw);
}

// ─── Build prompts ────────────────────────────────────────

function buildEchoPrompt(input: PipelineInput): string {
  return `Analyze this implementation source and extract structured intelligence.

Repository: ${input.repositoryFullName ?? "unknown"}
Language: ${input.repositoryLanguage ?? "TypeScript"}
${input.sourceUrl ? `Source URL: ${input.sourceUrl}` : ""}

Implementation source:
"""
${input.rawInput}
"""`;
}

function buildContextualPrompt(
  input: PipelineInput,
  priorOutputs: Partial<AgentOutputs>
): string {
  return `${buildEchoPrompt(input)}

Prior analysis:
${JSON.stringify(priorOutputs, null, 2)}`;
}

// ─── Main orchestration entry point ──────────────────────

/**
 * Run the full agent pipeline.
 *
 * If config is null or undefined, falls back to the mock pipeline
 * (useful during development or when no provider is configured).
 */
export async function runPipeline(
  input: PipelineInput,
  config: OrchestratorConfig | null
): Promise<AgentOutputs> {
  if (!config) {
    return runMockPipeline(input);
  }

  try {
    const outputs: Partial<AgentOutputs> = {};

    // ── Echo: feature extraction ──────────────────────────
    outputs.echo = (await callAgent("echo", buildEchoPrompt(input), config)) as AgentOutputs["echo"];

    // ── Atlas: architecture mapping ───────────────────────
    outputs.atlas = (await callAgent(
      "atlas",
      buildContextualPrompt(input, { echo: outputs.echo }),
      config
    )) as AgentOutputs["atlas"];

    // ── Cipher: security evaluation ───────────────────────
    outputs.cipher = (await callAgent(
      "cipher",
      buildContextualPrompt(input, { echo: outputs.echo, atlas: outputs.atlas }),
      config
    )) as AgentOutputs["cipher"];

    // ── Sage: validation ──────────────────────────────────
    outputs.sage = (await callAgent(
      "sage",
      buildContextualPrompt(input, outputs),
      config
    )) as AgentOutputs["sage"];

    // ── Aegis: governance ─────────────────────────────────
    outputs.aegis = (await callAgent(
      "aegis",
      buildContextualPrompt(input, outputs),
      config
    )) as AgentOutputs["aegis"];

    // ── V#: synthesis ─────────────────────────────────────
    outputs.vhash = (await callAgent(
      "vhash",
      buildContextualPrompt(input, outputs),
      config
    )) as AgentOutputs["vhash"];

    // ── Forge: execution payload ──────────────────────────
    outputs.forge = (await callAgent(
      "forge",
      buildContextualPrompt(input, outputs),
      config
    )) as AgentOutputs["forge"];

    return outputs as AgentOutputs;
  } catch (err) {
    // On any AI error, fall back to the mock pipeline with a console warning
    console.warn("[orchestrator] Real pipeline failed, falling back to mock:", err instanceof Error ? err.message : err);
    return runMockPipeline(input);
  }
}

/**
 * Test whether a given provider config is functional.
 * Runs a minimal single-agent call. Returns true on success, throws on failure.
 */
export async function testProviderConfig(config: OrchestratorConfig): Promise<true> {
  await callAgent("echo", "Test: describe a simple login button.", config);
  return true;
}
