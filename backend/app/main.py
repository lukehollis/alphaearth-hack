from __future__ import annotations

import json
import os
from typing import Any, List, Optional, Set
from datetime import datetime

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import logging
import anyio
logger = logging.getLogger("policy_proof.ws")

from .services.analyze import run_real_srd_analysis, run_mock_srd_analysis
from .services.llm import stream_text, stream_ollama, stream_sambanova, stream_text_anakin
from .services.ee_alphaearth import alphaearth_tile_template
from .services.ee_climate import climate_temperature_tile_template


class AnalyzeRequest(BaseModel):
    # Accept either a raw GeoJSON geometry or a Feature/FeatureCollection
    geometry: Optional[dict[str, Any]] = None
    feature: Optional[dict[str, Any]] = None
    feature_collection: Optional[dict[str, Any]] = Field(default=None, alias="featureCollection")
    policy: Optional[str] = None
    year: Optional[int] = None  # Year for AlphaEarth analysis, defaults to latest available

    def geojson_geometry(self) -> dict[str, Any]:
        g = None
        if self.geometry:
            g = self.geometry
        elif self.feature and isinstance(self.feature, dict):
            g = self.feature.get("geometry")
        elif self.feature_collection and isinstance(self.feature_collection, dict):
            feats = self.feature_collection.get("features") or []
            if feats and isinstance(feats[0], dict):
                g = feats[0].get("geometry")

        if not g or not isinstance(g, dict):
            raise ValueError(
                "No valid GeoJSON geometry provided. Send { geometry } or { feature } or { featureCollection }."
            )

        # If what we have is a Feature, extract its geometry.
        if str(g.get("type")).lower() == "feature":
            geom = g.get("geometry")
            if geom and isinstance(geom, dict):
                return geom
            else:
                # It's a feature without a valid geometry, so raise error
                raise ValueError("Feature provided without a valid geometry.")

        # Otherwise, assume it's a geometry and return it.
        return g
...

class AnalysisPoint(BaseModel):
    distance_km: float
    value: Optional[float] = None
    count: Optional[int] = None


class AnalyzeResponse(BaseModel):
    policy: Optional[str] = None
    impact_score: float
    points: List[AnalysisPoint]
    bins: List[float]
    title: Optional[str] = None
    x_label: Optional[str] = None
    y_label: Optional[str] = None
    charts: Optional[List[dict[str, Any]]] = None


class AlphaEarthTilesResponse(BaseModel):
    year: int
    bands: List[str]
    vmin: float
    vmax: float
    template: str


def get_allowed_origins() -> list[str]:
    # Comma-separated origins, default to common localhost ports
    raw = os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,http://localhost:5173,http://127.0.0.1:5173",
    )
    return [o.strip() for o in raw.split(",") if o.strip()]


app = FastAPI(title="Policy Proof Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


from fastapi.responses import StreamingResponse

@app.post("/api/analyze")
def analyze(req: AnalyzeRequest) -> StreamingResponse:
    geom = req.geojson_geometry()
    year = req.year if req.year is not None else (datetime.utcnow().year - 2)

    def generate():
        def _broadcast(text: str) -> None:
            try:
                anyio.from_thread.run(ws_manager.broadcast_json, {"type": "message", "from": "analysis", "message": text})
            except Exception:
                # best-effort
                pass
        try:
            gen = run_real_srd_analysis(geom, year)
            print(f"Using real AlphaEarth analysis for year {year}")
            _broadcast(f"Starting SRD analysis for year {year} using real AlphaEarth data.")
        except Exception as e:
            print(f"Earth Engine analysis failed ({e}), falling back to mock data")
            _broadcast(f"Earth Engine analysis failed ({e}); falling back to mock data.")
            result = run_mock_srd_analysis(geom)
            try:
                _broadcast(f"Mock analysis complete. Impact Score: {result.get('impact_score', 0):.3f} ({len(result.get('points', []))} points).")
            except Exception:
                pass
            yield json.dumps(AnalyzeResponse(policy=req.policy, **result).dict()) + "\n"
            return

        points = []
        bins = None
        impact_score = None

        for item in gen:
            if "bins" in item:
                bins = item["bins"]
                try:
                    if isinstance(bins, list) and bins:
                        _broadcast(f"Initialized {len(bins)} bins from {bins[0]:+.2f}km to {bins[-1]:+.2f}km.")
                    else:
                        _broadcast("Initialized analysis bins.")
                except Exception:
                    pass
            elif "point" in item:
                points.append(item["point"])
                try:
                    pt = item["point"]
                    val = pt.get("value")
                    val_str = "N/A" if val is None else f"{val:.2f}"
                    _broadcast(f"Year {year} | Dist {pt.get('distance_km', 0):+.2f}km | Value {val_str}")
                except Exception:
                    pass
                yield json.dumps(item) + "\n"
            elif "impact_score" in item:
                impact_score = item["impact_score"]
                try:
                    _broadcast(f"Impact Score: {float(impact_score):.3f}")
                except Exception:
                    pass

        if bins is not None and impact_score is not None:
            # Default chart metadata
            x_label = "Distance from border (km)"
            y_label = "Activity (normalized, 0–100)"
            title = f"{req.policy} — SRD Activity Profile" if req.policy else "SRD Activity Profile"

            # Build charts (activity and count)
            try:
                activity_series = [
                    {"x": float(p.get("distance_km")), "y": float(p["value"])}
                    for p in points
                    if p.get("value") is not None
                ]
            except Exception:
                activity_series = []
            try:
                count_series = [
                    {"x": float(p.get("distance_km")), "y": int(p.get("count", 0))}
                    for p in points
                ]
            except Exception:
                count_series = []

            charts = [
                {
                    "id": "activity",
                    "title": "Activity vs Distance",
                    "x_label": x_label,
                    "y_label": y_label,
                    "series": [{"name": "Activity mean", "points": activity_series}],
                },
                {
                    "id": "count",
                    "title": "Sample Count vs Distance",
                    "x_label": x_label,
                    "y_label": "Sample count",
                    "series": [{"name": "Count", "points": count_series}],
                },
            ]

            final = AnalyzeResponse(
                policy=req.policy,
                impact_score=impact_score,
                points=points,
                bins=bins,
                title=title,
                x_label=x_label,
                y_label=y_label,
                charts=charts,
            ).dict()
            yield json.dumps(final) + "\n"
            try:
                _broadcast("Analysis complete.")
            except Exception:
                pass

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@app.get("/api/ee/alphaearth/tiles", response_model=AlphaEarthTilesResponse)
def ee_alphaearth_tiles(
    year: Optional[int] = None,
    bands: Optional[str] = Query(
        default=None, description="Comma-separated bands like A01,A16,A09"
    ),
    vmin: Optional[float] = None,
    vmax: Optional[float] = None,
) -> AlphaEarthTilesResponse:
    """
    Returns a Leaflet XYZ tile template URL for the AlphaEarth Satellite Embedding
    dataset for the requested calendar year. Defaults to the last fully-available year.
    """
    y = year if year is not None else (datetime.utcnow().year - 1)
    bands_list = [b.strip() for b in bands.split(",")] if bands else None
    template, used_bands, mn, mx = alphaearth_tile_template(
        y,
        bands=bands_list,
        vmin=vmin if vmin is not None else -0.3,
        vmax=vmax if vmax is not None else 0.3,
    )
    return AlphaEarthTilesResponse(
        year=y, bands=used_bands, vmin=mn, vmax=mx, template=template
    )


class ClimateTilesResponse(BaseModel):
    source: str
    mode: str
    year: Optional[int] = None
    y1: Optional[int] = None
    y2: Optional[int] = None
    vmin: float
    vmax: float
    template: str


@app.get("/api/ee/climate/tiles", response_model=ClimateTilesResponse)
def ee_climate_tiles(
    source: Optional[str] = Query(default="era5land", description="era5land or modis"),
    year: Optional[int] = None,
    y1: Optional[int] = None,
    y2: Optional[int] = None,
    vmin: Optional[float] = None,
    vmax: Optional[float] = None,
) -> ClimateTilesResponse:
    """
    Returns a Leaflet XYZ tile template URL for climate temperature maps.
    Modes:
      - Absolute (year): /api/ee/climate/tiles?source=era5land&year=2023
      - Difference (y2 - y1): /api/ee/climate/tiles?source=era5land&y1=2022&y2=2023
    """
    mode = "diff" if (y1 is not None and y2 is not None) else "abs"
    if mode == "diff":
        template, mn, mx = climate_temperature_tile_template(
            source=source or "era5land",
            y1=y1,
            y2=y2,
            vmin=vmin,
            vmax=vmax,
        )
        return ClimateTilesResponse(
            source=(source or "era5land"),
            mode=mode,
            year=None,
            y1=y1,
            y2=y2,
            vmin=mn,
            vmax=mx,
            template=template,
        )
    else:
        y = year if year is not None else (datetime.utcnow().year - 1)
        template, mn, mx = climate_temperature_tile_template(
            source=source or "era5land",
            year=y,
            vmin=vmin,
            vmax=vmax,
        )
        return ClimateTilesResponse(
            source=(source or "era5land"),
            mode=mode,
            year=y,
            y1=None,
            y2=None,
            vmin=mn,
            vmax=mx,
            template=template,
        )

# Request model for LaTeX generation (superset of AnalyzeResponse) and endpoint
class AnalyzeLatexRequest(BaseModel):
    policy: Optional[str] = None
    impact_score: float
    points: List[AnalysisPoint]
    bins: List[float]
    selectedYear: Optional[int] = None
    dataType: Optional[str] = None
    title: Optional[str] = None
    x_label: Optional[str] = None
    y_label: Optional[str] = None
    charts: Optional[List[dict[str, Any]]] = None

@app.post("/api/analyze/latex")
async def analyze_latex(req: AnalyzeLatexRequest) -> dict[str, str]:
    """
    Generate a concise LaTeX snippet summarizing an SRD analysis.
    Performs a separate LLM call independent from the main analysis stream.
    """
    # Provider selection via env (mirror chat provider logic)
    provider = os.getenv("LLM_PROVIDER", "openrouter").lower()
    use_ollama = provider == "ollama" or os.getenv("USE_OLLAMA", "").lower() in ("1", "true", "yes")
    use_anakin = provider == "anakin" or os.getenv("USE_ANAKIN", "").lower() in ("1", "true", "yes")
    use_sambanova = provider == "sambanova"

    policy = req.policy or "Unnamed policy"
    year = req.selectedYear or (datetime.utcnow().year - 2)
    impact = float(req.impact_score)

    # Keep prompt compact; summarize essentials
    summary = {
        "policy": policy,
        "year": int(year),
        "impact_score": impact,
        "n_points": len(req.points or []),
        "x_label": (req.x_label or "Distance from border (km)"),
        "y_label": (req.y_label or "Outcome"),
    }
    summary_json = json.dumps(summary, separators=(",", ":"))

    instruction = (
        "Return LaTeX only (no markdown), suitable for direct paste into a paper. "
        "Include: "
        "1) A brief paragraph summarizing the SRD estimate in one or two sentences; "
        "2) The equation defining the discontinuity: "
        "\\tau = \\lim_{d\\to 0^+}\\mathbb{E}[Y\\mid d] - \\lim_{d\\to 0^-}\\mathbb{E}[Y\\mid d]; "
        "3) A compact figure-style caption referencing the selected year and policy. "
        "Do not include \\documentclass or preamble."
    )

    prompt = f"""{instruction}

Context (JSON): {summary_json}

Use the numeric impact value tau = {impact:.3f}. Write plain LaTeX only.
"""

    reply_text = ""
    try:
        if use_ollama:
            agen = stream_ollama(prompt=prompt, model=os.getenv("OLLAMA_MODEL", "llama3"), messages=None)
        elif use_sambanova:
            agen = stream_sambanova(prompt=prompt, messages=None)
        elif use_anakin:
            agen = stream_text_anakin(prompt=prompt, messages=None, app_id=os.getenv("ANAKIN_APP_ID"))
        else:
            agen = stream_text(prompt=prompt, messages=None, include_reasoning=False)

        async for chunk in agen:
            try:
                if getattr(chunk, "choices", None):
                    delta_obj = getattr(chunk.choices[0], "delta", None)
                    if delta_obj is not None:
                        delta = getattr(delta_obj, "content", None)
                        if delta:
                            reply_text += delta
            except Exception:
                # ignore malformed chunk pieces
                pass
    except Exception as e:
        return {"latex": f"% error generating LaTeX: {e}"}

    latex = reply_text.strip() or "% no content"
    return {"latex": latex}

# WebSocket connection manager for broadcasting analysis updates to all connected chat clients
class ConnectionManager:
    def __init__(self) -> None:
        self.active: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        self.active.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        try:
            self.active.discard(ws)
        except Exception:
            pass

    async def broadcast_json(self, obj: Any) -> None:
        dead: list[WebSocket] = []
        data = json.dumps(obj)
        for client in list(self.active):
            try:
                await client.send_text(data)
            except Exception:
                dead.append(client)
        for d in dead:
            self.disconnect(d)

ws_manager = ConnectionManager()

@app.websocket("/ws/chat")
async def chat_ws(ws: WebSocket):
    logger.info("WS: handshake start")
    print("WS: handshake start")
    # Accept WebSocket
    await ws.accept()
    # Register connection for broadcast
    try:
        await ws_manager.connect(ws)
    except Exception:
        pass
    logger.info("WS: accepted connection")
    print("WS: accepted connection")
    system_prompt = (
        "You are Policy Proof assistant. Help users evaluate climate policy impact using "
        "Spatial Regression Discontinuity (SRD). Keep responses concise and actionable."
    )
    # Conversation memory in OpenAI-style messages
    history: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    # Latest analysis context provided by this client (compact JSON)
    current_context: Optional[dict[str, Any]] = None

    async def send_json(obj: Any) -> None:
        try:
            await ws.send_text(json.dumps(obj))
        except Exception:
            # best-effort
            pass

    await send_json({"type": "info", "message": "Connected to Policy Proof chat."})

    # Provider selection via env
    provider = os.getenv("LLM_PROVIDER", "openrouter").lower()
    use_ollama = provider == "ollama" or os.getenv("USE_OLLAMA", "").lower() in ("1", "true", "yes")
    use_anakin = provider == "anakin" or os.getenv("USE_ANAKIN", "").lower() in ("1", "true", "yes")
    use_sambanova = provider == "sambanova"

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
                # Handle keepalive ping/heartbeat frames from client
                if isinstance(data, dict):
                    t = str(data.get("type", "")).lower()
                    if t in ("ping", "keepalive", "heartbeat"):
                        # ignore keepalive frames
                        continue

                    # If this is a context update frame, stash compact analysis context and ack
                    if t in ("context", "analysis_context"):
                        ctx = data.get("analysis") or data.get("context") or {}
                        # Best-effort compaction of large arrays
                        def _truncate_points(arr, max_points=200):
                            if not isinstance(arr, list):
                                return arr
                            n = len(arr)
                            if n <= max_points:
                                return arr
                            step = max(1, n // max_points)
                            return arr[::step]

                        try:
                            if isinstance(ctx, dict):
                                charts = ctx.get("charts")
                                if isinstance(charts, list):
                                    for ch in charts:
                                        try:
                                            series = ch.get("series")
                                            if isinstance(series, list):
                                                for s in series:
                                                    pts = s.get("points")
                                                    if pts is not None:
                                                        s["points"] = _truncate_points(pts)
                                        except Exception:
                                            pass
                        except Exception:
                            pass

                        current_context = ctx if isinstance(ctx, dict) else {"raw": str(ctx)}
                        await send_json({"type": "info", "message": "Analysis context received."})
                        continue

                    # Accept alternate keys for message payloads
                    msg = data.get("message") or data.get("text") or data.get("content")
                else:
                    # String or other JSON types
                    if isinstance(data, str) and data.lower() in ("ping", "keepalive", "heartbeat"):
                        # ignore keepalive frames
                        continue
                    msg = data
            except Exception:
                # Not JSON; treat raw as message or ping/heartbeat string
                if isinstance(raw, str) and raw.lower() in ("ping", "keepalive", "heartbeat"):
                    # ignore keepalive frames
                    continue
                msg = raw

            # Silently ignore non-text or empty payloads instead of error-spamming
            if not isinstance(msg, str) or not msg.strip():
                try:
                    logger.debug("WS: ignoring non-text or empty payload")
                except Exception:
                    pass
                continue

            # Append user message
            history.append({"role": "user", "content": msg})
            try:
                logger.info("WS: received user message (%d chars)", len(msg))
            except Exception:
                pass

            # If the payload also included an analysis object, update our current_context
            try:
                if isinstance(data, dict) and isinstance(data.get("analysis"), dict):
                    current_context = data.get("analysis")
            except Exception:
                pass

            # Route to selected LLM stream and aggregate into a single assistant message
            reply_text = ""

            # Build messages for this turn, injecting the latest analysis context as a transient system message
            messages_for_call = list(history)
            if current_context:
                try:
                    ctx_json = json.dumps(current_context, separators=(",", ":"), ensure_ascii=False)
                    messages_for_call.append({"role": "system", "content": f"Current analysis context (JSON): {ctx_json}"})
                except Exception:
                    pass

            try:
                if use_ollama:
                    agen = stream_ollama(prompt="", messages=messages_for_call)
                elif use_sambanova:
                    agen = stream_sambanova(prompt="", messages=messages_for_call)
                elif use_anakin:
                    agen = stream_text_anakin(prompt="", messages=messages_for_call, app_id=os.getenv("ANAKIN_APP_ID"))
                else:
                    agen = stream_text(prompt="", messages=messages_for_call, include_reasoning=False)

                async for chunk in agen:
                    try:
                        # OpenAI-style streaming delta
                        if getattr(chunk, "choices", None):
                            delta_obj = getattr(chunk.choices[0], "delta", None)
                            if delta_obj is not None:
                                delta = getattr(delta_obj, "content", None)
                                if delta:
                                    reply_text += delta
                    except Exception:
                        # ignore malformed chunk
                        pass
            except Exception as e:
                # If we received partial content before the error, send it as a best-effort reply
                partial = reply_text.strip()
                if partial:
                    history.append({"role": "assistant", "content": partial})
                    try:
                        logger.info("WS: sending partial assistant reply (%d chars) after error", len(partial))
                    except Exception:
                        pass
                    await send_json({"type": "message", "from": "assistant", "message": partial})
                await send_json({"type": "error", "message": f"LLM error: {e}"})
                continue

            reply_text = reply_text.strip()
            if not reply_text:
                await send_json({"type": "error", "message": "No response generated from the model."})
                continue

            # Append assistant message to history and send to client
            history.append({"role": "assistant", "content": reply_text})
            try:
                logger.info("WS: sending assistant reply (%d chars)", len(reply_text))
            except Exception:
                pass
            await send_json({"type": "message", "from": "assistant", "message": reply_text})

    except WebSocketDisconnect:
        logger.info("WS: client disconnected")
        print("WS: client disconnected")
        try:
            ws_manager.disconnect(ws)
        except Exception:
            pass
        return
    except Exception as e:
        logger.exception("WS: server error")
        print(f"WS: server error: {e}")
        await send_json({"type": "error", "message": f"Server error: {e}"})
        try:
            ws_manager.disconnect(ws)
        except Exception:
            pass


# Simple echo WebSocket for connectivity testing
@app.websocket("/ws/echo")
async def echo_ws(ws: WebSocket):
    print("WS-ECHO: handshake start")
    await ws.accept()
    print("WS-ECHO: accepted connection")
    try:
        while True:
            try:
                msg = await ws.receive_text()
            except Exception:
                # If it's not text, just continue
                await ws.send_text("non-text frame received")
                continue
            if msg == "__close__":
                await ws.close()
                break
            await ws.send_text(f"echo:{msg}")
    except WebSocketDisconnect:
        print("WS-ECHO: client disconnected")
        return
    except Exception as e:
        print(f"WS-ECHO: server error: {e}")

# Entrypoint hint for uvicorn: app is defined above
