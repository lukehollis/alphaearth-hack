from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Sequence, Tuple

import ee

from .ee_alphaearth import _ensure_initialized, alphaearth_image_for_year
from .ee_climate import _annual_mean_era5_land_temperature, _annual_mean_modis_lst_day_c


def _all_alphaearth_bands() -> List[str]:
    # AlphaEarth 64-D embedding bands are named A00..A63 in the GEE dataset
    return [f"A{str(i).zfill(2)}" for i in range(0, 64)]


def _bands_list(bands: Sequence[str] | None) -> List[str]:
    if bands is None:
        return _all_alphaearth_bands()
    return [str(b).strip() for b in bands if str(b).strip()]


def _target_image_for_year(target: str, year: int) -> Tuple[ee.Image, str, bool]:
    """
    Returns (target_image, band_name, is_celsius)

    target options:
      - "t2m": ERA5-Land annual mean 2m air temperature (°C, converted from K)
      - "lst_day": MODIS LST daytime annual mean (°C)
      - "stl1" | "stl2" | "stl3" | "stl4": ERA5-Land soil temperature levels 1..4 annual mean (°C)
          (level definitions: 1=0–7 cm, 2=7–28 cm, 3=28–100 cm, 4=100–289 cm)
    """
    t = (target or "t2m").strip().lower()

    if t == "t2m":
        img_k = _annual_mean_era5_land_temperature(int(year))  # Kelvin, band "t2m"
        img_c = img_k.select("t2m").add(-273.15).rename(["target"])
        return ee.Image(img_c), "target", True

    if t in ("lst", "lst_day", "modis_lst_day"):
        img_c = _annual_mean_modis_lst_day_c(int(year))  # Celsius, band "LST_Day_C"
        return ee.Image(img_c.select("LST_Day_C").rename(["target"])), "target", True

    # Soil temperature levels via ERA5-Land HOURLY aggregated to annual mean
    # Accepted aliases: stl1..stl4, soil_temperature_level_1..4
    if t.startswith("stl") or t.startswith("soil_temperature_level_"):
        try:
            if t.startswith("stl"):
                level = int(t.replace("stl", "").strip() or "1")
            else:
                level = int(t.replace("soil_temperature_level_", "").strip() or "1")
        except Exception:
            level = 1
        level = max(1, min(4, level))
        start = f"{int(year)}-01-01"
        end = f"{int(year) + 1}-01-01"
        band_name = f"soil_temperature_level_{level}"
        col = (
            ee.ImageCollection("ECMWF/ERA5_LAND/HOURLY")
            .filterDate(start, end)
            .select([band_name])
        )
        # Mean over the year, convert K->°C
        img_k = col.mean().rename([band_name])
        img_c = img_k.add(-273.15).rename(["target"])
        return ee.Image(img_c), "target", True

    raise ValueError(f"Unsupported target for regression: {target!r}")


def alphaearth_learned_tile_template(
    year: int,
    geometry: Dict[str, Any] | None,
    target: str = "t2m",
    bands: Sequence[str] | None = None,
    scale: int = 1000,
    max_pixels: float = 1e9,
    best_effort: bool = True,
    vmin: Optional[float] = None,
    vmax: Optional[float] = None,
) -> Tuple[str, List[str], float, float]:
    """
    Learn a linear mapping from AlphaEarth embeddings to a climate target for a given year
    using multiple linear regression (across pixels in the ROI), then render the predicted
    target as XYZ tiles.

    Returns (template, bands_used, min, max)
    """
    _ensure_initialized()

    # Inputs
    used_bands = _bands_list(bands)
    if len(used_bands) == 0:
        raise ValueError("No AlphaEarth bands specified for regression.")
    # Validate requested bands to match AlphaEarth dataset (A00..A63)
    valid_bands = set(_all_alphaearth_bands())
    invalid = [b for b in used_bands if b not in valid_bands]
    if invalid:
        raise ValueError(f"Invalid AlphaEarth band(s) requested: {invalid}. Valid bands are A00..A63.")

    # AOI
    geom = ee.Geometry(geometry) if geometry else None

    # Fetch inputs
    # Use global AlphaEarth predictors so the prediction covers the entire map (do NOT restrict by geometry).
    ae_img = alphaearth_image_for_year(int(year)).select(used_bands)
    tgt_img, tgt_band, is_celsius = _target_image_for_year(target, int(year))

    # Combine predictors (scalar bands) and dependent (scalar band) for regression
    combined = ae_img.addBands(tgt_img.rename([tgt_band]))

    # Region to sample/regress: prefer provided geometry; otherwise, use AlphaEarth image footprint (restricted)
    if geom is None:
        # Using entire image footprint is expensive; constrain via a coarse global polygon
        geom = ee.Geometry.Rectangle([-180, -60, 180, 80], proj=None, geodesic=False)

    # Fit linear regression across pixels in the region
    num_x = len(used_bands)
    reducer = ee.Reducer.linearRegression(num_x, 1)
    lr = combined.reduceRegion(
        reducer=reducer,
        geometry=geom,
        scale=scale,
        maxPixels=max_pixels,
        bestEffort=best_effort,
    )

    # Extract coefficient matrix (shape [num_x, 1])
    coeffs = ee.Array(lr.get("coefficients"))
    # Sanity: In rare cases, regression can fail to converge or return null; guard it
    coeffs = ee.Algorithms.If(coeffs, coeffs, ee.Array([[0]]))
    coeffs = ee.Array(coeffs)

    # Convert coefficients to 1D array [num_x] for dot product
    coeffs_list = ee.List(coeffs.toList().map(lambda row: ee.List(row).get(0)))
    coeffs_arr_1d = ee.Array(coeffs_list)

    # Predict target from embeddings for all pixels
    # predictors (per-pixel array [num_x]) dot coeffs_1d ([num_x]) -> [1]
    predictors_arr = ae_img.toArray()
    coeffs_img = ee.Image.constant(coeffs_arr_1d)
    pred = predictors_arr.arrayDotProduct(coeffs_img).rename(["pred"])

    # Visualization defaults (Celsius scale if applicable)
    if vmin is None or vmax is None:
        if is_celsius:
            vmin_used = -30.0
            vmax_used = 30.0
        else:
            # Should not occur with current targets; keep a broad Kelvin window if needed
            vmin_used = 240.0
            vmax_used = 320.0
    else:
        vmin_used = float(vmin)
        vmax_used = float(vmax)

    vis = {
        "bands": ["pred"],
        "min": float(vmin_used),
        "max": float(vmax_used),
        "palette": [
            "#313695", "#4575b4", "#74add1", "#abd9e9", "#e0f3f8",
            "#ffffbf", "#fee090", "#fdae61", "#f46d43", "#d73027", "#a50026"
        ],
    }

    info = pred.getMapId(vis)
    try:
        template = info["tile_fetcher"].url_format
    except Exception:
        mapid = info.get("mapid") or info.get("mapId")
        token = info.get("token")
        if not mapid or not token:
            raise RuntimeError("Unexpected EE map id response for learned embedding tiles.")
        template = f"https://earthengine.googleapis.com/map/{mapid}/{{z}}/{{x}}/{{y}}?token={token}"

    return template, used_bands, float(vmin_used), float(vmax_used)
