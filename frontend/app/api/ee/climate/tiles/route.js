export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxy to backend FastAPI for Climate (temperature) tile templates.
 * Forwards:
 *   GET /api/ee/climate/tiles?source=era5land|modis[&year|&y1&y2][&vmin&vmax]
 * to:
 *   ${NEXT_PUBLIC_API_BASE || http://localhost:8000}/api/ee/climate/tiles
 *
 * Examples:
 *   /api/ee/climate/tiles?source=era5land&year=2024
 *   /api/ee/climate/tiles?source=era5land&y1=2023&y2=2024
 *   /api/ee/climate/tiles?source=modis&y1=2023&y2=2024
 */
export async function GET(req) {
  try {
    const upstreamBase =
      process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
    const url = new URL(
      `${upstreamBase.replace(/\/+$/, "")}/api/ee/climate/tiles`
    );

    // Forward query params
    const incoming = new URL(req.url);
    for (const [k, v] of incoming.searchParams.entries()) {
      url.searchParams.set(k, v);
    }

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
      },
      cache: "no-store",
      redirect: "follow",
    });

    const resText = await res.text();
    const contentType =
      res.headers.get("content-type") || "application/json; charset=utf-8";

    return new Response(resText, {
      status: res.status,
      headers: {
        "content-type": contentType,
        "x-proxy-upstream": url.toString(),
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e?.message || String(e) }),
      {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  }
}

// CORS preflight (no-op for same-origin)
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}
