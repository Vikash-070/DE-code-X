/**
 * HTTP security guards — shared, dependency-free helpers for API routes.
 *
 *   • rateLimit       — per-key sliding-window limiter (economic-DoS / abuse).
 *   • sameOrigin      — lightweight CSRF defense for state-changing POSTs.
 *   • tooLargeByHeader— reject oversized uploads before buffering the body.
 *
 * The limiter is in-process (per server instance). That's a real, MVP-grade
 * mitigation; a distributed limiter (Redis) is the follow-up if you scale to
 * multiple instances. Pure logic — `rateLimit` is unit-testable via `_now`.
 */

interface Bucket { hits: number[]; }

const buckets = new Map<string, Bucket>();
/** Safety cap so the map can't grow unbounded under key churn. */
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the next request would be allowed (0 when allowed). */
  retryAfterSec: number;
  /** Remaining allowance in the current window. */
  remaining: number;
}

/**
 * Sliding-window rate limit. Returns whether `key` may proceed given `max`
 * requests per `windowMs`. `_now` is injectable for tests.
 */
export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
  _now: number = Date.now()
): RateLimitResult {
  if (buckets.size > MAX_KEYS) buckets.clear(); // coarse but bounded

  const bucket = buckets.get(key) ?? { hits: [] };
  const hits = bucket.hits.filter((t) => _now - t < windowMs);

  if (hits.length >= max) {
    const oldest = hits[0]!;
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (_now - oldest)) / 1000));
    bucket.hits = hits;
    buckets.set(key, bucket);
    return { allowed: false, retryAfterSec, remaining: 0 };
  }

  hits.push(_now);
  bucket.hits = hits;
  buckets.set(key, bucket);
  return { allowed: true, retryAfterSec: 0, remaining: max - hits.length };
}

/** Test/maintenance helper — clears all rate-limit state. */
export function _resetRateLimits(): void {
  buckets.clear();
}

/**
 * CSRF guard for state-changing requests. Browsers send `Origin` on POST; a
 * cross-site form/fetch carries the attacker's origin, which won't match the
 * request host. Same-origin requests that omit `Origin` are allowed (no CSRF
 * vector without a forged origin). Returns true when the request is safe.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // no Origin header → not a cross-site form POST

  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host");
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** True when the declared Content-Length exceeds maxBytes (reject pre-buffer). */
export function tooLargeByHeader(request: Request, maxBytes: number): boolean {
  const raw = request.headers.get("content-length");
  if (!raw) return false; // unknown length → fall back to post-read size check
  const len = Number(raw);
  return Number.isFinite(len) && len > maxBytes;
}
