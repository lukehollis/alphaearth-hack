from __future__ import annotations

import json
import os
from typing import Any, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .services.analyze import run_mock_srd_analysis


class AnalyzeRequest(BaseModel):
    # Accept either a raw GeoJSON geometry or a Feature/FeatureCollection
    geometry: Optional[dict[str, Any]] = None
    feature: Optional[dict[str, Any]] = None
    feature_collection: Optional[dict[str, Any]] = Field(default=None, alias="featureCollection")
    policy: Optional[str] = None

    def geojson_geometry(self) -> dict[str, Any]:
        if self.geometry:
            return self.geometry
        if self.feature and isinstance(self.feature, dict):
            geom = self.feature.get("geometry")
            if geom:
                return geom
        if self.feature_collection and isinstance(self.feature_collection, dict):
            feats = self.feature_collection.get("features") or []
            if feats and isinstance(feats[0], dict):
                geom = feats[0].get("geometry")
                if geom:
                    return geom
        raise ValueError("No valid GeoJSON geometry provided. Send { geometry } or { feature } or { featureCollection }.")


class AnalysisPoint(BaseModel):
    distance_km: float
    value: float


class AnalyzeResponse(BaseModel):
    policy: Optional[str] = None
    impact_score: float
    points: List[AnalysisPoint]
    bins: List[float]


def get_allowed_origins() -> list[str]:
    # Comma-separated origins, default to common localhost ports
    raw = os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173",
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
    result = run_mock_srd_analysis(geom)
    return AnalyzeResponse(policy=req.policy, **result)


@app.websocket("/ws/chat")
async def chat_ws(ws: WebSocket):
    # Accept WebSocket with optional origin check (already covered by CORS for HTTP)
    await ws.accept()
    system_prompt = (
        "You are Policy Proof assistant. Help users evaluate climate policy impact using "
        "Spatial Regression Discontinuity (SRD). Keep responses concise and actionable."
    )
    history: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]

    async def send_json(obj: Any) -> None:
        try:
            await ws.send_text(json.dumps(obj))
        except Exception:
            # best-effort
            pass

    await send_json({"type": "info", "message": "Connected to Policy Proof chat."})
    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
                msg = data.get("message")
            except Exception:
                msg = raw

            if not isinstance(msg, str):
                await send_json({"type": "error", "message": "Invalid message payload."})
                continue

            # Append to history
            history.append({"role": "user", "content": msg})

            # Very lightweight rule-based response for MVP
            reply = None
            low = msg.lower()
            if "boundary" in low or "polygon" in low:
                reply = "Draw a boundary on the map and click Analyze to run the SRD mock analysis."
            elif "analyz" in low or "impact" in low:
                reply = "Use the Analyze button after selecting a boundary. The chart will show any discontinuity at the border."
            elif "earth engine" in low or "gee" in low:
                reply = "The map displays Google Earth Engine tiles. You can compare embeddings and similarity layers."
            else:
                reply = "I can help you evaluate policy impact near borders using SRD. What policy or area are you interested in?"

            history.append({"role": "assistant", "content": reply})
            await send_json({"type": "message", "from": "assistant", "message": reply})
    except WebSocketDisconnect:
        # Client disconnected
        return
    except Exception as e:
        await send_json({"type": "error", "message": f"Server error: {e}"})


# Entrypoint hint for uvicorn: app is defined above
