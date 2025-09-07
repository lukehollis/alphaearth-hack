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

  useEffect(() => {
    let map;
    let baseLayer;

    async function init() {
      try {
        // Guard against double-init in React StrictMode (dev) which mounts twice
        if (mapRef.current) return;
        // Dynamically import Leaflet on client
        const L = (await import("leaflet")).default;

        // Initialize Leaflet map
        if (!mapElRef.current) return;
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

        // Wait for Earth Engine and Google API scripts injected via Next.js
        await waitForGlobal("gapi");
        await waitForGlobal("ee");

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

  return (
    <div style={{ height: "100vh", width: "100%", position: "relative" }}>
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
      <div ref={mapElRef} style={{ height: "100%", width: "100%" }} />
    </div>
  );
}
