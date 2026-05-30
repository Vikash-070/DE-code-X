"use client";

/**
 * useFileWires — lazy loader for the Stage 2 import wires.
 *
 * The wires scan reads file contents (bounded), so it is NOT fetched with the
 * base architecture load. This hook fires only once `enabled` is true (the user
 * opted into the wired view), and resets when the active repository changes.
 */

import { useEffect, useRef, useState } from "react";

import { useActiveRepository } from "@/contexts/repository-context";
import type { FileEdge } from "@/server/repo/import-graph";

type WiresStatus = "idle" | "loading" | "ready" | "error";

export interface FileWiresState {
  status: WiresStatus;
  edges: FileEdge[];
  scanned: number;
  anchors: number;
  truncated: boolean;
  error: string | null;
}

const INITIAL: FileWiresState = {
  status: "idle", edges: [], scanned: 0, anchors: 0, truncated: false, error: null,
};

export function useFileWires(enabled: boolean): FileWiresState {
  const { activeRepository } = useActiveRepository();
  const [state, setState] = useState<FileWiresState>(INITIAL);
  const fetchIdRef = useRef(0);

  // Reset when the repository changes.
  useEffect(() => { setState(INITIAL); }, [activeRepository?.fullName]);

  useEffect(() => {
    if (!enabled || !activeRepository) return;
    // Only fetch once per repo (idle → loading).
    if (state.status !== "idle") return;

    const [owner, repo] = activeRepository.fullName.split("/");
    if (!owner || !repo) return;

    const fetchId = ++fetchIdRef.current;
    setState((s) => ({ ...s, status: "loading", error: null }));

    (async () => {
      try {
        const params = new URLSearchParams({ owner, repo });
        if (activeRepository.defaultBranch) params.set("branch", activeRepository.defaultBranch);
        const res = await fetch(`/api/repo/architecture/wires?${params.toString()}`);
        if (fetchId !== fetchIdRef.current) return;

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setState({ ...INITIAL, status: "error", error: body.error ?? `Request failed (${res.status})` });
          return;
        }
        const data = (await res.json()) as FileWiresState & { edges: FileEdge[] };
        if (fetchId !== fetchIdRef.current) return;
        setState({
          status: "ready",
          edges: data.edges ?? [],
          scanned: data.scanned ?? 0,
          anchors: data.anchors ?? 0,
          truncated: data.truncated ?? false,
          error: null,
        });
      } catch (err) {
        if (fetchId !== fetchIdRef.current) return;
        setState({ ...INITIAL, status: "error", error: err instanceof Error ? err.message : "Failed to load wires" });
      }
    })();
  }, [enabled, activeRepository, state.status]);

  return state;
}
