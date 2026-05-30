/**
 * POST /api/repo/reference/document  (multipart/form-data, field "file")
 *
 * Extracts plain text from an uploaded document so it can be fed to V# as a
 * reference source — exactly like a YouTube/X link, but the content comes from
 * a file. The extracted text is returned to the client, which then sends it to
 * /api/orchestrate as `referenceDocument`. Nothing is stored server-side.
 *
 * MVP scope: text-based formats (.txt/.md/.markdown/.csv/.tsv/.json/.log/.yml).
 * Binary formats (.pdf/.docx) are recognized and rejected with a clear message
 * (they need a parser library); pasting text still works for those.
 *
 * SECURITY: auth required; size + type validated; content never persisted.
 */

import { auth }          from "@clerk/nextjs/server";
import { NextResponse }  from "next/server";

import { rateLimit, sameOrigin, tooLargeByHeader } from "@/server/security/guards";

export const dynamic = "force-dynamic";

/** Max upload size — keeps parse + token cost bounded. */
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
/** Max characters returned (the AI call truncates further). */
const MAX_CHARS = 50_000;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "mdx", "csv", "tsv", "json", "jsonc",
  "log", "yml", "yaml", "text", "rst",
]);
const BINARY_HINT = new Set(["pdf", "docx", "doc", "rtf", "pages", "odt"]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/**
 * Heuristic binary detection: count control bytes (excluding tab=9, LF=10,
 * CR=13) in a sample. >2% control → treat as binary.
 */
function looksBinary(sample: string): boolean {
  if (sample.length === 0) return false;
  let control = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    const isControl = (c <= 8) || c === 11 || c === 12 || (c >= 14 && c <= 31);
    if (isControl) control++;
  }
  return control > sample.length * 0.02;
}

export async function POST(request: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  const rl = rateLimit(`document:${userId}`, 20, 5 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many uploads. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  // Reject oversized uploads BEFORE buffering the body (formData reads it all).
  // Allow a small multipart envelope overhead above the raw content cap.
  if (tooLargeByHeader(request, MAX_BYTES + 64 * 1024)) {
    return NextResponse.json({ error: "File too large (max 5 MB)." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data with a 'file' field." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 422 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "The file is empty." }, { status: 422 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 5 MB)." }, { status: 413 });
  }

  const ext = extOf(file.name);
  const isTextMime = (file.type || "").startsWith("text/") || file.type === "application/json";

  if (BINARY_HINT.has(ext)) {
    return NextResponse.json(
      { error: `${ext.toUpperCase()} isn't supported yet — paste the text, or upload a .txt / .md export of it.` },
      { status: 415 }
    );
  }
  if (!TEXT_EXTENSIONS.has(ext) && !isTextMime) {
    return NextResponse.json(
      { error: "Unsupported file type. Upload a text document (.txt, .md, .csv, .json, …) or paste the content." },
      { status: 415 }
    );
  }

  let raw: string;
  try {
    raw = await file.text();
  } catch {
    return NextResponse.json({ error: "Couldn't read the file as text." }, { status: 422 });
  }

  if (looksBinary(raw.slice(0, 2_000))) {
    return NextResponse.json(
      { error: "This looks like a binary file. Upload a plain-text document or paste the content." },
      { status: 415 }
    );
  }

  const text = raw.slice(0, MAX_CHARS).trim();
  if (!text) {
    return NextResponse.json({ error: "No readable text found in the file." }, { status: 422 });
  }

  return NextResponse.json({
    title: file.name,
    text,
    chars: text.length,
    truncated: raw.length > MAX_CHARS,
  });
}
