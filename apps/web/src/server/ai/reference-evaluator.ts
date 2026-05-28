/**
 * Repository-Aware Implementation Evaluation — Stages 3 & 4.
 *
 * Stage 3: extractImplementationIntent()
 *   Single OpenRouter call (max_tokens=350, temp=0) → structured engineering semantics
 *   describing implementation patterns, systems, realtime behaviours, and architecture concerns.
 *   Cached 30 min by SHA-256 of content string (cache v2 — invalidates pre-schema-upgrade entries).
 *
 * Stage 4: evaluateRepoCompatibility()
 *   Pure logic — no AI call. Matches extracted intent against:
 *   (a) repo architecture metadata (RepoContextInput), and
 *   (b) retrieved file contents (CodeContext).
 *   Returns alreadySupported, missingSystems, complexity, architectureFit, confidence.
 *
 * Server-side only. Never import from client components.
 *
 * SECURITY:
 *   - API key used only for Stage 3 call, decrypted upstream, never logged
 *   - Reference content is not persisted — in-memory cache only
 *   - Cache keys are SHA-256 hashes, not raw content
 */

import { createHash }    from "crypto";
import OpenAI            from "openai";
import { OPENROUTER_BASE_URL } from "@/server/ai/constants";
import type { RepoContextInput, CodeContext } from "@/server/ai/vhash-prompt";

// ─── Types ────────────────────────────────────────────────

/**
 * Structured engineering implementation semantics extracted from reference content.
 *
 * v2 schema: 7 fields covering both product and engineering dimensions.
 * The three new fields (systems, realtimeBehaviors, architectureConcerns) are
 * engineering-domain-specific and drive Stage 3.5 retrieval targeting.
 */
export interface ImplementationIntent {
  /** Specific implementation patterns shown — "sliding window rate limiting" not "rate limiting" */
  patterns:             string[];
  /** Named engineering systems required — "request throttling middleware", "Redis TTL cache" */
  systems:              string[];
  /** Real-time / async behaviors — "burst protection", "request queuing" */
  realtimeBehaviors:    string[];
  /** Architecture-level implications — "horizontal scaling", "stateless APIs" */
  architectureConcerns: string[];
  /** Technology / framework names — "Redis", "Prisma", "Next.js" */
  stackHints:           string[];
  /** Product features demonstrated — "API throttling", "abuse prevention" */
  coreFeatures:         string[];
  /** UI/UX patterns if applicable */
  uiPatterns:           string[];
  /** Source content type */
  sourceType:   "youtube" | "loom" | "twitter" | "unknown";
  /** Title of the reference, if available */
  sourceTitle?: string;
}

/**
 * Repository compatibility evaluation result.
 * Produced by Stage 4 (pure logic). Injected into Stage 5 synthesis prompt.
 * Never streamed as JSON to the client — only shapes V#'s natural language output.
 */
export interface ReferenceEvaluation {
  /** Features / systems the repository already supports — with evidence annotation */
  alreadySupported: string[];
  /** Systems required by the intent that are not found in the repo */
  missingSystems:   string[];
  /** Implementation complexity estimate */
  complexity:       "low" | "medium" | "high";
  /** One-sentence reason for the complexity estimate */
  complexityReason: string;
  /** Overall architecture fit assessment */
  architectureFit:  "good" | "partial" | "poor";
  /**
   * Confidence in the assessment — based on what evidence was actually available.
   * Drives V# behavior:
   *   high   → speak directly from evidence
   *   medium → qualify with "based on what I could inspect"
   *   low    → acknowledge limited visibility, ask user for infrastructure details
   */
  confidence:       "high" | "medium" | "low";
  /** One-sentence explanation of what drove the confidence level */
  confidenceReason: string;
}

// ─── Intent extraction cache ──────────────────────────────
// Keyed by cache version + SHA-256 of content string. TTL 30 minutes.
// v2 prefix invalidates all pre-schema-upgrade (4-field) cache entries.

interface CacheEntry {
  intent:    ImplementationIntent;
  expiresAt: number;
}

const INTENT_CACHE   = new Map<string, CacheEntry>();
const CACHE_TTL_MS   = 30 * 60 * 1_000; // 30 minutes
const CACHE_VERSION  = "v2";

function getCacheKey(content: string): string {
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
  return `${CACHE_VERSION}:${hash}`;
}

function getCached(key: string): ImplementationIntent | null {
  const entry = INTENT_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    INTENT_CACHE.delete(key);
    return null;
  }
  return entry.intent;
}

function setCache(key: string, intent: ImplementationIntent): void {
  INTENT_CACHE.set(key, { intent, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── Stage 3 — extractImplementationIntent ────────────────

/**
 * Engineering-domain extraction prompt.
 *
 * Asks for specific, named engineering concepts rather than generic categories.
 * Critically: "patterns" should be SPECIFIC ("sliding window rate limiting", not "rate limiting").
 * "systems" should name the ACTUAL engineering system ("request throttling middleware", not "middleware").
 *
 * Max output: 7 compact arrays × 3-5 items × ~5 tokens avg ≈ 200 tokens.
 * max_tokens=350 gives comfortable headroom for JSON structure overhead.
 */
const INTENT_EXTRACTION_SYSTEM = `Extract structured implementation engineering semantics from this reference content.
Return ONLY valid JSON with these exact fields (no markdown, no explanation):
{
  "patterns": ["specific implementation patterns shown, max 5 — 'sliding window rate limiting' not 'rate limiting'"],
  "systems": ["named engineering systems required, max 4 — 'request throttling middleware', 'Redis TTL storage', 'request fingerprinting'"],
  "realtimeBehaviors": ["async/realtime behaviors, max 3 — 'burst protection', 'request queuing'"],
  "architectureConcerns": ["architecture implications, max 3 — 'horizontal scaling', 'stateless APIs', 'edge consistency'"],
  "stackHints": ["technology names only, max 5"],
  "coreFeatures": ["product features demonstrated, max 4"],
  "uiPatterns": ["UI/UX patterns if applicable, max 3"]
}
Be domain-specific. Empty arrays OK. No nested objects.`;

/** Minimal intent — all arrays empty. Allows pipeline to continue with confidence=low */
const EMPTY_INTENT = (sourceType: ImplementationIntent["sourceType"]): ImplementationIntent => ({
  patterns:             [],
  systems:              [],
  realtimeBehaviors:    [],
  architectureConcerns: [],
  stackHints:           [],
  coreFeatures:         [],
  uiPatterns:           [],
  sourceType
});

/**
 * Extract structured implementation engineering semantics from reference content.
 *
 * @param content    - Raw text content (transcript, description, etc.), max 3000 chars
 * @param apiKey     - Decrypted OpenRouter API key (from user's BYOK config)
 * @param sourceType - Platform type for context
 * @param title      - Optional reference title
 */
export async function extractImplementationIntent(
  content:    string,
  apiKey:     string,
  sourceType: ImplementationIntent["sourceType"] = "unknown",
  title?:     string
): Promise<ImplementationIntent> {
  if (!content.trim()) {
    console.log(`[semantic] extraction_skipped reason=empty_content sourceType=${sourceType}`);
    return EMPTY_INTENT(sourceType);
  }

  const cacheKey = getCacheKey(content);
  const cached   = getCached(cacheKey);
  if (cached) {
    console.log(`[semantic] extraction_cache_hit key=${cacheKey}`);
    return { ...cached, sourceType, sourceTitle: title };
  }

  console.log(`[semantic] extraction_started contentLen=${content.length} sourceType=${sourceType}`);

  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      "HTTP-Referer": "https://decode-x.ai",
      "X-Title":      "DE-code X"
    }
  });

  try {
    const response = await client.chat.completions.create({
      model:       "openai/gpt-4o-mini",
      max_tokens:  350,   // Raised from 250: 7 fields at max capacity exceed 250; new high-value fields appear last and silently truncate otherwise
      temperature: 0,
      messages: [
        { role: "system", content: INTENT_EXTRACTION_SYSTEM },
        { role: "user",   content: `Reference title: ${title ?? "unknown"}\n\nContent:\n${content}` }
      ]
    });

    const raw = response.choices[0]?.message?.content ?? "";

    // Strip markdown fences if model includes them despite instructions
    const jsonStr = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();

    let parsed: {
      patterns?:             unknown;
      systems?:              unknown;
      realtimeBehaviors?:    unknown;
      architectureConcerns?: unknown;
      stackHints?:           unknown;
      coreFeatures?:         unknown;
      uiPatterns?:           unknown;
    };

    try {
      parsed = JSON.parse(jsonStr) as typeof parsed;
    } catch {
      console.log(`[semantic] extraction_parse_failed raw=${raw.slice(0, 80)}`);
      return EMPTY_INTENT(sourceType);
    }

    const intent: ImplementationIntent = {
      patterns:             toStringArray(parsed.patterns,             5),
      systems:              toStringArray(parsed.systems,              4),
      realtimeBehaviors:    toStringArray(parsed.realtimeBehaviors,    3),
      architectureConcerns: toStringArray(parsed.architectureConcerns, 3),
      stackHints:           toStringArray(parsed.stackHints,           5),
      coreFeatures:         toStringArray(parsed.coreFeatures,         4),
      uiPatterns:           toStringArray(parsed.uiPatterns,           3),
      sourceType,
      sourceTitle:          title
    };

    setCache(cacheKey, intent);

    console.log(
      `[semantic] extraction_success` +
      ` patterns=${intent.patterns.length}` +
      ` systems=${intent.systems.length}` +
      ` behaviors=${intent.realtimeBehaviors.length}` +
      ` concerns=${intent.architectureConcerns.length}` +
      ` stack=${intent.stackHints.slice(0, 3).join(",")}`
    );

    return intent;

  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.log(`[semantic] extraction_failed err=${msg.slice(0, 80)}`);
    return EMPTY_INTENT(sourceType);
  }
}

// ─── Stage 4 — evaluateRepoCompatibility ─────────────────

/**
 * Evaluate repository compatibility against extracted implementation intent.
 *
 * Pure logic — no AI call, no network, <5ms.
 *
 * Matching strategy (in order):
 * 1. Check intent.systems AND intent.coreFeatures against repo capabilities
 *    (architecturePatterns, authSystem, apiPattern, file paths)
 * 2. Content-based second pass: for items still in missingSystems,
 *    check if any retrieved file's CONTENT contains evidence keywords
 * 3. Derive confidence from retrieval coverage
 */
export function evaluateRepoCompatibility(
  intent:  ImplementationIntent,
  ctx:     RepoContextInput,
  code:    CodeContext | null
): ReferenceEvaluation {
  // Build a flat capability list from everything known about the repo
  const repoCapabilities: string[] = [
    ...(ctx.architecturePatterns ?? []),
    ctx.authSystem      ? `${ctx.authSystem} auth`   : null,
    ctx.stateManagement ? ctx.stateManagement         : null,
    ctx.apiPattern      ? `${ctx.apiPattern} api`     : null,
    ctx.language        ?? null,
    ...(code?.files.map((f) => f.path) ?? [])  // file paths as initial capability signals
  ].filter((x): x is string => x != null);

  // ── First pass: path/metadata matching ───────────────────
  // Evaluate both intent.systems (primary, engineering-specific) and intent.coreFeatures (product)
  const alreadySupported: string[] = [];
  const missingSystems:   string[] = [];

  const allItems = [
    ...intent.systems.map((s) => ({ label: s, isSystem: true  })),
    ...intent.coreFeatures.map((f) => ({ label: f, isSystem: false }))
  ];

  for (const item of allItems) {
    if (semanticMatch(item.label, repoCapabilities)) {
      alreadySupported.push(item.label);
    } else {
      missingSystems.push(item.label);
    }
  }

  // Also flag stack hints for specific missing technologies
  for (const hint of intent.stackHints) {
    const alreadyCovered =
      alreadySupported.some((s) => s.toLowerCase().includes(hint.toLowerCase())) ||
      missingSystems.some((s) => s.toLowerCase().includes(hint.toLowerCase()));
    if (!alreadyCovered && !semanticMatch(hint, repoCapabilities)) {
      if (isSpecificTechnology(hint, ctx)) {
        missingSystems.push(`${hint} integration`);
      }
    }
  }

  // ── Second pass: content-based evidence ──────────────────
  // For items still in missingSystems, check if any retrieved file BODY
  // contains keyword evidence. File path matching is insufficient — a file
  // named "middleware.ts" could implement auth, CORS, logging, or rate-limiting.
  // Content evidence is authoritative.

  if (code?.files.length) {
    const toReclassify: string[] = [];

    for (const missing of missingSystems) {
      const terms = tokenize(missing.toLowerCase()).filter((t) => t.length >= 5);
      if (!terms.length) continue;

      for (const file of code.files) {
        const contentLower = file.content.toLowerCase();
        const hit = terms.some((term) => contentLower.includes(term));
        if (hit) {
          const basename = file.path.split("/").pop() ?? file.path;
          toReclassify.push(`${missing} (evidence: ${basename})`);
          break;
        }
      }
    }

    for (const reclassified of toReclassify) {
      // reclassified contains the original label + annotation
      const originalLabel = reclassified.split(" (evidence:")[0]!;
      const idx = missingSystems.indexOf(originalLabel);
      if (idx !== -1) {
        missingSystems.splice(idx, 1);
        alreadySupported.push(reclassified);
      }
    }
  }

  // ── Complexity estimation ─────────────────────────────────
  const missingCount = missingSystems.length;
  const complexity: ReferenceEvaluation["complexity"] =
    missingCount > 3 ? "high"   :
    missingCount > 1 ? "medium" : "low";

  const complexityReason =
    complexity === "high"
      ? `${missingCount} systems need to be built from scratch — significant new infrastructure required`
      : complexity === "medium"
      ? `${missingCount} missing ${missingCount === 1 ? "system requires" : "systems require"} new work but the repo architecture supports it`
      : "Your repository already supports most of the required patterns";

  // ── Architecture fit ──────────────────────────────────────
  const totalItems    = allItems.length;
  const supportedRatio = totalItems > 0
    ? alreadySupported.filter((s) => !s.includes("(evidence:")).length / totalItems
    : 1;

  const architectureFit: ReferenceEvaluation["architectureFit"] =
    supportedRatio >= 0.7 ? "good"    :
    supportedRatio >= 0.3 ? "partial" : "poor";

  // ── Confidence model ──────────────────────────────────────
  // Based on what retrieval evidence was actually available.
  // Drives V# behavior: high → direct; medium → qualified; low → ask for details.
  const hasCodeFiles    = (code?.files.length ?? 0) > 0;
  const hasContentHits  = alreadySupported.some((s) => s.includes("(evidence:"));
  const hasMetadata     = (ctx.architecturePatterns?.length ?? 0) > 0
                       || !!ctx.authSystem || !!ctx.apiPattern;

  let confidence:       ReferenceEvaluation["confidence"];
  let confidenceReason: string;

  if (hasCodeFiles && hasContentHits) {
    confidence       = "high";
    confidenceReason = `${code!.files.length} relevant file${code!.files.length === 1 ? "" : "s"} inspected with matching content evidence`;
  } else if (hasCodeFiles) {
    confidence       = "medium";
    confidenceReason = `${code!.files.length} file${code!.files.length === 1 ? "" : "s"} inspected but content does not directly match all evaluated systems`;
  } else if (hasMetadata) {
    confidence       = "medium";
    confidenceReason = "assessed from repository architecture metadata — no source files inspected";
  } else {
    confidence       = "low";
    confidenceReason = "assessed from repository name and language only — no architecture metadata or source files available";
  }

  console.log(
    `[semantic] evaluation_complete` +
    ` supported=${alreadySupported.length}` +
    ` missing=${missingSystems.length}` +
    ` complexity=${complexity}` +
    ` fit=${architectureFit}` +
    ` confidence=${confidence}`
  );

  return {
    alreadySupported,
    missingSystems,
    complexity,
    complexityReason,
    architectureFit,
    confidence,
    confidenceReason
  };
}

// ─── Helpers ──────────────────────────────────────────────

/** Safe array coercion with string filtering and length cap */
function toStringArray(val: unknown, maxLen: number): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, maxLen);
}

/**
 * Case-insensitive keyword overlap check.
 * Returns true if the feature string has meaningful overlap with any capability.
 */
function semanticMatch(feature: string, capabilities: string[]): boolean {
  const featureLower = feature.toLowerCase();
  const featureWords = tokenize(featureLower);

  for (const cap of capabilities) {
    const capLower = cap.toLowerCase();
    // Direct substring match
    if (capLower.includes(featureLower) || featureLower.includes(capLower)) return true;
    // Word-level overlap (2+ matching meaningful words)
    const capWords  = tokenize(capLower);
    const overlap   = featureWords.filter((w) => capWords.includes(w));
    if (overlap.length >= 2) return true;
    // Single high-signal word match
    if (featureWords.some((w) => HIGH_SIGNAL_TERMS.has(w) && capWords.includes(w))) return true;
  }
  return false;
}

/** Tokenize to meaningful words (strip stopwords and short tokens) */
function tokenize(str: string): string[] {
  return str
    .split(/[\s\-_/.,()]+/)
    .map((w) => SYNONYMS[w] ?? w)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

/** Returns true if this technology name is specific enough to flag as missing */
function isSpecificTechnology(hint: string, ctx: RepoContextInput): boolean {
  const h = hint.toLowerCase();
  const lang = ctx.language?.toLowerCase() ?? "";
  // Don't flag the repo's own language as missing
  if (lang && lang.includes(h)) return false;
  if (h === "react" || h === "typescript" || h === "javascript") return false;
  return true;
}

const STOPWORDS = new Set([
  "with", "that", "this", "from", "have", "been", "will", "what",
  "your", "their", "them", "they", "when", "then", "than", "into",
  "over", "such", "some", "more", "also", "both", "each", "just"
]);

const HIGH_SIGNAL_TERMS = new Set([
  "auth", "upload", "realtime", "websocket", "queue", "cache", "stripe",
  "payment", "search", "notification", "email", "webhook", "storage",
  "video", "image", "chat", "analytics", "role", "permission", "rbac",
  "oauth", "clerk", "supabase", "prisma", "redis", "postgres",
  // New: engineering-domain signals
  "throttl", "limit", "middleware", "coordinat", "distribut",
  "fingerprint", "bucket", "window", "circuit", "proxy", "guard"
]);

// Normalise common synonyms
const SYNONYMS: Record<string, string> = {
  "authentication": "auth",
  "authorisation":  "auth",
  "authorization":  "auth",
  "database":       "data",
  "realtime":       "real",
  "real-time":      "real",
  "websockets":     "websocket",
  "uploads":        "upload",
  "payments":       "payment",
  "notifications":  "notification",
  "permissions":    "permission",
  "throttling":     "throttl",
  "throttle":       "throttl",
  "limiting":       "limit",
  "middleware":     "middleware",
  "distributed":    "distribut",
  "coordination":   "coordinat",
};
