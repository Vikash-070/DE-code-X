"use client";

/**
 * IntelligencePanel
 *
 * Right-hand panel in the Architecture Workspace two-column layout.
 * Shown when the user clicks a domain node in the architecture tree.
 *
 * Displays findings from all modules (Cipher, Sentinel, Pulse, Atlas)
 * for files within the selected domain.
 *
 * States:
 *   idle     — "Click a domain to see its intelligence" prompt
 *   loading  — skeleton while fetching
 *   empty    — domain has no stored intelligence yet; prompt to analyse
 *   success  — findings grouped by module, then by file
 *   error    — fetch failed
 *
 * Module tabs: All | Cipher | Sentinel | Pulse | Atlas
 *   Each tab shows a count badge. Clicking filters to that module.
 */

import { useState } from "react";
import {
  AlertTriangle, BookOpen, CheckCircle2,
  FileCode, Layers, Lock, MessageSquare, Minus,
  Shield, Zap
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { cn } from "@/lib/utils";
import type { AgentId, CipherFinding } from "@/types/intelligence";
import type { DomainIntelligenceState, DomainFileEntry } from "@/hooks/use-domain-intelligence";

// ─── Props ────────────────────────────────────────────────────

interface IntelligencePanelProps {
  state:        DomainIntelligenceState;
  /** Called when the user asks to analyse files in this domain. */
  onAnalyse?:   (domainPrefix: string) => void;
  /**
   * Called when the user clicks "Ask V#" on a file row.
   * Receives a pre-composed message: "Tell me about [file] — [top finding]".
   * The workspace page wires this to router.push('/workspace?prefill=...').
   */
  onAskVHash?:  (message: string) => void;
}

// ─── Module config ────────────────────────────────────────────

const MODULE_CONFIG: Record<AgentId, { label: string; color: string; icon: React.ReactNode }> = {
  cipher: {
    label: "Cipher",
    color: "text-blue-400",
    icon:  <BookOpen className="h-3 w-3" />,
  },
  sentinel: {
    label: "Sentinel",
    color: "text-red-400",
    icon:  <Shield className="h-3 w-3" />,
  },
  pulse: {
    label: "Pulse",
    color: "text-amber-400",
    icon:  <Zap className="h-3 w-3" />,
  },
  atlas: {
    label: "Atlas",
    color: "text-purple-400",
    icon:  <Layers className="h-3 w-3" />,
  },
  forge: {
    label: "Forge",
    color: "text-emerald-400",
    icon:  <FileCode className="h-3 w-3" />,
  },
};

const CONFIDENCE_CONFIG = {
  confirmed:   { label: "confirmed",   classes: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400", icon: <CheckCircle2 className="h-2.5 w-2.5" /> },
  inferred:    { label: "inferred",    classes: "border-blue-500/20 bg-blue-500/10 text-blue-400",           icon: <Minus className="h-2.5 w-2.5" /> },
  speculative: { label: "speculative", classes: "border-zinc-700/40 bg-zinc-700/10 text-zinc-500",           icon: <AlertTriangle className="h-2.5 w-2.5" /> },
};

// ─── Component ────────────────────────────────────────────────

export function IntelligencePanel({ state, onAnalyse, onAskVHash }: IntelligencePanelProps) {
  const [activeModule, setActiveModule] = useState<AgentId | "all">("all");

  // ── Idle ───────────────────────────────────────────────────
  if (state.status === "idle") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Layers className="h-7 w-7 text-zinc-700" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-zinc-500">Select a domain</p>
          <p className="text-xs text-zinc-700">
            Click any domain in the tree to view its intelligence findings.
          </p>
        </div>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────
  if (state.status === "loading") {
    return (
      <div className="space-y-4 p-4" role="status" aria-label="Loading findings…">
        <div className="h-5 w-1/2 animate-pulse rounded bg-white/[0.06]" />
        <div className="flex gap-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-6 w-16 animate-pulse rounded-full bg-white/[0.05]" />
          ))}
        </div>
        <div className="space-y-3 pt-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="space-y-1.5 rounded-xl border border-white/[0.05] p-3">
              <div className="h-3 w-2/3 animate-pulse rounded bg-white/[0.05]" />
              <div className="h-3 w-full animate-pulse rounded bg-white/[0.04]" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.04]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────
  if (state.status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <AlertTriangle className="h-6 w-6 text-red-400" />
        <p className="text-sm text-red-300">Failed to load intelligence</p>
        <p className="text-xs text-zinc-600">{state.error}</p>
      </div>
    );
  }

  // ── Empty ──────────────────────────────────────────────────
  if (state.status === "empty") {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <Lock className="h-7 w-7 text-zinc-700" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-zinc-400">No intelligence yet</p>
          <p className="text-xs text-zinc-600">
            <code className="text-zinc-500">{state.domainPrefix}</code> hasn&apos;t been
            analysed. Open a file from this domain in the chat to trigger Cipher.
          </p>
        </div>
        {onAnalyse && state.domainPrefix && (
          <button
            onClick={() => onAnalyse(state.domainPrefix!)}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-white/[0.08]"
          >
            Analyse stale files
          </button>
        )}
      </div>
    );
  }

  // ── Success ────────────────────────────────────────────────
  const { data } = state;
  if (!data) return null;

  const moduleIds = Object.keys(data.modules) as AgentId[];
  const allEntries: DomainFileEntry[] = moduleIds.flatMap(m => data.modules[m] ?? []);

  const filteredEntries = activeModule === "all"
    ? allEntries
    : (data.modules[activeModule] ?? []);

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-zinc-300">
              {data.domainPrefix}
            </p>
            <p className="mt-0.5 text-[10px] text-zinc-600">
              {data.totalFindings} finding{data.totalFindings !== 1 ? "s" : ""} across{" "}
              {data.fileCount} file{data.fileCount !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* Module tabs */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <ModuleTab
            label="All"
            count={data.totalFindings}
            active={activeModule === "all"}
            color="text-zinc-400"
            onClick={() => setActiveModule("all")}
          />
          {moduleIds.map(agentId => {
            const moduleEntries = data.modules[agentId] ?? [];
            const count = moduleEntries.reduce((sum, e) => sum + e.findings.length, 0);
            const cfg   = MODULE_CONFIG[agentId];
            return (
              <ModuleTab
                key={agentId}
                label={cfg?.label ?? agentId}
                count={count}
                active={activeModule === agentId}
                color={cfg?.color ?? "text-zinc-400"}
                onClick={() => setActiveModule(agentId)}
              />
            );
          })}
        </div>
      </div>

      {/* ── Findings list ────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeModule}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="space-y-2"
          >
            {filteredEntries.length === 0 ? (
              <p className="py-4 text-center text-xs text-zinc-700">
                No findings from{" "}
                {activeModule === "all"
                  ? "any module"
                  : MODULE_CONFIG[activeModule]?.label ?? activeModule}
                {" "}in this domain.
              </p>
            ) : (
              filteredEntries.map((entry, entryIdx) => (
                <FileEntry
                  key={`${entry.agentId}-${entry.filePath}-${entryIdx}`}
                  entry={entry}
                  onAskVHash={onAskVHash}
                />
              ))
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function ModuleTab({
  label, count, active, color, onClick,
}: {
  label:   string;
  count:   number;
  active:  boolean;
  color:   string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition",
        active
          ? "border-white/10 bg-white/[0.06] text-zinc-200"
          : "border-white/[0.04] bg-transparent text-zinc-600 hover:text-zinc-400"
      )}
    >
      <span className={active ? "text-zinc-200" : color}>{label}</span>
      <span className={cn(
        "rounded-full px-1 font-mono",
        active ? "text-zinc-400" : "text-zinc-700"
      )}>
        {count}
      </span>
    </button>
  );
}

function FileEntry({
  entry,
  onAskVHash,
}: {
  entry:       DomainFileEntry;
  onAskVHash?: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const cfg = MODULE_CONFIG[entry.agentId];

  const fileName   = entry.filePath.split("/").pop() ?? entry.filePath;
  const topFinding = entry.findings[0];

  function handleAskVHash(e: React.MouseEvent) {
    e.stopPropagation(); // don't toggle expand
    if (!onAskVHash) return;
    const topTitle = topFinding?.title ?? "findings";
    onAskVHash(`Tell me about ${fileName} — ${topTitle}`);
  }

  return (
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.02]">
      {/* File header */}
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <FileCode className="h-3 w-3 shrink-0 text-zinc-600" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-400">
          {fileName}
        </span>
        <span className={cn("flex items-center gap-1 text-[10px]", cfg?.color ?? "text-zinc-500")}>
          {cfg?.icon}
          <span>{cfg?.label ?? entry.agentId}</span>
        </span>
        <span className="text-[10px] text-zinc-700">
          {entry.findings.length} finding{entry.findings.length !== 1 ? "s" : ""}
        </span>
        {/* Ask V# button — only shown when callback is wired */}
        {onAskVHash && (
          <button
            onClick={handleAskVHash}
            title={`Ask V# about ${fileName}`}
            className="flex items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 text-[9px] text-zinc-500 transition hover:border-blue-500/20 hover:bg-blue-500/10 hover:text-blue-400"
          >
            <MessageSquare className="h-2.5 w-2.5" />
            <span>Ask V#</span>
          </button>
        )}
      </button>

      {/* Findings */}
      <AnimatePresence initial={false}>
        {expanded && entry.findings.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden border-t border-white/[0.04]"
          >
            <div className="space-y-px p-2">
              {entry.findings.map(finding => (
                <FindingCard key={finding.id} finding={finding} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FindingCard({ finding }: { finding: CipherFinding }) {
  const [expanded, setExpanded] = useState(false);
  const conf = CONFIDENCE_CONFIG[finding.confidence];

  return (
    <div className="rounded-lg px-2.5 py-2 hover:bg-white/[0.03]">
      <button
        className="w-full text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-start gap-2">
          {/* Title */}
          <p className="min-w-0 flex-1 text-[11px] font-medium leading-snug text-zinc-300">
            {finding.title}
          </p>
          {/* Confidence chip */}
          <span className={cn(
            "flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px]",
            conf.classes
          )}>
            {conf.icon}
            <span>{conf.label}</span>
          </span>
        </div>

        {/* Evidence lines */}
        {finding.evidenceLines && (
          <p className="mt-0.5 text-[10px] text-zinc-700">
            line {finding.evidenceLines.start}
            {finding.evidenceLines.end !== finding.evidenceLines.start &&
              `–${finding.evidenceLines.end}`}
          </p>
        )}
      </button>

      {/* Expanded: description + reasoning */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.12 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-2">
              <p className="text-[10px] leading-relaxed text-zinc-500">
                {finding.description}
              </p>
              <div className="rounded-lg border border-white/[0.04] bg-white/[0.02] px-2.5 py-2">
                <p className="text-[9px] font-medium uppercase tracking-wide text-zinc-700">
                  Reasoning
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
                  {finding.agentReasoning}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
