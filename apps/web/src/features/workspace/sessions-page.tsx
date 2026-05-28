"use client";

import { useRouter } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { motion } from "framer-motion";

import { Button } from "@/components/ui/button";

// ─── Types (placeholder until session persistence is wired) ──

interface SessionSummary {
  id:          string;
  repoName:    string;
  repoOwner:   string;
  lastMessage: string;
  messageCount: number;
  updatedAt:   Date;
}

// ─── Helpers ─────────────────────────────────────────────────

function formatAge(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60)   return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60)   return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)    return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1)  return "yesterday";
  if (days < 7)    return `${days}d ago`;
  const wks = Math.floor(days / 7);
  if (wks < 5)     return `${wks}w ago`;
  const mos = Math.floor(days / 30);
  return `${mos}mo ago`;
}

// ─── Session row ──────────────────────────────────────────────

function SessionRow({ session }: { session: SessionSummary }) {
  const router = useRouter();

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="group flex items-start gap-4 px-4 py-4 transition-colors hover:bg-white/[0.02]"
    >
      {/* Icon */}
      <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-white/[0.05] bg-white/[0.02]">
        <MessagesSquare className="h-3.5 w-3.5 text-zinc-700 transition-colors group-hover:text-zinc-500" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-600">{session.repoOwner}/</span>
          <span className="text-sm font-medium text-zinc-300">{session.repoName}</span>
        </div>
        <p className="mt-0.5 truncate text-xs leading-5 text-zinc-600">
          {session.lastMessage}
        </p>
      </div>

      {/* Meta + action */}
      <div className="flex shrink-0 flex-col items-end gap-2">
        <span className="text-[10px] text-zinc-700">{formatAge(session.updatedAt)}</span>
        <button
          onClick={() => router.push("/workspace")}
          className="text-[10px] text-zinc-700 opacity-0 transition-opacity group-hover:opacity-100 hover:text-zinc-400"
        >
          Resume →
        </button>
      </div>
    </motion.div>
  );
}

// ─── Empty state ──────────────────────────────────────────────

function EmptyState() {
  const router = useRouter();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-white/[0.05] text-center"
    >
      <div className="grid h-12 w-12 place-items-center rounded-2xl border border-white/[0.06] bg-white/[0.02]">
        <MessagesSquare className="h-5 w-5 text-zinc-700" />
      </div>

      <p className="mt-5 text-sm font-medium text-zinc-300">No sessions yet</p>
      <p className="mt-1.5 max-w-[260px] text-xs leading-5 text-zinc-600">
        Start a conversation in the workspace. Your implementation sessions will be indexed here.
      </p>

      <Button
        variant="ghost"
        size="sm"
        className="mt-6"
        onClick={() => router.push("/workspace")}
      >
        Open workspace
      </Button>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────

export function SessionsPage() {
  // Sessions are not yet persisted — empty state for now.
  // When session persistence is wired (Prisma migration + API route),
  // replace this with a useSessions() hook and render SessionRow items.
  const sessions: SessionSummary[] = [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">

      {/* Header */}
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-700">Sessions</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-zinc-200">
          {sessions.length > 0
            ? `${sessions.length} session${sessions.length === 1 ? "" : "s"}`
            : "Implementation sessions"}
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Your conversations with V#, indexed by repository and implementation context.
        </p>
      </div>

      {/* Content */}
      {sessions.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/[0.05]">
          {sessions.map((session, i) => (
            <motion.div
              key={session.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.03 }}
              className={i < sessions.length - 1 ? "border-b border-white/[0.04]" : ""}
            >
              <SessionRow session={session} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
