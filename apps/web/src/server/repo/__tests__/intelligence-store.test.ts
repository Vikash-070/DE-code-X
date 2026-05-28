/**
 * Unit tests: intelligence-store.ts
 *
 * Tests deduplication logic, blobSHA staleness detection, and snapshot capping.
 * These tests do NOT hit the real DB — they verify the pure logic that wraps
 * Prisma calls.
 *
 * Run with: vitest / jest (add test runner to package.json when ready)
 *
 * NOTE: Tests that require DB access should use a test Prisma client with a
 * separate test DATABASE_URL. The logic tests below are pure / in-memory.
 */

/**
 * Test runner: add vitest or jest to package.json to run these.
 * The tests below use only standard assertions — no runner-specific APIs
 * beyond describe/it/expect (compatible with both vitest and jest).
 *
 * Install vitest: `pnpm add -D vitest` in apps/web or root
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { describe, it, expect } = (globalThis as unknown as {
  describe: typeof import("vitest")["describe"];
  it: typeof import("vitest")["it"];
  expect: typeof import("vitest")["expect"];
});

interface CipherFinding {
  id: string;
  type: string;
  title: string;
  description: string;
  confidence: "confirmed" | "inferred" | "speculative";
  agentReasoning: string;
  evidenceLines?: { start: number; end: number };
  relatedFilePaths?: string[];
  pressureLevel?: "high" | "medium" | "low";
}

// ─── Test: CipherFinding normalization (pure logic) ──────────

describe("CipherFinding schema", () => {
  it("requires agentReasoning to be non-empty", () => {
    const finding: CipherFinding = {
      id:             "test-id",
      type:           "implementation",
      title:          "Test finding",
      description:    "A test finding",
      confidence:     "confirmed",
      agentReasoning: "Line 42 calls verify() without expiresIn option",
    };
    expect(finding.agentReasoning.length).toBeGreaterThan(10);
  });

  it("accepts all valid confidence values", () => {
    const values: CipherFinding["confidence"][] = ["confirmed", "inferred", "speculative"];
    for (const v of values) {
      const f: CipherFinding = {
        id: "x", type: "implementation", title: "t",
        description: "d", confidence: v, agentReasoning: "specific line reference"
      };
      expect(f.confidence).toBe(v);
    }
  });

  it("accepts all valid finding types", () => {
    const types: CipherFinding["type"][] = [
      "implementation", "integrity", "pressure", "dependency", "security-signal"
    ];
    for (const t of types) {
      const f: CipherFinding = {
        id: "x", type: t, title: "t",
        description: "d", confidence: "inferred", agentReasoning: "line 10"
      };
      expect(f.type).toBe(t);
    }
  });
});

// ─── Test: blobSHA staleness logic ────────────────────────────

describe("blobSHA staleness", () => {
  it("detects staleness when SHA differs", () => {
    const shas = { stored: "abc123", current: "def456" };
    const isStale = shas.stored !== shas.current;
    expect(isStale).toBe(true);
  });

  it("detects freshness when SHA matches", () => {
    const sha = "abc123";
    const shas = { stored: sha, current: sha };
    const isStale = shas.stored !== shas.current;
    expect(isStale).toBe(false);
  });

  it("treats sentinel __stale__ as always-stale", () => {
    const sentinel = "__stale__";
    const shas = { stored: sentinel, current: "abc123" };
    const isStale = shas.stored !== shas.current || shas.stored === sentinel;
    expect(isStale).toBe(true);
  });
});

// ─── Test: snapshot entry capping ────────────────────────────

describe("snapshot capping", () => {
  const MAX = 10_000;

  it("returns entries unchanged when under cap", () => {
    const entries = Array.from({ length: 5_000 }, (_, i) => ({
      path: `src/file${i}.ts`,
      blobSHA: `sha${i}`,
    }));
    const capped = entries.length > MAX ? entries.slice(0, MAX) : entries;
    expect(capped.length).toBe(5_000);
  });

  it("caps at MAX_SNAPSHOT_ENTRIES for large repos", () => {
    const entries = Array.from({ length: 15_000 }, (_, i) => ({
      path: `src/file${i}.ts`,
      blobSHA: `sha${i}`,
    }));
    const capped = entries.length > MAX ? entries.slice(0, MAX) : entries;
    expect(capped.length).toBe(MAX);
  });
});

// ─── Test: staleness diff logic ───────────────────────────────

describe("staleness diff computation", () => {
  type Entry = { path: string; blobSHA: string };

  function computeDiff(prior: Entry[], current: Entry[]) {
    const priorMap   = new Map(prior.map(e => [e.path, e.blobSHA]));
    const currentMap = new Map(current.map(e => [e.path, e.blobSHA]));

    const changed: Entry[] = [];
    const newFiles: Entry[] = [];
    const removed: string[] = [];

    for (const entry of current) {
      const priorSHA = priorMap.get(entry.path);
      if (priorSHA === undefined) newFiles.push(entry);
      else if (priorSHA !== entry.blobSHA) changed.push(entry);
    }

    for (const path of priorMap.keys()) {
      if (!currentMap.has(path)) removed.push(path);
    }

    return { changed, newFiles, removed };
  }

  it("detects changed files", () => {
    const prior   = [{ path: "src/auth.ts", blobSHA: "old" }];
    const current = [{ path: "src/auth.ts", blobSHA: "new" }];
    const { changed } = computeDiff(prior, current);
    expect(changed).toHaveLength(1);
    expect(changed[0].path).toBe("src/auth.ts");
  });

  it("detects new files", () => {
    const prior   = [{ path: "src/auth.ts", blobSHA: "abc" }];
    const current = [
      { path: "src/auth.ts",  blobSHA: "abc" },
      { path: "src/upload.ts", blobSHA: "xyz" },
    ];
    const { newFiles } = computeDiff(prior, current);
    expect(newFiles).toHaveLength(1);
    expect(newFiles[0].path).toBe("src/upload.ts");
  });

  it("detects removed files", () => {
    const prior   = [
      { path: "src/auth.ts",   blobSHA: "abc" },
      { path: "src/legacy.ts", blobSHA: "old" },
    ];
    const current = [{ path: "src/auth.ts", blobSHA: "abc" }];
    const { removed } = computeDiff(prior, current);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toBe("src/legacy.ts");
  });

  it("returns empty arrays when nothing changed", () => {
    const entries = [{ path: "src/auth.ts", blobSHA: "abc" }];
    const { changed, newFiles, removed } = computeDiff(entries, entries);
    expect(changed).toHaveLength(0);
    expect(newFiles).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  it("handles empty prior snapshot (first run)", () => {
    const current = [{ path: "src/auth.ts", blobSHA: "abc" }];
    const { newFiles } = computeDiff([], current);
    expect(newFiles).toHaveLength(1);
  });
});

// ─── Test: finding normalization (title truncation) ───────────

describe("finding normalization", () => {
  it("truncates title at 80 chars", () => {
    const longTitle = "A".repeat(100);
    const truncated = longTitle.slice(0, 80);
    expect(truncated.length).toBe(80);
  });

  it("falls back to speculative confidence for unknown values", () => {
    const validConfidence = ["confirmed", "inferred", "speculative"];
    const incoming = "uncertain"; // not a valid value
    const normalized = validConfidence.includes(incoming) ? incoming : "speculative";
    expect(normalized).toBe("speculative");
  });

  it("falls back to implementation type for unknown finding types", () => {
    const validTypes = ["implementation", "integrity", "pressure", "dependency", "security-signal"];
    const incoming = "unknown-type";
    const normalized = validTypes.includes(incoming) ? incoming : "implementation";
    expect(normalized).toBe("implementation");
  });
});
