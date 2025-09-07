# Policy Proof Backend (FastAPI)

FastAPI backend providing:
- WebSocket chat at `/ws/chat`
- Mock Spatial Regression Discontinuity (SRD) analysis at `POST /api/analyze`
- Health check at `/health`

This service is designed to work with the Next.js frontend in `../frontend`.

## Requirements

- Python 3.10+
- uv (preferred Python package manager)
  - Install: `pipx install uv` or `pip install uv`

## Setup

1) Create and activate a virtual environment (uv manages this automatically).
2) Install dependencies:

```bash
uv sync
```

3) Configure environment (optional):

Create a `.env` file in this directory (or set env vars in your shell):

```env
# Comma-separated list of allowed HTTP origins for CORS
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

If not set, the app defaults to allowing common dev ports (3000/5173).

## Run (dev)

Do not run the dev server if your workflow already runs it elsewhere; these commands are for reference:

```bash
uv run uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

- HTTP base: `http://localhost:8000`
- WebSocket endpoint: `ws://localhost:8000/ws/chat`

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

The current MVP uses simple rule-based responses for guidance and can be swapped for an LLM later.

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
    { "distance_km": -5.0, "value": 8.4 },
    ...
  ],
  "bins": [-5, -4, -3, ..., 5]
}
```

The mock simulates a discontinuity (jump) at distance 0 to represent a policy effect.

## Project Structure

```
backend/
  app/
    __init__.py
    main.py               # FastAPI app (routes, CORS, WS)
    services/
      analyze.py          # Mock SRD analysis
  pyproject.toml          # uv project manifest
  README.md               # this file
  .env.example            # example environment variables
```

## Notes

- CORS is configured via `ALLOWED_ORIGINS`.
- The frontend should use:
  - `NEXT_PUBLIC_API_BASE` for HTTP requests (e.g. `http://localhost:8000`)
  - `NEXT_PUBLIC_WS_URL` for WebSocket (e.g. `ws://localhost:8000/ws/chat`)
