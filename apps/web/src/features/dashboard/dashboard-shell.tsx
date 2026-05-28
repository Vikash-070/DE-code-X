"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import {
  ChevronLeft,
  FolderGit2,
  Layers,
  MessagesSquare,
  Network,
  PanelLeftClose,
  Settings
} from "lucide-react";
import { motion } from "framer-motion";

import { AmbientBackground } from "@/components/primitives/ambient-background";
import { RepositorySelector } from "@/components/dashboard/repository-selector";
import { RepositoryProvider } from "@/contexts/repository-context";
import { useGitHubIntelligence } from "@/hooks/use-github-intelligence";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Workspace",     href: "/workspace",                  icon: Layers         },
  { label: "Architecture",  href: "/dashboard/architecture",     icon: Network        },
  { label: "Repositories",  href: "/dashboard/repositories",     icon: FolderGit2     },
  { label: "Sessions",      href: "/workspace/sessions",         icon: MessagesSquare }
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const { data } = useGitHubIntelligence();

  return (
    <RepositoryProvider repositories={data?.repositories ?? []}>
      <main className="relative min-h-screen bg-black text-white">
        <AmbientBackground />

        {/* ── Sidebar ─────────────────────────────────────── */}
        <aside
          className={cn(
            "fixed bottom-4 left-4 top-4 z-40 hidden flex-col rounded-[24px] border border-white/[0.06] bg-black/50 p-3 backdrop-blur-2xl transition-all duration-500 lg:flex",
            collapsed ? "w-[72px]" : "w-[220px]"
          )}
        >
          {/* Logo */}
          <div className="flex items-center justify-between px-2 py-2">
            <Link href="/" className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04]">
                <Layers className="h-4 w-4 text-zinc-300" />
              </span>
              {!collapsed && (
                <span className="text-sm font-medium tracking-[0.1em] text-zinc-400">DE-code X</span>
              )}
            </Link>
            <button
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setCollapsed((v) => !v)}
              className="grid h-7 w-7 place-items-center rounded-full text-zinc-700 transition hover:text-zinc-400"
            >
              {collapsed
                ? <ChevronLeft className="h-3.5 w-3.5 rotate-180" />
                : <PanelLeftClose className="h-3.5 w-3.5" />
              }
            </button>
          </div>

          {/* Nav items */}
          <nav className="mt-4 space-y-0.5">
            {NAV.map((item, i) => {
              // Exact match for workspace root; prefix match for sub-routes
              const isActive =
                item.href === "/workspace"
                  ? pathname === "/workspace"
                  : pathname.startsWith(item.href);
              return (
                <motion.div key={item.label} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                  <Link
                    href={item.href}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors",
                      isActive
                        ? "bg-white/[0.05] text-zinc-200"
                        : "text-zinc-600 hover:bg-white/[0.04] hover:text-zinc-300"
                    )}
                  >
                    <item.icon className={cn(
                      "h-4 w-4 shrink-0 transition-colors",
                      isActive ? "text-zinc-300" : "group-hover:text-zinc-300"
                    )} />
                    {!collapsed && item.label}
                  </Link>
                </motion.div>
              );
            })}
          </nav>

          {/* Settings pinned to bottom */}
          <div className="mt-auto">
            <Link
              href="/dashboard/settings"
              className={cn(
                "group flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors",
                pathname.startsWith("/dashboard/settings")
                  ? "bg-white/[0.05] text-zinc-200"
                  : "text-zinc-700 hover:bg-white/[0.04] hover:text-zinc-300"
              )}
            >
              <Settings className={cn(
                "h-4 w-4 shrink-0 transition-colors",
                pathname.startsWith("/dashboard/settings") ? "text-zinc-300" : "group-hover:text-zinc-300"
              )} />
              {!collapsed && "Settings"}
            </Link>
          </div>
        </aside>

        {/* ── Content ─────────────────────────────────────── */}
        <div className={cn("transition-all duration-500 lg:pl-[244px]", collapsed && "lg:pl-[100px]")}>

          {/* Top bar */}
          <header className="sticky top-0 z-30 px-5 pt-4">
            <div className="flex items-center justify-end rounded-2xl border border-white/[0.05] bg-black/60 px-4 py-2.5 backdrop-blur-xl">
              <RepositorySelector />
            </div>
          </header>

          {/* Page content */}
          <div className="px-5 py-5 sm:px-6">
            {children}
          </div>
        </div>
      </main>
    </RepositoryProvider>
  );
}
