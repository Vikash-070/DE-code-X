/**
 * GET /api/orchestrate/status
 *
 * Lightweight endpoint: returns whether an OpenRouter key is configured
 * for the authenticated user. Used by the workspace provider health panel.
 *
 * NEVER returns the key itself or the encrypted value.
 */

import { auth }        from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { prisma }           from "@/lib/prisma";
import { OPENROUTER_MODEL } from "@/server/ai/constants";

export const dynamic = "force-dynamic"; // never cache — status changes when user saves key

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const record = await prisma.userProviderKey.findFirst({
    where: {
      user:     { clerkId },
      provider: "openrouter",
      isActive: true
    },
    select: { model: true, lastUsedAt: true }
  }).catch(() => null);

  return NextResponse.json({
    provider:  "openrouter",
    model:     record?.model ?? OPENROUTER_MODEL,
    hasKey:    !!record,
    lastUsed:  record?.lastUsedAt ?? null
  });
}
