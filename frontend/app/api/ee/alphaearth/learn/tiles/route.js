export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxy to backend FastAPI for learned AlphaEarth embedding → climate tiles.
 * Forwards:
 *   POST /api/ee/alphaearth/learn/tiles?target=stl1|t2m|lst_day[&year][&vmin&vmax][&scale]
 * Body:
 *   { "geometry": GeoJSONGeometry }
 *
 * to:
 *   ${NEXT_PUBLIC_API_BASE || http://localhost:8000}/api/ee/alphaearth/learn/tiles
 *
 * Examples:
 *   POST /api/ee/alphaearth/learn/tiles?target=stl1&year=2024
 *   body: { "geometry": { ... } }
 */
export async function POST(req) {
  try {
    const upstreamBase =
      process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
    const incomingUrl = new URL(req.url);
    const url = new URL(
      `${upstreamBase.replace(/\/+$/, "")}/api/ee/alphaearth/learn/tiles`
    );

    // Forward query params
    for (const [k, v] of incomingUrl.searchParams.entries()) {
      url.searchParams.set(k, v);
    }

    // Forward body
    const bodyText = await req.text();

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "content-type":
          req.headers.get("content-type") || "application/json; charset=utf-8",
        accept: "application/json",
      },
      body: bodyText,
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
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}
