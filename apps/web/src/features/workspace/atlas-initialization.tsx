"use client";

import { useEffect, useRef, useState } from "react";
import {
  BrainCircuit,
  CheckCircle2,
  GitBranch,
  Loader2,
  Network,
  Route,
  ScanLine,
  ShieldCheck
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import type { GitHubRepositorySummary } from "@/services/github/types";
import { cn } from "@/lib/utils";

interface InitStep {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  completionNote: string;
  durationMs: number;
}

const STEPS: InitStep[] = [
  { id: "graph", label: "Architecture graph scan", icon: Network, completionNote: "nodes mapped", durationMs: 640 },
  { id: "deps", label: "Dependency chain resolution", icon: Route, completionNote: "service edges resolved", durationMs: 580 },
  { id: "auth", label: "Auth system detection", icon: ShieldCheck, completionNote: "auth boundaries identified", durationMs: 520 },
  { id: "boundaries", label: "Service boundary analysis", icon: GitBranch, completionNote: "boundaries mapped", durationMs: 500 },
  { id: "security", label: "Security surface scan", icon: ScanLine, completionNote: "surface area indexed", durationMs: 560 },
  { id: "ready", label: "Intelligence ready", icon: BrainCircuit, completionNote: "workspace activated", durationMs: 440 }
];

// Plausible mock counts per step (0 = don't show a count, just show the label)
const STEP_COUNTS = [148, 34, 6, 12, 89, 0];

export function AtlasInitialization({
  repository,
  onComplete
}: {
  repository: GitHubRepositorySummary;
  onComplete: () => void;
}) {
  const [completedCount, setCompletedCount] = useState(0);
  const [allDone, setAllDone] = useState(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  useEffect(() => {
    let step = 0;
    let timer: ReturnType<typeof setTimeout>;

    function advance() {
      if (step >= STEPS.length) {
        setAllDone(true);
        timer = setTimeout(() => onCompleteRef.current(), 1000);
        return;
      }
      timer = setTimeout(() => {
        step += 1;
        setCompletedCount(step);
        advance();
      }, STEPS[step].durationMs);
    }

    advance();
    return () => clearTimeout(timer);
  }, []);

  const progress = Math.round((completedCount / STEPS.length) * 100);
  const [owner, repoName] = repository.fullName.split("/");

  return (
    <div className="flex min-h-[68vh] items-center justify-center">
      <div className="w-full max-w-[600px]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="overflow-hidden rounded-[32px] border border-sky-300/15 bg-black/60 p-10 shadow-[0_0_80px_rgba(125,211,252,.06)] backdrop-blur-2xl"
        >
          {/* Header */}
          <div className="mb-8 flex items-center gap-4">
            <motion.span
              animate={{ boxShadow: allDone ? "0 0 40px rgba(110,231,183,.35)" : "0 0 30px rgba(125,211,252,.18)" }}
              transition={{ duration: 0.6 }}
              className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-sky-300/25 bg-sky-700/20"
            >
              <Network className={cn("h-6 w-6 transition-colors duration-500", allDone ? "text-emerald-200" : "text-sky-200")} />
            </motion.span>
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-sky-300/60">Atlas · Architecture Intelligence</p>
              <h2 className="mt-1 text-xl font-semibold text-white">
                {allDone ? "Intelligence ready" : "Initializing workspace"}
              </h2>
              <p className="mt-0.5 text-sm text-zinc-500">
                <span className="text-zinc-600">{owner}/</span>
                <span className="text-zinc-300">{repoName}</span>
              </p>
            </div>
          </div>

          {/* Step rows */}
          <div className="space-y-2.5">
            {STEPS.map((step, index) => {
              const isComplete = index < completedCount;
              const isActive = index === completedCount;
              const isQueued = index > completedCount;
              const Icon = step.icon;
              const count = STEP_COUNTS[index];

              return (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: isQueued ? 0.3 : 1, x: 0 }}
                  transition={{ delay: index * 0.04, duration: 0.4 }}
                  className={cn(
                    "flex items-center gap-4 rounded-2xl border px-4 py-3 transition-all duration-500",
                    isComplete
                      ? "border-emerald-200/20 bg-forest-700/10"
                      : isActive
                        ? "border-white/12 bg-white/[0.03]"
                        : "border-transparent bg-transparent"
                  )}
                >
                  <span
                    className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-xl border transition-all duration-400",
                      isComplete
                        ? "border-emerald-300/30 bg-forest-700/30"
                        : isActive
                          ? "border-white/12 bg-white/[0.04]"
                          : "border-white/[0.05] bg-transparent"
                    )}
                  >
                    {isComplete ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                    ) : isActive ? (
                      <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                    ) : (
                      <Icon className="h-4 w-4 text-zinc-700" />
                    )}
                  </span>

                  <p
                    className={cn(
                      "flex-1 text-sm transition-colors",
                      isComplete ? "text-white" : isActive ? "text-zinc-200" : "text-zinc-600"
                    )}
                  >
                    {step.label}
                  </p>

                  <AnimatePresence mode="wait">
                    {isComplete && (
                      <motion.p
                        key="done"
                        initial={{ opacity: 0, y: 3 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-[11px] text-emerald-400/70"
                      >
                        {count > 0 ? `${count} ${step.completionNote}` : step.completionNote}
                      </motion.p>
                    )}
                    {isActive && (
                      <motion.p
                        key="active"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-[11px] text-zinc-600"
                      >
                        scanning…
                      </motion.p>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>

          {/* Progress bar */}
          <div className="mt-8">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-zinc-600">Initialization progress</span>
              <span className="text-xs text-zinc-600">{progress}%</span>
            </div>
            <div className="h-[3px] overflow-hidden rounded-full bg-white/[0.05]">
              <motion.div
                className={cn(
                  "h-full rounded-full transition-colors duration-700",
                  allDone
                    ? "bg-gradient-to-r from-emerald-500 to-emerald-300"
                    : "bg-gradient-to-r from-sky-600 to-sky-300"
                )}
                initial={{ width: "0%" }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.45, ease: "easeOut" }}
              />
            </div>
          </div>

          {/* Completion message */}
          <AnimatePresence>
            {allDone && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 flex items-center justify-center gap-2 text-sm text-emerald-300"
              >
                <CheckCircle2 className="h-4 w-4" />
                Architecture intelligence online
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
