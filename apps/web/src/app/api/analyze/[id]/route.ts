import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { id } = await params;

  const analysis = await prisma.tutorialAnalysis.findUnique({
    where: { id },
    select: {
      id: true,
      pipelineStatus: true,
      agentOutputs: true,
      repositoryFullName: true,
      rawInput: true,
      createdAt: true
    }
  });

  if (!analysis) {
    return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
  }

  return NextResponse.json({
    sessionId: analysis.id,
    status: analysis.pipelineStatus,
    outputs: analysis.agentOutputs,
    repositoryFullName: analysis.repositoryFullName,
    createdAt: analysis.createdAt
  });
}
