# Policy Proof Frontend (Next.js + Leaflet)

Interactive web app for exploring AlphaEarth Satellite Embedding tiles from Google Earth Engine and running a mock Spatial Regression Discontinuity (SRD) analysis near municipal borders.

What’s included:
- AlphaEarth Satellite Embedding visualization via server-side Google Earth Engine (no client OAuth popup)
- Boundary drawing (polygon/rectangle) on a Leaflet map
- Analyze button that sends your boundary to a FastAPI backend (`POST /api/analyze`) and renders a simple discontinuity chart
- WebSocket chat to the backend (`/ws/chat`) for guidance

This frontend lives alongside the FastAPI backend in `../backend`.

## Prerequisites

- FastAPI backend running locally (see `../backend/README.md`)
- Backend must be configured with Earth Engine credentials (service account) to sign tile templates (see backend README)

Note: The frontend no longer uses the Earth Engine JS client or OAuth popup. All Earth Engine interactions are handled server-side by the backend, which returns signed tile URL templates.

## Environment

Copy the example env and set values:

```bash
cp .env.local.example .env.local
# edit .env.local and set:
# - NEXT_PUBLIC_API_BASE (e.g., http://localhost:8000)
# - NEXT_PUBLIC_WS_URL   (e.g., ws://localhost:8000/ws/chat)
# (optional) AlphaEarth tile URL overrides if you want to use local/pre-rendered tiles
```

- `NEXT_PUBLIC_API_BASE`: FastAPI base URL (HTTP)
- `NEXT_PUBLIC_WS_URL`: FastAPI WebSocket URL for chat
- Optional AlphaEarth local tiles (if not using Earth Engine dynamically):
  - `NEXT_PUBLIC_ALPHAEARTH_TILE_TEMPLATE=/api/tiles/{year}/{z}/{x}/{y}.png`
  - Or explicit:
    - `NEXT_PUBLIC_ALPHAEARTH_LATEST_URL=/api/tiles/2024/{z}/{x}/{y}.png`
    - `NEXT_PUBLIC_ALPHAEARTH_PREVIOUS_URL=/api/tiles/2023/{z}/{x}/{y}.png`

If none of the optional AlphaEarth envs are set, the frontend will call the backend proxy route `/api/ee/alphaearth/tiles?year=YYYY&bands=A01,A16,A09` to obtain a signed Google Earth Engine XYZ tile template for the requested year.

## Development

Install dependencies and run the dev server (use your preferred Node package manager; pnpm recommended):

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000 in your browser.

Notes:
- The AlphaEarth overlays are available in the Leaflet Layers control. If the backend Earth Engine credentials are not set, an error banner will guide you.
- You can also supply local tiles under `frontend/public/alphaearth/{year}/{z}/{x}/{y}.png` and set the envs described above.

## Usage

1) Browse the map with Esri World Imagery basemap.
2) Optionally toggle AlphaEarth overlays in the Layers control:
   - If using dynamic Earth Engine, the app will fetch signed tile templates for the last fully available year and the previous year.
   - If using local tiles, ensure files exist at `public/alphaearth/{year}/{z}/{x}/{y}.png`.
3) Draw a boundary (polygon or rectangle) roughly along a municipal border using the toolbar.
4) Optionally enter a policy name (e.g., "Brookline Gas Leaf Blower Ban").
5) Click Analyze to send the boundary to the backend. A simple SVG chart will display the mock SRD discontinuity (jump at the border) and an Impact Score.
6) Use the Chat panel for quick guidance.

## Backend integration

- Analysis: `POST {NEXT_PUBLIC_API_BASE}/api/analyze`
  - Request body (one of `geometry`, `feature`, or `featureCollection`):
    ```json
    {
      "policy": "Some Policy",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[lng, lat], ...]]
      }
    }
    ```
  - Response:
    ```json
    {
      "policy": "Some Policy",
      "impact_score": 2.97,
      "points": [{ "distance_km": -5.0, "value": 8.4 }, ...],
      "bins": [-5, -4, ..., 5]
    }
    ```
- Chat: `WS {NEXT_PUBLIC_WS_URL}` (e.g., `ws://localhost:8000/ws/chat`)
  - Send `{ "message": "text" }` or a raw string
  - Receives JSON messages with `{type, from, message}`
- AlphaEarth tile template (dynamic EE): `GET {NEXT_PUBLIC_API_BASE}/api/ee/alphaearth/tiles?year=YYYY&bands=A01,A16,A09`
  - Returns:
    ```json
    {
      "year": 2024,
      "bands": ["A01", "A16", "A09"],
      "vmin": -0.3,
      "vmax": 0.3,
      "template": "https://earthengine.googleapis.com/..."
    }
    ```

## Troubleshooting

- AlphaEarth tiles fail:
  - If using dynamic EE: Ensure the backend has `EE_PROJECT` and `GOOGLE_APPLICATION_CREDENTIALS` set and the service account has Earth Engine access.
  - If using local tiles: Place PNGs under `public/alphaearth/{year}/{z}/{x}/{y}.png` and set `NEXT_PUBLIC_ALPHAEARTH_*` envs.
- CORS errors calling API: Set `ALLOWED_ORIGINS` in backend or ensure `NEXT_PUBLIC_API_BASE` points to the correct port.
- WebSocket fails: Check `NEXT_PUBLIC_WS_URL` and that the backend is running on that port.

## Code structure

- `components/EEMap.js`
  - Loads Leaflet and Leaflet.Draw
  - Provides draw controls, analyze button, chart, and chat UI
  - Fetches AlphaEarth tile templates from backend (or uses local tiles if configured)
- `app/layout.js`
  - Injects Leaflet and Leaflet.Draw CSS
- `app/api/analyze/route.js`
  - Same-origin proxy to backend analyze endpoint
- `app/api/ee/alphaearth/tiles/route.js`
  - Same-origin proxy to backend Earth Engine tile template endpoint
- `app/api/tiles/[year]/[z]/[x]/[y]/route.js`
  - Serves local pre-rendered AlphaEarth tiles from `public/alphaearth/...` (optional)

## License

MIT
