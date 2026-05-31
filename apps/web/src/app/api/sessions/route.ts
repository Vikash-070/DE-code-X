/**
 * GET /api/sessions
 *
 * Returns the current user's chat sessions, newest first.
 * Used by the Sessions page to list past conversations.
 */

import { auth }         from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma }       from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where:  { clerkId: userId },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ sessions: [] });

  const rows = await prisma.chatSession.findMany({
    where:   { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id:           true,
      repoFullName: true,
      repoName:     true,
      repoOwner:    true,
      lastMessage:  true,
      messageCount: true,
      updatedAt:    true,
    },
  });

  return NextResponse.json({ sessions: rows });
}
