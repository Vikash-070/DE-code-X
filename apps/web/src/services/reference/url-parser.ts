/**
 * Reference URL parser — pure, no network calls.
 *
 * Classifies and normalises implementation reference URLs (YouTube, Loom, X/Twitter).
 * Used by the Inspire pipeline to route to the correct content fetcher.
 *
 * parseReferenceUrl() uses the URL() constructor for robust platform detection:
 * handles Shorts, mobile YouTube (m.youtube.com), youtu.be with query params,
 * embed URLs, and live URLs — none of which are reliably caught by regex.
 *
 * SANITIZATION: sanitizeReferenceUrl() is applied at the server boundary inside
 * parseReferenceUrl() before new URL() is called. It strips trailing punctuation
 * and bracket wrappers that users naturally include when pasting URLs into prose
 * (e.g. "check this out: https://youtu.be/abc. What do you think?").
 *
 * extractReferenceUrl() (client-side) intentionally returns the raw matched
 * substring without sanitizing — its contract is "does this text contain a
 * detectable URL", not "return a clean URL". The server sanitizes.
 */

export type ReferenceUrlType = "youtube" | "loom" | "twitter" | "unsupported";

export interface ParsedReferenceUrl {
  type:    ReferenceUrlType;
  /** Platform-specific content ID (video ID, tweet ID, Loom share ID) */
  id:      string;
  /**
   * Canonical URL form — normalized to https + platform canonical shape.
   * YouTube: https://www.youtube.com/watch?v={id}
   * Twitter: https://x.com/{pathname} (twitter.com → x.com)
   * Loom: original share URL (already canonical)
   *
   * NOTE: This field is NOT used by the transcript fetcher — fetchYouTubeTranscript()
   * and fetchLoomContent() consume `id`, not `url`. The canonical form is stored
   * for future use (caching keys, display, deep links) but has no current effect
   * on content fetch behavior.
   */
  url:     string;
}

// ─── Client-side detection regex ──────────────────────────
//
// Used by extractReferenceUrl() to scan chat text for supported URLs.
// Covers: YouTube watch, Shorts, embed, live, mobile (m.), youtu.be,
// Loom share, Twitter/X status.
//
// NOTE: This regex DETECTS URLs in text — it does not validate IDs.
// The [^\s]* suffix greedily captures trailing chars (including punctuation
// like periods, closing parens, brackets). sanitizeReferenceUrl() inside
// parseReferenceUrl() strips these before validation.
// The server-side parseReferenceUrl() (URL() constructor) does full validation.

export const REFERENCE_URL_RE =
  /https?:\/\/(?:(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=[A-Za-z0-9_-]{11}|shorts\/[A-Za-z0-9_-]{11}|embed\/[A-Za-z0-9_-]{11}|live\/[A-Za-z0-9_-]{11})|youtu\.be\/[A-Za-z0-9_-]{11})|(?:www\.)?loom\.com\/share\/[a-f0-9]{32,}|(?:www\.)?(?:twitter|x)\.com\/\S+\/status\/\d+)[^\s]*/i;

/**
 * Detect whether a text string contains a supported reference URL.
 * Returns the URL substring if found, null otherwise.
 *
 * Used by the client to decide whether to send `referenceUrl` in the
 * orchestrate request — before any network calls.
 *
 * Returns the raw matched substring without sanitization — the server's
 * parseReferenceUrl() handles cleaning before URL() construction.
 */
export function extractReferenceUrl(text: string): string | null {
  const match = REFERENCE_URL_RE.exec(text);
  return match ? match[0]! : null;
}

// ─── URL sanitization ─────────────────────────────────────
//
// Strips real-world input contamination before new URL() is called.
// Users paste URLs with trailing sentence punctuation, markdown wrappers,
// Slack auto-link angle brackets, and backtick code spans.
//
// Applied inside parseReferenceUrl() only (server boundary).
// NOT applied in extractReferenceUrl() — preserves its "raw match" contract.
//
// Idempotent: sanitizeReferenceUrl(sanitizeReferenceUrl(x)) === sanitizeReferenceUrl(x)
//
// Supported input patterns → cleaned output:
//   https://youtu.be/abc?si=xyz.          → https://youtu.be/abc?si=xyz  (trailing period)
//   https://youtu.be/abc.                 → https://youtu.be/abc         (period in path)
//   (https://youtu.be/abc)                → https://youtu.be/abc         (paren wrapping)
//   [https://youtu.be/abc]                → https://youtu.be/abc         (bracket wrapping)
//   <https://youtu.be/abc>                → https://youtu.be/abc         (Slack angle-bracket)
//   `https://youtu.be/abc`                → https://youtu.be/abc         (code backtick)
//   [watch this](https://youtu.be/abc)    → https://youtu.be/abc         (markdown link)
//   https://youtu.be/abc.,!               → https://youtu.be/abc         (multi-punct)
//   https://youtu.be/abc                  → https://youtu.be/abc         (no-op, clean input)

export function sanitizeReferenceUrl(raw: string): string {
  let s = raw.trim();

  // 1. Unwrap markdown link syntax: [label](url) → url
  //    Must run before other stripping — the trailing ) is the markdown closer,
  //    not sentence punctuation. The .replace(/\)$/, "") removes it after extraction.
  s = s.replace(/^\[.*?\]\(/, "").replace(/\)$/, "");

  // 2. Strip leading wrappers: angle bracket (Slack), paren, square bracket, backtick
  s = s.replace(/^[<\[(]/, "").replace(/^`/, "");

  // 3. Strip trailing punctuation and closing wrappers.
  //    Excluded from strip: `?` (query string separator — would corrupt URLs like
  //    "https://youtu.be/abc?t=60" if it appeared as trailing char after stripping
  //    something else). All other listed chars are unambiguously sentence/wrapper chars.
  s = s.replace(/[.,!;:\)>\]`]+$/, "");

  return s.trim();
}

/**
 * Parse a reference URL string into a typed, normalised result.
 *
 * Uses the URL() constructor for hostname and pathname parsing — handles
 * all YouTube URL variants (watch, shorts, embed, live, mobile, youtu.be),
 * Loom share URLs, and Twitter/X status URLs.
 *
 * Applies sanitizeReferenceUrl() before construction to strip trailing
 * punctuation, bracket wrappers, and markdown syntax that users include
 * when pasting URLs into conversational messages.
 *
 * Returns `{ type: "unsupported", id: "", url }` for any URL that doesn't
 * match a supported platform or is not a valid URL after sanitization.
 */
export function parseReferenceUrl(raw: string): ParsedReferenceUrl {
  // Normalize http → https before sanitizing (sanitizer may strip trailing chars
  // that include the protocol-colon in pathological input; normalise first).
  const normalized = raw.trim().replace(/^http:\/\//, "https://");

  console.log(`[reference] raw_url_received raw=${normalized.slice(0, 80)}`);

  // Sanitize: strip trailing punctuation, bracket/markdown wrappers
  const sanitized = sanitizeReferenceUrl(normalized);

  if (sanitized !== normalized) {
    console.log(
      `[reference] sanitized_url` +
      ` before=${normalized.slice(0, 80)}` +
      ` after=${sanitized.slice(0, 80)}`
    );
  }

  try {
    const u    = new URL(sanitized);
    // Strip www. and m. prefixes for uniform hostname matching
    const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");

    // ── YouTube ──────────────────────────────────────────
    if (host === "youtube.com" || host === "youtu.be") {
      let videoId: string | null = null;

      if (host === "youtu.be") {
        // youtu.be/VIDEO_ID  (query params like ?t=60, ?si=… are ignored)
        videoId = u.pathname.slice(1).split("/")[0] ?? null;
      } else if (u.pathname === "/watch" || u.pathname.startsWith("/watch?")) {
        // youtube.com/watch?v=VIDEO_ID
        videoId = u.searchParams.get("v");
      } else if (u.pathname.startsWith("/shorts/")) {
        // youtube.com/shorts/VIDEO_ID
        videoId = u.pathname.split("/")[2] ?? null;
      } else if (u.pathname.startsWith("/embed/")) {
        // youtube.com/embed/VIDEO_ID
        videoId = u.pathname.split("/")[2] ?? null;
      } else if (u.pathname.startsWith("/live/")) {
        // youtube.com/live/VIDEO_ID
        videoId = u.pathname.split("/")[2] ?? null;
      }

      // Validate: YouTube video IDs are exactly 11 chars (alphanumeric + _ -)
      if (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        // Canonical URL: always normalize to watch?v= form regardless of input variant
        const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
        console.log(`[reference] url_detected platform=youtube videoId=${videoId}`);
        return { type: "youtube", id: videoId, url: canonicalUrl };
      }
    }

    // ── Loom ─────────────────────────────────────────────
    if (host === "loom.com") {
      const shareMatch = /\/share\/([a-f0-9]{32,})/i.exec(u.pathname);
      if (shareMatch) {
        console.log(`[reference] url_detected platform=loom shareId=${shareMatch[1]!.slice(0, 8)}…`);
        // Loom share URL is already canonical
        return { type: "loom", id: shareMatch[1]!, url: sanitized };
      }
    }

    // ── Twitter / X ───────────────────────────────────────
    if (host === "twitter.com" || host === "x.com") {
      const statusMatch = /\/status\/(\d+)/.exec(u.pathname);
      if (statusMatch) {
        // Canonical URL: normalize to x.com (twitter.com → x.com)
        const canonicalUrl = `https://x.com${u.pathname}`;
        console.log(`[reference] url_detected platform=twitter tweetId=${statusMatch[1]}`);
        return { type: "twitter", id: statusMatch[1]!, url: canonicalUrl };
      }
    }

  } catch {
    // URL() constructor threw — string is not a valid URL even after sanitization
    console.log(`[reference] url_parse_error raw=${raw.slice(0, 60)}`);
  }

  return { type: "unsupported", id: "", url: sanitized };
}
