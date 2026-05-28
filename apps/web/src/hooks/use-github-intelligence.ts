"use client";

import { useEffect, useState } from "react";

import type { GitHubIntelligence } from "@/services/github/types";

export function useGitHubIntelligence() {
  const [data, setData] = useState<GitHubIntelligence | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        const response = await fetch("/api/github/intelligence");
        if (!response.ok) {
          throw new Error(`GitHub intelligence failed with ${response.status}`);
        }
        const payload = (await response.json()) as GitHubIntelligence;
        if (isMounted) {
          setData(payload);
          setError(null);
        }
      } catch (requestError) {
        if (isMounted) {
          setError(requestError instanceof Error ? requestError.message : "Unable to load GitHub intelligence");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      isMounted = false;
    };
  }, []);

  return { data, isLoading, error };
}
