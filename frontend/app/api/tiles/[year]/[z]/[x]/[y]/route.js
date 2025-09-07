export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { promises as fs } from "fs";
import path from "path";

/**
 * Serves AlphaEarth XYZ tiles from the app's public folder:
 *   public/alphaearth/{year}/{z}/{x}/{y}.png
 *
 * Usage (set in .env.local):
 *   NEXT_PUBLIC_ALPHAEARTH_TILE_TEMPLATE=/api/tiles/{year}/{z}/{x}/{y}.png
 *
 * Drop your pre-rendered PNG tiles under public/alphaearth accordingly.
 * If a tile is missing, this returns a lightweight SVG placeholder instead of 404,
 * so Leaflet won't spam the console with network errors.
 */
export async function GET(_req, { params }) {
  try {
    const year = String(params?.year ?? "");
    const z = String(params?.z ?? "");
    const x = String(params?.x ?? "");
    const y = String(params?.y ?? "");

    if (!year || !z || !x || !y) {
      return new Response("Bad Request", { status: 400 });
    }

    const baseDir = process.cwd(); // Next.js frontend project root
    const filePath = path.join(
      baseDir,
      "public",
      "alphaearth",
      year,
      z,
      x,
      `${y}.png`
    );

    const data = await fs.readFile(filePath);
    return new Response(data, {
      status: 200,
      headers: {
        "content-type": "image/png",
        // Long cache for tiles; invalidate by changing filenames/paths if needed.
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    // Return an inline SVG "missing tile" to avoid console errors and visualize gaps.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
  <defs>
    <pattern id="p" width="16" height="16" patternUnits="userSpaceOnUse">
      <rect width="16" height="16" fill="#f3f3f3" />
      <path d="M0,0 L16,16 M16,0 L0,16" stroke="#ddd" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="256" height="256" fill="url(#p)"/>
  <rect x="8" y="8" width="240" height="240" fill="none" stroke="#bbb" stroke-width="1"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
        font-family="monospace" font-size="12" fill="#888">
    no tile
  </text>
</svg>`;
    return new Response(svg, {
      status: 200,
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "no-cache",
      },
    });
  }
}
