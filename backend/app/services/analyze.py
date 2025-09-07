from __future__ import annotations

import json
import math
import random
from typing import Any, Dict, List


from .ee_alphaearth import alphaearth_image_for_year, _ensure_initialized
import ee


def run_real_srd_analysis(geometry: Dict[str, Any], year: int = 2023) -> Dict[str, Any]:
    """
    Perform Spatial Regression Discontinuity analysis using real AlphaEarth satellite data.

    Args:
        geometry: GeoJSON geometry dict representing the policy boundary
        year: Year to analyze (default: 2023)

    Returns:
        {
            "impact_score": float,
            "points": [{"distance_km": float, "value": float}, ...],
            "bins": [float, ...]   # distance bin edges (km) for possible aggregation
        }
    """
    _ensure_initialized()

    # Define analysis parameters - smaller range for local discontinuity detection
    start_km, end_km, step_km = -2.0, 2.0, 0.1

    # Generate sample points along distance gradient from boundary
    distances: List[float] = []
    d = start_km
    while d <= end_km + 1e-9:
        distances.append(round(d, 3))
        d += step_km

    # Get AlphaEarth image for the year
    img = alphaearth_image_for_year(year)

    # For policy analysis, we'll aggregate multiple bands into a single "activity" metric
    # Higher values typically indicate more developed/urbanized areas
    bands = ["A01", "A16", "A09"]  # Example bands from concept paper
    activity_img = img.select(bands).reduce(ee.Reducer.mean())

    points = []
    for dist_km in distances:
        # Buffer the geometry by distance from boundary
        # Positive dist = inside boundary, negative = outside
        buffer_geom = (
            ee.Geometry(ee.Feature(geometry).buffer(dist_km * 1000))  # km to meters
        )

        # Sample activity values within buffer distance from boundary using 10m scale
        samples = activity_img.reduceRegion(
            reducer=ee.Reducer.mean().combine(ee.Reducer.count(), '', True),
            geometry=buffer_geom,
            scale=10,  # 10m resolution for AlphaEarth
            maxPixels=1e6
        ).getInfo()

        # Handle missing data (areas with no valid pixels or empty geometry)
        try:
            raw_value = samples['mean']
            count = samples['count']
            if count == 0 or raw_value is None:
                value = None
            else:
                # Normalize to 0-1 range (AlphaEarth embeddings are typically -0.3 to 0.3)
                normalized_value = (raw_value + 0.3) / 0.6  # Scale to 0-1
                value = round(normalized_value * 100, 2)  # Convert to percentage-like score
        except (KeyError, TypeError):
            value = None  # Default if no data available

        print(f"Year {year} | Dist {dist_km}km | Value {value} | Count {samples.get('count', 'N/A')}")  # Debug log
        points.append({"distance_km": dist_km, "value": value})

    # Calculate discontinuity as the difference near the boundary, filtering valid points
    valid_points = [p for p in points if p["value"] is not None]

    if len(valid_points) < 4:
        # Not enough data, fallback to mock
        impact_est = 0.0
    else:
        near_inside = [p["value"] for p in valid_points if 0.0 <= p["distance_km"] <= 0.5]
        near_outside = [p["value"] for p in valid_points if -0.5 <= p["distance_km"] < 0.0]

        if near_inside and near_outside:
            inside_mean = sum(near_inside) / len(near_inside)
            outside_mean = sum(near_outside) / len(near_outside)
            impact_est = inside_mean - outside_mean
        else:
            # If no symmetric data, use trend from 0 outward
            pos_values = sorted([p["value"] for p in valid_points if p["distance_km"] >= 0], key=lambda pv: pv[1] if isinstance(pv, tuple) else pv)
            if pos_values:
                impact_est = 0.0  # Could extrapolate, but for now neutral
            else:
                impact_est = 0.0

    # Provide bin edges for potential aggregation
    bins = [round(b, 3) for b in frange(math.floor(start_km), math.ceil(end_km), 0.5)]

    return {
        "impact_score": float(round(impact_est, 3)),
        "points": points,
        "bins": bins,
    }


def run_mock_srd_analysis(geometry: Dict[str, Any]) -> Dict[str, Any]:
    """
    Fallback mock SRD analysis for development/testing.

    This is the original synthetic implementation - kept for fallback if EE fails.
    """
    # Seed for determinism given a geometry input
    try:
        seed_material = json.dumps(geometry, sort_keys=True)[:512]
    except Exception:
        seed_material = "default"
    random.seed(seed_material)

    # Configuration of the synthetic relationship
    delta = 3.0  # jump at boundary (policy effect)
    base = 10.0
    slope = 0.4  # smooth spatial trend
    noise_sigma = 0.5

    # Sample distances symmetrically around 0 (km)
    start_km, end_km, step = -5.0, 5.0, 0.25
    distances: List[float] = []
    d = start_km
    while d <= end_km + 1e-9:
        distances.append(round(d, 3))
        d += step

    points = []
    for dist in distances:
        mu = base + slope * dist + (delta if dist >= 0 else 0.0)
        # Heteroskedastic-ish noise: slightly higher farther from border
        sigma = noise_sigma * (1.0 + 0.05 * abs(dist))
        val = random.gauss(mu, sigma)
        points.append({"distance_km": dist, "value": val})

    # Estimate impact as the gap very near the threshold
    near_neg = [p["value"] for p in points if -0.5 <= p["distance_km"] < 0]
    near_pos = [p["value"] for p in points if 0 <= p["distance_km"] <= 0.5]
    if near_neg and near_pos:
        impact_est = (sum(near_pos) / len(near_pos)) - (sum(near_neg) / len(near_neg))
    else:
        impact_est = delta

    # Provide coarse bin edges (every 1 km) that a client could aggregate with if needed
    bins = [round(b, 3) for b in frange(math.floor(start_km), math.ceil(end_km), 1.0)]

    return {
        "impact_score": float(round(impact_est, 3)),
        "points": points,
        "bins": bins,
    }


def frange(start: float, stop: float, step: float) -> List[float]:
    vals: List[float] = []
    x = start
    # Avoid float drift with a small epsilon
    while x <= stop + 1e-9:
        vals.append(x)
        x += step
    return vals
