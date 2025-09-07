/* global ee, gapi */

"use client";

import { useEffect, useRef, useState } from "react";

// Utility to load external scripts sequentially
function loadScript(src) {
  return new Promise((resolve, reject) => {
    // Avoid inserting the same script multiple times
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = (e) => reject(new Error(`Failed to load script ${src}`));
    document.head.appendChild(s);
  });
}

function waitForGlobal(name, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      if (typeof window !== "undefined" && window[name]) {
        resolve(window[name]);
        return;
      }
      if (Date.now() - start > timeout) {
        reject(new Error(`Global ${name} did not load in time`));
        return;
      }
      setTimeout(check, 100);
    })();
  });
}

/**
 * Helper: load a global by trying a list of script sources in order, with per-attempt timeout.
 * Tries each candidate src sequentially until the given global appears, or throws with the last error.
 */
async function ensureGlobal(name, candidates, perAttemptMs = 7000) {
  if (typeof window !== "undefined" && window[name]) return window[name];

  let lastErr = null;
  for (const src of candidates) {
    try {
      await loadScript(src);
      const val = await waitForGlobal(name, perAttemptMs);
      return val;
    } catch (e) {
      lastErr = e;
      // try next candidate
    }
  }
  throw new Error(
    `Failed to load ${name} from candidates: ${candidates.join(", ")}. Last error: ${
      lastErr?.message || String(lastErr)
    }`
  );
}

// Wrap ee.Image.getMap() in a Promise for async/await ergonomics
function getEeMapInfo(image, visParams) {
  return new Promise((resolve, reject) => {
    // image.getMap(visParams, onSuccess, onError)
    image.getMap(
      visParams,
      (mapInfo) => resolve(mapInfo),
      (err) => reject(err)
    );
  });
}

export default function EEMap() {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const [error, setError] = useState("");
  const [selectedGeom, setSelectedGeom] = useState(null);
  const [policy, setPolicy] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const wsRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const connectingRef = useRef(false);
  const firstConnectTimerRef = useRef(null);

  // Backend endpoints
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws/chat";

  useEffect(() => {
    let map;
    let baseLayer;

    async function init() {
      try {
        // Guard against double-init in React StrictMode (dev) which mounts twice
        if (mapRef.current) return;
        // Dynamically import Leaflet on client
        const L = (await import("leaflet")).default;
        // Expose to window so plugins (leaflet-draw) can attach
        if (typeof window !== "undefined") {
          window.L = L;
        }
        // Load Leaflet.Draw plugin via package (requires window.L set)
        await import("leaflet-draw");

        // Initialize Leaflet map
        if (!mapElRef.current) return;

        // In dev with Fast Refresh/StrictMode, the DOM node can retain a previous Leaflet map.
        // If so, clear the container before creating a new map to avoid:
        // "Map container is already initialized."
        if (mapElRef.current._leaflet_id) {
          try {
            if (mapRef.current && typeof mapRef.current.remove === "function") {
              mapRef.current.remove();
            }
          } catch {
            // ignore
          }
          // Hard reset the container
          mapElRef.current._leaflet_id = null;
          mapElRef.current.innerHTML = "";
        }

        map = L.map(mapElRef.current, {
          preferCanvas: true,
          zoomControl: true,
        });
        mapRef.current = map;

        // Basemap: Esri World Imagery
        baseLayer = L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          {
            attribution:
              'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
            maxZoom: 19,
          }
        ).addTo(map);

        // Center over point of interest
        const poiLatLng = [39.0372, -121.8036]; // [lat, lng]
        map.setView(poiLatLng, 12);

        // Drawing controls (Polygon/Rectangle only)
        const drawnItems = new L.FeatureGroup();
        drawnItems.addTo(map);

        const drawControl = new L.Control.Draw({
          draw: {
            polygon: true,
            rectangle: true,
            polyline: false,
            circle: false,
            marker: false,
            circlemarker: false,
          },
          edit: {
            featureGroup: drawnItems,
            edit: true,
            remove: true,
          },
        });
        map.addControl(drawControl);

        map.on(L.Draw.Event.CREATED, (e) => {
          try {
            drawnItems.clearLayers();
            drawnItems.addLayer(e.layer);
            const gj = e.layer.toGeoJSON();
            const geom = gj && gj.geometry ? gj.geometry : null;
            if (geom) setSelectedGeom(geom);
          } catch {}
        });

        map.on(L.Draw.Event.EDITED, () => {
          try {
            const layers = drawnItems.getLayers();
            if (layers.length > 0) {
              const gj = layers[0].toGeoJSON();
              const geom = gj && gj.geometry ? gj.geometry : null;
              if (geom) setSelectedGeom(geom);
            }
          } catch {}
        });

        map.on(L.Draw.Event.DELETED, () => {
          setSelectedGeom(null);
        });

        // Ensure gapi and ee are loaded; try local proxies first, then fall back to upstreams.
        await ensureGlobal("gapi", ["/api/proxy-gapi", "https://apis.google.com/js/api.js"], 15000);
        await ensureGlobal("ee", ["/api/proxy-ee", "https://www.gstatic.com/earthengine/ee_api_js.js"], 15000);

        // Authenticate & initialize Earth Engine
        const clientId = process.env.NEXT_PUBLIC_EE_CLIENT_ID;
        if (!clientId) {
          throw new Error(
            "Missing NEXT_PUBLIC_EE_CLIENT_ID. Create .env.local and set your Web OAuth Client ID."
          );
        }

        await new Promise((resolve, reject) => {
          // Implicit OAuth flow in-popup
          // If you want to force re-auth each time during dev, pass true as 5th arg.
          ee.data.authenticateViaOauth(
            clientId,
            () => {
              ee.initialize(null, null, resolve, reject);
            },
            (e) => reject(e),
            null,
            // opt_force_reauth
            false
          );
        });

        // Replicate the user's EE script logic
        const dataset = ee.ImageCollection(
          "GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL"
        );

        const point = ee.Geometry.Point([-121.8036, 39.0372]);

        const image1 = dataset
          .filterDate("2023-01-01", "2024-01-01")
          .filterBounds(point)
          .first();

        const image2 = dataset
          .filterDate("2024-01-01", "2025-01-01")
          .filterBounds(point)
          .first();

        // Visualize three axes of the embedding space as an RGB
        const rgbVis = { min: -0.3, max: 0.3, bands: ["A01", "A16", "A09"] };

        // Compute dot product similarity
        const dotProd = image1.multiply(image2).reduce(ee.Reducer.sum());

        // Create EE tile layers for Leaflet
        const m1 = await getEeMapInfo(image1, rgbVis);
        const m2 = await getEeMapInfo(image2, rgbVis);
        const mDot = await getEeMapInfo(dotProd, {
          min: 0,
          max: 1,
          palette: ["white", "black"],
        });

        const url1 = `https://earthengine.googleapis.com/map/${m1.mapid}/{z}/{x}/{y}?token=${m1.token}`;
        const url2 = `https://earthengine.googleapis.com/map/${m2.mapid}/{z}/{x}/{y}?token=${m2.token}`;
        const urlDot = `https://earthengine.googleapis.com/map/${mDot.mapid}/{z}/{x}/{y}?token=${mDot.token}`;

        const layer2023 = L.tileLayer(url1, {
          attribution: "Google Earth Engine",
          opacity: 0.8,
        });

        const layer2024 = L.tileLayer(url2, {
          attribution: "Google Earth Engine",
          opacity: 0.8,
        });

        const layerSimilarity = L.tileLayer(urlDot, {
          attribution: "Google Earth Engine",
          opacity: 0.6,
        });

        // Add layers to map
        layer2023.addTo(map);
        layer2024.addTo(map);
        layerSimilarity.addTo(map);

        // Layer controls
        L.control
          .layers(
            {
              "Esri World Imagery": baseLayer,
            },
            {
              "2023 embeddings": layer2023,
              "2024 embeddings": layer2024,
              "Similarity between years (brighter = less similar)": layerSimilarity,
            },
            { collapsed: false }
          )
          .addTo(map);
      } catch (e) {
        console.error(e);
        setError(e?.message || String(e));
      }
    }

    init();

    return () => {
      try {
        if (mapRef.current) {
          mapRef.current.remove();
          mapRef.current = null;
        }
      } catch {
        // ignore
      }
    };
  }, []);

  // WebSocket chat connection with retry/backoff
  useEffect(() => {
    let cancelled = false;

    function scheduleReconnect() {
      if (cancelled) return;
      const attempt = (reconnectAttemptsRef.current || 0) + 1;
      reconnectAttemptsRef.current = attempt;
      // Exponential backoff: 0.5s, 1s, 2s, 4s, ... capped at 10s
      const delay = Math.min(10000, 500 * Math.pow(2, attempt - 1));
      try {
        clearTimeout(reconnectTimerRef.current);
      } catch {}
      reconnectTimerRef.current = setTimeout(() => {
        if (!cancelled) openSocket();
      }, delay);
    }

    function openSocket() {
      try {
        // Avoid duplicate connects during StrictMode re-mounts
        if (
          wsRef.current &&
          (wsRef.current.readyState === WebSocket.OPEN ||
            wsRef.current.readyState === WebSocket.CONNECTING)
        ) {
          return;
        }
        if (connectingRef.current) return;

        // Upgrade to wss if page is https and env provides ws://
        const pageIsHttps =
          typeof window !== "undefined" && window.location.protocol === "https:";
        // Build candidate URLs by cycling hostnames to handle localhost/127.0.0.1 mismatches
        // and normalizing scheme to wss when the page is https.
        let url = wsUrl;
        try {
          const u = new URL(wsUrl);
          const pageHost =
            (typeof window !== "undefined" && window.location.hostname) || u.hostname;
          const candidates = Array.from(
            new Set([pageHost, "localhost", "127.0.0.1"])
          );
          const idx = reconnectAttemptsRef.current % candidates.length;
          u.hostname = candidates[idx];
          url = u.toString();
        } catch {
          // ignore, keep wsUrl
        }
        if (pageIsHttps && url.startsWith("ws://")) {
          url = "wss://" + url.slice(5);
        }

        const ws = new WebSocket(url);
        connectingRef.current = true;
        wsRef.current = ws;

        ws.onopen = () => {
          connectingRef.current = false;
          reconnectAttemptsRef.current = 0;
          try {
            clearInterval(pingIntervalRef.current);
          } catch {}
          pingIntervalRef.current = setInterval(() => {
            try {
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: "ping" }));
              }
            } catch {
              // ignore
            }
          }, 25000); // keepalive every 25s
          setChatMessages((m) => [
            ...m,
            { from: "system", text: "Connected to chat." },
          ]);
        };
        ws.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data);
            if (data?.type === "message") {
              setChatMessages((m) => [
                ...m,
                { from: data.from || "assistant", text: data.message },
              ]);
            } else if (data?.type === "info") {
              setChatMessages((m) => [
                ...m,
                { from: "system", text: data.message },
              ]);
            } else if (data?.type === "error") {
              setChatMessages((m) => [
                ...m,
                { from: "system", text: `Error: ${data.message}` },
              ]);
            } else {
              setChatMessages((m) => [
                ...m,
                { from: "system", text: ev.data },
              ]);
            }
          } catch {
            setChatMessages((m) => [
              ...m,
              { from: "assistant", text: ev.data },
            ]);
          }
        };
        ws.onerror = () => {
          connectingRef.current = false;
          setChatMessages((m) => [
            ...m,
            { from: "system", text: "WebSocket error" },
          ]);
          // Proactively schedule a reconnect on error as some environments fire error without close
          scheduleReconnect();
        };
        ws.onclose = () => {
          connectingRef.current = false;
          try {
            clearInterval(pingIntervalRef.current);
          } catch {}
          setChatMessages((m) => [
            ...m,
            { from: "system", text: "Disconnected" },
          ]);
          scheduleReconnect();
        };
      } catch {
        scheduleReconnect();
      }
    }

    // Delay initial connect slightly to avoid StrictMode double-invoke race
    try {
      clearTimeout(firstConnectTimerRef.current);
    } catch {}
    firstConnectTimerRef.current = setTimeout(() => {
      if (!cancelled) openSocket();
    }, 800);

    return () => {
      cancelled = true;
      try {
        clearTimeout(reconnectTimerRef.current);
      } catch {}
      try {
        clearTimeout(firstConnectTimerRef.current);
      } catch {}
      try {
        clearInterval(pingIntervalRef.current);
      } catch {}
      try {
        // Only actively close if open; avoid closing CONNECTING sockets (causes spurious errors)
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
        wsRef.current = null;
      } catch {}
    };
  }, [wsUrl]);

  async function handleAnalyze() {
    try {
      if (!selectedGeom) {
        setError("Please draw a boundary (polygon or rectangle) before analyzing.");
        return;
      }
      setAnalyzing(true);
      setAnalysis(null);
      setError("");

      const res = await fetch(`${apiBase}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policy: policy || undefined,
          geometry: selectedGeom,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Analyze failed: ${res.status} ${txt}`);
      }
      const data = await res.json();
      setAnalysis(data);
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  function sendChat() {
    const text = (chatInput || "").trim();
    if (!text) return;
    // optimistic local append
    setChatMessages((m) => [...m, { from: "you", text }]);
    setChatInput("");
    try {
      const payload = JSON.stringify({ message: text });
      wsRef.current?.send(payload);
    } catch {
      // ignore
    }
  }

  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
      {/* Error overlay */}
      {error ? (
        <div
          style={{
            position: "absolute",
            zIndex: 1000,
            top: 8,
            left: 8,
            right: 8,
            background: "#fff",
            border: "1px solid #f00",
            color: "#b00020",
            padding: "8px 12px",
            fontSize: 14,
            borderRadius: 4,
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
          }}
        >
          Error: {error}
        </div>
      ) : null}

      {/* Analysis panel */}
      <div
        style={{
          position: "absolute",
          zIndex: 999,
          top: 12,
          left: 52,
          width: 360,
          background: "rgba(255,255,255,0.95)",
          border: "1px solid #ddd",
          borderRadius: 6,
          padding: 12,
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8, color: "#222" }}>Policy Proof</div>
        <div style={{ fontSize: 12, color: "#333", marginBottom: 10 }}>
          1) Draw a polygon/rectangle along a municipal border. 2) Enter an optional policy name.
          3) Click Analyze to run the mock SRD and see the discontinuity plot.
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            placeholder="Policy (optional)"
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
            style={{
              flex: 1,
              fontSize: 14,
              padding: "6px 8px",
              border: "1px solid #ccc",
              borderRadius: 4,
            }}
          />
          <button
            onClick={handleAnalyze}
            disabled={!selectedGeom || analyzing}
            style={{
              fontSize: 14,
              padding: "6px 10px",
              borderRadius: 4,
              border: "1px solid #006",
              background: analyzing ? "#ccd" : "#eef",
              color: "#003",
              cursor: !selectedGeom || analyzing ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {analyzing ? "Analyzing…" : "Analyze"}
          </button>
        </div>

        {/* Results */}
        {analysis ? (
          <div>
            <div style={{ fontSize: 13, marginBottom: 6 }}>
              Impact Score:{" "}
              <span style={{ fontWeight: 600 }}>{analysis.impact_score}</span>
              {analysis.policy ? (
                <span style={{ color: "#666" }}> — {analysis.policy}</span>
              ) : null}
            </div>
            {/* Simple SVG scatter/line chart */}
            <Chart points={analysis.points} width={328} height={160} />
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "#666" }}>
            Draw a boundary and click Analyze to view the chart.
          </div>
        )}
      </div>

      {/* Chat panel */}
      <div
        style={{
          position: "absolute",
          zIndex: 999,
          bottom: 12,
          right: 12,
          width: 320,
          background: "rgba(255,255,255,0.95)",
          border: "1px solid #ddd",
          borderRadius: 6,
          display: "flex",
          flexDirection: "column",
          maxHeight: "55vh",
          color: "#222",
        }}
      >
        <div
          style={{
            padding: "8px 10px",
            borderBottom: "1px solid #eee",
            fontWeight: 600,
            color: "#222",
          }}
        >
          Chat
        </div>
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 10,
            fontSize: 13,
            lineHeight: 1.35,
          }}
        >
          {chatMessages.length === 0 ? (
            <div style={{ color: "#666" }}>
              Connects to backend WebSocket for quick guidance.
            </div>
          ) : (
            chatMessages.map((m, idx) => (
              <div key={idx} style={{ marginBottom: 6 }}>
                <span
                  style={{
                    fontWeight: 600,
                    color:
                      m.from === "you"
                        ? "#064"
                        : m.from === "assistant"
                        ? "#046"
                        : "#555",
                  }}
                >
                  {m.from}:
                </span>{" "}
                <span>{m.text}</span>
              </div>
            ))
          )}
        </div>
        <div style={{ display: "flex", gap: 6, padding: 8, borderTop: "1px solid #eee" }}>
          <input
            type="text"
            placeholder="Ask about SRD, borders, policies…"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendChat();
            }}
            style={{
              flex: 1,
              fontSize: 14,
              padding: "6px 8px",
              border: "1px solid #ccc",
              borderRadius: 4,
            }}
          />
          <button
            onClick={sendChat}
            style={{
              fontSize: 14,
              padding: "6px 10px",
              borderRadius: 4,
              border: "1px solid #060",
              background: "#efe",
              color: "#030",
              cursor: "pointer",
            }}
          >
            Send
          </button>
        </div>
      </div>

      {/* Map container */}
      <div ref={mapElRef} style={{ height: "100%", width: "100%" }} />
    </div>
  );
}

// Minimal inline Chart component
function Chart({ points, width = 320, height = 160 }) {
  if (!Array.isArray(points) || points.length === 0) return null;

  // Compute bounds
  const xs = points.map((p) => p.distance_km);
  const ys = points.map((p) => p.value);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const pad = 24;
  const w = width;
  const h = height;

  const xScale = (x) =>
    pad + ((x - minX) / (maxX - minX || 1)) * (w - pad * 2);
  const yScale = (y) =>
    h - pad - ((y - minY) / (maxY - minY || 1)) * (h - pad * 2);

  // Build path for line (sorted by x)
  const sorted = [...points].sort((a, b) => a.distance_km - b.distance_km);
  const pathD = sorted
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.distance_km)} ${yScale(p.value)}`)
    .join(" ");

  return (
    <svg width={w} height={h} style={{ border: "1px solid #eee", background: "#fff" }}>
      {/* Axes */}
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#999" strokeWidth="1" />
      <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#999" strokeWidth="1" />
      {/* Threshold at 0 */}
      {minX < 0 && maxX > 0 ? (
        <line
          x1={xScale(0)}
          y1={pad}
          x2={xScale(0)}
          y2={h - pad}
          stroke="#d00"
          strokeDasharray="4 3"
          strokeWidth="1"
        />
      ) : null}
      {/* Line */}
      <path d={pathD} stroke="#06c" strokeWidth="1.5" fill="none" opacity="0.85" />
      {/* Points */}
      {sorted.map((p, i) => (
        <circle
          key={i}
          cx={xScale(p.distance_km)}
          cy={yScale(p.value)}
          r="2.5"
          fill="#06c"
          opacity="0.9"
        />
      ))}
      {/* Labels */}
      <text x={w / 2} y={h - 6} textAnchor="middle" fontSize="10" fill="#333">
        Distance from border (km)
      </text>
      <text
        x={-h / 2}
        y={10}
        transform="rotate(-90)"
        textAnchor="middle"
        fontSize="10"
        fill="#333"
      >
        Outcome
      </text>
    </svg>
  );
}
