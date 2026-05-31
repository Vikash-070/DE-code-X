"use client";

/**
 * useSessionPersistence — auto-saves the workspace chat after each completed turn.
 *
 * Fires POST /api/sessions/save whenever:
 *   • A new assistant message reaches streamState === "complete"
 *   • The component unmounts with unsaved messages (beforeunload / cleanup)
 *
 * Debounced by 800ms so rapid streamed flushes don't spam the endpoint.
 * Save failures are silent (non-fatal) — the UX never blocks on persistence.
 */

import { useCallback, useEffect, useRef } from "react";

import type { GitHubRepositorySummary } from "@/services/github/types";
import type { SessionMessage }          from "@/features/workspace/workspace-session";

interface Options {
  messages:         SessionMessage[];
  activeRepository: GitHubRepositorySummary | null;
  isOrchestrating:  boolean;
}

export function useSessionPersistence({ messages, activeRepository, isOrchestrating }: Options) {
  const lastSavedCountRef = useRef(0);
  const debounceRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef        = useRef(false);

  const save = useCallback(async (msgs: SessionMessage[], repo: GitHubRepositorySummary) => {
    if (pendingRef.current) return; // don't stack saves
    pendingRef.current = true;
    try {
      const [repoOwner, repoName] = repo.fullName.split("/");
      await fetch("/api/sessions/save", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          repoFullName: repo.fullName,
          repoName:     repoName ?? repo.name,
          repoOwner:    repoOwner ?? "",
          messages:     msgs,
        }),
      });
      lastSavedCountRef.current = msgs.length;
    } catch {
      // Persist errors are silent — conversation is still usable in-session
    } finally {
      pendingRef.current = false;
    }
  }, []);

  // Save after each completed assistant turn (debounced).
  useEffect(() => {
    if (isOrchestrating || !activeRepository) return;

    const lastMsg = messages[messages.length - 1];
    const isNewComplete =
      lastMsg?.role === "assistant" &&
      (lastMsg as { streamState?: string }).streamState === "complete" &&
      messages.length > lastSavedCountRef.current;

    if (!isNewComplete) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void save(messages, activeRepository);
    }, 800);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [messages, isOrchestrating, activeRepository, save]);

  // Flush on unmount (navigation away / tab close).
  useEffect(() => {
    return () => {
      if (!activeRepository) return;
      if (messages.length <= lastSavedCountRef.current) return;
      // Best-effort synchronous save on unload — keepalive ensures delivery.
      const [repoOwner, repoName] = activeRepository.fullName.split("/");
      navigator.sendBeacon(
        "/api/sessions/save",
        JSON.stringify({
          repoFullName: activeRepository.fullName,
          repoName:     repoName ?? activeRepository.name,
          repoOwner:    repoOwner ?? "",
          messages,
        })
      );
    };
  }, [messages, activeRepository]); // eslint-disable-line react-hooks/exhaustive-deps
}
