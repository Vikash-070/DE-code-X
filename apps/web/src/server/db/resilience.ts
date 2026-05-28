/**
 * Prisma resilience utilities.
 *
 * Classifies DB errors, retries transient failures, and wraps operations
 * with hard timeouts. All DB-touching API routes should use these wrappers.
 *
 * SECURITY: classifyPrismaError() produces user-facing messages that never
 * expose raw Prisma internals, stack traces, or connection strings.
 */

import { Prisma } from "@prisma/client";

// ─── Error classification ─────────────────────────────────

export type DbErrorKind =
  | "timeout"     // DB timed out (Prisma P1002/P1008, or our withDbTimeout sentinel)
  | "connection"  // Can't reach DB (P1001, P1017, init failure)
  | "constraint"  // Unique / foreign-key violation — non-retriable
  | "not_found"   // Record required by query not found — non-retriable
  | "unknown";    // Everything else

export interface ClassifiedDbError {
  kind:      DbErrorKind;
  code?:     string;   // Prisma P-code (logging only — never send to client)
  raw:       string;   // Full error message (logging only — never send to client)
  message:   string;   // Safe, user-facing explanation
  retriable: boolean;
}

/** Prisma error codes that indicate transient/retriable failures */
const RETRIABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017"]);

/** Subset of retriable codes that specifically indicate a timeout */
const TIMEOUT_CODES = new Set(["P1002", "P1008"]);

/** Sentinel thrown by withDbTimeout — must stay in sync with the throw below */
const TIMEOUT_SENTINEL = "__db_timeout__";

/**
 * Classify an unknown DB error into a typed, user-safe result.
 *
 * @param err - Any value caught from a Prisma operation or withDbTimeout
 */
export function classifyPrismaError(err: unknown): ClassifiedDbError {
  const raw = err instanceof Error ? err.message : String(err);

  // Sentinel from our own withDbTimeout()
  if (raw === TIMEOUT_SENTINEL) {
    return {
      kind: "timeout", raw, retriable: true,
      message: "Database timed out. Supabase may be cold-starting — wait a few seconds and try again."
    };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const { code } = err;

    if (TIMEOUT_CODES.has(code)) {
      return {
        kind: "timeout", code, raw, retriable: true,
        message: "Database timed out. Supabase may be cold-starting — wait a few seconds and try again."
      };
    }
    if (RETRIABLE_CODES.has(code)) {
      return {
        kind: "connection", code, raw, retriable: true,
        message: "Database connection failed. Try again in a moment."
      };
    }
    if (code === "P2002") {
      return {
        kind: "constraint", code, raw, retriable: false,
        message: "A record conflict occurred. Try refreshing and saving again."
      };
    }
    if (code === "P2025") {
      return {
        kind: "not_found", code, raw, retriable: false,
        message: "Record not found."
      };
    }
    return {
      kind: "unknown", code, raw, retriable: false,
      message: "Database error. Try again shortly."
    };
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    const isTimeout = /timed?\s*out|timeout/i.test(raw);
    return {
      kind: isTimeout ? "timeout" : "connection",
      raw, retriable: true,
      message: isTimeout
        ? "Database is warming up. Wait a few seconds and try again."
        : "Database unavailable. Check your DATABASE_URL or try again shortly."
    };
  }

  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    return {
      kind: "connection", raw, retriable: true,
      message: "Database returned an unexpected error. Try again shortly."
    };
  }

  if (err instanceof Prisma.PrismaClientRustPanicError) {
    return {
      kind: "unknown", raw, retriable: false,
      message: "Internal database error. Contact support if this persists."
    };
  }

  return {
    kind: "unknown", raw, retriable: false,
    message: "Unexpected error. Try again shortly."
  };
}

// ─── Retry with exponential backoff ──────────────────────

export interface RetryOptions {
  /** Total attempts including the first. Default: 3 (initial + 2 retries). */
  maxAttempts?: number;
  /** Initial delay in ms. Doubles on each retry. Default: 350ms. */
  baseDelayMs?: number;
  /** Label for server log lines. Default: "db_op". */
  label?:       string;
}

/**
 * Wraps a DB operation with retry logic for transient failures.
 *
 * Retries on: timeout, connection errors (kind === "timeout" | "connection").
 * Does NOT retry on: constraint, not_found, unknown.
 *
 * Re-throws the original error on final failure so the caller can still
 * call classifyPrismaError() on it for the user-facing message.
 */
export async function withRetry<T>(
  fn:   () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 350, label = "db_op" } = opts;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) {
        console.log(`[db-resilience] ${label} recovered attempt=${attempt}`);
      }
      return result;
    } catch (err) {
      lastErr = err;
      const c = classifyPrismaError(err);

      if (!c.retriable || attempt === maxAttempts) {
        console.log(
          `[db-resilience] ${label} failed` +
          ` attempt=${attempt}/${maxAttempts}` +
          ` kind=${c.kind}` +
          (c.code ? ` code=${c.code}` : "") +
          ` retriable=${c.retriable}`
        );
        throw err; // re-throw original for caller's classifyPrismaError
      }

      const delay = baseDelayMs * (2 ** (attempt - 1)); // 350ms, 700ms
      console.log(
        `[db-resilience] ${label} transient` +
        ` attempt=${attempt}/${maxAttempts}` +
        ` kind=${c.kind}` +
        ` retrying_in=${delay}ms`
      );
      await new Promise<void>((r) => setTimeout(r, delay));
    }
  }

  throw lastErr; // unreachable — TypeScript requires it
}

// ─── Hard timeout ─────────────────────────────────────────

/**
 * Race a DB operation against a hard timeout.
 *
 * On expiry, throws `new Error("__db_timeout__")` — a value that
 * classifyPrismaError() recognises and maps to kind="timeout".
 *
 * @param promise - The DB operation to race
 * @param ms      - Hard timeout in milliseconds
 */
export async function withDbTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(TIMEOUT_SENTINEL)),
      ms
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId!);
  }
}
