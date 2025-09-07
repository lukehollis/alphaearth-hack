from __future__ import annotations

import json
import math
import random
from typing import Any, Dict, List


def run_mock_srd_analysis(geometry: Dict[str, Any]) -> Dict[str, Any]:
    """
    Simulate a Spatial Regression Discontinuity (SRD) result.

    We generate synthetic points of an outcome variable as a function of signed distance (km)
    from a boundary. Negative distances are "outside" the policy boundary, positive are "inside".
    A positive jump at 0 models a policy impact.

    Returns:
        {
            "impact_score": float,
            "points": [{"distance_km": float, "value": float}, ...],
            "bins": [float, ...]   # distance bin edges (km) for possible aggregation
        }
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
