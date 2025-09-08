![alpha_1](https://github.com/user-attachments/assets/0e63ac20-cf44-4e21-b993-3b581df6b053)


# SRD + AlphaEarth

[![Live Demo](https://img.shields.io/badge/Live%20Demo-alphaearth.vercel.app-brightgreen)](https://alphaearth.vercel.app/) [![FastAPI](https://img.shields.io/badge/FastAPI-005571?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/) [![Next.js](https://img.shields.io/badge/Next.js-000000?logo=next.js&logoColor=white)](https://nextjs.org/) [![Vercel](https://img.shields.io/badge/Vercel-000000?logo=vercel&logoColor=white)](https://vercel.com/) [![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](#requirements)  
[![uv](https://img.shields.io/badge/uv-Recommended-000000?logo=python&logoColor=white)](https://docs.astral.sh/uv/) [![pnpm](https://img.shields.io/badge/pnpm-Recommended-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/) [![Earth Engine](https://img.shields.io/badge/Google%20Earth%20Engine-4285F4?logo=google&logoColor=white)](https://developers.google.com/earth-engine) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#license)

FastAPI backend `./backend` powering Spatial Regression Discontinuity (SRD) quasi-experiments and AlphaEarth Satellite Embedding visualization for the companion Next.js frontend in `./frontend`.

What this service provides:
- Health check at `GET /health`
- Streaming SRD analysis (NDJSON) at `POST /api/analyze` (uses real AlphaEarth data via Earth Engine when available; falls back to mock)
- AlphaEarth Satellite Embedding tiles template via server-side Google Earth Engine at `GET /api/ee/alphaearth/tiles`
- WebSocket chat at `WS /ws/chat`

This backend is designed to run locally in development and to work seamlessly with the frontend to let users draw a boundary near a policy border, run an SRD-style analysis, and visualize both the AlphaEarth embeddings and the discontinuity chart.

Note on SRD in this project: `/api/analyze` streams a simple SRD-style analysis. When Earth Engine credentials are configured, it computes distance-banded means of selected AlphaEarth bands and a near-border difference as an `impact_score`. If Earth Engine is unavailable, it falls back to a deterministic mock generator. This is a teaching/demo pipeline and does not implement local polynomial regression, bandwidth selection, spatial clustering/standard errors, or identification checks; treat the output as non-causal visualization only. A production SRD would estimate treatment effects under continuity assumptions with appropriate bandwidth choice, covariate balance checks, and statistical inference.

---

![alpha_3](https://github.com/user-attachments/assets/abd1ce7d-a8f4-4555-b09e-2f92a55d8294)


## SRD + AlphaEarth: How it works

- Draw a boundary along a candidate policy border (e.g., a municipal boundary).
- The frontend sends the boundary geometry to this backend: `POST /api/analyze`.
- Backend returns:
  - `points`: distance-banded mean activity values (real via EE when configured) or a synthetic fallback; expect a jump at zero (the border)
  - `bins`: reference positions for bins (e.g., starts/centers) used primarily for axis ticks; negative on one side of the border, positive on the other
  - `impact_score`: a scalar summarizing the estimated discontinuity magnitude
- In parallel, the map uses AlphaEarth Satellite Embedding tiles for visual context:
  - The frontend requests a signed XYZ template from `GET /api/ee/alphaearth/tiles`.
  - The backend signs and returns a Google Earth Engine (GEE) URL template for an AlphaEarth year/band combo (defaults suitable for RGB).
  - The `/api/analyze` stream may also emit a `{"tiles": {...}}` event early with a signed template derived from the request for convenience.

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

### SRD Analysis (Streaming NDJSON)

- POST `/api/analyze` (application/x-ndjson stream)
- Request body (one of `geometry`, `feature`, or `featureCollection`):
Optional: `year` (int) to select the AlphaEarth year. Defaults to current year - 2.
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
- `bins`: reference positions for bins (e.g., starts/centers) used primarily for axis ticks (km). Negative and positive indicate opposite sides of the boundary; 0 is the boundary.
- `points`: distance-banded activity values (real via Earth Engine) or synthetic fallback; includes an estimated sample `count` per band.
- `impact_score`: scalar summary of the near-border discontinuity magnitude.

Quick test (stream the NDJSON):
```bash
curl -N -sX POST http://localhost:8000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "policy": "Demo Policy",
    "geometry": {
      "type": "Polygon",
      "coordinates": [
        [[-71.2,42.35],[-71.18,42.35],[-71.18,42.37],[-71.2,42.37],[-71.2,42.35]]
      ]
    }
  }'
```

Extract only the final JSON object from the stream:
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
  }' | jq -s '.[-1]'
```

---

### AlphaEarth Satellite Embedding tiles (server-side GEE)

- GET `/api/ee/alphaearth/tiles`
- Query params:
  - `year` (optional, int): Calendar year. Defaults to last fully-available year (current year - 1).
  - `bands` (optional, CSV): Defaults to `A01,A16,A09` for RGB visualization.
  - `vmin` (optional, float): Defaults to `-0.3`.
  - `vmax` (optional, float): Defaults to `0.3`.
  - `tweak` (optional, string): Deterministic token to perturb bands and vmin/vmax so per-analysis maps look distinct.
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
      analyze.py                 # SRD analysis (real via EE + mock fallback)
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
- The SRD endpoint implements a simplified real analysis via EE when configured and falls back to a mock generator; it is for demonstration/teaching and not a causal estimator. Replace with a production estimator as needed while keeping the same I/O contract for the UI.

## License

MIT
