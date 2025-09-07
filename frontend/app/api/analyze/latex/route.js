export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same-origin proxy to backend FastAPI to avoid CORS in the browser.
// Forwards POST /api/analyze/latex to `${NEXT_PUBLIC_API_BASE || http://localhost:8001}/api/analyze/latex`
export async function POST(req) {
  try {
    const body = await req.text(); // keep raw body
    const upstreamBase =
      process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8001";
    const url = `${upstreamBase.replace(/\/+$/, "")}/api/analyze/latex`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": req.headers.get("content-type") || "application/json",
      },
      body,
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
        "x-proxy-upstream": url,
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

// Not strictly needed for same-origin requests, but safe no-op for preflight.
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}
