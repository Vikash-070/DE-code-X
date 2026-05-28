"use client";

import { useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  EyeOff,
  GitBranch,
  LockKeyhole,
  Network,
  Route,
  ScanLine,
  Search,
  Server,
  ShieldCheck,
  Star
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { PageHeading } from "@/components/dashboard/page-heading";
import { Button } from "@/components/ui/button";
import type { GitHubRepositorySummary } from "@/services/github/types";
import { cn } from "@/lib/utils";

const LANG_BADGE: Record<string, string> = {
  TypeScript: "text-blue-400 border-blue-400/25 bg-blue-400/[0.08]",
  JavaScript: "text-yellow-300 border-yellow-300/25 bg-yellow-300/[0.08]",
  Python: "text-green-400 border-green-400/25 bg-green-400/[0.08]",
  Rust: "text-orange-400 border-orange-400/25 bg-orange-400/[0.08]",
  Go: "text-cyan-400 border-cyan-400/25 bg-cyan-400/[0.08]",
  "C++": "text-pink-400 border-pink-400/25 bg-pink-400/[0.08]",
  Java: "text-red-400 border-red-400/25 bg-red-400/[0.08]",
  Ruby: "text-red-500 border-red-500/25 bg-red-500/[0.08]",
  Swift: "text-orange-300 border-orange-300/25 bg-orange-300/[0.08]",
  Kotlin: "text-purple-400 border-purple-400/25 bg-purple-400/[0.08]",
  Dart: "text-sky-400 border-sky-400/25 bg-sky-400/[0.08]"
};

function formatRecency(pushedAt: string | null): string {
  if (!pushedAt) return "";
  const ms = Date.now() - new Date(pushedAt).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function detectFramework(repo: GitHubRepositorySummary): string | null {
  const n = repo.name.toLowerCase();
  if (repo.language === "TypeScript" || repo.language === "JavaScript") {
    if (n.includes("next") || n.includes("nextjs")) return "Next.js";
    if (n.includes("nest") || n.includes("nestjs")) return "NestJS";
    if (n.includes("expo") || n.includes("react-native") || n.startsWith("rn-")) return "React Native";
    if (n.includes("react")) return "React";
    if (n.includes("vue")) return "Vue";
    if (n.includes("svelte")) return "Svelte";
    if (n.includes("electron")) return "Electron";
    if (n.includes("express") || n.includes("fastify") || n.includes("hono") || n.includes("api") || n.includes("server") || n.includes("backend")) return "Node.js";
  }
  if (repo.language === "Python") {
    if (n.includes("django")) return "Django";
    if (n.includes("flask")) return "Flask";
    if (n.includes("fastapi") || n.includes("fast-api")) return "FastAPI";
  }
  if (repo.language === "Go") {
    if (n.includes("gin")) return "Gin";
    if (n.includes("fiber")) return "Fiber";
    return "Go API";
  }
  if (repo.language === "Rust") return "Rust";
  if (repo.language === "Java" && n.includes("spring")) return "Spring Boot";
  return null;
}

const TRUST_ATTESTATIONS = [
  { icon: EyeOff, label: "Read-only repository access", detail: "Atlas never writes or modifies files in your repository" },
  { icon: LockKeyhole, label: "No automatic code modifications", detail: "Every write operation requires your explicit approval" },
  { icon: Server, label: "Tokens stored server-side only", detail: "GitHub credentials never reach the browser" },
  { icon: ShieldCheck, label: "Isolated workspace indexing", detail: "Intelligence runs in a sandboxed analysis environment" },
  { icon: CheckCircle2, label: "Approval gates before execution", detail: "V# presents a plan — you confirm before Forge executes" }
];

const ATLAS_CAPABILITIES = [
  { icon: Network, label: "Architecture graph mapping" },
  { icon: Route, label: "Dependency chain resolution" },
  { icon: ShieldCheck, label: "Auth system boundary detection" },
  { icon: GitBranch, label: "Service edge analysis" },
  { icon: ScanLine, label: "Security surface identification" }
];

export function RepositoryOnboarding({
  repositories,
  githubOwner,
  onConfirm
}: {
  repositories: GitHubRepositorySummary[];
  githubOwner: string;
  onConfirm: (repo: GitHubRepositorySummary) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<GitHubRepositorySummary | null>(
    repositories[0] ?? null
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = repositories.filter((r) =>
    r.fullName.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="Repository Intelligence"
        title="Select your active workspace."
        description="Atlas initializes in read-only intelligence mode. Your architecture is mapped, analyzed, and validated — without touching a single file."
      />

      <div className="grid gap-6 xl:grid-cols-[0.82fr_1.18fr]">
        {/* Left — trust + capabilities */}
        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-[28px] border border-emerald-200/15 bg-forest-700/10 p-6"
          >
            <div className="mb-6 flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-emerald-300/25 bg-forest-700/45 shadow-glow">
                <ShieldCheck className="h-5 w-5 text-emerald-200" />
              </span>
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-emerald-300/60">Security guarantees</p>
                <p className="text-sm font-semibold text-white">Read-only intelligence mode</p>
              </div>
            </div>
            <div className="space-y-4">
              {TRUST_ATTESTATIONS.map((item, i) => (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.06 + i * 0.06 }}
                  className="flex items-start gap-3"
                >
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-xl border border-emerald-200/20 bg-forest-700/30">
                    <item.icon className="h-3.5 w-3.5 text-emerald-300" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-white">{item.label}</p>
                    <p className="mt-0.5 text-xs leading-5 text-zinc-500">{item.detail}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.16 }}
            className="rounded-[28px] border border-white/8 bg-white/[0.02] p-6"
          >
            <div className="mb-4 flex items-center gap-2">
              <Network className="h-4 w-4 text-sky-300" />
              <p className="text-xs uppercase tracking-[0.22em] text-sky-300/60">Atlas will analyze</p>
            </div>
            <ul className="space-y-3">
              {ATLAS_CAPABILITIES.map((cap, i) => (
                <motion.li
                  key={cap.label}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.24 + i * 0.05 }}
                  className="flex items-center gap-2.5 text-sm text-zinc-400"
                >
                  <cap.icon className="h-3.5 w-3.5 shrink-0 text-sky-400/60" />
                  {cap.label}
                </motion.li>
              ))}
            </ul>
          </motion.div>
        </div>

        {/* Right — repo picker */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
        >
          <div className="overflow-hidden rounded-[28px] border border-white/10 bg-black/45 backdrop-blur-xl">
            {/* Search bar */}
            <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-5 py-4">
              <Search className="h-4 w-4 shrink-0 text-zinc-600" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search repositories…"
                className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none"
              />
              <span className="shrink-0 text-xs text-zinc-700">
                {repositories.length} {repositories.length === 1 ? "repository" : "repositories"}
              </span>
            </div>

            {/* Repo list */}
            <div className="max-h-[440px] overflow-y-auto">
              {repositories.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <p className="text-sm text-zinc-500">No repositories found.</p>
                  <p className="mt-2 text-xs text-zinc-700">Make sure your GitHub connection includes repository access.</p>
                </div>
              ) : filtered.length === 0 ? (
                <p className="px-5 py-10 text-center text-xs text-zinc-600">
                  No repositories match &ldquo;{query}&rdquo;
                </p>
              ) : (
                <div className="p-2">
                  {filtered.map((repo, index) => {
                    const isSelected = selected?.fullName === repo.fullName;
                    const [owner, repoName] = repo.fullName.split("/");
                    const isOrg = Boolean(githubOwner) && owner !== githubOwner;
                    const langBadge = repo.language ? (LANG_BADGE[repo.language] ?? "text-zinc-400 border-zinc-700 bg-zinc-800/40") : null;
                    const framework = detectFramework(repo);
                    const recency = formatRecency(repo.pushedAt);

                    return (
                      <motion.button
                        key={repo.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.025 }}
                        onClick={() => setSelected(repo)}
                        className={cn(
                          "w-full rounded-2xl border px-4 py-3.5 text-left transition-all duration-150",
                          isSelected
                            ? "border-emerald-200/25 bg-emerald-300/[0.05]"
                            : "border-transparent hover:border-white/8 hover:bg-white/[0.03]"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={cn(
                              "mt-2 h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
                              isSelected ? "bg-emerald-400" : "bg-zinc-700"
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm">
                                <span className="text-zinc-500">{owner}/</span>
                                <span className={cn(isSelected ? "font-medium text-white" : "text-zinc-200")}>{repoName}</span>
                              </span>
                              {repo.private && (
                                <span className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-zinc-500">
                                  <LockKeyhole className="h-2 w-2" /> Private
                                </span>
                              )}
                              {isOrg && (
                                <span className="rounded-full border border-violet-300/20 bg-violet-300/[0.06] px-2 py-0.5 text-[10px] text-violet-300/70">
                                  Org
                                </span>
                              )}
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              {langBadge && repo.language && (
                                <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", langBadge)}>
                                  {framework ?? repo.language}
                                </span>
                              )}
                              {recency && (
                                <span className="text-[10px] text-zinc-700">{recency}</span>
                              )}
                              {repo.stars > 0 && (
                                <span className="flex items-center gap-1 text-[10px] text-zinc-700">
                                  <Star className="h-2.5 w-2.5" />
                                  {repo.stars}
                                </span>
                              )}
                            </div>
                          </div>
                          {isSelected && (
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                          )}
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Confirm CTA */}
            <AnimatePresence>
              {selected && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="border-t border-white/[0.06] p-4"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        <span className="text-zinc-500">{selected.fullName.split("/")[0]}/</span>
                        <span className="font-medium text-white">{selected.name}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-600">
                        {selected.language ?? "Unknown language"}{selected.pushedAt ? ` · ${formatRecency(selected.pushedAt)}` : ""}
                      </p>
                    </div>
                    <Button
                      variant="forest"
                      onClick={() => onConfirm(selected)}
                      className="shrink-0"
                    >
                      Initialize Atlas
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
