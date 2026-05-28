"use client";

import { useRouter } from "next/navigation";
import { Github, LockKeyhole, Star } from "lucide-react";
import { motion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { useActiveRepository } from "@/contexts/repository-context";
import { useGitHubIntelligence } from "@/hooks/use-github-intelligence";
import type { GitHubRepositorySummary } from "@/services/github/types";

// ─── Helpers ─────────────────────────────────────────────

function formatRecency(pushedAt: string | null): string {
  if (!pushedAt) return "";
  const days = Math.floor((Date.now() - new Date(pushedAt).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7)  return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ─── Repository row ───────────────────────────────────────

function RepositoryRow({
  repo,
  isActive,
  onSelect
}: {
  repo:     GitHubRepositorySummary;
  isActive: boolean;
  onSelect: (repo: GitHubRepositorySummary) => void;
}) {
  const [owner, name] = repo.fullName.split("/");
  const recency = formatRecency(repo.pushedAt);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="group flex items-center gap-4 rounded-2xl px-4 py-3.5 transition-colors hover:bg-white/[0.03]"
    >
      {/* Active indicator */}
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
          isActive ? "bg-zinc-400" : "bg-zinc-800 group-hover:bg-zinc-700"
        }`}
      />

      {/* Name */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-500">{owner}/</span>
          <span className={`text-sm font-medium ${isActive ? "text-zinc-200" : "text-zinc-300"}`}>
            {name}
          </span>
          {repo.private && (
            <span className="flex items-center gap-1 text-[10px] text-zinc-700">
              <LockKeyhole className="h-2.5 w-2.5" />
              private
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-3">
          {repo.language && (
            <span className="text-xs text-zinc-600">{repo.language}</span>
          )}
          {repo.stars > 0 && (
            <span className="flex items-center gap-1 text-xs text-zinc-700">
              <Star className="h-2.5 w-2.5" />
              {repo.stars}
            </span>
          )}
          {recency && (
            <span className="text-xs text-zinc-700">{recency}</span>
          )}
        </div>
      </div>

      {/* Action */}
      <button
        onClick={() => onSelect(repo)}
        className={`shrink-0 rounded-xl border px-3 py-1.5 text-xs transition-all ${
          isActive
            ? "border-white/[0.08] text-zinc-400"
            : "border-transparent text-zinc-700 hover:border-white/[0.06] hover:text-zinc-400 group-hover:border-white/[0.05] group-hover:text-zinc-500"
        }`}
      >
        {isActive ? "Active workspace" : "Open"}
      </button>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────

export function RepositoriesPage() {
  const router = useRouter();
  const { data, isLoading } = useGitHubIntelligence();
  const { activeRepository, confirmRepository } = useActiveRepository();

  const repositories = data?.repositories ?? [];

  function handleSelect(repo: GitHubRepositorySummary) {
    confirmRepository(repo);
    router.push("/workspace");
  }

  // Not connected
  if (!isLoading && data?.connectionRequired) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-5 text-center">
        <Github className="h-8 w-8 text-zinc-700" />
        <div>
          <p className="text-sm font-medium text-zinc-300">No repositories connected</p>
          <p className="mt-1 text-xs text-zinc-600">
            Connect GitHub from the workspace to unlock repository intelligence.
          </p>
        </div>
        <Button variant="forest" onClick={() => router.push("/workspace")}>
          Go to workspace
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-700">Repositories</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-zinc-200">
          {isLoading
            ? "Loading…"
            : `${repositories.length} repositor${repositories.length === 1 ? "y" : "ies"}`}
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Select a repository to open it in your implementation workspace.
        </p>
      </div>

      {/* Repository list */}
      {isLoading ? (
        <div className="space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[60px] animate-pulse rounded-2xl bg-white/[0.02]" />
          ))}
        </div>
      ) : repositories.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-600">
          No repositories found for this GitHub account.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/[0.05]">
          {repositories.map((repo, i) => (
            <motion.div
              key={repo.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.02 }}
              className={i < repositories.length - 1 ? "border-b border-white/[0.04]" : ""}
            >
              <RepositoryRow
                repo={repo}
                isActive={activeRepository?.fullName === repo.fullName}
                onSelect={handleSelect}
              />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
