# Policy Proof Frontend (Next.js + Leaflet + Google Earth Engine)

Interactive web app for exploring Google Earth Engine layers and running a mock Spatial Regression Discontinuity (SRD) analysis near municipal borders. Includes:
- Google Earth Engine visualization (annual embedding layers and a similarity layer)
- Boundary drawing (polygon/rectangle) on a Leaflet map
- Analyze button that sends your boundary to a FastAPI backend (`POST /api/analyze`) and renders a simple discontinuity chart
- WebSocket chat to the backend (`/ws/chat`) for guidance

This frontend lives alongside the FastAPI backend in `../backend`.

## Prerequisites

- A Google Cloud project with the Earth Engine API enabled
- An Earth Engine account (approved for your Google user)
- A Web OAuth 2.0 Client ID (Google Cloud Console) with authorized origins for local dev
- FastAPI backend running locally (see `../backend/README.md`)

## Environment

Copy the example env and set values:

```bash
cp .env.local.example .env.local
# edit .env.local and set:
# - NEXT_PUBLIC_EE_CLIENT_ID
# - NEXT_PUBLIC_API_BASE (e.g., http://localhost:8000)
# - NEXT_PUBLIC_WS_URL   (e.g., ws://localhost:8000/ws/chat)
```

- `NEXT_PUBLIC_EE_CLIENT_ID`: Your Google OAuth Web Client ID
- `NEXT_PUBLIC_API_BASE`: FastAPI base URL (HTTP)
- `NEXT_PUBLIC_WS_URL`: FastAPI WebSocket URL for chat

## Development

Install dependencies and run the dev server (use your preferred Node package manager):

```bash
npm install
npm run dev
```

Open http://localhost:3000 in your browser.

Notes:
- On first load, a Google OAuth popup will ask you to sign in and authorize Earth Engine. Make sure popups are allowed for localhost.
- The app loads gapi and Earth Engine JS via Next API proxy routes to avoid Content-Security issues.

## Usage

1) Browse the map with Esri World Imagery basemap.
2) Draw a boundary (polygon or rectangle) roughly along a municipal border using the toolbar.
3) Optionally enter a policy name (e.g., "Brookline Gas Leaf Blower Ban").
4) Click Analyze to send the boundary to the backend. A simple SVG chart will display the mock SRD discontinuity (jump at the border) and an Impact Score.
5) Use the Chat panel to ask questions. Messages are sent over a WebSocket to the backend for fast guidance.

## What the map renders (Earth Engine)

The app reproduces a simple Earth Engine example:
- 2023 embedding RGB: bands A01, A16, A09 (range -0.3..0.3)
- 2024 embedding RGB: same visualization
- Similarity between years via dot product (0..1; white..black)

This corresponds to:

```javascript
var dataset = ee.ImageCollection('GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL');
var point = ee.Geometry.Point(-121.8036, 39.0372);
var image1 = dataset.filterDate('2023-01-01', '2024-01-01').filterBounds(point).first();
var image2 = dataset.filterDate('2024-01-01', '2025-01-01').filterBounds(point).first();
var visParams = {min: -0.3, max: 0.3, bands: ['A01', 'A16', 'A09']};
var dotProd = image1.multiply(image2).reduce(ee.Reducer.sum());
```

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

See `../backend/README.md` for details and how to run the backend.

## Troubleshooting

- Popup blocked: Allow popups for localhost:3000
- 401 / auth errors: Ensure Earth Engine account is approved, API enabled, OAuth client origins include localhost. Confirm `NEXT_PUBLIC_EE_CLIENT_ID`
- Blank tiles: Check browser console for Earth Engine errors. Verify network access to `earthengine.googleapis.com`
- CORS errors calling API: Set `ALLOWED_ORIGINS` in backend or ensure `NEXT_PUBLIC_API_BASE` points to the correct port
- WebSocket fails: Check `NEXT_PUBLIC_WS_URL` and that the backend is running on that port

## Code structure

- `components/EEMap.js`
  - Loads Leaflet and Leaflet.Draw (via CDN)
  - Injects EE layers using Earth Engine JS API with OAuth
  - Provides draw controls, analyze button, chart, and chat UI
- `app/layout.js`
  - Injects Leaflet and Leaflet.Draw CSS
  - Loads gapi and Earth Engine scripts via local proxy routes
- `app/page.js`
  - Client-only dynamic import for the map
- `app/api/proxy-ee` and `app/api/proxy-gapi`
  - Lightweight proxies to load required Google scripts in a Next-safe way

## License

MIT
