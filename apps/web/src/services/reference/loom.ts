/**
 * Loom reference content fetcher.
 *
 * Loom does not expose a public transcript API.
 * We use the oEmbed endpoint to retrieve title + description (the video
 * summary the creator writes), which is usually sufficient for intent extraction.
 *
 * Server-side only. Never import from client components.
 */

const LOOM_OEMBED_BASE = "https://www.loom.com/v1/oembed";
const MAX_CONTENT_CHARS = 3_000;

interface LoomOEmbedResponse {
  title?:       string;
  description?: string;
  author_name?: string;
}

export interface LoomContent {
  title:   string | null;
  /** Combined content string: title + description, capped to MAX_CONTENT_CHARS */
  text:    string;
}

/**
 * Fetch Loom video metadata via oEmbed.
 * Returns title + description as a combined text string.
 * Returns null on fetch failure.
 */
export async function fetchLoomContent(
  shareId: string
): Promise<LoomContent | null> {
  const shareUrl = `https://www.loom.com/share/${shareId}`;
  const endpoint = `${LOOM_OEMBED_BASE}?url=${encodeURIComponent(shareUrl)}`;

  try {
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(4_000),
      headers: { Accept: "application/json" }
    });

    if (!res.ok) {
      console.log(`[reference/loom] oembed_failed shareId=${shareId} status=${res.status}`);
      return null;
    }

    const data = await res.json() as LoomOEmbedResponse;
    const title = data.title ?? null;
    const parts = [title, data.description].filter(Boolean).join(". ");
    const text  = parts.slice(0, MAX_CONTENT_CHARS);

    console.log(`[reference/loom] oembed_success shareId=${shareId} textLen=${text.length}`);
    return { title, text };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[reference/loom] fetch_failed shareId=${shareId} err=${msg.slice(0, 80)}`);
    return null;
  }
}
