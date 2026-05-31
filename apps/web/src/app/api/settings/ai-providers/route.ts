/**
 * BYOK API key management endpoint.
 *
 * GET    /api/settings/ai-providers   — list configured providers (no key exposure)
 * POST   /api/settings/ai-providers   — save or update a provider key
 * DELETE /api/settings/ai-providers   — remove a provider key
 *
 * SECURITY GUARANTEES:
 * - Raw API keys are encrypted before DB write, decrypted only for testing
 * - GET response NEVER includes raw or encrypted keys
 * - DELETE requires matching userId (Clerk auth)
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { prisma }              from "@/lib/prisma";
import { encryptKey, redactKey } from "@/server/ai/encryption";
import { testOpenRouterKey }   from "@/server/ai/providers/openrouter";
import { testAnthropicKey }    from "@/server/ai/providers/anthropic";
import { testOpenAIKey }       from "@/server/ai/providers/openai";
import { testGeminiKey, GEMINI_KEY_PREFIX } from "@/server/ai/providers/gemini";
import {
  classifyPrismaError,
  withRetry,
  withDbTimeout
} from "@/server/db/resilience";

// Hard timeout for DB operations in this route (provider save is user-interactive,
// so we give slightly more headroom than the orchestrate route).
const DB_TIMEOUT_MS = 6_000;

// All four providers are active and connection-tested on save.
type Provider = "anthropic" | "openrouter" | "openai" | "gemini";
const VALID_PROVIDERS: Provider[] = ["anthropic", "openrouter", "openai", "gemini"];

async function resolveUserId(clerkId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { clerkId }, select: { id: true } });
  return user?.id ?? null;
}

// ─── GET — list configured providers ─────────────────────

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = await resolveUserId(clerkId);
  if (!userId) {
    console.log(`[provider-get] no_user_record clerkId=${clerkId.slice(0, 12)}…`);
    return NextResponse.json({ providers: [] });
  }

  const keys = await prisma.userProviderKey.findMany({
    where:  { userId },
    select: { provider: true, model: true, isActive: true, lastUsedAt: true, createdAt: true }
  });

  console.log(`[provider-get] found=${keys.length} providers=[${keys.map(k => k.provider).join(",")}]`);

  type KeyRow = { provider: string; model: string | null; isActive: boolean; lastUsedAt: Date | null; createdAt: Date };
  return NextResponse.json({
    providers: (keys as KeyRow[]).map((k) => ({
      provider:    k.provider,
      model:       k.model,
      isActive:    k.isActive,
      lastUsedAt:  k.lastUsedAt,
      configuredAt: k.createdAt
    }))
  });
}

// ─── POST — save / update a provider key ─────────────────

interface SaveBody {
  provider: Provider;
  apiKey: string;
  model?: string;
  testConnection?: boolean;
}

export async function POST(request: Request) {
  const t0 = Date.now();
  console.log(`[provider-save] request_received`);

  const { userId: clerkId } = await auth();
  if (!clerkId) {
    console.log(`[provider-save] auth_failed`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  console.log(`[provider-save] user_authenticated clerkId=${clerkId.slice(0, 12)}…`);

  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { provider, apiKey, model, testConnection = false } = body;
  console.log(`[provider-save] provider=${provider} testConnection=${testConnection} model=${model ?? "default"}`);

  if (!VALID_PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(", ")}` }, { status: 422 });
  }
  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 8) {
    return NextResponse.json({ error: "apiKey must be at least 8 characters" }, { status: 422 });
  }

  const trimmedKey = apiKey.trim();

  // Key format validation — provider-specific prefixes catch typos early.
  if (provider === "openrouter" && !trimmedKey.startsWith("sk-or-")) {
    console.log(`[provider-save] invalid_key_format provider=openrouter prefix=${trimmedKey.slice(0, 6)}`);
    return NextResponse.json(
      { error: "OpenRouter keys must start with sk-or-. Get your key at openrouter.ai/keys" },
      { status: 422 }
    );
  }
  // Gemini keys don't have a single canonical prefix — AI Studio keys start
  // with "AIza" but other Google products (Vertex, workspace-issued credentials)
  // use different prefixes. We skip the prefix check and let the connection
  // test be the source of truth.
  void GEMINI_KEY_PREFIX;
  if (provider === "anthropic" && !trimmedKey.startsWith("sk-ant-")) {
    console.log(`[provider-save] invalid_key_format provider=anthropic prefix=${trimmedKey.slice(0, 6)}`);
    return NextResponse.json(
      { error: "Anthropic keys must start with sk-ant-. Get yours at console.anthropic.com/account/keys" },
      { status: 422 }
    );
  }
  if (provider === "openai" && !trimmedKey.startsWith("sk-")) {
    console.log(`[provider-save] invalid_key_format provider=openai prefix=${trimmedKey.slice(0, 3)}`);
    return NextResponse.json(
      { error: "OpenAI keys must start with sk-. Get yours at platform.openai.com/api-keys" },
      { status: 422 }
    );
  }

  // Lightweight connection test — uses a minimal ping call, NOT the full pipeline.
  // Optional connection test — every provider supports it.
  if (testConnection) {
    console.log(`[provider-save] connection_test_start provider=${provider}`);
    try {
      if (provider === "openrouter")     await testOpenRouterKey(trimmedKey);
      else if (provider === "anthropic") await testAnthropicKey(trimmedKey);
      else if (provider === "openai")    await testOpenAIKey(trimmedKey);
      else if (provider === "gemini")    await testGeminiKey(trimmedKey);
      console.log(`[provider-save] connection_test_passed provider=${provider} elapsed=${Date.now() - t0}ms`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.log(`[provider-save] connection_test_failed provider=${provider} err=${msg}`);
      return NextResponse.json({ error: `Connection test failed: ${msg}` }, { status: 422 });
    }
  }

  // Resolve or create the User record
  let userId: string | null;
  try {
    userId = await withDbTimeout(resolveUserId(clerkId), DB_TIMEOUT_MS);
  } catch (err) {
    const { kind, code, raw, message } = classifyPrismaError(err);
    console.log(`[provider-save] user_lookup_failed kind=${kind}${code ? ` code=${code}` : ""} err=${raw.slice(0, 120)}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
  console.log(`[provider-save] db_user_lookup userId=${userId ? userId.slice(0, 8) + "…" : "not_found"}`);

  if (!userId) {
    console.log(`[provider-save] upserting_user clerkId=${clerkId.slice(0, 12)}…`);
    try {
      const client    = await clerkClient();
      const clerkUser = await client.users.getUser(clerkId);
      const email     = clerkUser.emailAddresses[0]?.emailAddress ?? `${clerkId}@clerk.local`;

      // Use upsert keyed on `email` rather than `create` so we survive the case
      // where a row already exists under this email with a different clerkId
      // (Clerk account re-creation, SSO vs email login, etc.).
      // The update arm reconciles the clerkId — all existing data (projects,
      // provider keys) remains linked to the same internal user record.
      const user = await withRetry(
        () => withDbTimeout(
          prisma.user.upsert({
            where:  { email },
            create: { clerkId, email, name: clerkUser.fullName ?? undefined },
            update: { clerkId, name: clerkUser.fullName ?? undefined },
            select: { id: true }
          }),
          DB_TIMEOUT_MS
        ),
        { label: "user_upsert" }
      );
      userId = user.id;
      console.log(`[provider-save] user_upserted userId=${userId.slice(0, 8)}…`);
    } catch (err) {
      const { kind, code, raw, message } = classifyPrismaError(err);
      console.log(`[provider-save] user_upsert_failed kind=${kind}${code ? ` code=${code}` : ""} err=${raw.slice(0, 120)}`);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Encrypt and persist
  let encryptedKey: string;
  try {
    encryptedKey = encryptKey(trimmedKey);
    console.log(`[provider-save] encryption_success encryptedLen=${encryptedKey.length}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.log(`[provider-save] encryption_failed err=${msg}`);
    return NextResponse.json({ error: "Key encryption failed. Check ENCRYPTION_KEY env variable." }, { status: 500 });
  }

  let record;
  try {
    record = await withRetry(
      () => withDbTimeout(
        prisma.userProviderKey.upsert({
          where:  { userId_provider: { userId: userId!, provider } },
          create: { userId: userId!, provider, encryptedKey, model: model ?? null, isActive: true },
          update: { encryptedKey, model: model ?? null, isActive: true, updatedAt: new Date() },
          select: { id: true, provider: true, model: true, isActive: true, createdAt: true }
        }),
        DB_TIMEOUT_MS
      ),
      { label: "provider_upsert" }
    );
    console.log(
      `[provider-save] db_write_success` +
      ` provider=${provider}` +
      ` userId=${userId!.slice(0, 8)}…` +
      ` recordId=${record.id.slice(0, 8)}…` +
      ` elapsed=${Date.now() - t0}ms`
    );
  } catch (err) {
    const { kind, code, raw, message } = classifyPrismaError(err);
    console.log(
      `[provider-save] db_write_failed` +
      ` kind=${kind}${code ? ` code=${code}` : ""}` +
      ` provider=${provider}` +
      ` elapsed=${Date.now() - t0}ms` +
      ` err=${raw.slice(0, 120)}`
    );

    // When validation already passed, tell the user their key is valid
    // but the save failed — avoids conflating a DB issue with a bad key.
    const tested = testConnection && provider === "openrouter";
    const saveError = kind === "timeout"
      ? `${tested ? "Your key was validated, but it" : "Your key"} couldn't be saved — database timed out. Wait a few seconds and try again.`
      : kind === "connection"
      ? `${tested ? "Your key was validated, but it" : "Your key"} couldn't be saved — database unavailable. Try again shortly.`
      : message;

    return NextResponse.json({ error: saveError }, { status: 500 });
  }

  return NextResponse.json({
    provider:     record.provider,
    model:        record.model,
    isActive:     record.isActive,
    redactedKey:  redactKey(trimmedKey),
    configuredAt: record.createdAt,
    tested:       testConnection && provider === "openrouter"
  });
}

// ─── DELETE — remove a provider key ──────────────────────

export async function DELETE(request: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { provider: Provider };
  try {
    body = (await request.json()) as { provider: Provider };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!VALID_PROVIDERS.includes(body.provider)) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 422 });
  }

  const userId = await resolveUserId(clerkId);
  if (!userId) return NextResponse.json({ success: true }); // idempotent

  await prisma.userProviderKey.deleteMany({
    where: { userId, provider: body.provider }
  });

  return NextResponse.json({ success: true });
}

// ─── POST /test — standalone connection test ──────────────
// Note: consumed by the settings UI "Test Connection" button
// via a separate action; the test flag on POST is preferred.
