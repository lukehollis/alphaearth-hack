# Policy Proof Backend (FastAPI)

FastAPI backend providing:
- WebSocket chat at `/ws/chat`
- Mock Spatial Regression Discontinuity (SRD) analysis at `POST /api/analyze`
- AlphaEarth Satellite Embedding tiles template at `GET /api/ee/alphaearth/tiles`
- Health check at `/health`

This service is designed to work with the Next.js frontend in `../frontend`.

## Requirements

- Python 3.10+
- uv (preferred Python package manager)
  - Install: `pipx install uv` or `pip install uv`
- For Earth Engine features:
  - A Google Cloud project linked to Earth Engine (EE API enabled)
  - A service account with access to Earth Engine for that project
  - A local credentials JSON for that service account

## Setup

1) Install dependencies:

```bash
uv sync
```

2) Configure environment:

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

## Run (dev)

Do not run the dev server if your workflow already runs it elsewhere; these commands are for reference:

```bash
uv run uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

- HTTP base: `http://localhost:8000`
- WebSocket endpoint: `ws://localhost:8000/ws/chat`

## Earth Engine setup (server-side)

This backend initializes the Earth Engine Python API using Application Default Credentials (ADC).

Steps:
1) Enable the Earth Engine API on your Google Cloud project (`EE_PROJECT`).
2) Create a service account in the same project and download its JSON key.
3) Grant the service account access to Earth Engine for your project:
   - Sign in to the Earth Engine Code Editor with a user that has EE access.
   - Share project access with the service account (refer to EE docs for service account setup).
4) Set:
   - `EE_PROJECT=<your GCP project>`
   - `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json`

On startup, the first Earth Engine call will use ADC and the configured project to create signed tile templates.

## API

### Health

- GET `/health`
- Response: `{ "status": "ok" }`

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

Dataset: `GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL` (AlphaEarth Foundations Satellite Embedding).

Attribution: include “AlphaEarth via Google Earth Engine” in your map credits.

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

## Notes

- CORS is configured via `ALLOWED_ORIGINS`.
- The frontend should use:
  - `NEXT_PUBLIC_API_BASE` for HTTP requests (e.g. `http://localhost:8000`)
  - `NEXT_PUBLIC_WS_URL` for WebSocket (e.g. `ws://localhost:8000/ws/chat`)
