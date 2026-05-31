"use client";

/**
 * useSessions — fetches the current user's chat session list.
 * Used by the Sessions page to list past conversations.
 */

import { useEffect, useState } from "react";

export interface SessionSummary {
  id:           string;
  repoFullName: string;
  repoName:     string;
  repoOwner:    string;
  lastMessage:  string;
  messageCount: number;
  updatedAt:    string; // ISO
}

interface State {
  status:   "loading" | "ready" | "error";
  sessions: SessionSummary[];
  error:    string | null;
}

export function useSessions(): State & { refetch: () => void } {
  const [state, setState] = useState<State>({ status: "loading", sessions: [], error: null });
  const [tick, setTick]   = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: "loading" }));

    fetch("/api/sessions")
      .then((r) => r.json() as Promise<{ sessions?: SessionSummary[]; error?: string }>)
      .then((data) => {
        if (cancelled) return;
        setState({ status: "ready", sessions: data.sessions ?? [], error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: "error", sessions: [], error: err instanceof Error ? err.message : "Failed to load sessions" });
      });

    return () => { cancelled = true; };
  }, [tick]);

  return { ...state, refetch: () => setTick((t) => t + 1) };
}

/**
 * Load the full message history for a single session.
 * Called when the user taps "Resume" from the sessions list.
 */
export async function loadSessionMessages(id: string): Promise<unknown[] | null> {
  try {
    const res  = await fetch(`/api/sessions/${id}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { session?: { messages?: unknown[] } };
    return data.session?.messages ?? null;
  } catch {
    return null;
  }
}

/**
 * Delete a session.
 */
export async function deleteSession(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/sessions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}
