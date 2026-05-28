/**
 * YouTube transcript fetcher.
 *
 * Uses `youtube-transcript` npm package — handles auto-caption XML parse
 * and segment chunking. Returns a plain string capped to `maxChars`.
 *
 * Server-side only. Never import from client components.
 *
 * Failure modes:
 * - No auto-captions on video → returns null (caller uses title-only fallback)
 * - Private or unavailable video → returns null
 * - YouTube server-side block → returns null with structured telemetry
 * - Network timeout → returns null (wrapped in 5s hard timeout upstream)
 */

// Dynamic import avoids build-time errors if the package is not yet installed.
// Resolved at runtime when `youtube-transcript` is in node_modules.
type YoutubeTranscriptModule = {
  YoutubeTranscript: {
    fetchTranscript(
      videoId: string,
      config?: { lang?: string }
    ): Promise<Array<{ text: string; duration: number; offset: number }>>;
  };
};

const MAX_TRANSCRIPT_CHARS = 3_000;

/**
 * Fetch and concatenate the auto-generated transcript for a YouTube video.
 *
 * Passes `{ lang: 'en' }` to prefer English captions — reduces chance of
 * receiving non-English or auto-translated transcripts. Falls back gracefully
 * when the video has no captions or when YouTube blocks server-side requests.
 *
 * @param videoId  - 11-character YouTube video ID
 * @param maxChars - Hard character cap (default 3000)
 * @returns Truncated transcript text, or null on any failure
 */
export async function fetchYouTubeTranscript(
  videoId:  string,
  maxChars: number = MAX_TRANSCRIPT_CHARS
): Promise<string | null> {
  console.log(`[reference] transcript_fetch_started videoId=${videoId}`);

  try {
    // Dynamic import — avoids client-bundle contamination and allows graceful
    // degradation if the package is absent in certain build environments.
    const mod = await import("youtube-transcript") as YoutubeTranscriptModule;

    const segments = await mod.YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });

    if (!segments || segments.length === 0) {
      console.log(`[reference] transcript_fetch_failed videoId=${videoId} reason=empty_segments`);
      return null;
    }

    const full    = segments.map((s) => s.text).join(" ");
    const trimmed = full.slice(0, maxChars);

    console.log(`[reference] transcript_fetch_success videoId=${videoId} chars=${trimmed.length} segments=${segments.length}`);
    return trimmed;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Classify the failure reason for actionable telemetry
    const reason =
      msg.includes("Could not get")     ? "no_captions"     :
      msg.includes("disabled")          ? "captions_disabled" :
      msg.includes("private")           ? "private_video"   :
      msg.includes("unavailable")       ? "video_unavailable" :
      msg.includes("fetch") || msg.includes("network") ? "network_error" :
      "unknown";

    console.log(
      `[reference] transcript_fetch_failed` +
      ` videoId=${videoId}` +
      ` reason=${reason}` +
      ` err=${msg.slice(0, 100)}`
    );
    return null;
  }
}

/**
 * Fetch the title of a YouTube video via oEmbed (no API key needed).
 * This is used as the title-only fallback when transcript extraction fails.
 * Intent extraction can still derive implementation context from a title alone
 * (e.g. "Build a Stripe Checkout in Next.js" → intent extracted from title).
 *
 * @param videoId - 11-character YouTube video ID
 * @returns Video title string, or null on failure
 */
export async function fetchYouTubeTitle(videoId: string): Promise<string | null> {
  try {
    const endpoint = `https://www.youtube.com/oembed?url=https://youtu.be/${videoId}&format=json`;
    const res      = await fetch(endpoint, { signal: AbortSignal.timeout(3_000) });

    if (!res.ok) {
      console.log(`[reference] title_fetch_failed videoId=${videoId} status=${res.status}`);
      return null;
    }

    const data  = await res.json() as { title?: string };
    const title = data.title ?? null;

    if (title) {
      console.log(`[reference] title_fetch_success videoId=${videoId} title=${title.slice(0, 60)}`);
    } else {
      console.log(`[reference] title_fetch_failed videoId=${videoId} reason=no_title_field`);
    }

    return title;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[reference] title_fetch_failed videoId=${videoId} err=${msg.slice(0, 60)}`);
    return null;
  }
}
