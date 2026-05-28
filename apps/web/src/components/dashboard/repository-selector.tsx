"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Github, LockKeyhole, Search } from "lucide-react";

import { useActiveRepository } from "@/contexts/repository-context";
import { cn } from "@/lib/utils";

const LANG_COLORS: Record<string, string> = {
  TypeScript: "text-blue-400",
  JavaScript: "text-yellow-300",
  Python: "text-green-400",
  Rust: "text-orange-400",
  Go: "text-cyan-400",
  "C++": "text-pink-400",
  Java: "text-red-400",
  Ruby: "text-red-500",
  Swift: "text-orange-300",
  Kotlin: "text-purple-400",
  Dart: "text-sky-400"
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

export function RepositorySelector() {
  const { activeRepository, setActiveRepository, repositories } = useActiveRepository();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = repositories.filter((r) =>
    r.fullName.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!activeRepository) {
    return (
      <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-4 py-2 text-sm text-zinc-600 sm:flex">
        <Github className="h-4 w-4 shrink-0" />
        <span>No repository</span>
      </div>
    );
  }

  const [owner, repoName] = activeRepository.fullName.split("/");

  return (
    <div ref={containerRef} className="relative hidden sm:block">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm transition-all duration-200",
          open
            ? "border-emerald-300/25 bg-emerald-300/[0.05] text-white"
            : "border-white/10 bg-white/[0.035] text-zinc-300 hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
        )}
      >
        <Github className="h-4 w-4 shrink-0 text-zinc-500" />
        <span className="max-w-[180px] truncate">
          <span className="text-zinc-500">{owner}/</span>
          <span className="text-zinc-200">{repoName}</span>
        </span>
        {activeRepository.private && (
          <LockKeyhole className="h-3 w-3 shrink-0 text-zinc-600" />
        )}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-zinc-600 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="absolute right-0 top-[calc(100%+8px)] z-50 w-[360px] overflow-hidden rounded-[20px] border border-white/10 bg-[#0a0a0a]/90 shadow-premium backdrop-blur-2xl"
          >
            <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4 py-3">
              <Search className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter repositories…"
                className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="text-xs text-zinc-600 hover:text-zinc-400"
                >
                  clear
                </button>
              )}
            </div>

            <div className="max-h-[340px] overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-zinc-600">
                  No repositories match &ldquo;{query}&rdquo;
                </p>
              ) : (
                <div className="py-1.5">
                  {filtered.map((repo) => {
                    const isActive = repo.fullName === activeRepository.fullName;
                    const [repoOwner, rName] = repo.fullName.split("/");
                    const langColor = repo.language
                      ? (LANG_COLORS[repo.language] ?? "text-zinc-500")
                      : "text-zinc-600";
                    const recency = formatRecency(repo.pushedAt);

                    return (
                      <button
                        key={repo.id}
                        onClick={() => {
                          setActiveRepository(repo);
                          setOpen(false);
                          setQuery("");
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100",
                          "hover:bg-white/[0.04]",
                          isActive && "bg-emerald-300/[0.04]"
                        )}
                      >
                        <span
                          className={cn(
                            "mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
                            isActive ? "bg-emerald-400" : "bg-zinc-800"
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm leading-5">
                            <span className="text-zinc-500">{repoOwner}/</span>
                            <span className={isActive ? "text-white" : "text-zinc-200"}>{rName}</span>
                          </p>
                          <div className="mt-0.5 flex items-center gap-2.5">
                            {repo.language && (
                              <span className={cn("text-xs", langColor)}>
                                {repo.language}
                              </span>
                            )}
                            {recency && (
                              <span className="text-xs text-zinc-700">{recency}</span>
                            )}
                            {repo.stars > 0 && (
                              <span className="text-xs text-zinc-700">★ {repo.stars}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {repo.private && (
                            <LockKeyhole className="h-3 w-3 text-zinc-700" />
                          )}
                          {isActive && (
                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2.5">
              <span className="text-xs text-zinc-700">
                {repositories.length} {repositories.length === 1 ? "repository" : "repositories"}
              </span>
              <span className="text-xs text-zinc-700">
                {repositories.filter((r) => r.private).length} private
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
