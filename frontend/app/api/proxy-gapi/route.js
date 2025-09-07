export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const upstream = "https://apis.google.com/js/api.js";
  try {
    const res = await fetch(upstream, {
      method: "GET",
      headers: {
        "user-agent": "AlphaEarth-Next-Proxy",
        accept: "application/javascript, text/javascript, */*;q=0.1",
      },
      redirect: "follow",
      cache: "no-store",
    });

    if (!res.ok) {
      let extra = "";
      try {
        const text = await res.text();
        if (text) extra = ` — ${text}`;
      } catch {
        // ignore
      }
      return new Response(
        `Failed to fetch Google API loader: ${res.status} ${res.statusText}${extra}`,
        { status: 502 }
      );
    }

    const body = await res.text();

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/javascript; charset=utf-8",
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
