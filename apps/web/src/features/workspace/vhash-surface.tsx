"use client";

import { memo, useEffect, useRef, useState } from "react";
import { ArrowUp, Code2, Loader2, Paperclip, X, FileText } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import type { GitHubRepositorySummary } from "@/services/github/types";
import { OPENROUTER_MODEL } from "@/server/ai/constants";
import { cn } from "@/lib/utils";
import type { CipherFinding } from "@/types/intelligence";

import type {
  AssistantMessage,
  AttachedDocument,
  CipherMessage,
  SessionMessage,
  StreamState,
  SystemMessage,
  UserMessage,
  VHashMessage,
  VHashSection
} from "./workspace-session";

// ─── Markdown renderer ────────────────────────────────────
// Handles: paragraphs, bullet/numbered lists, sub-headers,
// fenced code blocks (```lang\n...\n```), inline `code`, **bold**.

/** Render inline markup within a single line of text. */
function renderInline(text: string): React.ReactNode {
  const INLINE_RE = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/;
  if (!INLINE_RE.test(text)) return text; // fast path: no markup

  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
          return (
            <code key={i} className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[12.5px] text-emerald-300/80">
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return (
            <strong key={i} className="font-semibold text-zinc-100">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return part || null;
      })}
    </>
  );
}

function renderMarkdown(text: string): React.ReactNode[] {
  const normalised = text.replace(/\r\n/g, "\n");
  const nodes: React.ReactNode[] = [];
  let nodeKey = 0;

  // ── Step 1: Split out fenced code blocks ──────────────────
  // Process ``` blocks as discrete units so prose splitter never sees them.
  const CODE_FENCE_RE = /```(\w*)\n?([\s\S]*?)```/g;
  const segments: Array<{ type: "prose" | "code"; content: string; lang?: string }> = [];
  let lastIdx = 0;

  for (const match of normalised.matchAll(CODE_FENCE_RE)) {
    if ((match.index ?? 0) > lastIdx) {
      segments.push({ type: "prose", content: normalised.slice(lastIdx, match.index) });
    }
    segments.push({ type: "code", content: match[2] ?? "", lang: match[1]?.trim() });
    lastIdx = (match.index ?? 0) + match[0].length;
  }
  if (lastIdx < normalised.length) {
    segments.push({ type: "prose", content: normalised.slice(lastIdx) });
  }
  if (segments.length === 0) {
    segments.push({ type: "prose", content: normalised });
  }

  // ── Step 2: Render each segment ───────────────────────────
  for (const seg of segments) {
    if (seg.type === "code") {
      nodes.push(
        <pre key={nodeKey++} className="mt-3 overflow-x-auto rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3.5">
          {seg.lang && (
            <p className="mb-2 text-[10px] uppercase tracking-[0.15em] text-zinc-700">{seg.lang}</p>
          )}
          <code className="font-mono text-[12.5px] leading-6 text-zinc-300">
            {seg.content.trim()}
          </code>
        </pre>
      );
      continue;
    }

    // ── Prose blocks ─────────────────────────────────────────
    const blocks = seg.content.split(/\n{2,}/);
    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) continue;

      // Bullet list
      const bulletLines = lines.filter((l) => /^[*\-]\s+/.test(l));
      if (bulletLines.length > 0 && bulletLines.length === lines.length) {
        nodes.push(
          <ul key={nodeKey++} className="mt-2 space-y-1.5">
            {lines.map((line, li) => (
              <li key={li} className="flex items-start gap-3 text-sm leading-6 text-zinc-300">
                <span className="mt-[11px] h-[3px] w-[3px] shrink-0 rounded-full bg-zinc-700" />
                <span>{renderInline(line.replace(/^[*\-]\s+/, ""))}</span>
              </li>
            ))}
          </ul>
        );
        continue;
      }

      // Numbered list
      const numberedLines = lines.filter((l) => /^\d+\.\s+/.test(l));
      if (numberedLines.length > 0 && numberedLines.length === lines.length) {
        nodes.push(
          <ol key={nodeKey++} className="mt-2 space-y-1.5">
            {lines.map((line, li) => (
              <li key={li} className="flex items-start gap-3 text-sm leading-6 text-zinc-300">
                <span className="mt-0.5 shrink-0 font-mono text-xs text-zinc-600">
                  {li + 1}.
                </span>
                <span>{renderInline(line.replace(/^\d+\.\s+/, ""))}</span>
              </li>
            ))}
          </ol>
        );
        continue;
      }

      // Sub-header: single short line ending with ":"
      if (
        lines.length === 1 &&
        lines[0]!.endsWith(":") &&
        lines[0]!.length < 72 &&
        !/[.!?]/.test(lines[0]!.slice(0, -1))
      ) {
        nodes.push(
          <p key={nodeKey++} className="mt-5 text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-600">
            {lines[0]!.slice(0, -1)}
          </p>
        );
        continue;
      }

      // Paragraph
      nodes.push(
        <p key={nodeKey++} className="text-sm leading-7 text-zinc-300">
          {renderInline(lines.join(" "))}
        </p>
      );
    }
  }

  return nodes.length ? nodes : [
    <p key="empty" className="text-sm leading-7 text-zinc-300">{renderInline(text)}</p>
  ];
}

// ─── Message rows ─────────────────────────────────────────

// Static rows are memoized — they never re-render when only the
// streaming assistant message changes content.

const SystemRow = memo(function SystemRow({ msg }: { msg: SystemMessage }) {
  return (
    <div className="flex items-center gap-5 py-4">
      <div className="h-px flex-1 bg-white/[0.04]" />
      <span className="text-[10px] uppercase tracking-[0.22em] text-zinc-800">{msg.text}</span>
      <div className="h-px flex-1 bg-white/[0.04]" />
    </div>
  );
});

const UserRow = memo(function UserRow({ msg }: { msg: UserMessage }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
      className="py-3"
    >
      <p className="mb-1.5 text-[10px] uppercase tracking-[0.2em] text-zinc-700">you</p>
      <p className="text-sm leading-7 text-zinc-200">{msg.content}</p>
    </motion.div>
  );
});

// ─── Thinking state ───────────────────────────────────────
// These messages cycle while V# is preparing the first token.
// They reflect real work happening internally — not filler copy.

const THINKING_MESSAGES = [
  "Analyzing repository context…",
  "Mapping implementation boundaries…",
  "Evaluating architectural impact…",
  "Generating implementation strategy…"
] as const;

/** Thinking messages shown when a reference URL is being processed */
const REFERENCE_THINKING_MESSAGES = [
  "Analyzing reference…",
  "Extracting implementation intent…",
  "Evaluating compatibility…",
  "Mapping implementation boundaries…",
  "Generating feasibility assessment…"
] as const;

function AssistantRow({ msg, isReference = false }: { msg: AssistantMessage; isReference?: boolean }) {
  // Use explicit streamState — never infer from content being empty.
  // Transition: thinking → streaming → complete | error
  const state: StreamState = msg.streamState ?? (msg.isStreaming ? "thinking" : "complete");
  const isThinking  = state === "thinking";
  const isStreaming = state === "streaming";

  const thinkingPool = isReference ? REFERENCE_THINKING_MESSAGES : THINKING_MESSAGES;
  const [thinkingIdx, setThinkingIdx] = useState(0);

  useEffect(() => {
    if (!isThinking) {
      setThinkingIdx(0);
      return;
    }
    const id = setInterval(
      () => setThinkingIdx((i) => (i + 1) % thinkingPool.length),
      1800
    );
    return () => clearInterval(id);
  }, [isThinking, thinkingPool.length]);

  // ── Thinking state — cycle through status messages ────────
  if (isThinking) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="py-3"
      >
        <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-zinc-700">V#</p>
        <div className="border-l border-zinc-800/70 pl-5">
          <AnimatePresence mode="wait">
            <motion.p
              key={thinkingIdx}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.18 }}
              className="text-sm text-zinc-500"
            >
              {thinkingPool[thinkingIdx]}
              <span className="ml-1 animate-pulse text-zinc-400">▋</span>
            </motion.p>
          </AnimatePresence>
        </div>
      </motion.div>
    );
  }

  // ── Streaming — plain text only, no markdown parsing ────────
  // Markdown is expensive to parse on every flush. During streaming
  // we render raw text with a cursor; parse once on completion.
  if (isStreaming) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="py-3"
      >
        <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-zinc-700">V#</p>
        <div className="border-l border-zinc-800/70 pl-5">
          <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-300">
            {msg.content}
            <span className="ml-[1px] animate-pulse text-zinc-500">▋</span>
          </p>
        </div>
      </motion.div>
    );
  }

  // ── Error state ───────────────────────────────────────────
  if (state === "error") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="py-3"
      >
        <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-zinc-700">V#</p>
        <div className="border-l border-red-900/40 pl-5">
          <p className="text-sm leading-7 text-red-400/70">{msg.content}</p>
        </div>
      </motion.div>
    );
  }

  // ── Complete — parse and render markdown exactly once ────────
  const nodes = renderMarkdown(msg.content);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="py-3"
    >
      <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-zinc-700">V#</p>
      <div className="space-y-2 border-l border-zinc-800/70 pl-5">
        {nodes}
      </div>
    </motion.div>
  );
}

const SectionBlock = memo(function SectionBlock({ section, prose }: { section: VHashSection; prose: boolean }) {
  return (
    <div className="border-l border-zinc-800/70 pl-5">
      {!prose && section.label && (
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-600">
          {section.label}
        </p>
      )}
      <p className="text-sm leading-7 text-zinc-300">{section.body}</p>
      {section.items && section.items.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {section.items.map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-xs leading-5 text-zinc-400">
              <span className="mt-1.5 h-[3px] w-[3px] shrink-0 rounded-full bg-zinc-700" />
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

const VHashRow = memo(function VHashRow({ msg }: { msg: VHashMessage }) {
  const isProse = msg.briefType === "prose";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="py-3"
    >
      <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-zinc-700">V#</p>
      <div className="space-y-4">
        {msg.sections.map((section, i) => (
          <motion.div
            key={section.label ?? i}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: i * 0.07 }}
          >
            <SectionBlock section={section} prose={isProse} />
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
});

// ─── Cipher finding card ──────────────────────────────────

function FindingItem({ finding }: { finding: CipherFinding }) {
  const badgeStyle: Record<string, string> = {
    confirmed:   "bg-red-500/10 text-red-400/80 border-red-500/20",
    inferred:    "bg-amber-500/10 text-amber-400/80 border-amber-500/20",
    speculative: "bg-zinc-700/30 text-zinc-500 border-zinc-700/50",
  };
  const typeStyle: Record<string, string> = {
    "implementation":  "text-blue-400/60",
    "integrity":       "text-red-400/60",
    "pressure":        "text-amber-400/60",
    "dependency":      "text-purple-400/60",
    "security-signal": "text-red-500/80",
  };

  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn("text-[9px] font-medium uppercase tracking-[0.1em]", typeStyle[finding.type] ?? "text-zinc-600")}>
          {finding.type}
        </span>
        <span
          className={cn(
            "rounded border px-1.5 py-px text-[9px]",
            badgeStyle[finding.confidence] ?? badgeStyle["speculative"]!
          )}
        >
          {finding.confidence}
        </span>
        {finding.evidenceLines && (
          <span className="font-mono text-[9px] text-zinc-700">
            L{finding.evidenceLines.start}
            {finding.evidenceLines.end !== finding.evidenceLines.start
              ? `–${finding.evidenceLines.end}`
              : ""}
          </span>
        )}
        {finding.pressureLevel && (
          <span className={cn(
            "text-[9px]",
            finding.pressureLevel === "high"   ? "text-red-400/60"    :
            finding.pressureLevel === "medium" ? "text-amber-400/60"  :
                                                  "text-zinc-600"
          )}>
            {finding.pressureLevel} pressure
          </span>
        )}
      </div>
      <p className="text-[11px] font-medium leading-4 text-zinc-400">{finding.title}</p>
      <p className="text-[10px] leading-4 text-zinc-600">{finding.agentReasoning}</p>
    </div>
  );
}

const CipherRow = memo(function CipherRow({ msg }: { msg: CipherMessage }) {
  const shortPath = msg.filePath.split("/").pop() ?? msg.filePath;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="py-3"
    >
      {/* Header row */}
      <div className="mb-2 flex items-center gap-2">
        <Code2 className="h-2.5 w-2.5 shrink-0 text-purple-400/50" />
        <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-700">Cipher</p>
        <span className="text-[10px] text-zinc-800">·</span>
        <span className="font-mono text-[10px] text-zinc-600">{shortPath}</span>
        {msg.wasDeduped && (
          <span className="ml-auto rounded border border-zinc-800/60 bg-zinc-900/40 px-1.5 py-px text-[9px] text-zinc-700">
            cached
          </span>
        )}
      </div>

      {/* Findings list */}
      <div className="border-l border-purple-900/30 pl-5">
        {msg.findings.length === 0 ? (
          <p className="text-[11px] text-zinc-700">No notable findings in this file.</p>
        ) : (
          <div className="space-y-3">
            {msg.findings.slice(0, 6).map((f) => (
              <FindingItem key={f.id} finding={f} />
            ))}
            {msg.findings.length > 6 && (
              <p className="text-[10px] text-zinc-700">
                +{msg.findings.length - 6} more findings
              </p>
            )}
          </div>
        )}

        {/* File path footer */}
        <p className="mt-3 truncate font-mono text-[9px] text-zinc-800">{msg.filePath}</p>
      </div>
    </motion.div>
  );
});

// ─── Input bar ────────────────────────────────────────────

function WorkspaceInput({
  onSubmit,
  disabled,
  initialValue = "",
  suggestions = [],
}: {
  onSubmit:      (text: string, doc?: AttachedDocument) => void;
  disabled:      boolean;
  /** Pre-fills the input — used when navigating from Architecture Workspace via "Ask V#". */
  initialValue?: string;
  /**
   * Clickable suggestion chips rendered above the input. Used for gap-analysis
   * discoverability (starter chips) and gap-response follow-ups. Clicking a chip
   * submits it immediately. Empty array → no chip row rendered.
   */
  suggestions?: string[];
}) {
  const [value, setValue] = useState(initialValue);
  const [attached, setAttached] = useState<AttachedDocument | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync when initialValue changes (e.g. after URL param is read on first render)
  const prevInitial = useRef(initialValue);
  useEffect(() => {
    if (initialValue && initialValue !== prevInitial.current) {
      setValue(initialValue);
      prevInitial.current = initialValue;
    }
  }, [initialValue]);

  async function handleFile(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/repo/reference/document", { method: "POST", body: fd });
      const json = (await res.json()) as { text?: string; title?: string; error?: string };
      if (!res.ok || !json.text) {
        setUploadError(json.error ?? "Couldn't read that file.");
        return;
      }
      setAttached({ text: json.text, title: json.title ?? file.name });
    } catch {
      setUploadError("Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit() {
    if (disabled || uploading) return;
    const trimmed = value.trim();
    // Allow sending with just an attached document (default the prompt).
    if (!trimmed && !attached) return;
    if (trimmed.length < 2 && !attached) return;
    const text = trimmed || "Read this document and tell me how to apply it to my repo — what it would improve and what it touches.";
    onSubmit(text, attached ?? undefined);
    setValue("");
    setAttached(null);
    setUploadError(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const canSubmit = !disabled && !uploading && (value.trim().length >= 2 || !!attached);

  return (
    <div className="shrink-0 px-8 pb-6 pt-4">
      {/* Suggestion chips — gap-analysis discoverability + follow-ups */}
      {suggestions.length > 0 && !disabled && (
        <div className="mb-2.5 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSubmit(s)}
              className="rounded-full border border-white/[0.07] bg-white/[0.02] px-3 py-1.5 text-[11px] text-zinc-400 transition-colors duration-150 hover:border-white/[0.16] hover:text-zinc-200"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Attached document chip / upload error */}
      {attached && (
        <div className="mb-2 inline-flex max-w-full items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-2.5 py-1.5">
          <FileText className="h-3 w-3 shrink-0 text-emerald-400/80" />
          <span className="truncate text-[11px] text-zinc-300">{attached.title}</span>
          <button
            type="button"
            onClick={() => setAttached(null)}
            className="grid h-4 w-4 shrink-0 place-items-center rounded text-zinc-500 hover:text-zinc-200"
            aria-label="Remove attachment"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      {uploadError && <p className="mb-2 px-1 text-[10px] text-amber-500/70">{uploadError}</p>}

      <div
        className={cn(
          "flex items-end gap-3 rounded-2xl border bg-white/[0.02] px-5 py-3.5 transition-colors duration-200",
          disabled
            ? "border-white/[0.04]"
            : value.trim().length > 0 || attached
              ? "border-white/[0.12]"
              : "border-white/[0.06] focus-within:border-white/[0.16]"
        )}
      >
        {/* Attach document */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.markdown,.mdx,.csv,.tsv,.json,.log,.yml,.yaml,.rst,text/*,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = ""; // allow re-selecting the same file
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
          title="Attach a document"
          className="mb-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/[0.06] text-zinc-500 transition-colors hover:border-white/20 hover:text-zinc-300 disabled:opacity-40"
        >
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
        </button>

        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          placeholder={attached ? "Add a question, or just send to map this document to your repo…" : "Ask about the architecture, paste a link, or attach a document…"}
          className="flex-1 resize-none bg-transparent text-sm leading-6 text-zinc-200 placeholder-zinc-600 outline-none disabled:opacity-40"
          style={{ maxHeight: "160px", overflowY: "auto" }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={cn(
            "mb-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border transition-all duration-200",
            !canSubmit
              ? "border-white/[0.04] text-zinc-800"
              : "border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-200"
          )}
        >
          {disabled ? (
            <Loader2 className="h-3 w-3 animate-spin text-zinc-500" />
          ) : (
            <ArrowUp className="h-3 w-3" />
          )}
        </button>
      </div>
      <p className="mt-2 px-1 text-[10px] text-zinc-800">
        ↵ to send  ·  Shift+↵ for new line  ·  📎 .txt / .md / .csv / .json
      </p>
    </div>
  );
}

// ─── Provider health ──────────────────────────────────────

type ProviderHealth = "loading" | "connected" | "missing";

function useProviderStatus(): { health: ProviderHealth; model: string } {
  const [health, setHealth] = useState<ProviderHealth>("loading");
  const [model, setModel]   = useState<string>(OPENROUTER_MODEL);

  useEffect(() => {
    fetch("/api/orchestrate/status")
      .then((r) => r.json() as Promise<{ hasKey: boolean; model: string }>)
      .then((data) => {
        setHealth(data.hasKey ? "connected" : "missing");
        setModel(data.model ?? OPENROUTER_MODEL);
      })
      .catch(() => setHealth("missing"));
  }, []);

  return { health, model };
}

function ProviderStatusDot({ health }: { health: ProviderHealth }) {
  if (health === "loading") {
    return <span className="h-1.5 w-1.5 rounded-full bg-zinc-700 animate-pulse" />;
  }
  if (health === "connected") {
    return <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/60" />;
  }
  // missing
  return <span className="h-1.5 w-1.5 rounded-full bg-amber-500/50" />;
}

// ─── Main surface ─────────────────────────────────────────

export function VHashSurface({
  messages,
  isOrchestrating,
  isReferenceMode = false,
  activeRepository,
  onDirective,
  prefillMessage,
  suggestions = [],
}: {
  messages:          SessionMessage[];
  isOrchestrating:   boolean;
  /** True when the active orchestration request includes a reference URL */
  isReferenceMode?:  boolean;
  activeRepository:  GitHubRepositorySummary | null;
  onDirective:       (text: string, doc?: AttachedDocument) => void;
  /** Pre-fills the chat input. Set when navigating from Architecture Workspace via "Ask V#". */
  prefillMessage?:   string;
  /** Gap-analysis suggestion chips shown above the input. */
  suggestions?:      string[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { health, model } = useProviderStatus();
  const [owner, repoName] = activeRepository
    ? activeRepository.fullName.split("/")
    : [];

  // Auto-scroll when near bottom or streaming
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const lastMsg = messages[messages.length - 1];
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    const isStreaming =
      lastMsg?.role === "assistant" && (lastMsg as AssistantMessage).isStreaming;
    if (isNearBottom || isStreaming) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Context strip — repo + provider health */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.04] px-8 py-3">
        {/* Repository */}
        {activeRepository ? (
          <>
            <span className="text-xs text-zinc-600">{owner}/</span>
            <span className="text-xs text-zinc-500">{repoName}</span>
            {activeRepository.language && (
              <>
                <span className="text-zinc-800">·</span>
                <span className="text-xs text-zinc-600">{activeRepository.language}</span>
              </>
            )}
          </>
        ) : (
          <span className="text-xs text-zinc-700">No repository selected</span>
        )}

        {/* Spacer */}
        <span className="flex-1" />

        {/* Orchestrating indicator */}
        {isOrchestrating && (
          <span className="flex items-center gap-1.5">
            <span className="h-1 w-1 animate-pulse rounded-full bg-zinc-600" />
            <span className="text-[10px] text-zinc-500">thinking</span>
          </span>
        )}

        {/* Provider health */}
        {!isOrchestrating && (
          <span className="flex items-center gap-1.5">
            <ProviderStatusDot health={health} />
            <span className="text-[10px] text-zinc-700">
              {health === "connected"
                ? `OpenRouter · ${model.split("/").pop()}`
                : health === "missing"
                ? <a href="/dashboard/settings" className="text-amber-500/60 hover:text-amber-400/80 transition-colors">Configure API key</a>
                : "OpenRouter"}
            </span>
          </span>
        )}
      </div>

      {/* Message stream */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-8 pt-6"
        style={{ scrollbarWidth: "none" }}
      >
        <div className="mx-auto max-w-2xl">
          <AnimatePresence initial={false}>
            {messages.map((msg, idx) => {
              if (msg.role === "system")    return <SystemRow    key={msg.id} msg={msg} />;
              if (msg.role === "user")      return <UserRow      key={msg.id} msg={msg} />;
              if (msg.role === "cipher")    return <CipherRow    key={msg.id} msg={msg} />;
              if (msg.role === "assistant") {
                // isReferenceMode only applies to the last (currently streaming) message
                const isLastMsg = idx === messages.length - 1;
                return (
                  <AssistantRow
                    key={msg.id}
                    msg={msg}
                    isReference={isReferenceMode && isLastMsg}
                  />
                );
              }
              return <VHashRow key={msg.id} msg={msg} />;
            })}
          </AnimatePresence>

          {/* Scroll anchor */}
          <div className="h-4" />
        </div>
      </div>

      <WorkspaceInput onSubmit={onDirective} disabled={isOrchestrating} initialValue={prefillMessage} suggestions={suggestions} />
    </div>
  );
}
