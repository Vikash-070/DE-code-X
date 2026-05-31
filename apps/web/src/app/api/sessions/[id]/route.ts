/**
 * GET /api/sessions/[id]
 *
 * Loads the full message history for one session (owned by the current user).
 * Called when the user resumes a past conversation from the Sessions list.
 */

import { auth }         from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma }       from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { id } = await params;

  const user = await prisma.user.findUnique({
    where:  { clerkId: userId },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "User not found." }, { status: 404 });

  const session = await prisma.chatSession.findFirst({
    where: { id, userId: user.id }, // ownership check — users can only read their own
  });
  if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });

  return NextResponse.json({ session });
}
