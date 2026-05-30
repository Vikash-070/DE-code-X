"use client";

/**
 * Architecture Canvas — Increment E.
 *
 * Renders the deterministic ArchitectureGraph (Atlas Relationship Engine,
 * Increment A+B) as a tiered, visual architecture map:
 *
 *   • Tiered layout — Entry → Domain → Data → Infrastructure bands.
 *   • System nodes  — name, confidence, file count; click → evidence + details.
 *   • System edges  — directed, typed; confirmed = solid, inferred = dashed,
 *                     speculative = faint; click → evidence inspector.
 *
 * DETERMINISTIC: positions derive purely from graph.nodes order (already sorted
 * by Increment A) and tier grouping. Same graph (same fingerprint) → identical
 * placement on every render. No layout simulation, no randomness.
 *
 * Edges (SVG) and node cards (HTML) share one coordinate space. No graph
 * library — keeps the frontend light and the layout fully under our control.
 */

import { useEffect, useMemo, useState } from "react";
import { Layers, GitBranch, X, FileCode, Maximize2, Minimize2, Loader2, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  ArchitectureGraph,
  SystemNode,
  SystemEdge,
  SystemTier,
  Confidence,
} from "@/server/repo/architecture-wire";
import type { FileMap, FileNode } from "@/server/repo/file-map";
import { FILE_LAYER_ORDER, FILE_LAYER_LABEL } from "@/server/repo/file-map";
import type { FileEdge } from "@/server/repo/import-graph";
import type { FileNarration } from "@/server/repo/narration";
import { useFileWires } from "@/hooks/use-file-wires";
import { useActiveRepository } from "@/contexts/repository-context";

// ─── Layout constants (deterministic) ─────────────────────────

const NODE_W = 184;
const NODE_H = 72;
const COL_GAP = 28;
const BAND_LABEL_H = 26;
const BAND_GAP = 76;
const PAD = 28;

const TIER_ORDER: readonly SystemTier[] = ["entry", "domain", "data", "infra"];
const TIER_LABEL: Record<SystemTier, string> = {
  entry: "Entry Layer",
  domain: "Domain Layer",
  data: "Data Layer",
  infra: "Infrastructure Layer",
};

// ─── Visual encodings ─────────────────────────────────────────

const CONFIDENCE_DOT: Record<Confidence, string> = {
  confirmed:   "bg-emerald-400",
  inferred:    "bg-amber-400",
  speculative: "bg-zinc-500",
};
const CONFIDENCE_TEXT: Record<Confidence, string> = {
  confirmed:   "text-emerald-400",
  inferred:    "text-amber-400",
  speculative: "text-zinc-500",
};

/** Edge stroke style by confidence — solid / dashed / faint. */
function edgeStroke(confidence: Confidence): { dash?: string; opacity: number } {
  switch (confidence) {
    case "confirmed":   return { opacity: 0.85 };
    case "inferred":    return { dash: "6 4", opacity: 0.6 };
    case "speculative": return { dash: "2 5", opacity: 0.32 };
  }
}

/** Edge color by type → which arrowhead marker to use. */
function edgeColor(type: SystemEdge["type"]): { stroke: string; marker: string } {
  switch (type) {
    case "data-flow": return { stroke: "#22d3ee", marker: "arrow-cyan" };   // cyan-400
    case "guards":    return { stroke: "#f472b6", marker: "arrow-pink" };   // pink-400
    default:          return { stroke: "#6366f1", marker: "arrow-indigo" }; // indigo-500
  }
}

// ─── Positioning ──────────────────────────────────────────────

interface Placed {
  node: SystemNode;
  x: number;   // top-left
  y: number;
  cx: number;  // center
  cy: number;
}

interface Layout {
  placed: Map<string, Placed>;
  bands: { tier: SystemTier; labelY: number }[];
  width: number;
  height: number;
}

function computeLayout(graph: ArchitectureGraph): Layout {
  // Group preserving the deterministic graph.nodes order.
  const byTier = new Map<SystemTier, SystemNode[]>();
  for (const n of graph.nodes) {
    const b = byTier.get(n.tier) ?? [];
    b.push(n);
    byTier.set(n.tier, b);
  }

  const placed = new Map<string, Placed>();
  const bands: { tier: SystemTier; labelY: number }[] = [];
  let y = PAD;
  let maxCols = 0;

  for (const tier of TIER_ORDER) {
    const group = byTier.get(tier);
    if (!group || group.length === 0) continue;

    bands.push({ tier, labelY: y });
    const rowY = y + BAND_LABEL_H;
    group.forEach((node, j) => {
      const x = PAD + j * (NODE_W + COL_GAP);
      placed.set(node.id, { node, x, y: rowY, cx: x + NODE_W / 2, cy: rowY + NODE_H / 2 });
    });
    maxCols = Math.max(maxCols, group.length);
    y = rowY + NODE_H + BAND_GAP;
  }

  const width = PAD * 2 + Math.max(1, maxCols) * (NODE_W + COL_GAP) - COL_GAP;
  const height = Math.max(y - BAND_GAP + PAD, PAD * 2 + NODE_H);
  return { placed, bands, width, height };
}

/** Cubic bezier from the bottom of the source to the top of the target. */
function edgePath(from: Placed, to: Placed): string {
  const sx = from.cx, sy = from.y + NODE_H;
  const tx = to.cx,   ty = to.y;
  const dy = Math.max(24, (ty - sy) / 2);
  return `M ${sx} ${sy} C ${sx} ${sy + dy}, ${tx} ${ty - dy}, ${tx} ${ty}`;
}

// ─── Selection model ──────────────────────────────────────────

type Selection =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | null;

// ─── Component ────────────────────────────────────────────────

export function ArchitectureCanvas({
  graph,
  fileMap = null,
  loading = false,
}: {
  graph: ArchitectureGraph | null;
  fileMap?: FileMap | null;
  loading?: boolean;
}) {
  const [selection, setSelection] = useState<Selection>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [view, setView] = useState<"systems" | "files">("systems");

  // Escape exits fullscreen. Lock body scroll while expanded.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);

  const layout = useMemo(() => (graph ? computeLayout(graph) : null), [graph]);

  if (loading) {
    return (
      <div className="h-[420px] animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />
    );
  }

  const hasGraph = !!graph && graph.nodes.length > 0;
  const hasFiles = !!fileMap && fileMap.totalFiles > 0;

  if (!hasGraph && !hasFiles) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] py-16 text-center">
        <Layers className="h-7 w-7 text-zinc-600" />
        <p className="text-sm font-medium text-zinc-400">No architecture map yet</p>
        <p className="max-w-sm text-xs text-zinc-600">
          Atlas couldn&apos;t derive systems or files from this repository — it may use a
          non-standard layout, or its tree wasn&apos;t readable.
        </p>
      </div>
    );
  }

  // Force a renderable view when one side has no data.
  const activeView: "systems" | "files" = !hasGraph ? "files" : !hasFiles ? "systems" : view;

  const selectedNode =
    hasGraph && selection?.kind === "node" ? graph!.nodes.find((n) => n.id === selection.id) ?? null : null;
  const selectedEdge =
    hasGraph && selection?.kind === "edge" ? graph!.edges.find((e) => e.id === selection.id) ?? null : null;

  return (
    <div className={cn(fullscreen && "fixed inset-0 z-50 overflow-auto bg-[#050506] p-4")}>
      {/* ── Controls: view toggle + fullscreen ─────────────── */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setView("systems")}
            disabled={!hasGraph}
            className={cn(
              "rounded-md px-2.5 py-1 transition-colors disabled:opacity-30",
              activeView === "systems" ? "bg-white/[0.08] text-zinc-200" : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            Systems
          </button>
          <button
            type="button"
            onClick={() => setView("files")}
            disabled={!hasFiles}
            className={cn(
              "rounded-md px-2.5 py-1 transition-colors disabled:opacity-30",
              activeView === "files" ? "bg-white/[0.08] text-zinc-200" : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            Files{hasFiles ? ` · ${fileMap!.totalFiles}` : ""}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setFullscreen((v) => !v)}
          className="grid h-7 w-7 place-items-center rounded-lg border border-white/[0.08] bg-black/40 text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-200"
          aria-label={fullscreen ? "Exit fullscreen" : "View full map"}
          title={fullscreen ? "Exit fullscreen (Esc)" : "View full map"}
        >
          {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* ── Files view ─────────────────────────────────────── */}
      {activeView === "files" && hasFiles && (
        <FileColumnsView fileMap={fileMap!} fullscreen={fullscreen} />
      )}

      {/* ── Systems view ───────────────────────────────────── */}
      {activeView === "systems" && hasGraph && (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_300px]">
        {/* ── Canvas column ──────────────────────────────────── */}
        <div
          className="min-w-0 overflow-auto rounded-2xl border border-white/[0.06] bg-[#070708] p-2"
          style={fullscreen ? { maxHeight: "calc(100vh - 5rem)" } : undefined}
        >
          <div
            className="relative"
            style={{ width: layout!.width, height: layout!.height, minWidth: "100%" }}
            onClick={() => setSelection(null)}
          >
          {/* Tier band labels + separators */}
          {layout!.bands.map((b) => (
            <div
              key={b.tier}
              className="absolute left-0 right-0 flex items-center gap-2 px-1"
              style={{ top: b.labelY }}
            >
              <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-zinc-700">
                {TIER_LABEL[b.tier]}
              </span>
              <div className="h-px flex-1 bg-white/[0.04]" />
            </div>
          ))}

          {/* Edges (SVG, behind nodes) */}
          <svg
            className="pointer-events-none absolute inset-0"
            width={layout!.width}
            height={layout!.height}
          >
            <defs>
              {[
                { id: "arrow-indigo", c: "#6366f1" },
                { id: "arrow-cyan", c: "#22d3ee" },
                { id: "arrow-pink", c: "#f472b6" },
              ].map((m) => (
                <marker
                  key={m.id}
                  id={m.id}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={m.c} />
                </marker>
              ))}
            </defs>

            {graph!.edges.map((e) => {
              const from = layout!.placed.get(e.from);
              const to = layout!.placed.get(e.to);
              if (!from || !to) return null;
              const d = edgePath(from, to);
              const { dash, opacity } = edgeStroke(e.confidence);
              const { stroke, marker } = edgeColor(e.type);
              const active = selection?.kind === "edge" && selection.id === e.id;
              return (
                <g key={e.id}>
                  {/* Visible edge */}
                  <path
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={active ? 3 : 1.75}
                    strokeDasharray={dash}
                    strokeOpacity={active ? 1 : opacity}
                    markerEnd={`url(#${marker})`}
                  />
                  {/* Invisible wide hit area for clicking */}
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16}
                    className="pointer-events-auto cursor-pointer"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setSelection({ kind: "edge", id: e.id });
                    }}
                  />
                </g>
              );
            })}
          </svg>

          {/* Nodes (HTML, on top) */}
          {graph!.nodes.map((n) => {
            const p = layout!.placed.get(n.id);
            if (!p) return null;
            const active = selection?.kind === "node" && selection.id === n.id;
            return (
              <button
                key={n.id}
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation();
                  setSelection({ kind: "node", id: n.id });
                }}
                className={cn(
                  "absolute flex flex-col justify-center gap-1 rounded-xl border px-3 text-left transition-colors",
                  active
                    ? "border-white/25 bg-white/[0.06] ring-1 ring-white/20"
                    : "border-white/[0.08] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.05]"
                )}
                style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
              >
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", CONFIDENCE_DOT[n.confidence])} />
                  <span className="truncate text-[12px] font-semibold text-zinc-200">{n.name}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[9px]">
                  <span className={CONFIDENCE_TEXT[n.confidence]}>{n.confidence}</span>
                  <span className="text-zinc-700">·</span>
                  <span className="text-zinc-500">
                    {n.fileCount > 0 ? `${n.fileCount} file${n.fileCount === 1 ? "" : "s"}` : "dependency-only"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <Legend />
        </div>

        {/* ── Inspector ──────────────────────────────────────── */}
        <Inspector
          node={selectedNode}
          edge={selectedEdge}
          onClose={() => setSelection(null)}
        />
      </div>
      )}
    </div>
  );
}

// ─── Files view (Stage 1 + Stage 2 wires) ─────────────────────
// Layered columns of real files. Click a file → its inspector with path/role
// and, once the import scan is loaded, its "Calls / Sends To" + "Called by"
// wires (deterministic, file:line evidence). Plain-English prose = Stage 3.

const FILE_ROLE_COLOR: Record<string, string> = {
  entry: "text-sky-400", provider: "text-violet-400", guard: "text-rose-400",
  page: "text-blue-400", component: "text-zinc-400", hook: "text-teal-400",
  "frontend-service": "text-cyan-400", "server-entry": "text-emerald-400",
  route: "text-emerald-400", middleware: "text-amber-400", controller: "text-emerald-400",
  "backend-service": "text-emerald-400", model: "text-orange-400", schema: "text-orange-400",
  migration: "text-orange-400", config: "text-zinc-500", util: "text-zinc-500",
  type: "text-zinc-500", style: "text-pink-400", test: "text-lime-400",
  doc: "text-zinc-600", other: "text-zinc-600",
};

function pushEdge(map: Map<string, FileEdge[]>, key: string, e: FileEdge) {
  const arr = map.get(key);
  if (arr) arr.push(e);
  else map.set(key, [e]);
}

function FileColumnsView({ fileMap, fullscreen }: { fileMap: FileMap; fullscreen: boolean }) {
  const { activeRepository } = useActiveRepository();
  const [owner, repoName] = activeRepository ? activeRepository.fullName.split("/") : [null, null];
  const branch = activeRepository?.defaultBranch ?? "main";

  const [selected, setSelected] = useState<FileNode | null>(null);
  const [wiresOn, setWiresOn] = useState(false);
  const [layoutMode, setLayoutMode] = useState<"list" | "wires">("list");
  const wires = useFileWires(wiresOn);

  const columns = FILE_LAYER_ORDER.filter((l) => fileMap.byLayer[l].length > 0);

  const byPath = useMemo(() => {
    const m = new Map<string, FileNode>();
    for (const f of fileMap.files) m.set(f.path, f);
    return m;
  }, [fileMap]);

  const { outMap, inMap } = useMemo(() => {
    const out = new Map<string, FileEdge[]>();
    const inc = new Map<string, FileEdge[]>();
    for (const e of wires.edges) {
      pushEdge(out, e.from, e);
      pushEdge(inc, e.to, e);
    }
    return { outMap: out, inMap: inc };
  }, [wires.edges]);

  const related = useMemo(() => {
    if (!selected) return null;
    const s = new Set<string>();
    for (const e of outMap.get(selected.path) ?? []) s.add(e.to);
    for (const e of inMap.get(selected.path) ?? []) s.add(e.from);
    return s;
  }, [selected, outMap, inMap]);

  const selectByPath = (p: string) => { const f = byPath.get(p); if (f) setSelected(f); };
  const hasRelations = !!related && related.size > 0;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
      {/* Layer columns */}
      <div
        className="min-w-0 overflow-auto rounded-2xl border border-white/[0.06] bg-[#070708] p-3"
        style={fullscreen ? { maxHeight: "calc(100vh - 5rem)" } : { maxHeight: "70vh" }}
      >
        {/* Wires control */}
        <div className="mb-3 flex items-center gap-2 px-1">
          {wires.status === "idle" && (
            <button
              type="button"
              onClick={() => setWiresOn(true)}
              className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] text-zinc-300 transition-colors hover:border-white/20 hover:text-zinc-100"
            >
              Load call wires
            </button>
          )}
          {wires.status === "loading" && (
            <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" /> Scanning imports…
            </span>
          )}
          {wires.status === "ready" && (
            <>
              <span className="text-[10px] text-zinc-600">
                {wires.edges.length} call wires from {wires.scanned} files
                {wires.truncated ? " · partial (large repo)" : ""}
              </span>
              {wires.edges.length > 0 && (
                <div className="ml-auto inline-flex rounded-md border border-white/[0.08] bg-white/[0.02] p-0.5 text-[9px]">
                  {(["list", "wires"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setLayoutMode(m)}
                      className={cn(
                        "rounded px-2 py-0.5 capitalize transition-colors",
                        layoutMode === m ? "bg-white/[0.08] text-zinc-200" : "text-zinc-500 hover:text-zinc-300"
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {wires.status === "error" && (
            <span className="text-[10px] text-rose-400/70">Couldn&apos;t load wires.</span>
          )}
        </div>

        {layoutMode === "wires" && wires.status === "ready" && wires.edges.length > 0 ? (
          <WireMap
            fileMap={fileMap}
            edges={wires.edges}
            selectedPath={selected?.path ?? null}
            onSelect={setSelected}
          />
        ) : (
        <div className="flex gap-3" style={{ minWidth: "min-content" }}>
          {columns.map((layer) => {
            const files = fileMap.byLayer[layer];
            return (
              <div key={layer} className="flex w-[200px] shrink-0 flex-col gap-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[9px] font-medium uppercase tracking-[0.16em] text-zinc-600">
                    {FILE_LAYER_LABEL[layer]}
                  </span>
                  <span className="text-[9px] text-zinc-700">{files.length}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {files.map((f) => {
                    const active = selected?.path === f.path;
                    const isRelated = related?.has(f.path) ?? false;
                    const dim = hasRelations && !active && !isRelated;
                    const outCount = outMap.get(f.path)?.length ?? 0;
                    return (
                      <button
                        key={f.path}
                        type="button"
                        onClick={() => setSelected(f)}
                        className={cn(
                          "rounded-lg border px-2.5 py-1.5 text-left transition-all",
                          active
                            ? "border-white/25 bg-white/[0.06] ring-1 ring-white/15"
                            : isRelated
                              ? "border-indigo-500/40 bg-indigo-500/[0.06]"
                              : "border-white/[0.06] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]",
                          dim && "opacity-35"
                        )}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate text-[11px] font-medium text-zinc-300">{f.name}</span>
                          {outCount > 0 && (
                            <span className="shrink-0 text-[8px] text-indigo-400/70" title={`${outCount} calls`}>
                              →{outCount}
                            </span>
                          )}
                        </div>
                        <div className={cn("text-[9px]", FILE_ROLE_COLOR[f.role] ?? "text-zinc-600")}>
                          {f.role}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

      {/* File inspector */}
      <FileInspector
        file={selected}
        outgoing={selected ? (outMap.get(selected.path) ?? []) : []}
        incoming={selected ? (inMap.get(selected.path) ?? []) : []}
        wiresReady={wires.status === "ready"}
        owner={owner}
        repo={repoName}
        branch={branch}
        onClose={() => setSelected(null)}
        onSelectPath={selectByPath}
      />
    </div>
  );
}

// ─── Wire map (Stage 2b — overview arcs) ──────────────────────
// Absolute-positioned diagram of the WIRED files (those with edges), in layer
// columns left→right, with curved call arcs. Bounded to wired files to avoid a
// hairball. Deterministic positions → stable layout.

const W_NODE_W = 156, W_NODE_H = 38, W_COL_GAP = 72, W_ROW_GAP = 12, W_PAD = 20, W_LABEL_H = 22;

function WireMap({ fileMap, edges, selectedPath, onSelect }: {
  fileMap: FileMap;
  edges: FileEdge[];
  selectedPath: string | null;
  onSelect: (f: FileNode) => void;
}) {
  const layout = useMemo(() => {
    const wired = new Set<string>();
    for (const e of edges) { wired.add(e.from); wired.add(e.to); }
    const byPath = new Map(fileMap.files.map((f) => [f.path, f] as const));

    const byLayer = new Map<string, FileNode[]>();
    for (const p of wired) {
      const f = byPath.get(p);
      if (!f) continue;
      const arr = byLayer.get(f.layer) ?? [];
      arr.push(f);
      byLayer.set(f.layer, arr);
    }
    const cols = FILE_LAYER_ORDER.filter((l) => (byLayer.get(l)?.length ?? 0) > 0);
    const placed = new Map<string, { x: number; y: number; cx: number; cy: number }>();
    let maxRows = 0;
    cols.forEach((layer, ci) => {
      const files = (byLayer.get(layer) ?? []).slice().sort((a, b) => a.path.localeCompare(b.path));
      maxRows = Math.max(maxRows, files.length);
      const x = W_PAD + ci * (W_NODE_W + W_COL_GAP);
      files.forEach((f, ri) => {
        const y = W_PAD + W_LABEL_H + ri * (W_NODE_H + W_ROW_GAP);
        placed.set(f.path, { x, y, cx: x + W_NODE_W / 2, cy: y + W_NODE_H / 2 });
      });
    });
    const width = W_PAD * 2 + cols.length * (W_NODE_W + W_COL_GAP) - W_COL_GAP;
    const height = W_PAD * 2 + W_LABEL_H + maxRows * (W_NODE_H + W_ROW_GAP);
    return { cols, placed, width, height, byPath };
  }, [fileMap, edges]);

  const relatedPaths = useMemo(() => {
    if (!selectedPath) return null;
    const s = new Set<string>([selectedPath]);
    for (const e of edges) {
      if (e.from === selectedPath) s.add(e.to);
      if (e.to === selectedPath) s.add(e.from);
    }
    return s;
  }, [selectedPath, edges]);

  return (
    <div className="relative" style={{ width: layout.width, height: layout.height, minWidth: "100%" }}>
      {/* Column labels */}
      {layout.cols.map((layer, ci) => (
        <div key={layer} className="absolute" style={{ left: W_PAD + ci * (W_NODE_W + W_COL_GAP), top: 0, width: W_NODE_W }}>
          <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-zinc-600">{FILE_LAYER_LABEL[layer]}</span>
        </div>
      ))}

      {/* Arcs */}
      <svg className="pointer-events-none absolute inset-0" width={layout.width} height={layout.height}>
        <defs>
          <marker id="wire-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#6366f1" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = layout.placed.get(e.from);
          const b = layout.placed.get(e.to);
          if (!a || !b) return null;
          const sx = a.x + W_NODE_W, sy = a.cy, tx = b.x, ty = b.cy;
          const dx = Math.max(40, Math.abs(tx - sx) / 2);
          const d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
          const isSelEdge = !!selectedPath && (e.from === selectedPath || e.to === selectedPath);
          const { dash, opacity } = edgeStroke(e.confidence);
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke="#6366f1"
              strokeWidth={isSelEdge ? 2 : 1.25}
              strokeDasharray={dash}
              strokeOpacity={selectedPath ? (isSelEdge ? 0.95 : 0.07) : opacity * 0.7}
              markerEnd="url(#wire-arrow)"
            />
          );
        })}
      </svg>

      {/* Nodes */}
      {[...layout.placed.entries()].map(([path, p]) => {
        const f = layout.byPath.get(path);
        if (!f) return null;
        const active = selectedPath === path;
        const related = relatedPaths?.has(path) ?? false;
        const dim = !!selectedPath && !related;
        return (
          <button
            key={path}
            type="button"
            onClick={() => onSelect(f)}
            className={cn(
              "absolute flex flex-col justify-center rounded-lg border px-2 text-left transition-all",
              active
                ? "border-white/25 bg-white/[0.07] ring-1 ring-white/20"
                : related
                  ? "border-indigo-500/40 bg-indigo-500/[0.06]"
                  : "border-white/[0.07] bg-white/[0.025] hover:border-white/15",
              dim && "opacity-30"
            )}
            style={{ left: p.x, top: p.y, width: W_NODE_W, height: W_NODE_H }}
          >
            <span className="truncate text-[10px] font-medium text-zinc-300">{f.name}</span>
            <span className={cn("truncate text-[8px]", FILE_ROLE_COLOR[f.role] ?? "text-zinc-600")}>{f.role}</span>
          </button>
        );
      })}
    </div>
  );
}

function baseName(p: string): string {
  return p.split("/").pop() ?? p;
}

interface NarrationState {
  status: "idle" | "loading" | "ready" | "error";
  data: FileNarration | null;
  error: string | null;
  fromCache: boolean;
}
const NARRATION_IDLE: NarrationState = { status: "idle", data: null, error: null, fromCache: false };

function FileInspector({
  file, outgoing, incoming, wiresReady, owner, repo, branch, onClose, onSelectPath,
}: {
  file: FileNode | null;
  outgoing: FileEdge[];
  incoming: FileEdge[];
  wiresReady: boolean;
  owner: string | null;
  repo: string | null;
  branch: string;
  onClose: () => void;
  onSelectPath: (path: string) => void;
}) {
  const [narration, setNarration] = useState<NarrationState>(NARRATION_IDLE);

  // Reset narration whenever the selected file changes.
  useEffect(() => { setNarration(NARRATION_IDLE); }, [file?.path]);

  async function explain() {
    if (!file || !owner || !repo) return;
    setNarration({ status: "loading", data: null, error: null, fromCache: false });
    try {
      const res = await fetch("/api/repo/architecture/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo, branch, path: file.path }),
      });
      const json = (await res.json()) as { narration?: FileNarration; fromCache?: boolean; error?: string };
      if (!res.ok || !json.narration) {
        setNarration({ status: "error", data: null, error: json.error ?? `Failed (${res.status})`, fromCache: false });
        return;
      }
      setNarration({ status: "ready", data: json.narration, error: null, fromCache: !!json.fromCache });
    } catch (err) {
      setNarration({ status: "error", data: null, error: err instanceof Error ? err.message : "Failed", fromCache: false });
    }
  }

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 xl:sticky xl:top-6 xl:self-start">
      {!file ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-400">File inspector</p>
          <p className="text-[11px] leading-relaxed text-zinc-600">
            Click any file to see its path, role, and — once call wires are loaded — what it
            calls and what calls it. Tap <span className="text-zinc-400">Explain</span> for a
            plain-English summary.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileCode className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <span className="text-sm font-semibold text-zinc-200">{file.name}</span>
            </div>
            <CloseButton onClose={onClose} />
          </div>
          <div className="flex flex-wrap gap-2 text-[10px]">
            <Pill>{FILE_LAYER_LABEL[file.layer]}</Pill>
            <Pill className={FILE_ROLE_COLOR[file.role] ?? undefined}>{file.role}</Pill>
            {file.size > 0 && <Pill>{formatBytes(file.size)}</Pill>}
          </div>
          <div className="space-y-1.5 border-t border-white/[0.04] pt-2.5">
            <p className="text-[9px] font-medium uppercase tracking-[0.16em] text-zinc-700">Path</p>
            <p className="break-all font-mono text-[10px] text-zinc-500">{file.path}</p>
          </div>

          {/* ── Atlas narration (Stage 3, paid) ─────────────── */}
          <div className="space-y-2 border-t border-white/[0.04] pt-2.5">
            <p className="text-[9px] font-medium uppercase tracking-[0.16em] text-zinc-700">Atlas narration</p>

            {narration.status === "idle" && (
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={explain}
                  disabled={!owner || !repo}
                  className="flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/[0.08] px-2.5 py-1 text-[10px] text-violet-300 transition-colors hover:border-violet-500/50 hover:text-violet-200 disabled:opacity-40"
                >
                  <Sparkles className="h-3 w-3" /> Explain this file
                </button>
                <p className="text-[9px] text-zinc-700">Uses 1 paid OpenRouter call · cached after.</p>
              </div>
            )}
            {narration.status === "loading" && (
              <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                <Loader2 className="h-3 w-3 animate-spin" /> Reading &amp; explaining…
              </span>
            )}
            {narration.status === "error" && (
              <div className="space-y-1">
                <p className="text-[10px] text-rose-400/70">{narration.error}</p>
                <button type="button" onClick={explain} className="text-[10px] text-zinc-500 underline hover:text-zinc-300">
                  Try again
                </button>
              </div>
            )}
            {narration.status === "ready" && narration.data && (
              <div className="space-y-2">
                {narration.data.technicalRole && (
                  <p className="text-[11px] font-medium text-zinc-300">{narration.data.technicalRole}</p>
                )}
                {narration.data.plainEnglish && (
                  <p className="text-[11px] leading-relaxed text-zinc-500">{narration.data.plainEnglish}</p>
                )}
                {narration.data.notes.length > 0 && (
                  <ul className="space-y-1">
                    {narration.data.notes.map((n, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[10px] text-zinc-500">
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-violet-400/70" />
                        <span>{n}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[8px] text-zinc-700">
                  AI-generated{narration.fromCache ? " · cached" : ""} · verify against the source.
                </p>
              </div>
            )}
          </div>

          {wiresReady ? (
            <>
              <EdgeList
                title={`Calls / Sends To${outgoing.length ? ` (${outgoing.length})` : ""}`}
                edges={outgoing}
                peer={(e) => e.to}
                onSelectPath={onSelectPath}
                emptyText="Doesn't import any in-repo file."
              />
              <EdgeList
                title={`Called by${incoming.length ? ` (${incoming.length})` : ""}`}
                edges={incoming}
                peer={(e) => e.from}
                onSelectPath={onSelectPath}
                emptyText="No scanned file imports this one."
              />
            </>
          ) : (
            <p className="border-t border-white/[0.04] pt-2.5 text-[10px] text-zinc-600">
              Load call wires (top of the map) to see what this file calls and what calls it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function EdgeList({
  title, edges, peer, onSelectPath, emptyText,
}: {
  title: string;
  edges: FileEdge[];
  peer: (e: FileEdge) => string;
  onSelectPath: (path: string) => void;
  emptyText: string;
}) {
  return (
    <div className="space-y-1.5 border-t border-white/[0.04] pt-2.5">
      <p className="text-[9px] font-medium uppercase tracking-[0.16em] text-zinc-700">{title}</p>
      {edges.length === 0 ? (
        <p className="text-[10px] text-zinc-600">{emptyText}</p>
      ) : (
        <ul className="space-y-1">
          {edges.map((e) => {
            const path = peer(e);
            const ev = e.evidence[0];
            return (
              <li key={`${e.from}>${e.to}`}>
                <button
                  type="button"
                  onClick={() => onSelectPath(path)}
                  className="group w-full rounded-md px-1.5 py-1 text-left hover:bg-white/[0.03]"
                  title={path}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={cn(
                      "h-1 w-1 shrink-0 rounded-full",
                      e.confidence === "confirmed" ? "bg-emerald-400" : "bg-amber-400"
                    )} />
                    <span className="truncate text-[10px] text-zinc-400 group-hover:text-zinc-200">
                      {baseName(path)}
                    </span>
                  </span>
                  {ev && (
                    <span className="ml-2.5 block truncate font-mono text-[9px] text-zinc-700">
                      L{ev.line} · {ev.raw}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Legend ───────────────────────────────────────────────────

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-2 py-1 text-[9px] text-zinc-600">
      <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> confirmed</span>
      <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> inferred</span>
      <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-zinc-500" /> speculative</span>
      <span className="text-zinc-800">|</span>
      <span className="flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#a1a1aa" strokeWidth="1.75" /></svg> solid = confirmed</span>
      <span className="flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#a1a1aa" strokeWidth="1.75" strokeDasharray="6 4" /></svg> dashed = inferred</span>
      <span className="text-zinc-800">|</span>
      <span className="flex items-center gap-1.5"><span className="inline-block h-[2px] w-4 bg-[#6366f1]" /> depends-on</span>
      <span className="flex items-center gap-1.5"><span className="inline-block h-[2px] w-4 bg-[#22d3ee]" /> data-flow</span>
    </div>
  );
}

// ─── Inspector ────────────────────────────────────────────────

function Inspector({
  node,
  edge,
  onClose,
}: {
  node: SystemNode | null;
  edge: SystemEdge | null;
  onClose: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 xl:sticky xl:top-6 xl:self-start">
      {!node && !edge && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-400">Evidence inspector</p>
          <p className="text-[11px] leading-relaxed text-zinc-600">
            Click a <span className="text-zinc-400">system</span> to see its evidence paths and
            details, or an <span className="text-zinc-400">edge</span> to see why the relationship
            was inferred.
          </p>
        </div>
      )}

      {node && (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={cn("h-2 w-2 rounded-full", CONFIDENCE_DOT[node.confidence])} />
              <span className="text-sm font-semibold text-zinc-200">{node.name}</span>
            </div>
            <CloseButton onClose={onClose} />
          </div>

          <div className="flex flex-wrap gap-2 text-[10px]">
            <Pill>{TIER_LABEL[node.tier]}</Pill>
            <Pill className={CONFIDENCE_TEXT[node.confidence]}>{node.confidence}</Pill>
            <Pill>
              {node.fileCount > 0 ? `${node.fileCount} file${node.fileCount === 1 ? "" : "s"}` : "dependency-only"}
            </Pill>
          </div>

          {node.dependencies.length > 0 && (
            <Section title="Backing packages">
              <div className="flex flex-wrap gap-1.5">
                {node.dependencies.map((d) => (
                  <code key={d} className="rounded-md border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 text-[10px] text-zinc-400">
                    {d}
                  </code>
                ))}
              </div>
            </Section>
          )}

          <Section title={`Evidence paths${node.evidencePaths.length ? ` (${node.evidencePaths.length})` : ""}`}>
            {node.evidencePaths.length > 0 ? (
              <ul className="space-y-1">
                {node.evidencePaths.map((p) => (
                  <li key={p} className="flex items-start gap-1.5 font-mono text-[10px] text-zinc-500">
                    <FileCode className="mt-0.5 h-2.5 w-2.5 shrink-0 text-zinc-700" />
                    <span className="break-all">{p}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[10px] text-zinc-600">
                Discovered from a declared dependency — no source path yet.
              </p>
            )}
          </Section>
        </div>
      )}

      {edge && (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-200">
              <span className="truncate">{edge.from}</span>
              <GitBranch className="h-3 w-3 shrink-0 rotate-90 text-zinc-600" />
              <span className="truncate">{edge.to}</span>
            </div>
            <CloseButton onClose={onClose} />
          </div>

          <div className="flex flex-wrap gap-2 text-[10px]">
            <Pill>{edge.type}</Pill>
            <Pill className={CONFIDENCE_TEXT[edge.confidence]}>{edge.confidence}</Pill>
            <Pill>weight {edge.weight}</Pill>
          </div>

          <Section title="Inference source">
            <p className="text-[10px] leading-relaxed text-zinc-500">
              {edge.evidence.some((e) => e.includes("via `"))
                ? "External dependency declared in package.json. The precise source file is pinned when import scanning (Increment C) runs."
                : "Path and structure signals."}
            </p>
          </Section>

          <Section title={`Evidence${edge.evidence.length ? ` (${edge.evidence.length})` : ""}`}>
            {edge.evidence.length > 0 ? (
              <ul className="space-y-1">
                {edge.evidence.map((e, i) => (
                  <li key={i} className="text-[10px] text-zinc-500">
                    {e.replace(/`/g, "")}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[10px] text-zinc-600">No evidence recorded.</p>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

// ─── Small UI atoms ───────────────────────────────────────────

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-zinc-600 hover:bg-white/[0.05] hover:text-zinc-300"
      aria-label="Clear selection"
    >
      <X className="h-3 w-3" />
    </button>
  );
}

function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("rounded-full border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 text-zinc-400", className)}>
      {children}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 border-t border-white/[0.04] pt-2.5">
      <p className="text-[9px] font-medium uppercase tracking-[0.16em] text-zinc-700">{title}</p>
      {children}
    </div>
  );
}
