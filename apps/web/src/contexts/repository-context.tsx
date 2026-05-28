"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import type { GitHubRepositorySummary } from "@/services/github/types";

const STORAGE_KEY = "decode-x:active-repo";
const CONFIRMED_KEY = "decode-x:repo-confirmed";

interface RepositoryContextValue {
  activeRepository: GitHubRepositorySummary | null;
  setActiveRepository: (repo: GitHubRepositorySummary) => void;
  repositories: GitHubRepositorySummary[];
  hasConfirmedRepository: boolean;
  contextReady: boolean;
  confirmRepository: (repo: GitHubRepositorySummary) => void;
}

const RepositoryContext = createContext<RepositoryContextValue>({
  activeRepository: null,
  setActiveRepository: () => {},
  repositories: [],
  hasConfirmedRepository: false,
  contextReady: false,
  confirmRepository: () => {}
});

export function RepositoryProvider({
  repositories,
  children
}: {
  repositories: GitHubRepositorySummary[];
  children: React.ReactNode;
}) {
  const [activeRepository, setActiveRepositoryState] = useState<GitHubRepositorySummary | null>(null);
  const [hasConfirmedRepository, setHasConfirmedRepository] = useState(false);
  const [contextReady, setContextReady] = useState(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    // Mark ready immediately if no repos (e.g. GitHub not connected yet)
    if (repositories.length === 0) {
      if (!initializedRef.current) {
        initializedRef.current = true;
        setContextReady(true);
      }
      return;
    }

    const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    const confirmed = typeof window !== "undefined" ? localStorage.getItem(CONFIRMED_KEY) : null;
    const match = stored ? repositories.find((r) => r.fullName === stored) : null;

    // Only auto-select if user has previously confirmed a repository
    if (confirmed) {
      setActiveRepositoryState(match ?? repositories[0] ?? null);
      setHasConfirmedRepository(true);
    }

    initializedRef.current = true;
    setContextReady(true);
  }, [repositories]);

  function setActiveRepository(repo: GitHubRepositorySummary) {
    setActiveRepositoryState(repo);
    localStorage.setItem(STORAGE_KEY, repo.fullName);
  }

  const confirmRepository = useCallback((repo: GitHubRepositorySummary) => {
    setActiveRepositoryState(repo);
    setHasConfirmedRepository(true);
    localStorage.setItem(STORAGE_KEY, repo.fullName);
    localStorage.setItem(CONFIRMED_KEY, "1");
  }, []);

  return (
    <RepositoryContext.Provider
      value={{ activeRepository, setActiveRepository, repositories, hasConfirmedRepository, contextReady, confirmRepository }}
    >
      {children}
    </RepositoryContext.Provider>
  );
}

export function useActiveRepository() {
  return useContext(RepositoryContext);
}
