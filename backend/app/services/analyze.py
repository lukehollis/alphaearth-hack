from __future__ import annotations

import json
import math
import random
from typing import Any, Dict, List, Generator


from .ee_alphaearth import alphaearth_image_for_year, _ensure_initialized
import ee


def run_real_srd_analysis(geometry: Dict[str, Any], year: int = 2023) -> Generator[Dict[str, Any], None, None]:
    """
    Perform Spatial Regression Discontinuity analysis using real AlphaEarth satellite data.
    Yields points progressively, then the impact score at the end.
    """
    _ensure_initialized()

    # Define analysis parameters
    start_km, end_km, step_km = -2.0, 2.0, 0.1
    bin_edges = [round(start_km + i * step_km, 3) for i in range(int((end_km - start_km) / step_km) + 2)]

    yield {"bins": bin_edges[:-1]}  # Bin starts

    # Get AlphaEarth image for the year
    img = alphaearth_image_for_year(year)

    # Aggregate bands into activity metric
    bands = ["A01", "A16", "A09"]
    activity_img = img.select(bands).reduce(ee.Reducer.mean())

    points = []
    for i in range(len(bin_edges) - 1):
        low = bin_edges[i]
        high = bin_edges[i + 1]
        mid = round((low + high) / 2, 3)

        # Compute band geometry
        if high <= 0:  # Outside (negative)
            inner_dist = abs(high) * 1000
            outer_dist = abs(low) * 1000
            inner = ee.Feature(geometry).buffer(inner_dist, 50).geometry()
            outer = ee.Feature(geometry).buffer(outer_dist, 50).geometry()
            band_geom = outer.difference(inner)
        else:  # Inside (positive)
            inner_dist = high * 1000
            outer_dist = low * 1000
            inner = ee.Feature(geometry).buffer(-inner_dist, 50).geometry()
            outer = ee.Feature(geometry).buffer(-outer_dist, 50).geometry()
            band_geom = outer.difference(inner)

        # Sample
        samples = activity_img.reduceRegion(
            reducer=ee.Reducer.mean().combine(ee.Reducer.count(), '', True),
            geometry=band_geom,
            scale=10,
            maxPixels=1e9,
            bestEffort=True
        ).getInfo()

        try:
            raw_value = samples['mean']
            count = samples['count']
            if count == 0 or raw_value is None:
                value = None
            else:
                normalized_value = (raw_value + 0.3) / 0.6
                value = round(normalized_value * 100, 2)
        except (KeyError, TypeError):
            value = None

        print(f"Year {year} | Dist {mid}km | Value {value} | Count {samples.get('count', 'N/A')}")

        point = {"distance_km": mid, "value": value}
        points.append(point)
        yield {"point": point}

    # Calculate impact_score
    valid_points = [p for p in points if p["value"] is not None]
    if len(valid_points) < 4:
        impact_est = 0.0
    else:
        near_inside = [p["value"] for p in valid_points if 0.0 <= p["distance_km"] <= 0.5]
        near_outside = [p["value"] for p in valid_points if -0.5 <= p["distance_km"] < 0.0]
        if near_inside and near_outside:
            inside_mean = sum(near_inside) / len(near_inside)
            outside_mean = sum(near_outside) / len(near_outside)
            impact_est = inside_mean - outside_mean
        else:
            impact_est = 0.0

    yield {"impact_score": float(round(impact_est, 3))}


def run_mock_srd_analysis(geometry: Dict[str, Any]) -> Dict[str, Any]:
    """
    Fallback mock SRD analysis for development/testing.
    """
    # Seed for determinism
    try:
        seed_material = json.dumps(geometry, sort_keys=True)[:512]
    except Exception:
        seed_material = "default"
    random.seed(seed_material)

    delta = 3.0
    base = 10.0
    slope = 0.4
    noise_sigma = 0.5

    start_km, end_km, step = -5.0, 5.0, 0.25
    distances = [round(start_km + i * step, 3) for i in range(int((end_km - start_km) / step) + 1)]

    points = []
    for dist in distances:
        mu = base + slope * dist + (delta if dist >= 0 else 0.0)
        sigma = noise_sigma * (1.0 + 0.05 * abs(dist))
        val = random.gauss(mu, sigma)
        points.append({"distance_km": dist, "value": val})

    near_neg = [p["value"] for p in points if -0.5 <= p["distance_km"] < 0]
    near_pos = [p["value"] for p in points if 0 <= p["distance_km"] <= 0.5]
    if near_neg and near_pos:
        impact_est = (sum(near_pos) / len(near_pos)) - (sum(near_neg) / len(near_neg))
    else:
        impact_est = delta

    bins = [round(math.floor(start_km) + i, 3) for i in range(int(math.ceil(end_km) - math.floor(start_km)) + 1)]

    return {
        "impact_score": float(round(impact_est, 3)),
        "points": points,
        "bins": bins,
    }
