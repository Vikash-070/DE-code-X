"use client";

import { useEffect, useState } from "react";
import { useRouter }           from "next/navigation";
import { MessagesSquare, Loader2 } from "lucide-react";
import { motion }              from "framer-motion";

import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────

interface SessionSummary {
  id:          string;
  repoName:    string;
  repoOwner:   string;
  repoFullName: string;
  lastMessage: string;
  messageCount: number;
  updatedAt:   string;
}

// ─── Helpers ─────────────────────────────────────────────────

function formatAge(dateStr: string): string {
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
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
  return `${Math.floor(days / 30)}mo ago`;
}

// ─── Session row ──────────────────────────────────────────────

function SessionRow({ session }: { session: SessionSummary }) {
  const router = useRouter();

  function resume() {
    // Navigate to workspace — the session context loads when the repo is re-selected.
    // Future: pass ?session=id so we auto-restore the message history.
    router.push(
      `/workspace?session=${session.id}&repo=${encodeURIComponent(session.repoFullName)}`
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="group flex items-start gap-4 px-4 py-4 transition-colors hover:bg-white/[0.02]"
    >
      <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-white/[0.05] bg-white/[0.02]">
        <MessagesSquare className="h-3.5 w-3.5 text-zinc-700 transition-colors group-hover:text-zinc-500" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-600">{session.repoOwner}/</span>
          <span className="text-sm font-medium text-zinc-300">{session.repoName}</span>
          <span className="ml-2 rounded-full border border-white/[0.05] px-1.5 py-px text-[9px] text-zinc-700">
            {session.messageCount} msg{session.messageCount === 1 ? "" : "s"}
          </span>
        </div>
        {session.lastMessage && (
          <p className="mt-0.5 truncate text-xs leading-5 text-zinc-600">
            {session.lastMessage}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <span className="text-[10px] text-zinc-700">{formatAge(session.updatedAt)}</span>
        <button
          onClick={resume}
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
        Start a conversation in the workspace. Your chats are saved automatically and appear here.
      </p>
      <Button variant="ghost" size="sm" className="mt-6" onClick={() => router.push("/workspace")}>
        Open workspace
      </Button>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────

export function SessionsPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json() as Promise<{ sessions?: SessionSummary[] }>)
      .then((d) => setSessions(d.sessions ?? []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-700">Sessions</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-zinc-200">
          {loading ? "Loading…" : sessions.length > 0
            ? `${sessions.length} session${sessions.length === 1 ? "" : "s"}`
            : "Workspace sessions"}
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Your conversations with V#, saved automatically after each reply.
        </p>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-700" />
        </div>
      ) : sessions.length === 0 ? (
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
