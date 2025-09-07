export async function GET() {
  const upstream = "https://earthengine.googleapis.com/ee_api_js.js";
  try {
    const res = await fetch(upstream, {
      // Simple UA to avoid some corporate filters that block unknown clients
      headers: { "user-agent": "AlphaEarth-Next-Proxy" },
      // Use GET so it can be cached by Next.js edge/runtime
      method: "GET",
      // Let the platform decide runtime; Node.js runtime works fine
      // Keep defaults for redirects
    });

    if (!res.ok) {
      return new Response(
        `Failed to fetch EE loader: ${res.status} ${res.statusText}`,
        { status: 502 }
      );
    }

    const body = await res.text();

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        // Cache at the hosting layer/CDN for a day; SWR for an hour
        "cache-control": "public, s-maxage=86400, stale-while-revalidate=3600",
        "x-proxy-source": upstream,
      },
    });
  } catch (e) {
    return new Response(
      `Proxy error while fetching ${upstream}: ${e?.message || String(e)}`,
      { status: 500 }
    );
  }
}
