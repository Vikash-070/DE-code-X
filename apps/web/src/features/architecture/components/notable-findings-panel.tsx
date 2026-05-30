"use client";

/**
 * Notable Findings panel — Stage 3b.
 *
 * Repo-level AI synthesis (dead code, gated features, perf risk, …). Self-
 * contained: an explicit, clearly-priced button triggers one paid call
 * (confirm-before-spend); results render as severity-coded cards.
 */

import { useState } from "react";
import { Sparkles, Loader2, AlertTriangle, Info, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { useActiveRepository } from "@/contexts/repository-context";
import type { NotableFinding, FindingSeverity } from "@/server/repo/findings";

const SEVERITY_META: Record<FindingSeverity, { label: string; icon: React.ReactNode; cls: string; dot: string }> = {
  risk: { label: "Risk", icon: <ShieldAlert className="h-3 w-3" />, cls: "border-rose-500/25 bg-rose-500/[0.05]", dot: "text-rose-400" },
  warn: { label: "Watch", icon: <AlertTriangle className="h-3 w-3" />, cls: "border-amber-500/25 bg-amber-500/[0.04]", dot: "text-amber-400" },
  info: { label: "Note", icon: <Info className="h-3 w-3" />, cls: "border-sky-500/20 bg-sky-500/[0.04]", dot: "text-sky-400" },
};

interface State {
  status: "idle" | "loading" | "ready" | "error";
  findings: NotableFinding[];
  error: string | null;
  fromCache: boolean;
}
const IDLE: State = { status: "idle", findings: [], error: null, fromCache: false };

export function NotableFindingsPanel() {
  const { activeRepository } = useActiveRepository();
  const [state, setState] = useState<State>(IDLE);

  async function run() {
    if (!activeRepository) return;
    const [owner, repo] = activeRepository.fullName.split("/");
    if (!owner || !repo) return;
    setState({ ...IDLE, status: "loading" });
    try {
      const res = await fetch("/api/repo/architecture/findings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo, branch: activeRepository.defaultBranch ?? "main" }),
      });
      const json = (await res.json()) as { findings?: NotableFinding[]; fromCache?: boolean; error?: string };
      if (!res.ok) {
        setState({ ...IDLE, status: "error", error: json.error ?? `Failed (${res.status})` });
        return;
      }
      setState({ status: "ready", findings: json.findings ?? [], error: null, fromCache: !!json.fromCache });
    } catch (err) {
      setState({ ...IDLE, status: "error", error: err instanceof Error ? err.message : "Failed" });
    }
  }

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-violet-400" />
          <span className="text-xs font-medium text-zinc-400">Notable Findings</span>
        </div>
        {state.status === "ready" && (
          <span className="text-[9px] text-zinc-700">
            {state.findings.length} found{state.fromCache ? " · cached" : ""} · AI-generated
          </span>
        )}
      </div>

      {state.status === "idle" && (
        <div className="mt-3 space-y-1.5">
          <button
            type="button"
            onClick={run}
            disabled={!activeRepository}
            className="flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/[0.08] px-2.5 py-1 text-[10px] text-violet-300 transition-colors hover:border-violet-500/50 hover:text-violet-200 disabled:opacity-40"
          >
            <Sparkles className="h-3 w-3" /> Find notable issues
          </button>
          <p className="text-[9px] text-zinc-700">Scans ~20 high-signal files · 1 paid OpenRouter call · cached after.</p>
        </div>
      )}

      {state.status === "loading" && (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading files &amp; synthesizing…
        </div>
      )}

      {state.status === "error" && (
        <div className="mt-3 space-y-1">
          <p className="text-[11px] text-rose-400/70">{state.error}</p>
          <button type="button" onClick={run} className="text-[10px] text-zinc-500 underline hover:text-zinc-300">Try again</button>
        </div>
      )}

      {state.status === "ready" && (
        state.findings.length === 0 ? (
          <p className="mt-3 text-[11px] text-zinc-600">No notable findings surfaced from the scanned files.</p>
        ) : (
          <div className="mt-3 space-y-2.5">
            {state.findings.map((f, i) => {
              const m = SEVERITY_META[f.severity];
              return (
                <div key={i} className={cn("rounded-xl border p-3", m.cls)}>
                  <div className="flex items-center gap-1.5">
                    <span className={m.dot}>{m.icon}</span>
                    <span className="text-[11px] font-semibold text-zinc-200">{f.title}</span>
                    <span className="ml-auto text-[8px] uppercase tracking-wide text-zinc-600">{m.label}</span>
                  </div>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-400">{f.detail}</p>
                  {f.evidence.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {f.evidence.map((e) => (
                        <code key={e} className="rounded border border-white/[0.06] bg-black/30 px-1 py-0.5 font-mono text-[8px] text-zinc-500">
                          {e}
                        </code>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <p className="text-[8px] text-zinc-700">AI-generated from a bounded scan · verify against the source before acting.</p>
          </div>
        )
      )}
    </div>
  );
}
