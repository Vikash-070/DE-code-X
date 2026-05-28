"use client";

/**
 * ArchitectureNode
 *
 * Renders a single node in the architecture tree.
 *
 * Node type → rendering strategy:
 *   section       — bold label, no chip, expand/collapse chevron
 *   domain        — prefix badge, pressure chip, file count, chevron (no children rendered)
 *   system        — confidence chip (✅/⚠️), component badges, expand/collapse for evidence
 *   evidence-file — filename only, truncated path tooltip, indented leaf
 *
 * Confidence chips:
 *   ✅ strong       — green — source-confirmed
 *   ⚠️ partial      — amber — package.json only
 *   📁 directory-only — blue — structural (domains)
 */

import { useState } from "react";
import { ChevronRight, File, FolderOpen, Layers, Server, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { cn } from "@/lib/utils";
import type { ArchitectureTreeNode, ConfidenceLevel, NodeType, PressureLabel } from "@/types/architecture";

// ─── Props ────────────────────────────────────────────────────

interface ArchitectureNodeProps {
  node:  ArchitectureTreeNode;
  depth: number;
  /** Whether to start expanded (sections start open by default). */
  defaultExpanded?: boolean;
}

// ─── Component ────────────────────────────────────────────────

export function ArchitectureNode({ node, depth, defaultExpanded = false }: ArchitectureNodeProps) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const [expanded, setExpanded] = useState(defaultExpanded);

  const indent = depth * 16; // 16px per depth level

  return (
    <div>
      {/* ── Node row ─────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, x: -4 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2 }}
        className={cn(
          "group flex items-start gap-2 rounded-xl px-3 py-2.5 transition-colors",
          hasChildren && "cursor-pointer hover:bg-white/[0.03]",
          depth === 0 && "rounded-2xl border border-white/[0.06] bg-white/[0.02]",
        )}
        style={{ paddingLeft: `${indent + 12}px` }}
        onClick={hasChildren ? () => setExpanded(v => !v) : undefined}
        role={hasChildren ? "button" : undefined}
        aria-expanded={hasChildren ? expanded : undefined}
      >
        {/* Icon */}
        <NodeIcon type={node.type} confidence={node.confidence} className="mt-0.5 shrink-0" />

        {/* Main content */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* Label */}
            <span className={cn(
              "truncate font-medium",
              depth === 0 ? "text-sm text-zinc-200" : "text-xs text-zinc-300",
              node.type === "evidence-file" && "font-normal text-zinc-400",
            )}>
              {node.label}
            </span>

            {/* Confidence chip — not on sections or evidence files */}
            {node.type !== "section" && node.type !== "evidence-file" && (
              <ConfidenceChip confidence={node.confidence} />
            )}

            {/* Pressure chip — domain nodes */}
            {node.type === "domain" && node.pressure && (
              <PressureChip pressure={node.pressure} fileCount={node.fileCount} />
            )}
          </div>

          {/* Components row — system nodes */}
          {node.type === "system" && node.components && node.components.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {node.components.map(c => (
                <span
                  key={c}
                  className="rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-zinc-500"
                >
                  {c}
                </span>
              ))}
            </div>
          )}

          {/* Evidence note — partial systems */}
          {node.type === "system" && node.confidence === "partial" && node.evidenceNote && (
            <p className="mt-1 text-[10px] text-zinc-600">{node.evidenceNote}</p>
          )}

          {/* Freshness indicator — nodes with stored Cipher intelligence */}
          {node.freshnessStatus === "stale" && (
            <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-500/80">
              <span>⚠</span>
              <span>
                {node.staleFileCount
                  ? `${node.staleFileCount} file${node.staleFileCount !== 1 ? "s" : ""} changed since last analysis`
                  : "Changed since last analysis"}
              </span>
            </p>
          )}
          {node.freshnessStatus === "fresh" && node.lastIntelligenceAt && (
            <p className="mt-1 text-[10px] text-zinc-600">
              analyzed {formatRelativeTime(node.lastIntelligenceAt)}
            </p>
          )}

          {/* Prefix — domain nodes */}
          {node.type === "domain" && node.prefix && (
            <p className="mt-0.5 text-[10px] text-zinc-600">{node.prefix}/</p>
          )}

          {/* Full path tooltip for evidence-file nodes */}
          {node.type === "evidence-file" && node.prefix && node.prefix !== node.label && (
            <p className="mt-0.5 text-[10px] text-zinc-700">{node.prefix}</p>
          )}
        </div>

        {/* Chevron */}
        {hasChildren && (
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-zinc-600 transition-transform duration-200",
              expanded && "rotate-90"
            )}
          />
        )}
      </motion.div>

      {/* ── Children ─────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {expanded && hasChildren && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className={cn("mt-0.5 space-y-0.5", depth === 0 && "ml-4 mt-2")}>
              {node.children!.map(child => (
                <ArchitectureNode
                  key={child.id}
                  node={child}
                  depth={depth + 1}
                  defaultExpanded={child.type === "section"}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// ─── Sub-components ───────────────────────────────────────────

function NodeIcon({
  type,
  confidence,
  className,
}: {
  type: NodeType;
  confidence: ConfidenceLevel;
  className?: string;
}) {
  if (type === "section") {
    return <Layers className={cn("h-3.5 w-3.5 text-zinc-500", className)} />;
  }
  if (type === "domain") {
    return <FolderOpen className={cn("h-3.5 w-3.5 text-blue-400/70", className)} />;
  }
  if (type === "system") {
    const color =
      confidence === "strong"  ? "text-emerald-400/80" :
      confidence === "partial" ? "text-amber-400/70" :
      "text-zinc-500";
    return <Server className={cn("h-3.5 w-3.5", color, className)} />;
  }
  if (type === "evidence-file") {
    return <File className={cn("h-3 w-3 text-zinc-600", className)} />;
  }
  return <Zap className={cn("h-3.5 w-3.5 text-zinc-500", className)} />;
}

function ConfidenceChip({ confidence }: { confidence: ConfidenceLevel }) {
  if (confidence === "strong") {
    return (
      <span className="flex items-center gap-0.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
        ✅ source-confirmed
      </span>
    );
  }
  if (confidence === "partial") {
    return (
      <span className="flex items-center gap-0.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
        ⚠️ package only
      </span>
    );
  }
  // directory-only — domains use pressure chip instead, so this is rarely shown
  return (
    <span className="flex items-center gap-0.5 rounded-full border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
      📁 directory
    </span>
  );
}

function PressureChip({
  pressure,
  fileCount,
}: {
  pressure: PressureLabel;
  fileCount?: number;
}) {
  const label = fileCount !== undefined ? `${fileCount} files` : pressure;

  const classes =
    pressure === "heavy"  ? "border-zinc-600/40 bg-zinc-600/10 text-zinc-400" :
    pressure === "medium" ? "border-zinc-700/40 bg-zinc-700/10 text-zinc-500" :
                            "border-zinc-800/40 bg-zinc-800/10 text-zinc-600";

  return (
    <span className={cn(
      "rounded-full border px-1.5 py-0.5 text-[10px]",
      classes
    )}>
      {label}
    </span>
  );
}
