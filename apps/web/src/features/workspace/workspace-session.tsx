"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useActiveRepository }             from "@/contexts/repository-context";
import type { GitHubRepositorySummary }    from "@/services/github/types";
import { extractReferenceUrl }             from "@/services/reference/url-parser";
import type { AgentResult, CipherFinding } from "@/types/intelligence";

import type { CipherAgentState }            from "./agent-activity-panel";
import { CIPHER_IDLE }                      from "./agent-activity-panel";
import { VHashSurface }                     from "./vhash-surface";

// ─── Message types ────────────────────────────────────────

export interface SystemMessage {
  id:   string;
  role: "system";
  text: string;
  ts:   number;
}

export interface UserMessage {
  id:      string;
  role:    "user";
  content: string;
  ts:      number;
}

export type StreamState = "thinking" | "streaming" | "complete" | "error";

export interface AssistantMessage {
  id:          string;
  role:        "assistant";
  content:     string;
  isStreaming: boolean;
  streamState: StreamState;
  ts:          number;
}

export interface VHashSection {
  label?:  string;
  body:    string;
  signal?: "info" | "ok" | "warn" | "critical";
  items?:  string[];
}

export interface VHashMessage {
  id:        string;
  role:      "vhash";
  briefType: "prose" | "briefing" | "analysis" | "recommendation";
  sections:  VHashSection[];
  ts:        number;
}

export interface CipherMessage {
  id:         string;
  role:       "cipher";
  filePath:   string;
  findings:   CipherFinding[];
  blobSHA:    string;
  wasDeduped: boolean;
  ts:         number;
}

export type SessionMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | VHashMessage
  | CipherMessage;

// ─── Helpers ─────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

function buildOpeningBriefing(repo: GitHubRepositorySummary): VHashMessage {
  const lang = repo.language ?? "unknown stack";
  let body: string;
  if (repo.openIssues > 10) {
    body = `Connected to ${repo.name}. Stack: ${lang}. ${repo.openIssues} open issues in the tracker — worth a pass before new feature work. What are we building?`;
  } else if (repo.openIssues > 0) {
    body = `Connected to ${repo.name}. Stack: ${lang}. ${repo.openIssues} open issue${
      repo.openIssues === 1 ? "" : "s"
    } open. What are we building?`;
  } else {
    body = `Connected to ${repo.name}. Stack: ${lang}. Ask me anything about the architecture, or describe what you want to implement.`;
  }
  return {
    id:        "opening",
    role:      "vhash",
    briefType: "prose",
    sections:  [{ body, signal: "ok" }],
    ts:        Date.now()
  };
}

function buildConversationHistory(
  messages: SessionMessage[]
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter((m): m is UserMessage | AssistantMessage =>
      m.role === "user" || m.role === "assistant"
    )
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
    .slice(-8);
}

/**
 * Detect the first file-like path in a block of text.
 *
 * Matches paths with at least one directory separator, covering:
 *   - Backtick-wrapped:  `src/auth.ts`
 *   - Quoted:            "lib/utils.tsx"
 *   - Inline:            components/Button.tsx, app/api/users/route.ts
 *   - Bold markdown:     **src/middleware.ts**
 *
 * Does NOT match bare version numbers (v1.2/x) because the extension
 * requirement (.ts, .tsx, etc.) acts as a hard filter.
 */
function detectFilePath(text: string): string | null {
  // Accepts any leading whitespace or punctuation including backticks and asterisks
  const RE =
    /(?:^|[\s`'"(*,])(([\w][\w.\-]*(?:\/|\\)[\w.\-/\\]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|cs|rb|php|vue|svelte|yaml|yml|json|env\.example)))\b/gi;
  const match = RE.exec(text);
  return match?.[1]?.replace(/\\/g, "/") ?? null;
}

// ─── Component ───────────────────────────────────────────

export function WorkspaceSession({
  onOrchestrationChange,
  onCipherStateChange,
}: {
  onOrchestrationChange?: (orchestrating: boolean) => void;
  onCipherStateChange?:   (state: CipherAgentState) => void;
} = {}) {
  const { activeRepository } = useActiveRepository();

  const [messages, setMessages]   = useState<SessionMessage[]>(() =>
    activeRepository ? [buildOpeningBriefing(activeRepository)] : []
  );
  const [isOrchestrating,  setIsOrchestrating]  = useState(false);
  const [isReferenceMode,  setIsReferenceMode]   = useState(false);
  const [cipherState,      setCipherStateLocal]  = useState<CipherAgentState>(CIPHER_IDLE);

  const mountedRef             = useRef(true);
  const readerRef              = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const abortRef               = useRef<AbortController | null>(null);
  const cipherStateRef         = useRef<CipherAgentState>(CIPHER_IDLE);
  const processedForCipherRef  = useRef(new Set<string>());

  // Stable refs for callbacks so they never go stale in closures
  const onOrchestrationChangeRef = useRef(onOrchestrationChange);
  const onCipherStateChangeRef   = useRef(onCipherStateChange);
  useEffect(() => { onOrchestrationChangeRef.current = onOrchestrationChange; }, [onOrchestrationChange]);
  useEffect(() => { onCipherStateChangeRef.current   = onCipherStateChange;   }, [onCipherStateChange]);

  // Keep cipherStateRef in sync
  useEffect(() => { cipherStateRef.current = cipherState; }, [cipherState]);

  // Propagate orchestrating state to parent (AgentTeamPanel)
  useEffect(() => {
    onOrchestrationChangeRef.current?.(isOrchestrating);
  }, [isOrchestrating]);

  // Rebuild opening briefing when repository changes
  useEffect(() => {
    if (activeRepository) {
      setMessages([buildOpeningBriefing(activeRepository)]);
      processedForCipherRef.current.clear();
      setCipherState(CIPHER_IDLE);
    }
  }, [activeRepository?.fullName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      readerRef.current?.cancel().catch(() => null);
      abortRef.current?.abort();
    };
  }, []);

  // ── Cipher state setter (local + notify parent) ────────
  function setCipherState(next: CipherAgentState) {
    setCipherStateLocal(next);
    cipherStateRef.current = next;
    onCipherStateChangeRef.current?.(next);
  }

  // ── Core Cipher trigger ───────────────────────────────
  const triggerCipher = useCallback(async (filePath: string) => {
    if (!activeRepository) return;
    // Don't interrupt if already working
    if (cipherStateRef.current.status !== "idle") return;

    const [owner, repo] = activeRepository.fullName.split("/");
    if (!owner || !repo) return;

    function setC(next: CipherAgentState) {
      setCipherStateLocal(next);
      cipherStateRef.current = next;
      onCipherStateChangeRef.current?.(next);
    }

    setC({ status: "fetching", file: filePath, findingsCount: 0, error: null });

    try {
      setC({ status: "analyzing", file: filePath, findingsCount: 0, error: null });

      const res = await fetch("/api/repo/analyze-file", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ owner, repo, filePath }),
      });

      const data = (await res.json()) as Record<string, unknown>;
      if (!mountedRef.current) return;

      if (!res.ok) {
        if (res.status === 404) {
          console.log(`[cipher] not_in_repo path=${filePath}`);
          setC({ status: "error", file: filePath, findingsCount: 0, error: "Not in this repo" });
          setTimeout(() => { if (mountedRef.current) setC(CIPHER_IDLE); }, 3_000);
          return;
        }
        if (res.status === 503) {
          setC({ status: "error", file: filePath, findingsCount: 0, error: "No AI key — check Settings" });
          return;
        }
        const errMsg = typeof data.error === "string" ? data.error : "Analysis failed";
        console.warn(`[cipher] analyze_failed status=${res.status} msg=${errMsg}`);
        setC({ status: "error", file: filePath, findingsCount: 0, error: errMsg });
        return;
      }

      const result = data as unknown as AgentResult;

      // Inject findings card into conversation
      const cipherMsg: CipherMessage = {
        id:         uid(),
        role:       "cipher",
        filePath:   result.filePath,
        findings:   result.findings,
        blobSHA:    result.blobSHA,
        wasDeduped: result.wasDeduped,
        ts:         Date.now(),
      };
      setMessages((prev) => [...prev, cipherMsg]);

      setC({
        status:        "done",
        file:          filePath,
        findingsCount: result.findings.length,
        error:         null,
      });

      // Reset panel to idle after 8s
      setTimeout(() => { if (mountedRef.current) setC(CIPHER_IDLE); }, 8_000);

    } catch (err) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : "Analysis failed";
      console.error(`[cipher] trigger_error file=${filePath}`, err);
      setCipherStateLocal({ status: "error", file: filePath, findingsCount: 0, error: msg });
      onCipherStateChangeRef.current?.({ status: "error", file: filePath, findingsCount: 0, error: msg });
    }
  }, [activeRepository]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-trigger Cipher from V# responses ─────────────
  // When V# finishes streaming and its response contains a file path,
  // Cipher activates to analyze that file automatically.
  useEffect(() => {
    if (!activeRepository) return;

    // Walk backward through messages to find the latest completed assistant message
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) break;

      // Stop scanning at non-assistant messages (user, vhash, cipher, system)
      if (msg.role !== "assistant") break;

      const aMsg = msg as AssistantMessage;

      // Not done streaming yet — wait
      if (aMsg.streamState !== "complete") return;

      // Already processed this message
      if (processedForCipherRef.current.has(aMsg.id)) return;

      // Mark as processed so we don't re-fire
      processedForCipherRef.current.add(aMsg.id);

      const filePath = detectFilePath(aMsg.content);
      if (!filePath) return;

      console.log(`[cipher] vhash_response_file path=${filePath}`);

      // Short delay so V# render settles before Cipher panel activates
      setTimeout(() => {
        if (mountedRef.current) void triggerCipher(filePath);
      }, 700);

      return;
    }
  }, [messages, activeRepository, triggerCipher]);

  const handleDirective = useCallback(
    async (text: string) => {
      if (!text.trim() || isOrchestrating || !activeRepository) return;

      // ── File path in user message → trigger Cipher ──────
      const detectedFile = detectFilePath(text.trim());
      if (detectedFile) {
        console.log(`[cipher] user_msg_file path=${detectedFile}`);
        void triggerCipher(detectedFile);
      }

      // ── User message ─────────────────────────────────────
      const referenceUrl = extractReferenceUrl(text.trim()) ?? undefined;
      const userMsg: UserMessage = {
        id:      uid(),
        role:    "user",
        content: text.trim(),
        ts:      Date.now()
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsOrchestrating(true);
      setIsReferenceMode(!!referenceUrl);

      // ── V# streaming placeholder ──────────────────────────
      const assistantId = uid();
      setMessages((prev) => [
        ...prev,
        {
          id:          assistantId,
          role:        "assistant",
          content:     "",
          isStreaming: true,
          streamState: "thinking",
          ts:          Date.now()
        } satisfies AssistantMessage
      ]);

      const abort = new AbortController();
      abortRef.current = abort;
      const timeoutId = setTimeout(() => abort.abort("timeout"), 30_000);

      try {
        const history  = buildConversationHistory(messages);
        const response = await fetch("/api/orchestrate", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          signal:  abort.signal,
          body:    JSON.stringify({
            message: text.trim(),
            history,
            referenceUrl,
            repositoryContext: {
              fullName:   activeRepository.fullName,
              name:       activeRepository.name,
              language:   activeRepository.language ?? null,
              forks:      activeRepository.forks,
              openIssues: activeRepository.openIssues
            }
          })
        });

        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

        const reader  = response.body.getReader();
        readerRef.current = reader;
        const decoder = new TextDecoder();
        let accumulated      = "";
        let chunkCount       = 0;
        let flushCount       = 0;
        let hasStartedStream = false;
        let pendingBuffer    = "";

        function commitBuffer(trigger: string) {
          if (!pendingBuffer.length || !mountedRef.current) return;
          const flushedLen  = pendingBuffer.length;
          accumulated      += pendingBuffer;
          pendingBuffer     = "";
          flushCount++;
          const snap = accumulated;

          if (!hasStartedStream) {
            hasStartedStream = true;
            console.log(`[stream-ui] first_flush trigger=${trigger} chars=${flushedLen}`);
          }

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId && m.role === "assistant"
                ? { ...(m as AssistantMessage), content: snap, streamState: "streaming" as const }
                : m
            )
          );
        }

        while (true) {
          let readResult: ReadableStreamReadResult<Uint8Array>;
          try { readResult = await reader.read(); }
          catch (readErr) { throw readErr; }

          const { done, value } = readResult;
          if (done) { commitBuffer("stream_end"); break; }
          if (!mountedRef.current) break;
          if (!value || value.length === 0) continue;

          const decoded = decoder.decode(value, { stream: true });
          chunkCount++;
          if (!decoded.length) continue;

          pendingBuffer += decoded;

          const trigger =
            (!hasStartedStream && pendingBuffer.length >= 16) ? "first_token" :
            pendingBuffer.length >= 32                         ? "size"        :
            pendingBuffer.includes("\n")                       ? "newline"     :
            /[.!?]\s/.test(pendingBuffer)                      ? "sentence"    :
            null;

          if (trigger) commitBuffer(trigger);
        }

        console.log(`[stream-ui] complete chunks=${chunkCount} flushes=${flushCount} chars=${accumulated.length}`);

        if (mountedRef.current) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId && m.role === "assistant"
                ? { ...(m as AssistantMessage), isStreaming: false, streamState: "complete" }
                : m
            )
          );
        }
      } catch (err) {
        if (!mountedRef.current) return;
        const isAbort   = err instanceof DOMException && err.name === "AbortError";
        const isTimeout = isAbort && abort.signal.reason === "timeout";

        const errorText = isTimeout
          ? "Provider timeout exceeded. Try again or check Settings → AI Providers."
          : isAbort
          ? ""
          : err instanceof Error && err.message.startsWith("HTTP ")
          ? `Orchestration returned ${err.message}. Check Settings → AI Providers.`
          : "Streaming connection interrupted. Check Settings → AI Providers.";

        if (!isAbort || isTimeout) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId && m.role === "assistant"
                ? { ...(m as AssistantMessage), content: errorText, isStreaming: false, streamState: "error" }
                : m
            )
          );
        }
      } finally {
        clearTimeout(timeoutId);
        readerRef.current = null;
        abortRef.current  = null;
        if (mountedRef.current) {
          setIsOrchestrating(false);
          setIsReferenceMode(false);
        }
      }
    },
    [activeRepository, isOrchestrating, messages, triggerCipher]
  );

  return (
    <div className="h-full overflow-hidden rounded-2xl border border-white/[0.05]">
      <VHashSurface
        messages={messages}
        isOrchestrating={isOrchestrating}
        isReferenceMode={isReferenceMode}
        activeRepository={activeRepository}
        onDirective={handleDirective}
      />
    </div>
  );
}
