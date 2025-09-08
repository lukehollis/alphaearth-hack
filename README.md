![alpha_1](https://github.com/user-attachments/assets/0e63ac20-cf44-4e21-b993-3b581df6b053)


# SRD + AlphaEarth

FastAPI backend `./backend` powering Spatial Regression Discontinuity (SRD) quasi-experiments and AlphaEarth Satellite Embedding visualization for the companion Next.js frontend in `./frontend`.

What this service provides:
- Health check at `GET /health`
- Mock Spatial Regression Discontinuity analysis at `POST /api/analyze`
- AlphaEarth Satellite Embedding tiles template via server-side Google Earth Engine at `GET /api/ee/alphaearth/tiles`
- WebSocket chat at `WS /ws/chat`

This backend is designed to run locally in development and to work seamlessly with the frontend to let users draw a boundary near a policy border, run an SRD-style analysis, and visualize both the AlphaEarth embeddings and the discontinuity chart.

Note on SRD in this project: the current `/api/analyze` endpoint implements a mock SRD (for demo/teaching and end-to-end pipeline validation). It bins distances to the drawn border and returns a discontinuity-shaped series and an `impact_score`. The full experiment flow, UX, and data plumbing are realistic; you can later swap the mock with a production estimator.

---

![alpha_3](https://github.com/user-attachments/assets/abd1ce7d-a8f4-4555-b09e-2f92a55d8294)


## SRD + AlphaEarth: How it works

- Draw a boundary along a candidate policy border (e.g., a municipal boundary).
- The frontend sends the boundary geometry to this backend: `POST /api/analyze`.
- Backend returns:
  - `points`: synthetic values by distance-to-border bins with a jump at zero (the border)
  - `bins`: the bin centers, negative on one side of the border, positive on the other
  - `impact_score`: a scalar summarizing the estimated discontinuity magnitude
- In parallel, the map uses AlphaEarth Satellite Embedding tiles for visual context:
  - The frontend requests a signed XYZ template from `GET /api/ee/alphaearth/tiles`.
  - The backend signs and returns a Google Earth Engine (GEE) URL template for an AlphaEarth year/band combo (defaults suitable for RGB).

This approach demonstrates a realistic SRD workflow while using server-side GEE for tiles (no client OAuth popup).

![alpha_4](https://github.com/user-attachments/assets/2c3bd7f3-bd23-432b-bfe7-c9d37bc076dd)


---

## Requirements

- Python 3.10+
- uv (preferred Python package manager)
  - Install: `pipx install uv` or `pip install uv`
- For Earth Engine tile features:
  - A Google Cloud project linked to Earth Engine (EE API enabled)
  - A service account with access to Earth Engine for that project
  - A local credentials JSON for that service account

---

## Quickstart (Local Development)

1) Install dependencies

```bash
uv sync
```

2) Configure environment

Create a `.env` file in this directory (or set env vars in your shell). See `.env.example` for all options.

Minimum for development:
```env
# CORS for the Next.js frontend
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Earth Engine (server-side)
EE_PROJECT=your_gcp_project_id
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
```

Notes:
- The service account in `GOOGLE_APPLICATION_CREDENTIALS` must be granted Earth Engine access for the project in `EE_PROJECT`. See “Earth Engine setup” below.
- The frontend should set:
  - `NEXT_PUBLIC_API_BASE` (e.g. `http://localhost:8000`)
  - `NEXT_PUBLIC_WS_URL`  (e.g. `ws://localhost:8000/ws/chat`)

3) Run the backend (dev)

Do not run the dev server if your workflow already runs it elsewhere; this command is provided for reference:
```bash
uv run uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

- HTTP base: `http://localhost:8000`
- WebSocket endpoint: `ws://localhost:8000/ws/chat`

4) Run the frontend and perform an SRD experiment

- In `../frontend`, follow its README to install deps (`pnpm install`) and run `pnpm dev`.
- Open http://localhost:3000, draw a boundary roughly along a policy border, and click “Analyze.”
- Inspect:
  - The AlphaEarth overlay in the Layers control (requires backend EE credentials)
  - The SRD chart and `impact_score` returned by this backend

---

## Earth Engine setup (server-side)

This backend initializes the Earth Engine Python API using Application Default Credentials (ADC).

Steps:
1) Enable the Earth Engine API on your Google Cloud project (`EE_PROJECT`).
2) Create a service account in the same project and download its JSON key.
3) Grant the service account access to Earth Engine for your project:
   - Sign in to the Earth Engine Code Editor with a user that has EE access.
   - Share project access with the service account (refer to EE docs for service account setup).
4) Set environment variables:
   - `EE_PROJECT=<your GCP project>`
   - `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json`

On demand, the backend calls GEE using ADC and the configured project to create signed XYZ tile templates for the AlphaEarth dataset.

Dataset used: `GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL` (AlphaEarth Foundations Satellite Embedding).
Attribution: include “AlphaEarth via Google Earth Engine” in your map credits.

---

## API Reference

### Health

- GET `/health`
- Response:
```json
{ "status": "ok" }
```

Example:
```bash
curl -s http://localhost:8000/health
```

---

### WebSocket Chat

- WS `/ws/chat`
- Send either a raw string or a JSON object like `{ "message": "hello" }`
- Receives JSON messages, e.g.:
```json
{ "type": "info", "message": "Connected to Policy Proof chat." }
{ "type": "message", "from": "assistant", "message": "..." }
{ "type": "error", "message": "..." }
```

Provider selection and keys are configured via env (see `.env.example`).

Example (using websocat):
```bash
websocat ws://localhost:8000/ws/chat
# then type:
# {"message": "hi"}
```

---

### SRD Analysis (Mock)

- POST `/api/analyze`
- Request body (one of `geometry`, `feature`, or `featureCollection`):
```json
{
  "policy": "Newton Heat Pump Subsidy",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[lng, lat], ...]]
  }
}
```

- Response:
```json
{
  "policy": "Newton Heat Pump Subsidy",
  "impact_score": 2.97,
  "points": [
    { "distance_km": -5.0, "value": 8.4 }
  ],
  "bins": [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]
}
```

Semantics:
- `bins`: distance-to-border bin centers (km). Negative and positive indicate opposite sides of the boundary; 0 is the boundary.
- `points`: synthetic outcome values per bin suitable for plotting a discontinuity chart.
- `impact_score`: scalar summary of the discontinuity magnitude (mock).

Quick test:
```bash
curl -sX POST http://localhost:8000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "policy": "Demo Policy",
    "geometry": {
      "type": "Polygon",
      "coordinates": [
        [[-71.2,42.35],[-71.18,42.35],[-71.18,42.37],[-71.2,42.37],[-71.2,42.35]]
      ]
    }
  }' | jq
```

---

### AlphaEarth Satellite Embedding tiles (server-side GEE)

- GET `/api/ee/alphaearth/tiles`
- Query params:
  - `year` (optional, int): Calendar year. Defaults to last fully-available year (current year - 1).
  - `bands` (optional, CSV): Defaults to `A01,A16,A09` for RGB visualization.
  - `vmin` (optional, float): Defaults to `-0.3`.
  - `vmax` (optional, float): Defaults to `0.3`.
- Response:
```json
{
  "year": 2024,
  "bands": ["A01", "A16", "A09"],
  "vmin": -0.3,
  "vmax": 0.3,
  "template": "https://earthengine.googleapis.com/..."
}
```

The `template` is a signed XYZ URL that Leaflet can use directly. Tokens expire periodically; the frontend requests new templates on load.

Quick test:
```bash
curl -s "http://localhost:8000/api/ee/alphaearth/tiles?year=2024&bands=A01,A16,A09" | jq
```

---

## End-to-End SRD Experiment (Step-by-Step)

1) Backend:
   - `uv sync`
   - Create `.env` with `ALLOWED_ORIGINS`, `EE_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS`
   - Ensure your service account has EE access for `EE_PROJECT`
   - Run the backend dev server (or use your existing workflow)

2) Frontend:
   - In `../frontend`, copy env: `cp .env.local.example .env.local`
   - Set:
     - `NEXT_PUBLIC_API_BASE=http://localhost:8000`
     - `NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/chat`
   - `pnpm install` and `pnpm dev`

3) In the web app:
   - Toggle AlphaEarth overlays in the Layers control to confirm tiles load
   - Draw a polygon/rectangle along a policy border
   - Enter a policy name (optional)
   - Click “Analyze”
   - Read the chart and `impact_score` for the discontinuity

---

## Troubleshooting

- AlphaEarth tiles fail:
  - Ensure backend envs are set: `EE_PROJECT` and `GOOGLE_APPLICATION_CREDENTIALS`
  - Confirm the service account has Earth Engine access for your project
  - Check the backend logs for errors initializing GEE

- CORS errors calling API:
  - Set `ALLOWED_ORIGINS` to include your frontend origin
  - Verify `NEXT_PUBLIC_API_BASE` matches the backend origin

- WebSocket fails:
  - Check `NEXT_PUBLIC_WS_URL` and backend port
  - Verify no proxies are stripping WS upgrade headers

- Analysis errors:
  - Ensure your geometry is valid; try a smaller polygon
  - Review backend logs during the request

---

## Project Structure

```
backend/
  app/
    __init__.py
    main.py                      # FastAPI app (routes, CORS, WS)
    services/
      analyze.py                 # Mock SRD analysis
      ee_alphaearth.py           # EE init and AlphaEarth tile template helper
  pyproject.toml                 # uv project manifest
  README.md                      # this file
  .env.example                   # example environment variables (incl. EE auth)
```

---

## Notes

- CORS is configured via `ALLOWED_ORIGINS`.
- The frontend should use:
  - `NEXT_PUBLIC_API_BASE` for HTTP requests (e.g. `http://localhost:8000`)
  - `NEXT_PUBLIC_WS_URL` for WebSocket (e.g. `ws://localhost:8000/ws/chat`)
- The SRD endpoint is mock by design; replace with your estimator when ready while keeping the same I/O contract for the UI.

## License

MIT
