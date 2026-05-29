"use client";

/**
 * useDomainIntelligence
 *
 * Fetches intelligence findings for a single architectural domain prefix.
 * Called when the user clicks a domain node in the Architecture Workspace.
 *
 * State machine:
 *   idle     — no domain selected yet (initial state)
 *   loading  — fetch in flight
 *   success  — findings loaded
 *   empty    — no findings stored yet (domain not yet analysed)
 *   error    — request failed
 *
 * Caches results by domainPrefix so switching between domains
 * doesn't re-fetch already-loaded data within the same page session.
 */

import { useCallback, useRef, useState } from "react";

import { useActiveRepository } from "@/contexts/repository-context";
import type { CipherFinding, AgentId } from "@/types/intelligence";

// ─── Response types ───────────────────────────────────────────

export interface DomainFileEntry {
  filePath:   string;
  findings:   CipherFinding[];
  analyzedAt: string;
  agentId:    AgentId;
}

export interface DomainIntelligenceData {
  domainPrefix:  string;
  repoFullName:  string;
  branch:        string;
  modules:       Partial<Record<AgentId, DomainFileEntry[]>>;
  totalFindings: number;
  fileCount:     number;
}

type DomainIntelligenceStatus = "idle" | "loading" | "success" | "empty" | "error";

export interface DomainIntelligenceState {
  status:       DomainIntelligenceStatus;
  data:         DomainIntelligenceData | null;
  domainPrefix: string | null;
  error:        string | null;
}

// ─── Hook ─────────────────────────────────────────────────────

export function useDomainIntelligence() {
  const { activeRepository } = useActiveRepository();

  const [state, setState] = useState<DomainIntelligenceState>({
    status:       "idle",
    data:         null,
    domainPrefix: null,
    error:        null,
  });

  // In-session cache: prefix → DomainIntelligenceData
  const cacheRef = useRef<Map<string, DomainIntelligenceData>>(new Map());
  const fetchIdRef = useRef(0);

  const loadDomain = useCallback(
    async (domainPrefix: string) => {
      if (!activeRepository) return;

      // Cache hit — instant render
      const cached = cacheRef.current.get(domainPrefix);
      if (cached) {
        setState({
          status:       cached.totalFindings === 0 ? "empty" : "success",
          data:         cached,
          domainPrefix,
          error:        null,
        });
        return;
      }

      const fetchId = ++fetchIdRef.current;
      setState({ status: "loading", data: null, domainPrefix, error: null });

      try {
        const [owner, repo] = activeRepository.fullName.split("/");
        const branch        = activeRepository.defaultBranch ?? "main";

        const params = new URLSearchParams({ owner, repo, branch, domainPrefix });
        const response = await fetch(`/api/repo/intelligence/domain?${params.toString()}`);

        if (fetchId !== fetchIdRef.current) return; // stale

        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as { error?: string };
          setState({
            status:       "error",
            data:         null,
            domainPrefix,
            error:        body.error ?? `Request failed with ${response.status}`,
          });
          return;
        }

        const data = (await response.json()) as DomainIntelligenceData;

        if (fetchId !== fetchIdRef.current) return;

        cacheRef.current.set(domainPrefix, data);

        setState({
          status:       data.totalFindings === 0 ? "empty" : "success",
          data,
          domainPrefix,
          error:        null,
        });
      } catch (err) {
        if (fetchId !== fetchIdRef.current) return;
        setState({
          status:       "error",
          data:         null,
          domainPrefix,
          error:        err instanceof Error ? err.message : "Failed to load domain intelligence",
        });
      }
    },
    [activeRepository]
  );

  /** Invalidate cache for a domain (call after triggering re-analysis). */
  const invalidate = useCallback((domainPrefix: string) => {
    cacheRef.current.delete(domainPrefix);
  }, []);

  return { state, loadDomain, invalidate };
}
