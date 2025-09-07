/* Client-side map; Earth Engine removed */

"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { MathJax, MathJaxContext } from "better-react-mathjax";

export default function EEMap() {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const LRef = useRef(null);
  const drawnItemsRef = useRef(null);
  const learnedLayerRef = useRef(null);
  const layersControlRef = useRef(null);
  const [error, setError] = useState("");
  const [selectedGeom, setSelectedGeom] = useState(null);
  const [policy, setPolicy] = useState("");
  const [year, setYear] = useState(new Date().getFullYear() - 1); // Default to last available year
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [latex, setLatex] = useState("");
  const [latexLoading, setLatexLoading] = useState(false);
  const [latexError, setLatexError] = useState("");

  // MathJax v3 config for TeX + AMS environments
  const mathJaxConfig = {
    loader: { load: ["[tex]/ams"] },
    tex: {
      packages: { "[+]": ["ams"] },
      inlineMath: [
        ["$", "$"],
        ["\\(", "\\)"],
      ],
      displayMath: [
        ["$$", "$$"],
        ["\\[", "\\]"],
      ],
      macros: {
        captionof: ["\\text{#2}", 2],
      },
    },
  };

  // Example configurations
  const examples = [
    {
      name: "Falmouth Coastal Watershed Protection 🌊",
      policy: `Falmouth Coastal Watershed Protection SRD:
- Draw a polygon or rectangle that closely follows the Falmouth district boundary so the border lies inside the drawn shape.
- Treatment = inside the policy boundary; Control = outside.
- Backend pipeline (Earth Engine): build concentric rings from -2 km (outside) to +2 km (inside) in 0.1 km steps around the drawn boundary.
- For each ring, compute AlphaEarth activity as mean(A01, A16, A09) at 10 m scale, also recording sample count.
- Normalize ring means to a 0–100 index via (mean + 0.3) / 0.6 × 100 and emit a point at the ring midpoint distance.
- impact_score = mean(value) for distances in [0, 0.5] km minus mean(value) for [-0.5, 0) km.
- Select Year to choose which AlphaEarth image year to analyze.`,
      location: [41.55, -70.61], // Falmouth, MA
      zoom: 12,
      bounds: [[41.52, -70.68], [41.60, -70.55]],
    },
    {
      name: "Cambridge Climate Resilience Fee 🏗️",
      policy: `Cambridge Climate Resilience Fee SRD:
- Draw across the Cambridge–Somerville municipal border so that the border is within the polygon/rectangle you draw.
- Treatment = Cambridge side (inside); Control = Somerville side (outside).
- Backend forms buffer rings from -2 km (outside) to +2 km (inside) in 0.1 km steps around the boundary.
- Each ring reduces AlphaEarth mean(A01, A16, A09) at 10 m to a scalar with an accompanying count; values are normalized to 0–100.
- The discontinuity (impact_score) is computed as inside mean over [0, 0.5] km minus outside mean over [-0.5, 0) km.
- Use Year to run the analysis on a specific AlphaEarth year.`,
      location: [42.37, -71.11], // Cambridge/Somerville border, MA
      zoom: 13,
      bounds: [[42.35, -71.15], [42.39, -71.08]],
    },
    {
      name: "Boston Urban Carbon Sink Initiative 🌳",
      policy: `Boston Urban Carbon Sink Zone SRD:
- Draw a rectangle around the designated carbon sink zone boundary so the border is inside the shape.
- Treatment = inside the zone; Control = adjacent outside areas.
- Backend uses AlphaEarth mean(A01, A16, A09) at 10 m within concentric rings spanning -2…+2 km in 0.1 km steps from the boundary.
- For each ring it computes mean and count, normalizes the mean to a 0–100 index, and plots value vs. distance.
- impact_score = mean(value) in [0, 0.5] km (inside) – mean(value) in [-0.5, 0) km (outside).
- Pick Year to select the AlphaEarth image year.`,
      location: [42.352, -71.052], // Boston Seaport, MA
      zoom: 15,
      bounds: [[42.34, -71.06], [42.36, -71.04]],
    },
    {
      name: "Data Center Energy effects on Arctic Permafrost Counterfactual 🧊",
      policy: `Arctic Permafrost Counterfactual SRD:
- Draw a large polygon/rectangle over your area of interest near Utqiagvik; the SRD boundary is the perimeter of the shape you draw.
- Interpret inside as “treated” (conceptual +10% global energy use) and outside as “control”. The backend still samples real AlphaEarth data; the counterfactual is conceptual.
- Backend constructs rings from -2 km (outside) to +2 km (inside) in 0.1 km steps around the drawn boundary.
- For each ring, it computes AlphaEarth mean(A01, A16, A09) at 10 m with a count, normalizes to a 0–100 index, and emits a point at the ring midpoint.
- impact_score = mean inside [0, 0.5] km – mean outside [-0.5, 0) km.
- Set Year to choose which AlphaEarth year to reference.`,
      location: [71.29, -156.79], // Utqiagvik (Barrow), AK
      zoom: 10,
      bounds: [[71.20, -157.10], [71.36, -156.50]],
    },
  ];

  function runExample(example) {
    setPolicy(example.policy);
    if (mapRef.current && LRef.current && drawnItemsRef.current) {
      mapRef.current.setView(example.location, example.zoom);
      drawnItemsRef.current.clearLayers();
      if (example.bounds) {
        const layer = LRef.current.rectangle(example.bounds, { color: "#3388ff", weight: 2 });
        drawnItemsRef.current.addLayer(layer);
        const gj = layer.toGeoJSON();
        setSelectedGeom(gj.geometry);
      } else {
        setSelectedGeom(null);
      }
    }
  }

  // Chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const wsRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const connectingRef = useRef(false);
  const firstConnectTimerRef = useRef(null);
  const [attachContext, setAttachContext] = useState(true);

  // Backend endpoints
  // Use same-origin Next.js proxy route to avoid CORS for API calls.
  const apiBase = "";
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws/chat";

  useEffect(() => {
    let mounted = true;
    let map;
    let baseLayer;

    async function init() {
      try {
        // Guard against double-init in React StrictMode (dev) which mounts twice
        if (mapRef.current) return;
        // Dynamically import Leaflet on client
        const L = (await import("leaflet")).default;
        LRef.current = L;
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
        drawnItemsRef.current = drawnItems;
        drawnItems.addTo(map);

        if (L.Control && L.Control.Draw) {
          const drawControl = new L.Control.Draw({
            position: 'topleft',
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
          try {
            map.addControl(drawControl);
          } catch (e) {
            console.error('Failed to add draw control:', e);
            setError('Failed to initialize drawing tools.');
          }
        } else {
          console.warn('Leaflet Draw plugin not available.');
        }

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

        // AlphaEarth: prefer dynamic Google Earth Engine tiles if available,
        // otherwise allow local XYZ tiles via env config.
        // Configure one of:
        //  - NEXT_PUBLIC_ALPHAEARTH_TILE_TEMPLATE, e.g. http://localhost:8080/alphaearth/{year}/{z}/{x}/{y}.png
        //  - or explicit NEXT_PUBLIC_ALPHAEARTH_LATEST_URL and NEXT_PUBLIC_ALPHAEARTH_PREVIOUS_URL
        // If none are set, this component will call the backend proxy:
        //    GET /api/ee/alphaearth/tiles?year=YYYY&bands=A01,A16,A09
        // which returns a GEE tile URL template.
        const alphaTemplate = process.env.NEXT_PUBLIC_ALPHAEARTH_TILE_TEMPLATE;
        const alphaLatestUrlEnv = process.env.NEXT_PUBLIC_ALPHAEARTH_LATEST_URL;
        const alphaPrevUrlEnv = process.env.NEXT_PUBLIC_ALPHAEARTH_PREVIOUS_URL;

        const yearNow = new Date().getUTCFullYear();
        const latestYear = yearNow - 1; // assume last fully-available year
        const prevYear = latestYear - 1;

        function resolveUrl(urlOrTemplate, year) {
          if (!urlOrTemplate) return null;
          if (urlOrTemplate.includes("{year}")) {
            return urlOrTemplate.replaceAll("{year}", String(year));
          }
          return urlOrTemplate;
        }

        const urlLatest = resolveUrl(alphaLatestUrlEnv || alphaTemplate, latestYear);
        const urlPrev = resolveUrl(alphaPrevUrlEnv || alphaTemplate, prevYear);

        // Build overlays from env if provided; otherwise try backend GEE tile templates.
        const overlays = {};

        if (urlLatest) {
          overlays[`AlphaEarth ${latestYear}`] = L.tileLayer(urlLatest, {
            attribution: "AlphaEarth",
            opacity: 0.8,
          });
        }
        if (urlPrev) {
          overlays[`AlphaEarth ${prevYear}`] = L.tileLayer(urlPrev, {
            attribution: "AlphaEarth",
            opacity: 0.8,
          });
        }

        if (!urlLatest && !urlPrev) {
          // Fallback to backend dynamic GEE tiles
          async function fetchTemplateForYear(year) {
            const qs = new URLSearchParams({
              year: String(year),
              bands: "A01,A16,A09",
            });
            const resp = await fetch(`/api/ee/alphaearth/tiles?${qs.toString()}`, {
              method: "GET",
              cache: "no-store",
            });
            if (!resp.ok) {
              const txt = await resp.text().catch(() => "");
              throw new Error(`AlphaEarth tiles request failed (${year}): ${resp.status} ${txt}`);
            }
            return await resp.json();
          }

          try {
            const latestInfo = await fetchTemplateForYear(latestYear);
            if (!mounted) return;
            if (latestInfo?.template) {
              overlays[`AlphaEarth ${latestInfo.year}`] = L.tileLayer(latestInfo.template, {
                attribution: "AlphaEarth via Google Earth Engine",
                opacity: 0.8,
              });
            }
          } catch (e) {
            // If dynamic latest fails, surface a guided error only if no other overlays exist.
            if (Object.keys(overlays).length === 0) {
              setError(
                "AlphaEarth dynamic tiles unavailable. Ensure backend Earth Engine auth is configured (EE_PROJECT and GOOGLE_APPLICATION_CREDENTIALS), or set NEXT_PUBLIC_ALPHAEARTH_* envs for local tiles."
              );
            }
          }

          try {
            const prevInfo = await fetchTemplateForYear(prevYear);
            if (!mounted) return;
            if (prevInfo?.template) {
              overlays[`AlphaEarth ${prevInfo.year}`] = L.tileLayer(prevInfo.template, {
                attribution: "AlphaEarth via Google Earth Engine",
                opacity: 0.8,
              });
            }
          } catch {
            // Ignore prev year failure if latest succeeded.
          }
        }

        // Add Climate overlays (ERA5-Land) for absolute latestYear and year-over-year difference
        try {
          async function fetchClimate(path) {
            const resp = await fetch(path, { method: "GET", cache: "no-store" });
            if (!resp.ok) {
              let txt = "";
              try { txt = await resp.text(); } catch {}
              throw new Error(`${resp.status} ${txt}`);
            }
            return await resp.json();
          }
          // Absolute temperature (°C) for latestYear
          const absInfo = await fetchClimate(`/api/ee/climate/tiles?source=era5land&year=${latestYear}`);
          if (absInfo?.template && L && typeof L.tileLayer === "function") {
            overlays[`ERA5-Land T2M °C ${latestYear}`] = L.tileLayer(absInfo.template, {
              attribution: "ECMWF ERA5-Land via Google Earth Engine",
              opacity: 0.8,
            });
          }
          // Difference map (y2 - y1) in °C
          const diffInfo = await fetchClimate(`/api/ee/climate/tiles?source=era5land&y1=${prevYear}&y2=${latestYear}`);
          if (diffInfo?.template && L && typeof L.tileLayer === "function") {
            overlays[`ERA5-Land ΔT °C ${prevYear}→${latestYear}`] = L.tileLayer(diffInfo.template, {
              attribution: "ECMWF ERA5-Land via Google Earth Engine",
              opacity: 0.8,
            });
          }
        } catch (e) {
          console.warn("Climate tiles unavailable:", e?.message || e);
        }

        if (!mounted) return;

        if (Object.keys(overlays).length > 0 && baseLayer && mapRef.current) {
          // Filter out any invalid layers
          let cleanedOverlays = {};
          Object.entries(overlays).forEach(([name, layer]) => {
            if (layer && typeof layer.addTo === 'function') {
              cleanedOverlays[name] = layer;
            } else {
              console.warn(`Skipping invalid layer: ${name}`);
            }
          });

          // Warn if tiles fail to load when toggled on
          let tileErrorShown = false;
          Object.values(cleanedOverlays).forEach((layer) => {
            try {
              layer.on("tileerror", () => {
                if (!tileErrorShown) {
                  tileErrorShown = true;
                  setError(
                    "AlphaEarth tiles failed to load. If using local tiles, place under frontend/public/alphaearth/{year}/{z}/{x}/{y}.png. If using GEE, check backend EE credentials."
                  );
                }
              });
            } catch {}
          });

          // Do NOT add overlays by default; user can toggle them in the control
          if (Object.keys(cleanedOverlays).length > 0) {
            try {
              const ctrl = L.control
                .layers(
                  {
                    "Esri World Imagery": baseLayer,
                  },
                  cleanedOverlays,
                  { collapsed: false, position: 'topright' }
                )
                .addTo(mapRef.current);
              layersControlRef.current = ctrl;

              // Force AlphaEarth latest-year (e.g., 2024) overlay ON by default
              try {
                const alphaKey = `AlphaEarth ${latestYear}`;
                if (cleanedOverlays[alphaKey] && typeof cleanedOverlays[alphaKey].addTo === 'function') {
                  cleanedOverlays[alphaKey].addTo(mapRef.current);
                }
              } catch {}
            } catch (e) {
              console.error('Failed to add layers control:', e);
              setError('Failed to initialize map controls.');
            }
          }
        }
      } catch (e) {
        console.error(e);
        setError(e?.message || String(e));
      }
    }

    init();

    return () => {
      mounted = false;
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

  // Build a compact analysis object to send over WebSocket
  function buildCompactAnalysis(ana, geom) {
    const maxPoints = 400;
    const decimate = (arr, maxN) => {
      if (!Array.isArray(arr)) return arr;
      const n = arr.length;
      if (n <= maxN) return arr;
      const step = Math.ceil(n / maxN);
      const out = [];
      for (let i = 0; i < n; i += step) out.push(arr[i]);
      // Ensure we include the last point
      if (out.length && arr[n - 1] !== out[out.length - 1]) out.push(arr[n - 1]);
      return out;
    };
    const summarizeGeom = (g) => {
      try {
        if (!g || typeof g !== "object") return null;
        const coords = [];
        const walk = (c) => {
          if (!c) return;
          if (typeof c[0] === "number" && typeof c[1] === "number") {
            coords.push([c[0], c[1]]);
          } else if (Array.isArray(c)) {
            for (const x of c) walk(x);
          }
        };
        walk(g.coordinates);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of coords) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
        const bbox = (coords.length ? [minX, minY, maxX, maxY] : null);
        return {
          type: g.type || null,
          bbox,
          vertices: coords.length || null,
        };
      } catch {
        return null;
      }
    };

    const compact = {
      policy: ana?.policy ?? null,
      impact_score: ana?.impact_score ?? null,
      dataType: ana?.dataType ?? null,
      selectedYear: ana?.selectedYear ?? null,
      title: ana?.title ?? null,
      x_label: ana?.x_label ?? null,
      y_label: ana?.y_label ?? null,
      bins: Array.isArray(ana?.bins) ? ana.bins : null,
      points: Array.isArray(ana?.points) ? decimate(ana.points, maxPoints) : null,
      geom: summarizeGeom(geom),
    };

    if (Array.isArray(ana?.charts)) {
      compact.charts = ana.charts.map((ch) => {
        const out = { ...ch };
        if (Array.isArray(out.series)) {
          out.series = out.series.map((s) => {
            const ss = { ...s };
            if (Array.isArray(ss.points)) {
              ss.points = decimate(ss.points, 200);
            }
            return ss;
          });
        }
        return out;
      });
    } else {
      compact.charts = null;
    }
    return compact;
  }

  async function addLearnedOverlay(target = "stl1") {
    try {
      if (!selectedGeom || !mapRef.current || !LRef.current) return;
      const qs = new URLSearchParams({ target, year: String(year) });
      const resp = await fetch(`/api/ee/alphaearth/learn/tiles?${qs.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geometry: selectedGeom }),
      });
      if (!resp.ok) {
        let txt = ""; try { txt = await resp.text(); } catch {}
        setError(`Learned AlphaEarth tiles request failed: ${resp.status} ${txt}`);
        return;
      }
      const data = await resp.json();
      const template = data?.template;
      if (!template) return;
      const L = LRef.current;
      try {
        if (learnedLayerRef.current && typeof learnedLayerRef.current.remove === "function") {
          learnedLayerRef.current.remove();
        }
      } catch {}
      const layer = L.tileLayer(template, {
        attribution: "AlphaEarth→Soil Temp (learned) via Google Earth Engine",
        opacity: 1.0,
      });
      try { layer.on("tileerror", () => {}); } catch {}
      learnedLayerRef.current = layer;
      layer.addTo(mapRef.current);
      try { if (typeof layer.bringToFront === "function") layer.bringToFront(); } catch {}
      try {
        if (layersControlRef.current && typeof layersControlRef.current.addOverlay === "function") {
          const label = `AlphaEarth→Soil Temp (learned) ${String(target || "").toUpperCase()}`;
          layersControlRef.current.addOverlay(layer, label);
        }
      } catch {}
    } catch (e) {
      console.error(e);
    }
  }

  async function handleAnalyze() {
    try {
      if (!selectedGeom) {
        setError("Please draw a boundary (polygon or rectangle) before analyzing.");
        return;
      }
      setAnalyzing(true);
      setAnalysis(null);
      setError("");
      // Reset LaTeX state for a fresh run; generation will auto-trigger after analysis completes
      setLatex("");
      setLatexError("");
      setLatexLoading(false);

      const res = await fetch(`${apiBase}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policy: policy || undefined,
          geometry: selectedGeom,
          year: year,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Analyze failed: ${res.status} ${txt}`);
      }
      const txt = await res.text();
      let parsed;
      try {
        // Try single JSON first
        parsed = JSON.parse(txt);
      } catch {
        // Fallback: NDJSON (newline-delimited JSON). Parse last valid object,
        // preferring the summary with impact_score/bins/points if present.
        const lines = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        let finalObj = null;
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const obj = JSON.parse(lines[i]);
            finalObj = obj;
            if (obj && obj.impact_score != null && obj.points && obj.bins) {
              break;
            }
          } catch {
            // ignore parse errors on individual lines
          }
        }
        if (!finalObj) {
          throw new Error("Analyze returned no parseable JSON.");
        }
        parsed = finalObj;
      }
      // Add metadata about data type used and broadcast compact context to chat
      const enriched = {
        ...parsed,
        dataType: parsed.impact_score !== 0 ? "real" : "mock", // Simple heuristic - real data should show vary
        selectedYear: year,
      };
      setAnalysis(enriched);

      await addLearnedOverlay("stl1");

      try {
        const compact = buildCompactAnalysis(enriched, selectedGeom);
        wsRef.current?.send(JSON.stringify({ type: "context", analysis: compact }));
        setChatMessages((m) => [
          ...m,
          { from: "system", text: `Attached analysis context for ${enriched.policy ? enriched.policy : "current selection"} (${enriched.selectedYear}).` },
        ]);
      } catch {
        // ignore WS failures
      }
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleGenerateLatex() {
    try {
      setLatexLoading(true);
      setLatexError("");
      const resp = await fetch(`/api/analyze/latex`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(analysis),
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        throw new Error(`LaTeX failed: ${resp.status} ${t}`);
      }
      const data = await resp.json();
      setLatex(data?.latex || "");
    } catch (e) {
      console.error(e);
      setLatexError(e?.message || String(e));
    } finally {
      setLatexLoading(false);
    }
  }

  // Auto-generate LaTeX as soon as an analysis object is available
  useEffect(() => {
    if (analysis) {
      // Kick off LaTeX generation in parallel to rendering charts
      handleGenerateLatex();
    }
  }, [analysis]);

  function sendChat() {
    const text = (chatInput || "").trim();
    if (!text) return;
    // optimistic local append
    setChatMessages((m) => [...m, { from: "you", text }]);
    setChatInput("");
    try {
      const payloadObj = { type: "message", message: text };
      if (attachContext && analysis) {
        try {
          payloadObj.analysis = buildCompactAnalysis(analysis, selectedGeom);
        } catch {
          // ignore compact build failure
        }
      }
      wsRef.current?.send(JSON.stringify(payloadObj));
    } catch {
      // ignore
    }
  }

  return (
    <MathJaxContext config={mathJaxConfig}>
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
          width: 420,
          overflowX: "hidden",
          overflowY: "scoll",
          maxHeight: "90vh",
          background: "rgba(255,255,255,0.95)",
          border: "1px solid #ddd",
          borderRadius: 6,
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8, color: "#222", position: "sticky", top: "0", background: "rgba(255, 255, 255, 0.9)", padding: "12px 8px 4px" }}>Policy Proof</div>
        <div style={{ fontSize: 12, color: "#333", marginBottom: 10, padding: "0px 8px", }}>
          1) Draw a polygon/rectangle along a municipal border. 
          <br></br>
          2) Enter an optional policy name and select year.
          <br></br>
          3) Click Analyze to run SRD analysis using AlphaEarth satellite data (or fallback to simulated data).
        </div>
        <div style={{ marginBottom: 6 }}>
          <textarea
            placeholder="Policy (optional)"
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
            rows={6}
            style={{
              width: "100%",
              fontSize: 14,
              padding: "6px 8px",
              border: "1px solid #ccc",
              borderRadius: 4,
              marginBottom: 6,
              margin: "4px 6px",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: '0px 8px', }}>
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              style={{
                flex: 1,
                fontSize: 14,
                padding: "6px 8px",
                border: "1px solid #ccc",
                borderRadius: 4,
              }}
            >
              <option value={2024}>2024</option>
              <option value={2023}>2023</option>
              <option value={2022}>2022</option>
              <option value={2021}>2021</option>
            </select>
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
        </div>

        {/* Example buttons */}
        <div style={{ marginBottom: 10, padding: "0  8px", }}>
          <div style={{ fontSize: 12, color: "#333", marginBottom: 4 }}>Run Examples:</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {examples.map((example, idx) => (
              <button
                key={idx}
                onClick={() => runExample(example)}
                style={{
                  fontSize: 12,
                  padding: "4px 8px",
                  border: "1px solid #069",
                  background: "#eff",
                  color: "#036",
                  borderRadius: 3,
                  cursor: "pointer",
                  textAlign: "left",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={example.name}
              >
                {example.name}
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        {analysis ? (
          <div style={{ padding: "0px 8px" }}>
            <div style={{ fontSize: 13, marginBottom: 6 }}>
              Impact Score:{" "}
              <span style={{ fontWeight: 600 }}>{analysis.impact_score}</span>
              {analysis.policy ? (
                <span style={{ color: "#666" }}> — {analysis.policy}</span>
              ) : null}
            </div>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 6 }}>
              Year: {analysis.selectedYear} • Data: {analysis.dataType === "real" ? "Real AlphaEarth satellite" : "Simulated"}
            </div>
            <div style={{ fontSize: 10, color: "#999", marginBottom: 8 }}>
              {analysis.dataType === "real"
                ? "Using Google Earth Engine AlphaEarth embeddings for SRD analysis"
                : "Using simulated data - configure EE_PROJECT and GOOGLE_APPLICATION_CREDENTIALS for real analysis"
              }
            </div>
            {/* LaTeX (auto-generated) */}
            <div style={{ marginBottom: 8 }}>
              {latexLoading ? (
                <div style={{ fontSize: 12, color: "#333" }}>Generating LaTeX…</div>
              ) : latexError ? (
                <div style={{ color: "#b00", fontSize: 12 }}>Error: {latexError}</div>
              ) : latex ? (
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #ddd",
                    borderRadius: 4,
                    padding: 12,
                    fontSize: 13,
                    color: "#111",
                  }}
                >
                  <MathJax dynamic={true}>{latex}</MathJax>
                </div>
              ) : null}
            </div>

            {/* Charts */}
            {Array.isArray(analysis.charts) && analysis.charts.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {analysis.charts.map((c, idx) => {
                  const series = (c.series && c.series[0] && Array.isArray(c.series[0].points)) ? c.series[0].points : [];
                  const pts = series.map((p) => ({ distance_km: p.x, value: p.y }));
                  return (
                    <div key={idx} style={{ marginBottom: 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#222", marginBottom: 2 }}>
                        {c.title || analysis.title || "SRD Chart"}
                      </div>
                      <Chart
                        points={pts}
                        width={328}
                        height={160}
                        xLabel={c.x_label || analysis.x_label || "Distance from border (km)"}
                        yLabel={c.y_label || analysis.y_label || "Outcome"}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <Chart
                points={analysis.points}
                width={412}
                height={220}
                xLabel={analysis.x_label || "Distance from border (km)"}
                yLabel={analysis.y_label || "Outcome"}
              />
            )}

          </div>
        ) : (
          <div style={{ fontSize: 12, color: "#666", padding: "0 8px 8px" }}>
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
          width: 420,
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
                <div className="markdown">
                  <ReactMarkdown>{m.text}</ReactMarkdown>
                </div>
              </div>
            ))
          )}
        </div>
        <div style={{ display: "flex", gap: 6, padding: 8, borderTop: "1px solid #eee", alignItems: "center" }}>
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
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#333" }} title="Include latest analysis data with your message">
            <input
              type="checkbox"
              checked={attachContext}
              onChange={(e) => setAttachContext(e.target.checked)}
            />
            Attach context
          </label>
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
    </MathJaxContext>
  );
}

// Minimal inline Chart component
function Chart({ points, width = 320, height = 160, xLabel = "Distance from border (km)", yLabel = "Outcome", title }) {
  if (!Array.isArray(points) || points.length === 0) return null;

  // Filter out null/undefined values
  const validPoints = points.filter((p) => p.value != null && typeof p.value === "number");
  if (validPoints.length === 0) return <div style={{ fontSize: 12, color: "#666" }}>No valid data points to display</div>;

  // Compute bounds
  const xs = validPoints.map((p) => p.distance_km);
  const ys = validPoints.map((p) => p.value);
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
  const sorted = [...validPoints].sort((a, b) => a.distance_km - b.distance_km);
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
        {xLabel}
      </text>
      <text
        x={-h / 2}
        y={10}
        transform="rotate(-90)"
        textAnchor="middle"
        fontSize="10"
        fill="#333"
      >
        {yLabel}
      </text>
    </svg>
  );
}
