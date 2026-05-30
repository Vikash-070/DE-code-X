/**
 * File Narration — Stage 3 (AI layer).
 *
 * Generates the human-readable "Technical Role / Plain English / Notes" panel
 * for a single file by reading its content and asking OpenRouter for a tight,
 * grounded summary. This is the ONLY part of the architecture map that uses AI,
 * and it is gated by confirm-before-spend (explicit user action) at the call
 * site. Results are cached so re-opening a file is free.
 *
 * The PARSER (`parseNarration`) is pure and unit-tested. The model call is
 * isolated in `narrateFile` and only runs on an explicit, paid request.
 */

import OpenAI from "openai";

import {
  OPENROUTER_MODEL,
  OPENROUTER_BASE_URL,
} from "@/server/ai/constants";

// ─── Types ────────────────────────────────────────────────────

export interface FileNarration {
  /** One-line technical role, e.g. "Renders the ranked social feed". */
  technicalRole: string;
  /** 1–2 sentences a non-engineer could follow. */
  plainEnglish: string;
  /** 2–5 short, code-grounded bullets (what it reads / calls / does). */
  notes: string[];
}

// ─── Prompt ───────────────────────────────────────────────────

const SYSTEM_PROMPT =
  "You are Atlas, narrating one source file for a developer skimming an architecture map. " +
  "Read the file and explain what it actually does — grounded ONLY in the code shown. Never invent " +
  "APIs, functions, or behavior that isn't present. Be concise and concrete.\n\n" +
  "Return STRICT JSON, no markdown, no code fences, with exactly these keys:\n" +
  '{\n' +
  '  "technicalRole": string,   // <=120 chars, what this file is, technically\n' +
  '  "plainEnglish": string,    // 1-2 sentences a non-engineer understands; a short analogy is fine\n' +
  '  "notes": string[]          // 2-5 short bullets: what it imports/reads, what it calls, key behavior\n' +
  '}';

/** Bound the file content sent to the model (token + cost control). */
const MAX_CONTENT_CHARS = 12_000;

// ─── Parser (pure) ────────────────────────────────────────────

/**
 * Parse the model's response into a FileNarration. Tolerant of accidental code
 * fences / surrounding prose. Returns null when the shape is unusable.
 */
export function parseNarration(raw: string): FileNarration | null {
  if (!raw) return null;
  // Strip code fences and isolate the outermost JSON object.
  let text = raw.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  text = text.slice(start, end + 1);

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }

  const technicalRole = typeof obj.technicalRole === "string" ? obj.technicalRole.trim() : "";
  const plainEnglish = typeof obj.plainEnglish === "string" ? obj.plainEnglish.trim() : "";
  const notes = Array.isArray(obj.notes)
    ? obj.notes.filter((n): n is string => typeof n === "string").map((n) => n.trim()).filter(Boolean).slice(0, 5)
    : [];

  if (!technicalRole && !plainEnglish && notes.length === 0) return null;
  return { technicalRole, plainEnglish, notes };
}

// ─── Model call ───────────────────────────────────────────────

/**
 * Narrate a single file via OpenRouter. Caller MUST have already confirmed the
 * paid action and decrypted the user's key. Throws on provider/parse failure so
 * the route can surface a clear error.
 */
export async function narrateFile(params: {
  path: string;
  role: string;
  layer: string;
  content: string;
  apiKey: string;
  model?: string | null;
}): Promise<FileNarration> {
  const { path, role, layer, content, apiKey, model } = params;

  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: { "HTTP-Referer": "https://decode-x.ai", "X-Title": "DE-code X" },
  });

  const trimmed = content.length > MAX_CONTENT_CHARS
    ? content.slice(0, MAX_CONTENT_CHARS) + "\n/* …truncated… */"
    : content;

  const user =
    `File: ${path}\n` +
    `Detected role: ${role} (${layer})\n\n` +
    `--- SOURCE ---\n${trimmed}`;

  const completion = await client.chat.completions.create({
    model: model || OPENROUTER_MODEL,
    max_tokens: 600,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
  });

  const text = completion.choices[0]?.message?.content ?? "";
  const parsed = parseNarration(text);
  if (!parsed) throw new Error("Narration returned an unparseable response.");
  return parsed;
}
