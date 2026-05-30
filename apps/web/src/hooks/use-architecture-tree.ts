"use client";

/**
 * useArchitectureTree
 *
 * Fetches the architecture tree for the active repository from
 * GET /api/repo/architecture.
 *
 * State machine (5 states — all must be handled by callers):
 *
 *   loading  — request in flight; show skeleton
 *   success  — full tree returned with both domains and systems
 *   partial  — tree returned but one or both sections are missing
 *              (e.g. tree fetch failed → no domains; no package.json → no systems)
 *   error    — GitHub 404/401/403 or network failure; show error message
 *   empty    — tree returned but no domains AND no systems found (unlikely but valid)
 *
 * Re-fetches when the active repository changes.
 */

import { useEffect, useRef, useState } from "react";

import { useActiveRepository } from "@/contexts/repository-context";
import type { ArchitectureResponse, ArchitectureTreeNode } from "@/types/architecture";
import type { ArchitectureGraph } from "@/server/repo/architecture-wire";
import type { FileMap } from "@/server/repo/file-map";

// ─── State types ─────────────────────────────────────────────

type ArchitectureStatus = "loading" | "success" | "partial" | "error" | "empty";

export interface ArchitectureTreeState {
  status:      ArchitectureStatus;
  tree:        ArchitectureTreeNode[];
  repoFullName: string | null;
  generatedAt: string | null;
  systemSource: ArchitectureResponse["systemSource"] | null;
  /** Relationship graph (Increment A+B) — null until loaded / when unavailable. */
  architectureGraph: ArchitectureGraph | null;
  /** File-level map (Stage 1) — null until loaded / when unavailable. */
  fileMap: FileMap | null;
  /** Present when status === "error". */
  error:       string | null;
}

const INITIAL_STATE: ArchitectureTreeState = {
  status:       "loading",
  tree:         [],
  repoFullName: null,
  generatedAt:  null,
  systemSource: null,
  architectureGraph: null,
  fileMap:      null,
  error:        null,
};

// ─── Hook ─────────────────────────────────────────────────────

export function useArchitectureTree(): ArchitectureTreeState {
  const { activeRepository } = useActiveRepository();
  const [state, setState] = useState<ArchitectureTreeState>(INITIAL_STATE);

  // Track the current fetch so stale responses from previous repos are dropped
  const fetchIdRef = useRef(0);

  useEffect(() => {
    if (!activeRepository) {
      // No repo selected — stay in loading (not error; user just hasn't picked one)
      setState(INITIAL_STATE);
      return;
    }

    const { fullName, defaultBranch } = activeRepository;
    const [owner, repo] = fullName.split("/");
    if (!owner || !repo) return;

    const fetchId = ++fetchIdRef.current;
    setState(INITIAL_STATE); // reset to loading on repo change

    async function fetchTree() {
      try {
        const params = new URLSearchParams({ owner, repo });
        if (defaultBranch) params.set("branch", defaultBranch);

        const response = await fetch(`/api/repo/architecture?${params.toString()}`);

        // Stale response — another fetch started after this one
        if (fetchId !== fetchIdRef.current) return;

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          setState({
            ...INITIAL_STATE,
            status: "error",
            error:  body.error ?? `Request failed with ${response.status}`,
          });
          return;
        }

        const data = (await response.json()) as ArchitectureResponse;

        if (fetchId !== fetchIdRef.current) return;

        const hasDomains = data.tree.some(n => n.id === "section-domains");
        const hasSystems = data.tree.some(n => n.id === "section-systems");

        let status: ArchitectureStatus;
        if (data.tree.length === 0) {
          status = "empty";
        } else if (hasDomains && hasSystems) {
          status = "success";
        } else {
          status = "partial";
        }

        setState({
          status,
          tree:         data.tree,
          repoFullName: data.repoFullName,
          generatedAt:  data.generatedAt,
          systemSource: data.systemSource,
          architectureGraph: data.architectureGraph ?? null,
          fileMap:      data.fileMap ?? null,
          error:        null,
        });
      } catch (err) {
        if (fetchId !== fetchIdRef.current) return;
        setState({
          ...INITIAL_STATE,
          status: "error",
          error:  err instanceof Error ? err.message : "Failed to load architecture data",
        });
      }
    }

    fetchTree();
  }, [activeRepository]);

  return state;
}
