"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Brain, Code2, EyeOff, GitBranch, Loader2, Scan } from "lucide-react";

import { cn } from "@/lib/utils";
import type { GitHubRepositorySummary } from "@/services/github/types";

// ─── Cipher state types ───────────────────────────────────
// Exported so workspace-session.tsx can import and manage them.

export type CipherAgentStatus = "idle" | "fetching" | "analyzing" | "done" | "error";

export interface CipherAgentState {
  status:        CipherAgentStatus;
  file:          string | null;
  findingsCount: number;
  error:         string | null;
}

export const CIPHER_IDLE: CipherAgentState = {
  status:        "idle",
  file:          null,
  findingsCount: 0,
  error:         null,
};

// ─── Helpers ─────────────────────────────────────────────

function fileName(filePath: string | null): string {
  if (!filePath) return "";
  return filePath.split("/").pop() ?? filePath;
}

// ─── V# agent card ────────────────────────────────────────

function VHashCard({ isOrchestrating }: { isOrchestrating: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-3.5 transition-colors duration-300",
        isOrchestrating
          ? "border-emerald-500/10 bg-emerald-500/[0.04]"
          : "border-white/[0.05] bg-white/[0.015]"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div
          className={cn(
            "relative mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-xl border transition-all duration-300",
            isOrchestrating
              ? "border-emerald-500/25 bg-emerald-500/10"
              : "border-white/[0.06] bg-white/[0.02]"
          )}
        >
          <Brain
            className={cn(
              "h-3 w-3 transition-colors duration-300",
              isOrchestrating ? "text-emerald-400" : "text-zinc-700"
            )}
          />
          {isOrchestrating && (
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-1 ring-black">
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-70" />
            </span>
          )}
        </div>

        {/* Name + status */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-zinc-300">V#</span>
            <span className="text-[9px] text-zinc-700">Orchestrator</span>
          </div>

          <AnimatePresence mode="wait">
            {isOrchestrating ? (
              <motion.p
                key="working"
                initial={{ opacity: 0, y: 2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.15 }}
                className="mt-0.5 flex items-center gap-1 text-[10px] text-emerald-400/80"
              >
                <span>Working</span>
                <motion.span
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ repeat: Infinity, duration: 1.2 }}
                >
                  …
                </motion.span>
              </motion.p>
            ) : (
              <motion.p
                key="idle"
                initial={{ opacity: 0, y: 2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.15 }}
                className="mt-0.5 text-[10px] text-zinc-700"
              >
                Standing by
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ─── Cipher agent card ────────────────────────────────────

function CipherCard({ state }: { state: CipherAgentState }) {
  const isActive  = state.status !== "idle";
  const isWorking = state.status === "fetching" || state.status === "analyzing";
  const isDone    = state.status === "done";
  const isError   = state.status === "error";

  function statusLabel(): string {
    switch (state.status) {
      case "idle":      return "Waiting for files";
      case "fetching":  return `Reading ${fileName(state.file)}`;
      case "analyzing": return `Analyzing ${fileName(state.file)}`;
      case "done":
        return state.findingsCount === 0
          ? "No findings"
          : `${state.findingsCount} finding${state.findingsCount !== 1 ? "s" : ""} found`;
      case "error":     return state.error ?? "Analysis failed";
    }
  }

  // "Not in this repo" and "No AI key configured" are soft states — muted, not red
  const isSoftError = isError && (
    state.error === "Not in this repo" ||
    state.error === "No AI key configured"
  );

  function statusColor(): string {
    if (isWorking)    return "text-purple-400/80";
    if (isDone)       return state.findingsCount > 0 ? "text-amber-400/80" : "text-emerald-400/70";
    if (isSoftError)  return "text-zinc-600";
    if (isError)      return "text-red-400/60";
    return "text-zinc-700";
  }

  return (
    <div
      className={cn(
        "rounded-2xl border p-3.5 transition-colors duration-500",
        isWorking
          ? "border-purple-500/10 bg-purple-500/[0.04]"
          : isDone
            ? "border-blue-500/10 bg-blue-500/[0.02]"
            : "border-white/[0.05] bg-white/[0.015]"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div
          className={cn(
            "relative mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-xl border transition-all duration-300",
            isWorking
              ? "border-purple-500/25 bg-purple-500/10"
              : isActive
                ? "border-blue-500/20 bg-blue-500/[0.08]"
                : "border-white/[0.06] bg-white/[0.02]"
          )}
        >
          {isWorking ? (
            <Scan className="h-3 w-3 animate-pulse text-purple-400" />
          ) : (
            <Code2
              className={cn(
                "h-3 w-3 transition-colors duration-300",
                isDone        ? "text-blue-400"    :
                isSoftError   ? "text-zinc-600"    :
                isError       ? "text-red-400/60"  :
                                "text-zinc-700"
              )}
            />
          )}
          {isWorking && (
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-purple-400 ring-1 ring-black">
              <span className="absolute inset-0 animate-ping rounded-full bg-purple-400 opacity-70" />
            </span>
          )}
        </div>

        {/* Name + status */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-zinc-300">Cipher</span>
            <span className="text-[9px] text-zinc-700">Code Intel</span>
          </div>

          <AnimatePresence mode="wait">
            <motion.p
              key={state.status + (state.file ?? "")}
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -2 }}
              transition={{ duration: 0.15 }}
              className={cn("mt-0.5 truncate text-[10px]", statusColor())}
            >
              {statusLabel()}
              {isWorking && (
                <motion.span
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ repeat: Infinity, duration: 1.2 }}
                >
                  …
                </motion.span>
              )}
            </motion.p>
          </AnimatePresence>
        </div>

        {isWorking && (
          <Loader2 className="mt-0.5 h-2.5 w-2.5 shrink-0 animate-spin text-purple-400/40" />
        )}
      </div>

      {/* Active file pill */}
      <AnimatePresence>
        {state.file && isActive && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-2.5 truncate rounded-lg border border-white/[0.04] bg-white/[0.02] px-2 py-1 font-mono text-[9px] text-zinc-500"
          >
            {state.file}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Domain hint when idle */}
      {!isActive && (
        <p className="mt-2 text-[9px] leading-[14px] text-zinc-800">
          Activates on file paths in scope
        </p>
      )}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────

export function AgentTeamPanel({
  activeRepository,
  isOrchestrating,
  cipherState,
}: {
  activeRepository: GitHubRepositorySummary | null;
  isOrchestrating:  boolean;
  cipherState:      CipherAgentState;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[28px] border border-white/[0.06] bg-black/50 backdrop-blur-xl">

      {/* Header */}
      <div className="shrink-0 border-b border-white/[0.04] px-4 py-3">
        <p className="text-[9px] font-medium uppercase tracking-[0.22em] text-zinc-700">
          Agent Team
        </p>
      </div>

      {/* Agent cards */}
      <div
        className="flex-1 space-y-2 overflow-y-auto p-3"
        style={{ scrollbarWidth: "none" }}
      >
        <VHashCard isOrchestrating={isOrchestrating} />
        <CipherCard state={cipherState} />
      </div>

      {/* Footer */}
      <div className="shrink-0 space-y-1.5 border-t border-white/[0.04] p-3">
        {activeRepository && (
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.04] bg-white/[0.01] px-3 py-2">
            <GitBranch className="h-2.5 w-2.5 shrink-0 text-zinc-700" />
            <span className="min-w-0 truncate text-[10px]">
              <span className="text-zinc-700">
                {activeRepository.fullName.split("/")[0]}/
              </span>
              <span className="text-zinc-600">{activeRepository.name}</span>
            </span>
          </div>
        )}
        <div className="flex items-center gap-2 rounded-xl border border-white/[0.04] bg-white/[0.01] px-3 py-2">
          <EyeOff className="h-2.5 w-2.5 shrink-0 text-zinc-800" />
          <span className="text-[10px] text-zinc-800">Read-only · no edits</span>
        </div>
      </div>
    </div>
  );
}
