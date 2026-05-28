import { auth, clerkClient } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getOrCreateWorkspace } from "@/lib/provision-workspace";
import { decryptKey } from "@/server/ai/encryption";
import { runPipeline, type AIProvider, type OrchestratorConfig } from "@/server/ai/orchestrator";

export async function POST(request: Request) {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: {
    rawInput?: string;
    sourceUrl?: string;
    repositoryFullName?: string;
    repositoryLanguage?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { rawInput, sourceUrl, repositoryFullName, repositoryLanguage } = body;

  if (!rawInput || typeof rawInput !== "string" || rawInput.trim().length < 10) {
    return NextResponse.json({ error: "rawInput must be at least 10 characters" }, { status: 422 });
  }

  try {
    const client = await clerkClient();
    const clerkUser = await client.users.getUser(clerkId);
    const email = clerkUser.emailAddresses[0]?.emailAddress ?? `${clerkId}@clerk.local`;
    const name  = clerkUser.fullName ?? clerkUser.username;

    const { project } = await getOrCreateWorkspace(clerkId, email, name);

    // ── Resolve provider config (BYOK) ────────────────────
    // Prefer the first active key, prioritising: anthropic → openrouter → openai
    const providerKey = await prisma.userProviderKey.findFirst({
      where:   { user: { clerkId }, isActive: true },
      orderBy: [
        // Deterministic priority: anthropic first, then openrouter, then openai
        { provider: "asc" },
        { lastUsedAt: { sort: "desc", nulls: "last" } }
      ],
      select: { provider: true, encryptedKey: true, model: true }
    });

    let orchestratorConfig: OrchestratorConfig | null = null;

    if (providerKey) {
      try {
        const apiKey = decryptKey(providerKey.encryptedKey);
        orchestratorConfig = {
          provider: providerKey.provider as AIProvider,
          apiKey,
          model: providerKey.model ?? undefined
        };
      } catch (decryptErr) {
        // If decryption fails (e.g. key rotation), fall through to mock
        console.error("[analyze] Failed to decrypt provider key:", decryptErr);
      }
    }

    const outputs = await runPipeline(
      {
        rawInput: rawInput.trim(),
        sourceUrl,
        repositoryFullName,
        repositoryLanguage
      },
      orchestratorConfig
    );

    // Touch lastUsedAt on the provider key used
    if (providerKey && orchestratorConfig) {
      await prisma.userProviderKey.updateMany({
        where:  { user: { clerkId }, provider: providerKey.provider },
        data:   { lastUsedAt: new Date() }
      });
    }

    const analysis = await prisma.tutorialAnalysis.create({
      data: {
        projectId:            project.id,
        sourceType:           sourceUrl ? "url" : "text",
        sourceUrl:            sourceUrl ?? null,
        rawInput:             rawInput.trim(),
        repositoryFullName:   repositoryFullName ?? null,
        pipelineStatus:       "complete",
        agentOutputs:         outputs as unknown as Prisma.InputJsonValue,
        extractedFeature:     outputs.echo as unknown as Prisma.InputJsonValue,
        compatibilityFindings: { atlas: outputs.atlas, aegis: outputs.aegis } as unknown as Prisma.InputJsonValue,
        securityFindings:     outputs.cipher as unknown as Prisma.InputJsonValue,
        scalabilityFindings:  { sage: outputs.sage, vhash: outputs.vhash } as unknown as Prisma.InputJsonValue
      }
    });

    return NextResponse.json({
      sessionId:   analysis.id,
      status:      "complete",
      outputs,
      poweredBy:   orchestratorConfig ? orchestratorConfig.provider : "mock"
    });
  } catch (error) {
    console.error("analyze route error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      { status: 500 }
    );
  }
}
