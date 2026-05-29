/**
 * V# Streaming Orchestration — OpenRouter only.
 *
 * ARCHITECTURE:
 *   POST /api/orchestrate
 *   → (optional) Reference URL pipeline — Stages 1-4 of the Inspire feature
 *   → (optional) GitHub tree/file retrieval for repository-aware context
 *   → OpenRouter (openai/gpt-4o-mini — canonical model from constants.ts)
 *   → streamed text/plain response
 *
 * LATENCY CONTRACT:
 *   - HTTP 200 headers arrive at client within ~30ms (auth + JSON parse only)
 *   - DB lookup runs concurrently with stream setup — never blocks headers
 *   - Code retrieval runs concurrently with DB lookup when file references detected
 *   - Reference pipeline (when URL present): content fetch + intent extraction
 *     run inside the stream body, concurrent with DB key lookup
 *   - Hard 30s provider timeout — no infinite hangs
 *   - AbortSignal forwarded to provider — client disconnect cancels in-flight work
 *   - lastUsedAt update is fire-and-forget — never delays stream close
 *
 * SECURITY:
 *   - Auth required on every call
 *   - API key decrypted server-side only — never reaches the client
 *   - Raw key never logged (only redacted prefix)
 *   - GitHub token retrieved server-side only — never in the response body
 *   - Reference URLs fetched server-side only — raw transcript never sent to client
 */

import { auth, clerkClient } from "@clerk/nextjs/server";
import OpenAI               from "openai";
import { NextResponse }     from "next/server";

import { prisma }           from "@/lib/prisma";
import { decryptKey }       from "@/server/ai/encryption";
import {
  OPENROUTER_MODEL,
  OPENROUTER_BASE_URL,
  OPENROUTER_KEY_PREFIX,
  MAX_TOKENS
} from "@/server/ai/constants";
import {
  buildVHashSystemPrompt,
  buildVHashSystemPromptWithContext,
  buildVHashSystemPromptWithEvaluation,
  buildVHashSystemPromptForReferenceUnderstanding,
  buildVHashSystemPromptWithReferenceFailure,
  buildConversationalPrompt,
  type RepoContextInput,
  type CodeContext
} from "@/server/ai/vhash-prompt";
import {
  detectReferenceIntent,
  type ReferenceIntentMode
} from "@/server/ai/reference-intent";
import {
  buildRetrievalContext,
  type RetrievalTurn
} from "@/services/github/retrieval";
import {
  getOrBuildSystemMap,
  enrichSystemMapWithTree,
  type RepoSystem
} from "@/server/repo/system-registry";
import {
  buildDomainMap,
  formatDomainMap,
} from "@/server/repo/domain-map";
import { matchIntentToAgent }       from "@/server/repo/agent-registry";
import {
  getModuleContext,
  formatModuleContextForPrompt,
} from "@/server/repo/module-context";
import { fetchRepoTree, searchTree, type RepoTree }    from "@/services/github/tree";
import { buildSemanticRetrievalContext }                from "@/services/github/semantic-retrieval";
import { fetchFileContent }                          from "@/services/github/file";
import {
  parseReferenceUrl,
  type ParsedReferenceUrl
} from "@/services/reference/url-parser";
import { fetchYouTubeTranscript, fetchYouTubeTitle } from "@/services/reference/youtube";
import { fetchLoomContent }                           from "@/services/reference/loom";
import {
  extractImplementationIntent,
  evaluateRepoCompatibility,
  type ImplementationIntent,
  type ReferenceEvaluation
} from "@/server/ai/reference-evaluator";

// ─── Timeouts ─────────────────────────────────────────────

// Supabase serverless can take 2-3s on cold start — 5s gives headroom.
const DB_TIMEOUT_MS           = 5_000;
// Time until the FIRST token arrives. Protects against model queue delays,
// cold starts, and auth failures that don't throw. 20s is generous for
// free-tier models that are slower to start.
const FIRST_TOKEN_TIMEOUT_MS  = 20_000;
// Inactivity timeout AFTER streaming starts. Resets on every received token.
// Fires only when tokens stop mid-stream for >15s — not on long but active responses.
// This is what was killing "explain in detail" requests on the free tier:
// the old flat 30s cap fired on long valid responses. This only fires on hangs.
const NO_PROGRESS_TIMEOUT_MS  = 15_000;
// Hard cap for reference content fetch (YouTube transcript, Loom oEmbed)
const REFERENCE_TIMEOUT_MS    = 5_000;

// ─── Types ────────────────────────────────────────────────

export type ConversationTurn = RetrievalTurn;

interface OrchestrationRequest {
  message:           string;
  history?:          ConversationTurn[];
  repositoryContext: RepoContextInput;
  /** Optional: a reference URL extracted client-side from the message */
  referenceUrl?:     string;
}

// ─── OpenRouter streaming ─────────────────────────────────

async function* streamOpenRouter(
  apiKey:    string,
  system:    string,
  messages:  ConversationTurn[],
  signal:    AbortSignal
): AsyncGenerator<string> {
  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      "HTTP-Referer": "https://decode-x.ai",
      "X-Title":      "DE-code X"
    }
  });

  console.log(`[orchestrate] openrouter_request_started model=${OPENROUTER_MODEL} messages=${messages.length}`);

  let stream;
  try {
    stream = await client.chat.completions.create(
      {
        model:      OPENROUTER_MODEL,
        max_tokens: MAX_TOKENS,
        stream:     true,
        messages:   [
          { role: "system", content: system },
          ...messages.map((m) => ({ role: m.role, content: m.content }))
        ]
      },
      { signal }
    );
  } catch (err) {
    if (signal.aborted) return;
    // Surface auth failures and network errors clearly
    if (err instanceof OpenAI.APIError) {
      if (err.status === 401 || err.status === 403) {
        throw new Error("OpenRouter authentication failed. Check your API key in Settings → AI Providers.");
      }
      if (err.status === 429) {
        throw new Error("OpenRouter rate limit exceeded. Wait a moment and try again.");
      }
      throw new Error(`OpenRouter request failed (${err.status}): ${err.message}`);
    }
    throw err;
  }

  console.log(`[orchestrate] openrouter_response_200`);

  let firstToken = true;
  for await (const chunk of stream) {
    if (signal.aborted) break;
    const text = chunk.choices[0]?.delta?.content ?? "";
    if (text) {
      if (firstToken) {
        console.log(`[orchestrate] first_token_received`);
        firstToken = false;
      }
      yield text;
    }
  }
}

// ─── Mock streaming fallback ──────────────────────────────
// Used when no OpenRouter key is configured.
// Simulates realistic streaming latency to validate the UI pipeline.

function buildMockResponse(ctx: RepoContextInput, message: string): string {
  const name = ctx.name;
  const lang = ctx.language ?? "TypeScript";
  const msg  = message.toLowerCase();

  const isUpload   = /upload|file|storage|chunk|multipart|s3|blob/.test(msg);
  const isAuth     = /auth|login|session|jwt|oauth|permission|role|rbac/.test(msg);
  const isRealtime = /realtime|websocket|socket|live|presence|broadcast|sse/.test(msg);
  const isDB       = /database|migration|schema|table|prisma|query|orm/.test(msg);
  const isAPI      = /api|endpoint|route|rest|graphql|handler/.test(msg);
  const isAI       = /ai|llm|claude|openai|embedding|vector|model|inference/.test(msg);
  const isTest     = /test|spec|coverage|jest|vitest|cypress/.test(msg);
  const isPerf     = /performance|slow|optimis|cache|latency|scale/.test(msg);

  if (isUpload) {
    return `${name} — upload architecture context (${lang}):

Synchronous file handling inside route handlers couples upload lifecycle to the HTTP response thread. Uploads block until completion, creating timeout risk for large files.

Architecture impact:

The current route handler owns the full upload transaction. Any network interruption or file processing error fails the entire request with no recovery path.

Affected systems:

* Upload route handler (primary change)
* Storage abstraction layer
* Background job infrastructure (new)
* Frontend upload hook (progress, retry)

Implementation approach:

1. Add presigned URL generation endpoint — browser uploads directly to storage, bypassing your API server
2. Store upload session records in the database for resumability
3. Accept a webhook from storage on completion; trigger processing async
4. Move virus scanning and format validation into a queue worker

Risks / sequencing:

Presigned URL endpoint first. Get direct-to-storage working before building the async processing layer. Attempting both simultaneously makes debugging significantly harder.`;
  }

  if (isAuth) {
    return `${name} — auth boundary context (${lang}):

Auth changes carry the highest cascade risk of any codebase modification. Every protected route and middleware depends on the session contract being stable.

Architecture impact:

Changes to session ownership, token shape, or privilege assertion will propagate silently through middleware layers. The failure mode is often authorization bypass, not a hard error.

Affected systems:

* Auth middleware / session validation
* Protected route handlers
* Token refresh logic
* Client session state

Implementation approach:

1. Audit current middleware to map the full session ownership model before changing anything
2. Isolate all auth logic behind a single service boundary
3. Validate privilege assertions server-side on every request — never trust client state
4. Gate rollout behind a feature flag

Risks / sequencing:

Run security review before merging any auth boundary changes. The session contract must be versioned — do not change it without backward compatibility for active sessions.`;
  }

  if (isRealtime) {
    return `${name} — real-time infrastructure context (${lang}):

Adding a persistent connection layer to an existing ${lang} codebase requires strict isolation. WebSocket/SSE connections cannot share the same transport as synchronous request-response routes without introducing backpressure issues.

Architecture impact:

Persistent connections change the server's memory profile — connection count scales with active users, not requests. Horizontal scaling requires a shared pub/sub layer.

Affected systems:

* Transport server (new infrastructure, isolated from existing routes)
* Auth handshake (connection-level session validation)
* Client connection hook (lifecycle, reconnect, state reconciliation)
* Database query patterns (optimise for real-time read access)

Implementation approach:

1. Isolate WebSocket/SSE on a dedicated server path
2. Authenticate at handshake time using the same session mechanism as HTTP
3. Introduce a pub/sub layer (Redis or Supabase Realtime) for horizontal scaling
4. Implement client-side reconnection with exponential backoff

Risks / sequencing:

Connection authentication first. A real-time layer without session validation is an unauthenticated broadcast endpoint.`;
  }

  if (isDB) {
    return `${name} — database migration context (${lang}):

Live database migrations require additive-first thinking. Destructive operations — DROP, RENAME, constraint additions on populated tables — carry downtime risk proportional to table size.

Architecture impact:

Any column removal or type change that existing queries reference will fail at runtime, not at deploy time. The failure is often delayed until the old code path executes.

Affected systems:

* Schema migration files
* Affected ORM model queries
* API handlers reading or writing affected tables
* Background jobs if a data backfill is required

Implementation approach:

1. Write all changes as additive: new nullable columns, new tables, new indexes
2. Deploy application code that supports both old and new schema shapes
3. Run backfill as a background job — never in the migration script
4. Remove the deprecated column in a separate migration after old code is fully retired

Risks / sequencing:

Never run \`prisma migrate deploy\` directly against production without a tested rollback. Always validate against a production-size staging dataset first.`;
  }

  if (isAI) {
    return `${name} — AI inference integration context (${lang}):

AI provider calls are non-deterministic external dependencies. Treat them like any unreliable network service: latency spikes, rate limits, and output variability are the expected steady state, not exceptions.

Architecture impact:

Synchronous AI calls in request handlers will block response threads and create timeout pressure for users. Provider outages will cause your features to fail rather than degrade gracefully.

Affected systems:

* Server-side provider abstraction (new layer)
* Streaming response route handler
* Client streaming state accumulation and abort handling
* Caching layer for deterministic results

Implementation approach:

1. Route all inference through a server-side abstraction — never expose API keys or call providers from the browser
2. Stream responses to clients — reduces perceived latency and avoids timeout pressure
3. Cache embedding results and any idempotent inference (same input → same output)
4. Implement graceful degradation when the provider is unavailable

Risks / sequencing:

Set explicit \`max_tokens\` on every call. Unbounded completions are the fastest way to exceed budget. Add circuit-breaker logic before shipping to production.`;
  }

  if (isPerf) {
    return `${name} — performance context (${lang}):

Most ${lang} performance regressions trace to three causes: N+1 query patterns, missing database indexes on high-traffic access paths, and unoptimised list endpoints without pagination.

Architecture impact:

Feed-style endpoints without cursor pagination will degrade linearly as data grows. N+1 patterns are silent at small scale and catastrophic at 10k+ records.

Affected systems:

* Database query layer (indexes, select projections, join strategies)
* List and feed API endpoints (pagination strategy)
* Caching layer (TTL design, invalidation triggers)
* Frontend data fetching (stale-while-revalidate, prefetch)

Implementation approach:

1. Profile query execution plans for the slowest endpoints first
2. Add cursor-based pagination to any endpoint returning more than 50 rows
3. Use ORM \`select\` projections — never fetch columns you don't need
4. Cache expensive aggregations at the query level, not the component level

Risks / sequencing:

Measure before optimizing. Add observability (query timing, cache hit rates) before making changes — guessing at bottlenecks wastes engineering time.`;
  }

  if (isTest) {
    return `${name} — testing context (${lang}):

Effective test coverage targets behavioral boundaries, not implementation details. Tests that verify HOW something works rather than WHAT it does become liabilities during refactoring.

Architecture impact:

Auth middleware and permission boundaries require their own test surface — they are load-bearing and should not be validated only as a side-effect of route handler tests.

Affected systems:

* Test infrastructure (database seeding, mock boundaries)
* Auth middleware tests (isolated permission coverage)
* Route handler integration tests (real DB, mocked external services)
* Client interaction tests (behavior, not implementation)

Implementation approach:

1. Unit-test pure business logic functions in isolation — mock all I/O
2. Integration-test API routes against a real database (test container or isolated schema)
3. Test auth middleware in isolation with explicit privilege scenarios
4. Reserve E2E tests for the 3–5 highest-value user paths

Risks / sequencing:

Test auth boundaries before anything else. Permission regressions are the hardest class of bug to detect in production.`;
  }

  if (isAPI) {
    return `${name} — API design context (${lang}):

API contracts solidify quickly once clients consume them. Versioning, error format, and auth boundary choices are expensive to change after the first external consumer.

Architecture impact:

Inconsistent error responses across routes create unpredictable client behavior. Auth scattered across handlers rather than centralized in middleware creates security surface area.

Affected systems:

* Route handler structure
* Request validation middleware
* Error response contract
* Auth middleware integration

Implementation approach:

1. Define an explicit error response schema and use it on every route
2. Version from day one (\`/api/v1/\`) even with a single version — retrofitting is painful
3. Validate request schemas at the route boundary before business logic
4. Centralize auth in middleware — no auth checks inside individual handlers

Risks / sequencing:

Error contract and auth middleware first. These are the hardest things to change after clients are integrated.`;
  }

  return `${name} — implementation context (${lang}):

The requested change touches application logic. Without knowing the specific layer, I can reason about the general architectural implications.

To give you a precise strategy, describe:

* which layer this affects — API, data, frontend, or infrastructure
* whether this introduces new dependencies or modifies existing service boundaries
* any scale or traffic expectations for the feature

Once those are clear, I can map the affected areas, sequence the implementation, and flag any architectural risks before you write a line of code.`;
}

async function* streamMock(
  ctx:     RepoContextInput,
  message: string,
  signal:  AbortSignal
): AsyncGenerator<string> {
  console.log(`[orchestrate] mock_stream_started`);
  const text      = buildMockResponse(ctx, message);
  const chunkSize = 5;
  for (let i = 0; i < text.length; i += chunkSize) {
    if (signal.aborted) {
      console.log(`[orchestrate] mock_stream_aborted`);
      break;
    }
    yield text.slice(i, i + chunkSize);
    await new Promise<void>((r) => setTimeout(r, 12 + Math.random() * 8));
  }
  console.log(`[orchestrate] mock_stream_completed`);
}

// Code reference extraction and multi-file retrieval pipeline live in:
// services/github/retrieval.ts → buildRetrievalContext()

// ─── Conversational message detection ────────────────────
// Classifies short, casual, non-technical messages so V# can
// respond with its personality layer instead of the full
// architecture prompt. Technical intent always wins.

const CASUAL_PATTERNS = /^(yo|hey|hi+|hello|sup|wassup|what'?s\s?up|what'?s\s?happening|you\s+alive|wake\s+up|we'?re?\s+back|we\s+back|good\s+(morning|afternoon|evening|night)|let'?s\s+(cook|go|start|build|ship)|ready|i'?m\s+back|back\s+online|online|you\s+there|still\s+there|ping|you\s+good|check(ing)?\s+in|check\s+check|this\s+feel(s)?\s+(broken|off|wrong)|sounds\s+good|alright|ok+ay?|roger|got\s+it|cool|nice|great|yep|nah|yeah)\b/i;

const TECHNICAL_TERMS = /\b(add|fix|build|create|implement|debug|refactor|update|delete|remove|migrate|deploy|test|api|auth|db|sql|route|component|hook|type|interface|class|function|import|export|schema|query|endpoint|server|client|stream|event|modal|form|layout|nav|button|page|config|env|error|bug|crash|slow|performance|cache|queue|job|worker|cron|webhook|realtime|socket|upload|download|storage|file|image|token|session|cookie|key|secret|role|permission|rbac|middleware|proxy|cors|ci|cd|pipeline|docker|k8s|infra|vm|ssl|cert|dns|domain|repo|branch|commit|pr|merge|rebase)\b/i;

/**
 * Returns true when the message reads as casual/conversational
 * rather than a technical directive.
 *
 * Rules (in priority order):
 * 1. If message contains technical terms → always false (technical wins)
 * 2. If message matches casual patterns → true
 * 3. If message is very short (≤ 12 chars) and no technical terms → true
 */
function isConversationalMessage(message: string): boolean {
  const trimmed = message.trim();
  // Technical intent overrides everything
  if (TECHNICAL_TERMS.test(trimmed)) return false;
  // Explicit casual patterns
  if (CASUAL_PATTERNS.test(trimmed)) return true;
  // Short non-technical message (single word or short phrase)
  if (trimmed.length <= 12 && !/\?/.test(trimmed)) return true;
  return false;
}

// ─── Reference pipeline — stages 1+2 ─────────────────────
// Stage 1 (URL parse) is handled client-side; the parsed URL arrives
// as `referenceUrl` in the request body.
// Stage 2 (content fetch) runs here: 5s hard timeout, graceful fallback.

interface ReferenceContent {
  parsed: ParsedReferenceUrl;
  text:   string;        // transcript or description text
  title?: string;        // platform title (for V# context)
}

async function fetchReferenceContent(
  rawUrl: string
): Promise<ReferenceContent | null> {
  const parsed = parseReferenceUrl(rawUrl);
  if (parsed.type === "unsupported") {
    console.log(`[reference] url_unsupported url=${rawUrl.slice(0, 60)}`);
    return null;
  }

  console.log(
    `[reference] content_fetch_started` +
    ` type=${parsed.type}` +
    ` id=${parsed.id}`
  );

  try {
    if (parsed.type === "youtube") {
      const [transcript, title] = await Promise.all([
        fetchYouTubeTranscript(parsed.id),
        fetchYouTubeTitle(parsed.id)
      ]);
      if (!transcript && !title) return null;
      return {
        parsed,
        text:  transcript ?? `YouTube video: ${title ?? parsed.id}`,
        title: title ?? undefined
      };
    }

    if (parsed.type === "loom") {
      const content = await fetchLoomContent(parsed.id);
      if (!content) return null;
      return { parsed, text: content.text, title: content.title ?? undefined };
    }

    if (parsed.type === "twitter") {
      // oEmbed gives us the tweet text — no video transcript available
      const endpoint = `https://publish.twitter.com/oembed?url=${encodeURIComponent(rawUrl)}&format=json`;
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(3_000) });
      if (!res.ok) return null;
      const data = await res.json() as { html?: string; author_name?: string };
      // Strip HTML tags to get plain text
      const text = (data.html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return text ? { parsed, text: text.slice(0, 3_000), title: data.author_name } : null;
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(
      `[reference] content_fetch_failed` +
      ` type=${parsed.type}` +
      ` id=${parsed.id}` +
      ` err=${msg.slice(0, 80)}`
    );
  }

  return null;
}

// ─── Stage 3.5: Intent-derived retrieval ─────────────────
// Derives search targets from the extracted ImplementationIntent and retrieves
// actual source files. Runs after Stage 3, before Stage 4.
//
// CRITICAL: Calls searchTree() directly — NOT buildRetrievalContext().
// buildRetrievalContext() gates on extractCodeRefs() which requires file
// extensions or PascalCase names. An intent query like "request throttling
// middleware" produces zero extractCodeRefs() matches → function returns null.
// Intent-derived retrieval MUST bypass extractCodeRefs() entirely.

/**
 * Reduce a multi-word engineering term to its most distinctive search keyword.
 * "request throttling middleware" → "throttling"
 * "Redis TTL cache" → "redis"
 * "horizontal scaling" → "scaling"
 */
function tokenizeToKeyword(term: string): string {
  const words = term
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(w => w.length >= 4);
  // Prefer the longest word (most specific) — sort descending by length
  return words.sort((a, b) => b.length - a.length)[0] ?? term.toLowerCase().slice(0, 8);
}

async function buildIntentRetrievalContext(
  intent:         ImplementationIntent,
  ctx:            RepoContextInput,
  clerkId:        string,
  /**
   * Pre-fetched GitHub OAuth token from the route handler.
   * If provided, skips the Clerk round-trip — eliminates redundant token fetches
   * when multiple retrieval functions are called in the same request.
   * If omitted (or undefined), falls back to fetching from Clerk internally.
   */
  preloadedToken?: string
): Promise<CodeContext | null> {
  // ── 1. GitHub OAuth token ──────────────────────────────
  // Use pre-loaded token if provided by the route handler.
  let githubToken: string | undefined = preloadedToken;
  if (!githubToken) {
    try {
      const client = await clerkClient();
      const tokens = await client.users.getUserOauthAccessToken(clerkId, "github");
      githubToken  = tokens.data[0]?.token;
    } catch {
      return null; // GitHub not connected — graceful degradation
    }
  }
  if (!githubToken) return null;

  // ── 2. Parse owner/repo/branch ─────────────────────────
  const [owner, repo] = ctx.fullName.split("/");
  if (!owner || !repo) return null;
  const branch = ctx.defaultBranch ?? "main";

  // ── 3. Fetch tree (almost always a cache hit in reference flow) ─
  let tree: RepoTree;
  try {
    tree = await fetchRepoTree(owner, repo, branch, githubToken);
  } catch (err) {
    console.log(
      `[semantic] tree_fetch_failed` +
      ` owner=${owner} repo=${repo}` +
      ` err=${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }

  // ── 4. Derive 1-2 keyword search terms from intent ─────
  // systems first (most engineering-specific), then patterns as fallback
  const rawTerms = [...(intent.systems ?? []), ...(intent.patterns ?? [])].slice(0, 4);
  const searchTerms = [...new Set(rawTerms.map(tokenizeToKeyword).filter(Boolean))];

  console.log(`[semantic] retrieval_targets derived=${JSON.stringify(searchTerms)}`);

  if (!searchTerms.length) return null;

  // ── 5. Search tree and collect deduplicated candidates ─
  const seenPaths = new Set<string>();
  const candidates: string[] = [];

  for (const term of searchTerms) {
    const matches = searchTree(tree, term, 3);
    for (const m of matches) {
      if (!seenPaths.has(m.path)) {
        seenPaths.add(m.path);
        candidates.push(m.path);
      }
      if (candidates.length >= 3) break;
    }
    if (candidates.length >= 3) break;
  }

  if (!candidates.length) return null;

  // ── 6. Fetch top 2-3 files concurrently ───────────────
  const topPaths = candidates.slice(0, 3);
  const fetchResults = await Promise.allSettled(
    topPaths.map(path => fetchFileContent(owner, repo, path, githubToken!))
  );

  const files: CodeContext["files"] = [];
  let totalChars = 0;

  for (const result of fetchResults) {
    if (result.status === "fulfilled") {
      const f = result.value;
      files.push({ path: f.path, content: f.content, truncated: f.truncated });
      totalChars += f.content.length;
    }
  }

  if (!files.length) return null;

  console.log(
    `[semantic] retrieval_complete files=${files.length} chars=${totalChars}`
  );

  return { files, treeQuery: searchTerms.join(" ") };
}

// ─── System-name-triggered retrieval ─────────────────────
// Fires when normal code retrieval found nothing but a system map is available.
// Bridges the gap between "I know BullMQ is installed" and "here's where it's
// actually configured" — uses the detected package names as tree search terms
// to find real configuration files, then fetches them for V# to read.
//
// Without this, V# hallucinates generic file paths (src/queue/index.ts) because
// it knows the system exists from package.json but has no actual file evidence.

/** Per-system keyword sets for message relevance scoring. */
const SYSTEM_MSG_KEYWORDS: Record<string, string[]> = {
  "Authentication":         ["auth", "login", "signup", "token", "session", "user", "firebase", "clerk", "supabase"],
  "Database":               ["database", "db", "table", "query", "schema", "migration", "record", "row"],
  "AI Orchestration":       ["ai", "model", "prompt", "llm", "inference", "openai", "anthropic", "embedding"],
  "Realtime Messaging":     ["realtime", "socket", "live", "broadcast", "channel", "subscribe", "presence"],
  "File Uploads":           ["upload", "file", "storage", "image", "media", "bucket", "blob"],
  "Payments":               ["payment", "billing", "stripe", "charge", "subscription", "invoice"],
  "Queue Systems":          ["queue", "job", "worker", "background", "cron", "task", "schedule", "async"],
  "Infrastructure/Caching": ["redis", "cache", "rate", "limit", "ttl", "performance"],
};

/**
 * Score how relevant a detected system is to the current message.
 * Higher = more relevant. Systems with score 0 are searched last.
 */
function systemRelevanceScore(system: RepoSystem, msgLower: string): number {
  let score = 0;
  // System name match (e.g. message says "queue" and system is "Queue Systems")
  if (msgLower.includes(system.name.toLowerCase())) score += 3;
  // Stack component match (e.g. message says "bullmq" or "firebase")
  for (const c of system.stackComponents) {
    if (msgLower.includes(c.toLowerCase())) score += 2;
  }
  // Broad keyword match
  const keywords = SYSTEM_MSG_KEYWORDS[system.name] ?? [];
  for (const kw of keywords) {
    if (msgLower.includes(kw)) { score += 1; break; }
  }
  return score;
}

/**
 * System-level fallback search terms — used when component-name terms
 * don't match any file paths (e.g. "bullmq" finds nothing because the repo
 * names its queue files "worker.ts" or "jobs.ts", not "bullmq.ts").
 *
 * Component-specific terms are tried first (more precise).
 * These fallback terms cover the common file naming conventions for each system.
 */
const SYSTEM_FALLBACK_TERMS: Record<string, string[]> = {
  "Authentication":         ["auth", "login", "signup", "session"],
  "Database":               ["db", "database", "schema", "prisma", "model"],
  "AI Orchestration":       ["ai", "openai", "anthropic", "prompt", "llm"],
  "Realtime Messaging":     ["realtime", "socket", "channel", "broadcast"],
  "File Uploads":           ["upload", "storage", "bucket", "media"],
  "Payments":               ["payment", "billing", "webhook", "stripe"],
  "Queue Systems":          ["queue", "worker", "job", "processor", "bull"],
  "Infrastructure/Caching": ["redis", "cache", "rate"],
};

/**
 * Derive file tree search terms from a system's stack components + system-level fallbacks.
 *
 * Component terms first (precise): "BullMQ" → "bullmq", "ioredis/Redis" → "ioredis"
 * System fallbacks second: Queue Systems → ["queue", "worker", "job", "processor", "bull"]
 *
 * This ensures that repos which name their queue files "worker.ts" or "jobs.ts"
 * (rather than "bullmq.ts") are still matched.
 */
function systemToSearchTerms(system: RepoSystem): string[] {
  const componentTerms = system.stackComponents
    .slice(0, 2)
    .map(c =>
      c.toLowerCase()
        .split("/")[0]             // "ioredis/Redis" → "ioredis"
        .replace(/[^a-z0-9]/g, "") // strip special chars
    )
    .filter(t => t.length >= 3);

  const fallbackTerms = SYSTEM_FALLBACK_TERMS[system.name] ?? [];

  // Deduplicated: component terms first (more specific), fallbacks catch the rest
  return [...new Set([...componentTerms, ...fallbackTerms])];
}

/**
 * Given a system map, search the repo tree for actual configuration files
 * and return them as a CodeContext so V# can read real paths and values.
 *
 * Runs after system map is ready, before prompt assembly.
 * Returns null on any failure — always fail-open.
 */
async function buildSystemNameRetrieval(
  systems:        RepoSystem[],
  message:        string,
  ctx:            RepoContextInput,
  clerkId:        string,
  /**
   * Pre-fetched GitHub OAuth token from the route handler.
   * If provided, skips the Clerk round-trip — eliminates redundant token fetches
   * when multiple retrieval functions are called in the same request.
   * If omitted (or undefined), falls back to fetching from Clerk internally.
   */
  preloadedToken?: string
): Promise<CodeContext | null> {
  // ── 1. GitHub token ────────────────────────────────────────
  // Use pre-loaded token if provided by the route handler (eliminates duplicate
  // Clerk round-trips when multiple retrieval functions run per request).
  let githubToken: string | undefined = preloadedToken;
  if (!githubToken) {
    try {
      const client = await clerkClient();
      const tokens = await client.users.getUserOauthAccessToken(clerkId, "github");
      githubToken  = tokens.data[0]?.token;
    } catch {
      return null;
    }
  }
  if (!githubToken) return null;

  // ── 2. Parse owner/repo ────────────────────────────────────
  const [owner, repo] = ctx.fullName.split("/");
  if (!owner || !repo) return null;
  const branch = ctx.defaultBranch ?? "main";

  // ── 3. Fetch tree (almost always a cache hit) ──────────────
  let tree: RepoTree;
  try {
    tree = await fetchRepoTree(owner, repo, branch, githubToken);
  } catch {
    return null;
  }

  // ── 4. Rank systems by message relevance, take top 2 ──────
  const msgLower = message.toLowerCase();
  const ranked = systems
    .slice()
    .sort((a, b) => systemRelevanceScore(b, msgLower) - systemRelevanceScore(a, msgLower))
    .slice(0, 2);

  // ── 5. Derive search terms and scan tree ───────────────────
  const seenPaths = new Set<string>();
  const candidates: string[] = [];

  for (const sys of ranked) {
    const terms = systemToSearchTerms(sys);
    for (const term of terms) {
      const matches = searchTree(tree, term, 4);
      for (const m of matches) {
        // Skip test files — they confirm packages exist but don't show configuration
        if (
          m.path.includes(".test.") ||
          m.path.includes(".spec.") ||
          m.path.includes("__tests__") ||
          m.path.includes("/__mocks__/")
        ) continue;
        if (!seenPaths.has(m.path)) {
          seenPaths.add(m.path);
          candidates.push(m.path);
        }
        if (candidates.length >= 4) break;
      }
      if (candidates.length >= 4) break;
    }
    if (candidates.length >= 4) break;
  }

  if (!candidates.length) {
    console.log(`[system-registry] name_retrieval_no_candidates msg_len=${message.length}`);
    return null;
  }

  // ── 6. Fetch top 4 files concurrently ─────────────────────
  // FIX: was slice(0, 2) — raised to match normal retrieval budget (BUDGET.MAX_FILES=4).
  // Cross-cutting queries (e.g. payment webhooks spanning handler + validator + queue +
  // idempotency layers) need at least 4 files for meaningful context.
  const topPaths = candidates.slice(0, 4);
  const fetchResults = await Promise.allSettled(
    topPaths.map(path => fetchFileContent(owner, repo, path, githubToken!))
  );

  const files: CodeContext["files"] = [];
  let totalChars = 0;

  for (const result of fetchResults) {
    if (result.status === "fulfilled") {
      const f = result.value;
      files.push({ path: f.path, content: f.content, truncated: f.truncated });
      totalChars += f.content.length;
    }
  }

  if (!files.length) return null;

  const termsUsed = ranked.flatMap(systemToSearchTerms);
  console.log(
    `[system-registry] name_retrieval_complete` +
    ` files=${files.length}` +
    ` chars=${totalChars}` +
    ` terms=${JSON.stringify(termsUsed)}`
  );

  return { files, treeQuery: termsUsed.join(" ") };
}

// ─── Route handler ────────────────────────────────────────

export async function POST(request: Request) {
  const t0 = Date.now();
  console.log(`[orchestrate] request_start model=${OPENROUTER_MODEL}`);

  // ── 1. Auth ───────────────────────────────────────────────
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    console.log(`[orchestrate] auth_failed`);
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // ── 2. Parse body ─────────────────────────────────────────
  let body: OrchestrationRequest;
  try {
    body = (await request.json()) as OrchestrationRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { message, history = [], repositoryContext, referenceUrl } = body;
  if (!message?.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 422 });
  }

  const hasReference = Boolean(referenceUrl?.trim());

  // Detect reference intent early — determines which pipeline stages activate.
  // understanding → skip Stage 3+3.5+4 (saves ~550-850ms + one LLM call)
  // evaluation    → full pipeline (default)
  // hybrid        → full pipeline + summarizeFirst directive in V# prompt
  //
  // Bare URL rule: when the message is ONLY a URL with no surrounding text,
  // the user wants to understand the content — not run a compatibility analysis.
  // Default to "understanding" to skip Stage 3 (intent extraction LLM call)
  // and serve a direct content explanation.
  const messageWithoutUrl = referenceUrl
    ? message.trim().replace(referenceUrl.trim(), "").trim()
    : message.trim();
  const isBareUrl = hasReference && messageWithoutUrl.length === 0;

  const referenceMode: ReferenceIntentMode | null = hasReference
    ? (isBareUrl ? "understanding" : detectReferenceIntent(message.trim()))
    : null;

  // ── 3. Classify message ───────────────────────────────────
  // Reference messages are never classified as conversational —
  // they always carry implementation intent.
  const isConversational = hasReference ? false : isConversationalMessage(message.trim());
  console.log(
    `[orchestrate] message_route` +
    ` conversational=${isConversational}` +
    ` reference=${hasReference}` +
    ` referenceMode=${referenceMode ?? "n/a"}` +
    ` len=${message.trim().length}`
  );
  if (hasReference) {
    console.log(`[reference] url_present url=${referenceUrl!.slice(0, 80)}`);
    console.log(`[reference] intent_mode_detected mode=${referenceMode!}`);
  }

  const messages: ConversationTurn[] = [
    ...history.slice(-10),
    { role: "user", content: message.trim() }
  ];

  // ── 4. Kick off parallel async work — do NOT await yet ───
  // a) DB lookup for the OpenRouter key
  // b) Code context retrieval (tree search + file fetch) when refs are detected
  // c) Reference content fetch (YouTube transcript / Loom metadata / tweet text)
  // All run concurrently while the stream response is being set up.

  // Pre-fetch GitHub OAuth token once — shared across all retrieval functions.
  // Eliminates 3-4 redundant Clerk round-trips per request (buildRetrievalContext,
  // buildSystemNameRetrieval, buildIntentRetrievalContext, getOrBuildSystemMap each
  // previously fetched independently). Runs in parallel with everything else.
  // 3s cap matches the system map timeout — any downstream function that receives
  // `undefined` will fall back to its own Clerk fetch as a safe degradation.
  const githubTokenPromise: Promise<string | undefined> =
    isConversational
      ? Promise.resolve(undefined)
      : clerkClient()
          .then(client => client.users.getUserOauthAccessToken(clerkId, "github"))
          .then(tokens => tokens.data[0]?.token)
          .catch(() => undefined);

  const keyPromise = prisma.userProviderKey
    .findFirst({
      where: {
        user:      { clerkId },
        provider:  "openrouter",
        isActive:  true
      },
      select: { encryptedKey: true, model: true }
    })
    .catch(() => null);

  // Only retrieve code context for technical (non-conversational) messages.
  // When a reference URL is present, code context is handled by Stage 3.5
  // (buildIntentRetrievalContext — intent-derived retrieval) which runs after
  // intent extraction. Kicking off buildRetrievalContext here would waste a
  // GitHub API round-trip that returns nothing (extractCodeRefs finds no matches
  // in reference-mode messages which typically contain a plain URL + question).
  const codeContextPromise: Promise<CodeContext | null> =
    isConversational || hasReference
      ? Promise.resolve(null)
      : Promise.race([
          githubTokenPromise.then(token =>
            buildRetrievalContext(message.trim(), repositoryContext, clerkId, history, token)
          ),
          new Promise<null>((r) => setTimeout(() => r(null), 5_000))
        ]).catch(() => null);

  // System map build — runs parallel with DB key lookup and code context retrieval.
  // Skipped only for conversational messages (no technical context needed).
  //
  // FIX: Previously also skipped for reference messages — this prevented the system
  // map (detected packages from package.json) from being injected into reference-mode
  // prompts. The evaluation prompt calls formatSystemMap(ctx.systems) via the base
  // buildVHashSystemPrompt(), so without the map, V# has no package evidence when
  // assessing compatibility ("we have BullMQ installed" vs invented guess).
  //
  // Reference messages still skip systemNameRetrievalPromise (Stage 3.5 in the
  // reference pipeline already handles targeted file retrieval for that flow).
  //
  // Cache hit (common path after first call): zero network calls.
  // Cold build: 1-2 GitHub API calls — hard 3s timeout to protect stream startup.
  const systemMapPromise =
    isConversational
      ? Promise.resolve(null)
      : Promise.race([
          getOrBuildSystemMap(
            repositoryContext.fullName,
            clerkId,
            repositoryContext.language
          ),
          new Promise<null>((r) => setTimeout(() => r(null), 3_000))
        ]).catch(() => null);

  // v2 Architecture Intelligence: fetch tree for evidence enrichment + domain mapping.
  //
  // The tree is almost always a cache hit here (10-min TTL in tree.ts) because
  // buildRetrievalContext and buildSystemNameRetrieval both fetch it. In the rare case
  // where neither ran (e.g. reference-mode message with no code context), this triggers
  // the one GitHub API call needed to populate the cache for all subsequent requests.
  //
  // Used for:
  //   T2.1 — enrichSystemMapWithTree: upgrades "partial" → "strong" where source files confirm
  //   T2.2 — buildDomainMap: structural architecture shape for V# context (T2.3 injection)
  //
  // Skipped for conversational messages (no architecture context needed).
  // Hard 5s cap — same as codeContextPromise, never delays stream startup beyond DB wait.
  const [enrichOwner, enrichRepo] = repositoryContext.fullName.split("/");
  const enrichBranch = repositoryContext.defaultBranch ?? "main";
  const treeForArchitecturePromise: Promise<RepoTree | null> =
    isConversational || !enrichOwner || !enrichRepo
      ? Promise.resolve(null)
      : Promise.race([
          githubTokenPromise.then(async token => {
            if (!token) return null;
            return fetchRepoTree(enrichOwner, enrichRepo, enrichBranch, token);
          }),
          new Promise<null>((r) => setTimeout(() => r(null), 5_000))
        ]).catch(() => null);

  // System-name-triggered retrieval — chains on system map, starts immediately
  // after the map resolves (instant on cache hit).
  //
  // Closes the hallucination gap: V# knows "BullMQ is installed" from package.json
  // but invents file paths because it has no file evidence. This retrieval finds
  // the actual configuration files (e.g. src/queue/bull.ts) and fetches their
  // content so V# reads real paths and real values instead of guessing.
  //
  // Skipped for reference messages — Stage 3.5 (buildIntentRetrievalContext) already
  // handles targeted file retrieval for the reference pipeline; running system-name
  // retrieval in parallel would fetch files that activeCodeContext never injects
  // (reference prompt branches fire before the activeCodeContext else-if branch).
  //
  // Only used as a fallback when normal code retrieval (codeContextPromise)
  // found nothing. Hard 2.5s cap — must not extend stream startup past DB timeout.
  const systemNameRetrievalPromise: Promise<CodeContext | null> =
    isConversational || hasReference
      ? Promise.resolve(null)
      : systemMapPromise
          .then(map =>
            map?.systems.length
              ? githubTokenPromise.then(token =>
                  Promise.race([
                    buildSystemNameRetrieval(
                      map.systems,
                      message.trim(),
                      repositoryContext,
                      clerkId,
                      token          // FIX: reuse pre-fetched token — avoids redundant Clerk call
                    ),
                    new Promise<null>((r) => setTimeout(() => r(null), 2_500))
                  ])
                )
              : null
          )
          .catch(() => null);

  // Module intelligence — fetch top stored findings for the most relevant
  // intelligence module (sentinel, pulse, cipher, atlas).
  //
  // Only fires for technical, non-reference, non-conversational messages.
  // matchIntentToAgent() is a fast in-memory substring match (no I/O).
  // getModuleContext() hits the DB but races a 1s timeout — never blocks the stream.
  //
  // When findings exist, they are injected into repositoryContext.moduleIntelligence
  // so V# can answer questions grounded in persisted analysis.
  const detectedModule = (
    !isConversational && !hasReference && repositoryContext.fullName
  ) ? matchIntentToAgent(message.trim()) : null;

  const moduleIntelligencePromise: Promise<string | null> =
    detectedModule && repositoryContext.fullName
      ? Promise.race([
          (async () => {
            const [owner, repo] = repositoryContext.fullName.split("/");
            if (!owner || !repo) return null;
            const branch  = repositoryContext.defaultBranch ?? "main";
            const repoFull = `${owner}/${repo}`;
            const ctx = await getModuleContext(repoFull, branch, detectedModule.agentId);
            if (!ctx) return null;
            console.log(
              `[v# routing] module_context_loaded` +
              ` module=${ctx.agentId}` +
              ` findings=${ctx.findings.length}` +
              ` total=${ctx.totalAvailable}`
            );
            return formatModuleContextForPrompt(ctx);
          })(),
          new Promise<null>((r) => setTimeout(() => r(null), 1_000)),
        ]).catch(() => null)
      : Promise.resolve(null);

  if (detectedModule) {
    console.log(`[v# routing] intent_match module=${detectedModule.agentId} message_len=${message.trim().length}`);
  }

  // Reference content fetch — runs concurrently, hard 5s cap.
  const referenceContentPromise: Promise<ReferenceContent | null> =
    hasReference
      ? Promise.race([
          fetchReferenceContent(referenceUrl!),
          new Promise<null>((r) => setTimeout(() => r(null), REFERENCE_TIMEOUT_MS))
        ]).catch(() => null)
      : Promise.resolve(null);

  // ── 5. Create stream and return IMMEDIATELY ───────────────
  const encoder = new TextEncoder();
  let streamAbort: AbortController | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      streamAbort = new AbortController();
      const { signal } = streamAbort;

      const write = (text: string): void => {
        if (signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // Controller already closed (client disconnected)
        }
      };

      let providerTimeoutId:    ReturnType<typeof setTimeout> | null = null;
      let firstTokenTimeoutId:  ReturnType<typeof setTimeout> | null = null;

      try {
        // ── 5a. Await DB + code context + reference content ───
        let dbTimedOut = false;
        const dbTimeoutPromise = new Promise<null>((r) =>
          setTimeout(() => { dbTimedOut = true; r(null); }, DB_TIMEOUT_MS)
        );

        const [record, codeContext, refContent, systemMap, systemNameContext, architectureTree, moduleIntelligence] = await Promise.all([
          Promise.race([keyPromise, dbTimeoutPromise]),
          codeContextPromise,
          referenceContentPromise,
          systemMapPromise,
          systemNameRetrievalPromise,
          treeForArchitecturePromise,
          moduleIntelligencePromise,
        ]);

        // ── T2.1: v2 system evidence enrichment ───────────────────
        // Upgrade "partial" systems to "strong" using tree-confirmed source file evidence.
        // Pure — returns a new map without mutating the cached v1 map in systemMapCache.
        // enrichSystemMapWithTree runs ~8 in-memory searchTree() calls (~2-5ms total).
        const enrichedSystemMap = (systemMap && architectureTree)
          ? enrichSystemMapWithTree(systemMap, architectureTree)
          : systemMap;

        // Populate repository context with enriched (v2) systems, falling back to v1.
        // Null when: cache miss + build timed out, GitHub not connected, or skipped.
        if (enrichedSystemMap) {
          repositoryContext.systems = enrichedSystemMap.systems;
          const strongCount = enrichedSystemMap.systems.filter(s => s.status === "strong").length;
          console.log(
            `[system-registry] injected` +
            ` systems=${enrichedSystemMap.systems.length}` +
            ` strong=${strongCount}` +
            ` stack=${enrichedSystemMap.primaryStack}`
          );
        }

        // ── T2.2 + T2.3: directory domain map ─────────────────────────────
        // Build the architectural domain map (structural shape of the repository).
        // Zero API calls — operates on the already-cached architecture tree.
        // T2.3: inject compact domain map into repositoryContext so V# knows
        // what file domains exist without needing explicit file path mentions.
        if (architectureTree) {
          const domainMapResult = buildDomainMap(architectureTree);
          const formattedDomainMap = formatDomainMap(domainMapResult);
          if (formattedDomainMap) {
            repositoryContext.domainMap = formattedDomainMap;
          }
        }

        // ── V# module routing: inject stored intelligence findings ────────────────
        // When a module matched the user's intent AND findings were found,
        // inject them into repositoryContext so the system prompt includes
        // grounded findings from the detected module.
        if (moduleIntelligence) {
          repositoryContext.moduleIntelligence = moduleIntelligence;
          console.log(
            `[v# routing] module_intelligence_injected` +
            ` module=${detectedModule?.agentId ?? "unknown"}` +
            ` chars=${moduleIntelligence.length}`
          );
        }

        // activeCodeContext: use normal retrieval first; fall back to system-name retrieval.
        // System-name retrieval provides actual config files for detected systems when
        // no explicit code references were in the message (e.g. "where is BullMQ configured?").
        const activeCodeContext: CodeContext | null = codeContext ?? systemNameContext ?? null;
        if (systemNameContext && !codeContext) {
          console.log(
            `[system-registry] name_retrieval_active files=${systemNameContext.files.length}`
          );
        }

        // ── Phase 3: Semantic search fallback ─────────────────────────────
        // When all retrieval paths return nothing — no file refs, no keyword matches,
        // no system-name matches — try pgvector cosine similarity as a last resort.
        // Requires: user has an OpenAI key + Cipher has analyzed ≥1 file in this repo.
        // 2-second timeout: semantic search must not block the stream.
        // Only fires for non-conversational, non-reference messages.
        //
        // The existing `record` is OpenRouter-only (keyPromise WHERE provider="openrouter").
        // We do a separate lazy lookup for the OpenAI key — only pays the DB cost when needed
        // (i.e. after all other retrieval paths have already returned nothing).
        let semanticContext: CodeContext | null = null;
        if (!activeCodeContext && !isConversational && !hasReference) {
          try {
            const openAiRecord = await prisma.userProviderKey
              .findFirst({
                where:  { user: { clerkId }, provider: "openai", isActive: true },
                select: { encryptedKey: true }
              })
              .catch(() => null);

            if (openAiRecord) {
              const openAiKey = decryptKey(openAiRecord.encryptedKey);
              semanticContext = await Promise.race([
                buildSemanticRetrievalContext(message.trim(), repositoryContext, {
                  openAiKey,
                  branch: repositoryContext.defaultBranch ?? "main",
                }),
                new Promise<null>((r) => setTimeout(() => r(null), 2_000)),
              ]).catch(() => null);
            }
          } catch {
            // Key decryption failed or semantic search errored — proceed without
          }
        }

        // finalCodeContext: coalesce all retrieval sources.
        // Priority: normal retrieval > system-name retrieval > semantic fallback.
        const finalCodeContext: CodeContext | null = activeCodeContext ?? semanticContext;

        console.log(
          `[orchestrate] db_resolved=${Date.now() - t0}ms` +
          ` key_found=${!!record}` +
          ` timed_out=${dbTimedOut}` +
          ` code_files=${activeCodeContext?.files.length ?? 0}` +
          ` listing=${activeCodeContext?.folderListing?.length ?? 0}` +
          ` semantic=${semanticContext ? `yes(${semanticContext.folderListing?.length ?? 0})` : "no"}` +
          ` ref_fetched=${!!refContent}` +
          ` system_map=${enrichedSystemMap ? `${enrichedSystemMap.systems.length}_systems` : "none"}` +
          ` arch_tree=${architectureTree ? "hit" : "miss"}` +
          ` module=${detectedModule?.agentId ?? "none"}` +
          ` module_ctx=${moduleIntelligence ? "yes" : "no"}`
        );

        if (refContent) {
          console.log(
            `[reference] content_available` +
            ` type=${refContent.parsed.type}` +
            ` text_len=${refContent.text.length}` +
            ` title=${refContent.title ? `"${refContent.title.slice(0, 60)}"` : "none"}`
          );
          // Telemetry: transcript injection confirmed — this fires whenever transcript
          // was fetched successfully, regardless of which prompt path will be chosen.
          // Pair with prompt-selection telemetry below to trace the full pipeline.
          if (refContent.text.length > 0) {
            console.log(`[reference] transcript_injected chars=${refContent.text.length}`);
          }
        } else if (hasReference) {
          // Parse URL again (cheap pure fn) to get platform for telemetry + prompt
          const parsedForLog = parseReferenceUrl(referenceUrl!);
          console.log(
            `[reference] content_unavailable` +
            ` type=${parsedForLog.type}` +
            ` url=${referenceUrl!.slice(0, 60)}`
          );
        }

        // ── 5b. Reference pipeline stages 3+4 (needs apiKey) ─
        // Runs after key is resolved — intent extraction uses the BYOK key.
        let intent:            ImplementationIntent | null = null;
        let evaluation:        ReferenceEvaluation | null  = null;
        let intentCodeContext: CodeContext | null           = null;

        // understanding mode: content was fetched but evaluation stages are skipped.
        // Log the skip and fall through — the system prompt selector handles the rest.
        if (refContent && referenceMode === "understanding") {
          console.log(`[reference] pipeline_skipped_stages stages=3,3.5,4 mode=understanding`);
        }

        if (refContent && record && referenceMode !== "understanding") {
          let apiKey: string;
          try {
            apiKey = decryptKey(record.encryptedKey);
          } catch {
            // Key decryption failed — fall back to reference-failure prompt
            console.log(`[reference] intent_extraction_skipped reason=decrypt_failed`);
            apiKey = "";
          }

          if (apiKey) {
            // Stage 3 — intent extraction (single AI call, max_tokens=350, temp=0)
            console.log(
              `[semantic] extraction_started` +
              ` contentLen=${refContent.text.length}` +
              ` sourceType=${refContent.parsed.type}`
            );
            intent = await extractImplementationIntent(
              refContent.text,
              apiKey,
              refContent.parsed.type as ImplementationIntent["sourceType"],
              refContent.title
            );
            // Note: reference-evaluator.ts emits [semantic] extraction_success internally
            console.log(
              `[reference] intent_extraction_success` +
              ` patterns=${intent.patterns.length}` +
              ` systems=${intent.systems?.length ?? 0}` +
              ` behaviors=${intent.realtimeBehaviors?.length ?? 0}` +
              ` concerns=${intent.architectureConcerns?.length ?? 0}` +
              ` features=${intent.coreFeatures.length}`
            );

            // Stage 3.5 — intent-derived retrieval
            // Derive search targets from intent.systems + intent.patterns,
            // fetch actual code files to ground the compatibility evaluation.
            console.log(
              `[semantic] compatibility_reasoning_started` +
              ` systems=${intent.systems?.length ?? 0}` +
              ` features=${intent.coreFeatures.length}`
            );
            // Capture intent in a const so TypeScript's narrowing survives the async
            // boundary inside the .then() callback (intent is non-null here — we're
            // inside the `if (apiKey)` block which only runs after intent is assigned).
            const resolvedIntent = intent;
            intentCodeContext = await Promise.race([
              githubTokenPromise.then(token =>
                buildIntentRetrievalContext(resolvedIntent, repositoryContext, clerkId, token)  // FIX: reuse pre-fetched token
              ),
              new Promise<null>((r) => setTimeout(() => r(null), 3_000))
            ]).catch(() => null);

            // Stage 4 — evidence-backed compatibility evaluation (pure logic, no AI call)
            evaluation = evaluateRepoCompatibility(intent, repositoryContext, intentCodeContext);
            console.log(
              `[semantic] confidence=${evaluation.confidence}` +
              ` reason=${evaluation.confidenceReason.slice(0, 80)}`
            );
            console.log(
              `[semantic] evaluation_complete` +
              ` supported=${evaluation.alreadySupported.length}` +
              ` missing=${evaluation.missingSystems.length}` +
              ` complexity=${evaluation.complexity}` +
              ` fit=${evaluation.architectureFit}` +
              ` elapsed=${Date.now() - t0}ms`
            );
          }
        }

        // ── 5c. Build system prompt ───────────────────────────
        // Priority order (most specific wins):
        //   1. Conversational → personality-layer only
        //   2. Reference evaluation (intent + evaluation present) → evaluation/hybrid
        //   3. Reference understanding (mode=understanding + content fetched) → explanation
        //   4. Reference failure (URL detected but content/intent unavailable) → failure prompt
        //   5. Non-reference code context → injected source files
        //   6. Base prompt → repo facts only
        //
        // Cascade audit (Phase 4):
        //   • `intent && evaluation` can only be truthy when referenceMode !== "understanding"
        //     because understanding mode skips Stage 3 (intent extraction) entirely.
        //     The if-chain ordering is therefore correct — path 2 cannot fire in understanding
        //     mode even if a future refactor adds intent for other reasons.
        //   • The understanding path (path 3) is guarded by both `referenceMode === "understanding"`
        //     AND `refContent` — prevents activating with stale/null content.
        //   • Path 4 (failure) is the catch-all for `hasReference=true` when paths 2+3 don't fire.
        //     This covers: content_unavailable, intent_extraction_failed, key missing.
        //
        // Critical: when `hasReference=true` but content/intent is unavailable,
        // use the reference-failure prompt — NOT the base technical prompt.
        // Without this, V# receives a raw YouTube URL in the message body and
        // correctly says "I can't access external content" (right answer, wrong prompt).

        let systemPrompt: string;
        if (isConversational) {
          systemPrompt = buildConversationalPrompt(repositoryContext);
        } else if (intent && evaluation) {
          // Reference evaluation/hybrid mode: grounded in intentCodeContext (Stage 3.5 files).
          // intentCodeContext may be null if retrieval timed out or GitHub not connected —
          // evaluation still runs (confidence will be "low"), synthesis prompt still activates.
          // hybrid mode: pass summarizeFirst=true so V# opens with a content summary.
          systemPrompt = buildVHashSystemPromptWithEvaluation(
            repositoryContext, intent, evaluation, intentCodeContext ?? undefined,
            referenceMode === "hybrid" ? { summarizeFirst: true } : undefined
          );
          console.log(
            `[reference] evaluation_prompt_selected` +
            ` mode=${referenceMode ?? "evaluation"}` +
            ` confidence=${evaluation.confidence}` +
            ` files=${intentCodeContext?.files.length ?? 0}`
          );
        } else if (hasReference && referenceMode === "understanding" && refContent) {
          // Understanding mode: content was fetched, evaluation skipped.
          // V# explains what the reference demonstrates without a compat analysis.
          systemPrompt = buildVHashSystemPromptForReferenceUnderstanding(
            repositoryContext,
            refContent.title,
            refContent.text,
            refContent.parsed.type
          );
          console.log(
            `[reference] understanding_prompt_selected` +
            ` chars=${refContent.text.length}`
          );
        } else if (hasReference) {
          // URL was detected but content unavailable OR intent extraction failed.
          // Use the purpose-built failure prompt so V# gives an actionable response.
          const platformType = refContent?.parsed.type ?? parseReferenceUrl(referenceUrl!).type;
          systemPrompt = buildVHashSystemPromptWithReferenceFailure(
            repositoryContext, platformType, referenceUrl!
          );
          const failReason = !refContent ? "content_unavailable" : "intent_extraction_failed";
          console.log(
            `[reference] failure_prompt_selected` +
            ` platform=${platformType}` +
            ` reason=${failReason}`
          );
        } else if (finalCodeContext) {
          // Non-reference mode: pass any retrieval result to the context-aware prompt.
          // Handles all three retrieval modes transparently:
          //   files.length > 0     → "Retrieved Source Context" block (file content)
          //   folderListing + keyword  → "Keyword Search Results" block (Phase 2)
          //   folderListing + semantic → "Semantic Search Results" block (Phase 3)
          //   folderListing (folder)   → "Directory Listing" block (existing)
          // buildVHashSystemPromptWithContext falls back to base prompt if none apply.
          systemPrompt = buildVHashSystemPromptWithContext(repositoryContext, finalCodeContext);
        } else {
          systemPrompt = buildVHashSystemPrompt(repositoryContext);
        }

        // ── Phase 5: Fail-safe transcript guard ───────────────
        // When a reference was detected AND transcript was successfully fetched,
        // append a hard directive that prevents V# from claiming it can't access
        // external content. This fires regardless of which prompt path was selected
        // above — it is the last line of defense against a false "I can't access
        // the video" response.
        //
        // Only appended for reference messages with non-empty transcript text.
        // Does NOT fire for the failure prompt path (refContent is null there).
        if (hasReference && refContent && refContent.text.length > 0) {
          systemPrompt +=
            "\n\n─── Transcript Access Confirmation ───\n" +
            "The referenced content has been successfully extracted server-side. " +
            "You have full access to the transcript/content provided above. " +
            "Never claim you cannot access the video, the URL, or the referenced content. " +
            "The extraction already happened — you are working from the actual content.";
          console.log(`[reference] failsafe_guard_appended chars=${refContent.text.length}`);
        }

        if (signal.aborted) return;

        if (record) {
          // ── 5d. Decrypt and validate the OpenRouter key ─────
          // (may already be decrypted above for reference pipeline — fine to decrypt again,
          // decryptKey() is pure/fast and doesn't cache; avoids passing apiKey across scope)
          console.log(`[orchestrate] key_loaded record_found=true`);
          let apiKey: string;
          try {
            apiKey = decryptKey(record.encryptedKey);
            console.log(`[orchestrate] key_decrypted length=${apiKey.length}`);
          } catch (err) {
            console.log(`[orchestrate] stream_error reason=decrypt_failed err=${err instanceof Error ? err.message : "unknown"}`);
            write("OpenRouter key decryption failed. Re-save your API key in Settings → AI Providers.");
            return;
          }

          if (!apiKey || apiKey.trim().length === 0) {
            console.log(`[orchestrate] stream_error reason=key_empty`);
            write("OpenRouter API key is empty. Re-save your key in Settings → AI Providers.");
            return;
          }

          if (!apiKey.startsWith(OPENROUTER_KEY_PREFIX)) {
            console.log(`[orchestrate] stream_error reason=key_invalid_format prefix=${apiKey.slice(0, 6)}`);
            write("OpenRouter API key format is invalid (expected sk-or-…). Check Settings → AI Providers.");
            return;
          }

          console.log(`[orchestrate] key_validated prefix=${apiKey.slice(0, 12)}…`);

          // ── 5e. Two-stage provider timeout ──────────────────
          //
          // Stage 1 — First-token timeout (20s):
          //   Fires if the model never starts responding. Protects against
          //   provider queue delays, cold starts, and silent auth failures.
          //   Cleared immediately when the first token arrives.
          //
          // Stage 2 — No-progress watchdog (15s inactivity):
          //   Checks every second AFTER streaming starts. Resets on each token.
          //   Fires only when tokens stop mid-stream — never kills long but
          //   active responses. This replaces the old flat 30s cap that was
          //   terminating valid "explain in detail" responses on the free tier.
          firstTokenTimeoutId = setTimeout(() => {
            console.log(`[orchestrate] stream_error reason=first_token_timeout`);
            write("\n\nProvider isn't responding. Try again or check Settings → AI Providers.");
            streamAbort?.abort();
          }, FIRST_TOKEN_TIMEOUT_MS);

          let lastProgressAt    = Date.now();
          let firstTokenReceived = false;

          providerTimeoutId = setInterval(() => {
            if (firstTokenReceived && Date.now() - lastProgressAt > NO_PROGRESS_TIMEOUT_MS) {
              console.log(
                `[orchestrate] stream_error reason=no_progress_timeout` +
                ` silent_ms=${Date.now() - lastProgressAt}`
              );
              write("\n\nProvider stopped responding mid-stream. Try again.");
              streamAbort?.abort();
            }
          }, 1_000) as unknown as ReturnType<typeof setTimeout>;

          // ── 5f. Stream from OpenRouter ──────────────────────
          try {
            for await (const chunk of streamOpenRouter(apiKey, systemPrompt, messages, signal)) {
              // Clear first-token timeout on first arrival — model is responding
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                if (firstTokenTimeoutId !== null) {
                  clearTimeout(firstTokenTimeoutId);
                  firstTokenTimeoutId = null;
                }
              }
              lastProgressAt = Date.now();
              write(chunk);
            }
          } catch (err) {
            if (signal.aborted) return;
            const msg = err instanceof Error ? err.message : "Unknown streaming error";
            console.log(`[orchestrate] stream_error err=${msg}`);
            write(`\n\n${msg}`);
            return;
          }

          console.log(`[orchestrate] stream_completed total_ms=${Date.now() - t0}`);

          // ── 5g. Touch lastUsedAt — fire and forget ───────────
          prisma.userProviderKey
            .updateMany({
              where: { user: { clerkId }, provider: "openrouter" },
              data:  { lastUsedAt: new Date() }
            })
            .catch(() => null);

        } else if (dbTimedOut) {
          // ── DB timed out — Supabase cold start too slow ───────
          console.log(`[orchestrate] db_timeout — key may exist but query exceeded ${DB_TIMEOUT_MS}ms`);
          write(
            "Database connection timed out — Supabase may be cold-starting. " +
            "Wait a few seconds and try again. If this persists, check your DATABASE_URL."
          );
        } else {
          // ── No key configured ─────────────────────────────────
          console.log(`[orchestrate] no_openrouter_key_found`);
          if (process.env.NODE_ENV === "development") {
            console.log(`[orchestrate] dev_mock_pipeline_start`);
            for await (const chunk of streamMock(repositoryContext, message, signal)) {
              write(chunk);
            }
          } else {
            write(
              "OpenRouter API key not configured. " +
              "Add your key in Settings → AI Providers to enable live responses."
            );
          }
        }

      } catch (err) {
        if (signal.aborted) {
          console.log(`[orchestrate] stream_aborted`);
          return;
        }
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.log(`[orchestrate] unhandled_error err=${msg}`);
        write(`\n\nStreaming connection interrupted. ${msg}`);
      } finally {
        // Clear both provider timers — no-op if already cleared above
        if (providerTimeoutId   !== null) clearInterval(providerTimeoutId);
        if (firstTokenTimeoutId !== null) clearTimeout(firstTokenTimeoutId);
        try { controller.close(); } catch {}
      }
    },

    // Called when the client reader is cancelled (navigation, tab close, abort)
    cancel() {
      console.log(`[orchestrate] client_disconnected`);
      streamAbort?.abort();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type":      "text/plain; charset=utf-8",
      "Cache-Control":     "no-cache, no-transform",
      "X-Accel-Buffering": "no"
    }
  });
}
