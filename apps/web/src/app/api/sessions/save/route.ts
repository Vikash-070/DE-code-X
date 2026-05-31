/**
 * POST /api/sessions/save
 *
 * Upserts the chat session for the current user + repo. Called automatically
 * after each completed assistant turn so the conversation survives refresh,
 * navigation, and browser close.
 *
 * One row per (userId, repoFullName) — repeated saves overwrite the messages
 * array (latest wins). Messages are capped at MAX_MESSAGES to keep the JSONB
 * payload bounded; oldest messages are trimmed first.
 *
 * SECURITY: auth required; userId is always sourced from the server-side
 * Clerk session, never from the request body.
 */

import { auth }         from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma }       from "@/lib/prisma";
import { rateLimit, sameOrigin } from "@/server/security/guards";
import type { SessionMessage } from "@/features/workspace/workspace-session";

export const dynamic = "force-dynamic";

/** Cap messages stored per session — keeps the JSONB row bounded. */
const MAX_MESSAGES = 200;

interface SaveRequest {
  repoFullName: string;  // "owner/repo"
  repoName:     string;
  repoOwner:    string;
  messages:     SessionMessage[];
}

export async function POST(request: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const rl = rateLimit(`session-save:${userId}`, 60, 60_000); // 60/min — generous
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many saves." }, { status: 429 });
  }

  let body: SaveRequest;
  try {
    body = (await request.json()) as SaveRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { repoFullName, repoName, repoOwner, messages } = body;
  if (!repoFullName?.trim() || !Array.isArray(messages)) {
    return NextResponse.json({ error: "repoFullName and messages are required." }, { status: 422 });
  }

  // Trim oldest messages to cap; always keep the opening vhash briefing (index 0).
  const trimmed: SessionMessage[] = messages.length > MAX_MESSAGES
    ? [messages[0]!, ...messages.slice(-(MAX_MESSAGES - 1))]
    : messages;

  // Strip transient streaming state before persisting — only complete messages.
  const persisted = trimmed.filter((m) => {
    if (m.role === "assistant") return m.streamState === "complete";
    return true;
  });

  // Last user message → preview text shown in the sessions list.
  const lastUserMsg = [...persisted].reverse().find((m) => m.role === "user");
  const lastMessage = lastUserMsg
    ? (lastUserMsg as { content: string }).content.slice(0, 200)
    : "";

  // Find the user's DB row (created by Clerk webhook on first sign-in).
  const user = await prisma.user.findUnique({
    where:  { clerkId: userId },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  await prisma.chatSession.upsert({
    where:  { userId_repoFullName: { userId: user.id, repoFullName } },
    create: {
      userId:       user.id,
      repoFullName,
      repoName,
      repoOwner,
      messages:     persisted as unknown as object[],
      lastMessage,
      messageCount: persisted.length,
    },
    update: {
      messages:     persisted as unknown as object[],
      lastMessage,
      messageCount: persisted.length,
      repoName,
      repoOwner,
    },
  });

  return NextResponse.json({ ok: true, saved: persisted.length });
}
