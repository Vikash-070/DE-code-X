"use client";

import type { AgentOutputs } from "@decode-x/ai-orchestrator";
import { agentConfigs } from "@decode-x/ai-orchestrator";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Code2,
  FileCode2,
  Github,
  Loader2,
  Network,
  Send,
  ShieldCheck,
  Terminal,
  Workflow
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { PageHeading } from "@/components/dashboard/page-heading";
import { Panel } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";
import { useActiveRepository } from "@/contexts/repository-context";
import { cn } from "@/lib/utils";

type Phase = "input" | "analyzing" | "complete";

interface AnalysisResult {
  sessionId: string;
  outputs: AgentOutputs;
}

const agentIcons = {
  echo: BrainCircuit,
  atlas: Network,
  cipher: ShieldCheck,
  sage: FileCode2,
  aegis: Workflow,
  vhash: Terminal,
  forge: Code2
};

const agentColors = {
  echo: "text-emerald-300",
  atlas: "text-sky-300",
  cipher: "text-amber-300",
  sage: "text-violet-300",
  aegis: "text-rose-300",
  vhash: "text-emerald-200",
  forge: "text-emerald-400"
};

function AgentStageRow({
  config,
  index,
  activeIndex,
  isComplete,
  output,
  expanded,
  onToggle
}: {
  config: (typeof agentConfigs)[number];
  index: number;
  activeIndex: number;
  isComplete: boolean;
  output?: AgentOutputs[keyof AgentOutputs];
  expanded: boolean;
  onToggle: () => void;
}) {
  const Icon = agentIcons[config.id];
  const colorClass = agentColors[config.id];
  const isActive = index === activeIndex;
  const isDone = index < activeIndex || isComplete;
  const isIdle = !isActive && !isDone;

  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06 }}
      className={cn(
        "rounded-3xl border transition-all duration-500",
        isDone ? "border-emerald-200/25 bg-forest-700/10" : isActive ? "border-white/20 bg-white/[0.04]" : "border-white/8 bg-white/[0.02]"
      )}
    >
      <button
        onClick={isDone ? onToggle : undefined}
        className={cn("flex w-full items-center gap-5 p-5", isDone && "cursor-pointer")}
        disabled={!isDone}
      >
        <span
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-2xl border transition-all",
            isDone
              ? "border-emerald-300/30 bg-forest-700/30"
              : isActive
                ? "border-white/20 bg-white/[0.06]"
                : "border-white/8 bg-transparent"
          )}
        >
          <Icon className={cn("h-4 w-4", isDone ? colorClass : isActive ? "text-zinc-300" : "text-zinc-600")} />
        </span>
        <div className="flex-1 text-left">
          <p className={cn("text-sm font-semibold", isDone ? "text-white" : isActive ? "text-white" : "text-zinc-600")}>
            {config.name}
            <span className={cn("ml-2 text-xs font-normal tracking-wide", isDone ? "text-zinc-400" : "text-zinc-600")}>
              {config.codename}
            </span>
          </p>
          <p className={cn("mt-0.5 text-xs", isDone ? "text-zinc-400" : isActive ? "text-zinc-500" : "text-zinc-700")}>
            {isDone ? config.role : isActive ? `Processing ${config.codename.toLowerCase()}...` : "Queued"}
          </p>
        </div>
        <div className="shrink-0">
          {isDone ? (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-300" />
              {output !== undefined && (expanded ? <ChevronUp className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />)}
            </div>
          ) : isActive ? (
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          ) : (
            <Circle className="h-5 w-5 text-zinc-700" />
          )}
        </div>
      </button>

      <AnimatePresence>
        {isDone && output !== undefined && expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/8 px-5 pb-5 pt-4">
              <AgentOutputView agentId={config.id} output={output} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function AgentOutputView({ agentId, output }: { agentId: string; output: AgentOutputs[keyof AgentOutputs] }) {
  if (agentId === "echo") {
    const o = output as AgentOutputs["echo"];
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-emerald-300/70">Feature</p>
          <p className="text-sm font-semibold text-white">{o.featureName}</p>
          <p className="text-xs leading-5 text-zinc-400">{o.featureIntent}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-emerald-300/70">Technologies</p>
          <div className="flex flex-wrap gap-2">
            {o.technologiesDetected.map((t) => (
              <span key={t} className="rounded-full border border-emerald-200/20 bg-forest-700/20 px-2 py-0.5 text-xs text-emerald-100">
                {t}
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-emerald-300/70">Architecture concepts</p>
          <ul className="space-y-1">
            {o.architectureConcepts.map((c) => (
              <li key={c} className="text-xs text-zinc-400">· {c}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-emerald-300/70">Complexity</p>
          <span className={cn("rounded-full px-3 py-1 text-xs font-medium",
            o.complexitySignal === "high" ? "bg-red-500/15 text-red-300" :
            o.complexitySignal === "medium" ? "bg-amber-500/15 text-amber-300" :
            "bg-emerald-500/15 text-emerald-300"
          )}>
            {o.complexitySignal}
          </span>
        </div>
      </div>
    );
  }

  if (agentId === "atlas") {
    const o = output as AgentOutputs["atlas"];
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-sky-300/70">Repository</p>
          <p className="text-sm font-semibold text-white">{o.repositoryName}</p>
          <p className="mt-1 text-xs text-zinc-400">{o.primaryLanguage} · {o.apiPattern}</p>
        </div>
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-sky-300/70">Impact</p>
          <p className="text-2xl font-semibold text-white">{o.estimatedImpactFiles}</p>
          <p className="text-xs text-zinc-500">files affected</p>
        </div>
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-sky-300/70">Service boundaries</p>
          <ul className="space-y-1">
            {o.serviceBoundaries.map((b) => <li key={b} className="text-xs text-zinc-400">· {b}</li>)}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-sky-300/70">Conflicts</p>
          {o.dependencyConflicts.length === 0 ? (
            <p className="text-xs text-emerald-300">No conflicts detected</p>
          ) : (
            <ul className="space-y-1">
              {o.dependencyConflicts.map((c) => <li key={c} className="text-xs text-amber-300">· {c}</li>)}
            </ul>
          )}
        </div>
      </div>
    );
  }

  if (agentId === "cipher") {
    const o = output as AgentOutputs["cipher"];
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-amber-300/70">Risk score</p>
            <p className="text-3xl font-semibold text-white">{o.riskScore}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-amber-300/70">Attack surface</p>
            <p className="text-sm font-medium capitalize text-white">{o.attackSurface}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-amber-300/70">Auth drift</p>
            <p className={cn("text-sm font-medium", o.authDrift ? "text-amber-300" : "text-emerald-300")}>{o.authDrift ? "Detected" : "None"}</p>
          </div>
        </div>
        <div className="space-y-2">
          {o.securityFindings.map((f) => (
            <div key={f.title} className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className={cn("h-3.5 w-3.5", f.severity === "high" ? "text-red-400" : f.severity === "medium" ? "text-amber-400" : "text-emerald-400")} />
                <p className="text-xs font-medium text-white">{f.title}</p>
              </div>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{f.detail}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (agentId === "sage") {
    const o = output as AgentOutputs["sage"];
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-violet-300/70">Validation</p>
          <span className={cn("rounded-full px-3 py-1 text-xs font-medium",
            o.validationStatus === "approved" ? "bg-emerald-500/15 text-emerald-300" :
            o.validationStatus === "concerns" ? "bg-amber-500/15 text-amber-300" :
            "bg-red-500/15 text-red-300"
          )}>
            {o.validationStatus}
          </span>
          <p className="mt-3 text-xs leading-5 text-zinc-400">{o.recommendedApproach}</p>
        </div>
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-violet-300/70">Anti-patterns</p>
          {o.antiPatternsDetected.length === 0 ? (
            <p className="text-xs text-emerald-300">None detected</p>
          ) : (
            <ul className="space-y-1">
              {o.antiPatternsDetected.map((p) => <li key={p} className="text-xs text-amber-300">· {p}</li>)}
            </ul>
          )}
        </div>
        <div className="sm:col-span-2">
          <p className="mb-2 text-xs uppercase tracking-wider text-violet-300/70">Industry precedents</p>
          <p className="text-xs text-zinc-400">{o.industryPrecedents.join(" · ")}</p>
        </div>
      </div>
    );
  }

  if (agentId === "aegis") {
    const o = output as AgentOutputs["aegis"];
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-rose-300/70">Decision</p>
          <span className={cn("rounded-full px-3 py-1 text-xs font-semibold",
            o.governanceDecision === "proceed" ? "bg-emerald-500/15 text-emerald-300" :
            o.governanceDecision === "conditional" ? "bg-amber-500/15 text-amber-300" :
            "bg-red-500/15 text-red-300"
          )}>
            {o.governanceDecision}
          </span>
          <p className="mt-3 text-xs leading-5 text-zinc-400">{o.impactPrediction}</p>
        </div>
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-rose-300/70">Architecture fit</p>
          <p className="text-3xl font-semibold text-white">{o.architectureFit}<span className="text-base text-zinc-500">/100</span></p>
          <p className="mt-2 text-xs text-zinc-400">{o.rolloutStrategy}</p>
        </div>
        <div className="sm:col-span-2">
          <p className="mb-2 text-xs uppercase tracking-wider text-rose-300/70">Migration steps</p>
          <ol className="space-y-1">
            {o.migrationSteps.map((step, i) => (
              <li key={step} className="text-xs text-zinc-400"><span className="mr-2 text-zinc-600">0{i + 1}.</span>{step}</li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  if (agentId === "vhash") {
    const o = output as AgentOutputs["vhash"];
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-6">
          <div>
            <p className="text-xs uppercase tracking-wider text-emerald-300/70">Recommendation</p>
            <p className="mt-1 text-lg font-semibold capitalize text-white">{o.recommendation.replace(/-/g, " ")}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-emerald-300/70">Confidence</p>
            <p className="mt-1 text-lg font-semibold text-white">{o.confidenceScore}%</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-emerald-300/70">Priority</p>
            <p className="mt-1 text-lg font-semibold capitalize text-white">{o.implementationPriority}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-200/15 bg-forest-700/15 p-4">
          <p className="text-sm leading-6 text-zinc-200">{o.executiveSummary}</p>
        </div>
        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-emerald-300/70">Key tradeoffs</p>
          <ul className="space-y-1">
            {o.keyTradeoffs.map((t) => <li key={t} className="text-xs text-zinc-400">· {t}</li>)}
          </ul>
        </div>
        <p className="text-xs text-zinc-500">Complexity: {o.estimatedComplexity}</p>
      </div>
    );
  }

  if (agentId === "forge") {
    const o = output as AgentOutputs["forge"];
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-emerald-400/70">Readiness</p>
            <span className={cn("mt-1 block rounded-full px-3 py-1 text-xs font-medium",
              o.executionReadiness === "ready" ? "bg-emerald-500/15 text-emerald-300" :
              o.executionReadiness === "pending-approval" ? "bg-amber-500/15 text-amber-300" :
              "bg-red-500/15 text-red-300"
            )}>
              {o.executionReadiness}
            </span>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-emerald-400/70">Payload</p>
            <p className="mt-1 text-sm font-medium text-white">{o.payloadSize}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-emerald-400/70">Files</p>
            <p className="mt-1 text-sm font-medium text-white">{o.affectedFiles.length}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-200/15 bg-forest-950/60 p-4 font-mono text-xs leading-6 text-emerald-50">
          {o.codexPrompt}
        </div>
        {o.dependencyChanges.length > 0 && (
          <div>
            <p className="mb-2 text-xs uppercase tracking-wider text-emerald-400/70">Dependencies</p>
            <ul className="space-y-1">
              {o.dependencyChanges.map((d) => <li key={d} className="font-mono text-xs text-zinc-400">{d}</li>)}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return null;
}

function VHashRecommendation({ output }: { output: AgentOutputs["vhash"] }) {
  return (
    <Panel>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-2xl border border-emerald-300/30 bg-forest-700/30">
          <Terminal className="h-5 w-5 text-emerald-200" />
        </span>
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-emerald-300/70">V# Strategic Recommendation</p>
          <p className="text-lg font-semibold capitalize text-white">{output.recommendation.replace(/-/g, " ")}</p>
        </div>
        <span className="ml-auto text-2xl font-semibold text-white">{output.confidenceScore}%</span>
      </div>
      <div className="mt-5 rounded-2xl border border-emerald-200/15 bg-forest-700/15 p-5">
        <p className="text-sm leading-7 text-zinc-200">{output.executiveSummary}</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          ["Priority", output.implementationPriority],
          ["Complexity", output.estimatedComplexity],
          ["Tradeoffs", `${output.keyTradeoffs.length} identified`]
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/8 bg-white/[0.025] p-4">
            <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
            <p className="mt-2 text-sm font-semibold capitalize text-white">{value}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function TutorialAnalysisPage() {
  const { activeRepository, repositories } = useActiveRepository();
  const [rawInput, setRawInput] = useState(
    "https://youtube.com/watch?v=realtime-collab\n\nBuild realtime collaboration with socket-powered live editing, user presence, optimistic updates, and conflict resolution."
  );
  const [selectedRepo, setSelectedRepo] = useState(activeRepository?.fullName ?? "");
  const [phase, setPhase] = useState<Phase>("input");
  const [activeAgentIndex, setActiveAgentIndex] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set(["vhash", "forge"]));

  useEffect(() => {
    setSelectedRepo(activeRepository?.fullName ?? "");
  }, [activeRepository]);

  function toggleExpanded(agentId: string) {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }

  async function runAnalysis() {
    if (!rawInput.trim() || rawInput.trim().length < 10) return;
    setPhase("analyzing");
    setError(null);
    setResult(null);
    setActiveAgentIndex(0);

    const selectedRepoData = repositories.find((r) => r.fullName === selectedRepo);

    const advanceInterval = setInterval(() => {
      setActiveAgentIndex((prev) => {
        if (prev < agentConfigs.length - 1) return prev + 1;
        clearInterval(advanceInterval);
        return prev;
      });
    }, 320);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawInput: rawInput.trim(),
          sourceUrl: rawInput.includes("http") ? rawInput.split("\n")[0]?.trim() : undefined,
          repositoryFullName: selectedRepo || undefined,
          repositoryLanguage: selectedRepoData?.language ?? undefined
        })
      });

      clearInterval(advanceInterval);

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Analysis failed");
      }

      const data = (await response.json()) as { sessionId: string; outputs: AgentOutputs };
      setActiveAgentIndex(agentConfigs.length);
      setResult({ sessionId: data.sessionId, outputs: data.outputs });
      setPhase("complete");
    } catch (err) {
      clearInterval(advanceInterval);
      setError(err instanceof Error ? err.message : "Analysis failed");
      setPhase("input");
    }
  }

  function reset() {
    setPhase("input");
    setResult(null);
    setError(null);
    setActiveAgentIndex(0);
  }

  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="Tutorial analysis"
        title="Paste any implementation source for multi-agent analysis."
        description="Echo → Atlas → Cipher → Sage → Aegis → V# → Forge. Seven agents reason about your codebase before a single line is written."
        action={
          phase === "complete" ? (
            <Button variant="ghost" onClick={reset}>New Analysis</Button>
          ) : (
            <Button
              variant="forest"
              onClick={runAnalysis}
              disabled={phase === "analyzing" || rawInput.trim().length < 10}
            >
              {phase === "analyzing" ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Analyzing</>
              ) : (
                <><Send className="h-4 w-4" /> Run Analysis</>
              )}
            </Button>
          )
        }
      />

      {error ? (
        <div className="rounded-3xl border border-red-300/20 bg-red-500/10 p-5 text-sm text-red-100">{error}</div>
      ) : null}

      <AnimatePresence mode="wait">
        {phase === "input" && (
          <motion.div key="input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Panel>
              <div className="grid gap-6 lg:grid-cols-[1fr_0.85fr]">
                <div>
                  <label className="text-sm text-zinc-500">Implementation source</label>
                  <p className="mt-1 text-xs text-zinc-600">Paste a URL, tutorial transcript, documentation, or AI-generated example.</p>
                  <textarea
                    value={rawInput}
                    onChange={(e) => setRawInput(e.target.value)}
                    className="mt-3 min-h-[260px] w-full resize-none rounded-3xl border border-white/10 bg-black/45 p-5 font-mono text-sm leading-7 text-zinc-200 outline-none transition focus:border-emerald-200/40 focus:shadow-glow"
                    placeholder="Paste your implementation source here..."
                  />
                </div>
                <div className="space-y-5">
                  <div>
                    <label className="text-sm text-zinc-500">Target repository</label>
                    <p className="mt-1 text-xs text-zinc-600">Switch active repository from the header to change context.</p>
                    <div className="mt-3 space-y-2">
                      <button
                        onClick={() => setSelectedRepo("")}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition",
                          !selectedRepo
                            ? "border-emerald-200/30 bg-forest-700/20 text-white"
                            : "border-white/8 bg-white/[0.02] text-zinc-500 hover:border-white/15 hover:text-zinc-300"
                        )}
                      >
                        <Network className="h-4 w-4 text-emerald-300" />
                        No specific repository
                      </button>
                      {activeRepository && (
                        <button
                          onClick={() => setSelectedRepo(activeRepository.fullName)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition",
                            selectedRepo === activeRepository.fullName
                              ? "border-emerald-200/30 bg-forest-700/20 text-white"
                              : "border-white/8 bg-white/[0.02] text-zinc-500 hover:border-white/15 hover:text-zinc-300"
                          )}
                        >
                          <Github className="h-4 w-4 shrink-0 text-zinc-400" />
                          <span className="truncate">{activeRepository.name}</span>
                          {activeRepository.language ? (
                            <span className="ml-auto text-xs text-zinc-600">{activeRepository.language}</span>
                          ) : null}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="rounded-3xl border border-emerald-200/15 bg-forest-700/10 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-emerald-300/60">Agent pipeline</p>
                    <div className="mt-3 space-y-1.5">
                      {agentConfigs.map((agent) => {
                        const Icon = agentIcons[agent.id];
                        return (
                          <div key={agent.id} className="flex items-center gap-2 text-xs text-zinc-500">
                            <Icon className={cn("h-3 w-3", agentColors[agent.id])} />
                            <span className="font-medium text-zinc-400">{agent.name}</span>
                            <span className="text-zinc-700">·</span>
                            <span>{agent.codename}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </Panel>
          </motion.div>
        )}

        {(phase === "analyzing" || phase === "complete") && result === null && (
          <motion.div key="pipeline" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Panel title="Agent Pipeline Executing">
              <div className="space-y-3">
                {agentConfigs.map((config, index) => (
                  <AgentStageRow
                    key={config.id}
                    config={config}
                    index={index}
                    activeIndex={activeAgentIndex}
                    isComplete={false}
                    expanded={false}
                    onToggle={() => undefined}
                  />
                ))}
              </div>
            </Panel>
          </motion.div>
        )}

        {phase === "complete" && result !== null && (
          <motion.div key="complete" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <VHashRecommendation output={result.outputs.vhash} />

            <Panel title="Agent Intelligence Pipeline">
              <div className="space-y-3">
                {agentConfigs.map((config, index) => (
                  <AgentStageRow
                    key={config.id}
                    config={config}
                    index={index}
                    activeIndex={agentConfigs.length}
                    isComplete
                    output={result.outputs[config.id as keyof AgentOutputs]}
                    expanded={expandedAgents.has(config.id)}
                    onToggle={() => toggleExpanded(config.id)}
                  />
                ))}
              </div>
            </Panel>

            <div className="flex items-center justify-between rounded-3xl border border-emerald-200/15 bg-forest-700/10 px-6 py-5">
              <div className="flex items-center gap-3 text-sm text-zinc-300">
                <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                Analysis complete · Session {result.sessionId.slice(-8)}
              </div>
              <div className="flex gap-3">
                <Button variant="ghost" onClick={reset}>New Analysis</Button>
                <Button variant="forest" asChild>
                  <a href="/dashboard/implementation-plan">Generate Plan</a>
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
