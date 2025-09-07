from __future__ import annotations

import json
import os
from typing import Any, List, Optional
from datetime import datetime

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import logging
logger = logging.getLogger("policy_proof.ws")

from .services.analyze import run_real_srd_analysis, run_mock_srd_analysis
from .services.llm import stream_text, stream_ollama, stream_sambanova, stream_text_anakin
from .services.ee_alphaearth import alphaearth_tile_template


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


class AnalysisPoint(BaseModel):
    distance_km: float
    value: float


class AnalyzeResponse(BaseModel):
    policy: Optional[str] = None
    impact_score: float
    points: List[AnalysisPoint]
    bins: List[float]


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


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    geom = req.geojson_geometry()

    # Try to use real AlphaEarth analysis with EE
    try:
        year = req.year if req.year is not None else (datetime.utcnow().year - 1)
        result = run_real_srd_analysis(geom, year)
        print(f"Using real AlphaEarth analysis for year {year}")
    except Exception as e:
        print(f"Earth Engine analysis failed ({e}), falling back to mock data")
        result = run_mock_srd_analysis(geom)

    return AnalyzeResponse(policy=req.policy, **result)


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


@app.websocket("/ws/chat")
async def chat_ws(ws: WebSocket):
    logger.info("WS: handshake start")
    print("WS: handshake start")
    # Accept WebSocket
    await ws.accept()
    logger.info("WS: accepted connection")
    print("WS: accepted connection")
    system_prompt = (
        "You are Policy Proof assistant. Help users evaluate climate policy impact using "
        "Spatial Regression Discontinuity (SRD). Keep responses concise and actionable."
    )
    # Conversation memory in OpenAI-style messages
    history: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]

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
                    if str(data.get("type", "")).lower() in ("ping", "keepalive", "heartbeat"):
                        # ignore keepalive frames
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

            # Route to selected LLM stream and aggregate into a single assistant message
            reply_text = ""

            try:
                if use_ollama:
                    agen = stream_ollama(prompt="", messages=history)
                elif use_sambanova:
                    agen = stream_sambanova(prompt="", messages=history)
                elif use_anakin:
                    agen = stream_text_anakin(prompt="", messages=history, app_id=os.getenv("ANAKIN_APP_ID"))
                else:
                    agen = stream_text(prompt="", messages=history, include_reasoning=False)

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
        return
    except Exception as e:
        logger.exception("WS: server error")
        print(f"WS: server error: {e}")
        await send_json({"type": "error", "message": f"Server error: {e}"})


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
