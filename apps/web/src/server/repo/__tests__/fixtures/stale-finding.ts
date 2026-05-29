/**
 * Fixture: a stale finding for staleness-annotation tests.
 *
 * STALE_ANALYZED_AT is 20 days before the test clock (FIXED_NOW), which is
 * older than the default 14-day staleness window, so stalenessAnnotation()
 * must append "(analyzed 20 days ago)". FRESH_ANALYZED_AT is 2 days old and
 * must produce no annotation.
 *
 * Import-safe: plain constants, no prisma.
 */

/** Fixed clock for deterministic staleness math. */
export const FIXED_NOW = new Date("2026-05-29T00:00:00Z").getTime();

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 20 days before FIXED_NOW → beyond the 14-day default window. */
export const STALE_ANALYZED_AT = new Date(FIXED_NOW - 20 * MS_PER_DAY);

/** 2 days before FIXED_NOW → inside the window, no annotation. */
export const FRESH_ANALYZED_AT = new Date(FIXED_NOW - 2 * MS_PER_DAY);

export interface FixtureFinding {
  id:             string;
  type:           string;
  title:          string;
  description:    string;
  confidence:     "confirmed" | "inferred" | "speculative";
  agentReasoning: string;
  evidenceLines?: { start: number; end: number };
}

export const STALE_FINDING: FixtureFinding = {
  id: "stale1", type: "security-signal", title: "Outdated dependency",
  description: "Auth library version flagged with a known CVE",
  confidence: "inferred", agentReasoning: "package.json pins an old version",
};
