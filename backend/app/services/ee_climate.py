from __future__ import annotations

from typing import Optional, Tuple

import ee

# Reuse EE init from AlphaEarth helper
from .ee_alphaearth import _ensure_initialized


def _annual_mean_era5_land_temperature(year: int) -> ee.Image:
    """
    Build an ERA5-Land annual-mean 2m air temperature image (Kelvin).
    Dataset: ECMWF/ERA5_LAND/MONTHLY, band: temperature_2m
    """
    _ensure_initialized()
    start = f"{int(year)}-01-01"
    end = f"{int(year) + 1}-01-01"
    col = (
        ee.ImageCollection("ECMWF/ERA5_LAND/MONTHLY")
        .filterDate(start, end)
        .select(["temperature_2m"])
    )
    size = col.size().getInfo()
    if size == 0:
        raise ValueError(f"No ERA5-Land MONTHLY temperature_2m data for year {year}")
    img = col.mean().rename(["t2m"])  # Kelvin
    return ee.Image(img).set({"year": int(year)})


def _annual_mean_modis_lst_day_c(year: int) -> ee.Image:
    """
    Build a MODIS annual-mean daytime land surface temperature image (Celsius).
    Dataset: MODIS/061/MOD11A1, band: LST_Day_1km with scale factor 0.02 K.
    We convert to Celsius then average over the year.
    """
    _ensure_initialized()
    start = f"{int(year)}-01-01"
    end = f"{int(year) + 1}-01-01"
    col = (
        ee.ImageCollection("MODIS/061/MOD11A1")
        .filterDate(start, end)
        .select(["LST_Day_1km"])
    )
    size = col.size().getInfo()
    if size == 0:
        raise ValueError(f"No MODIS LST_Day_1km data for year {year}")
    # Convert each image to Celsius then mean
    def to_celsius(img: ee.Image) -> ee.Image:
        # MODIS scale factor 0.02, units Kelvin; convert to Celsius
        return img.multiply(0.02).add(-273.15).rename(["LST_Day_C"])

    col_c = col.map(to_celsius)
    img = col_c.mean().rename(["LST_Day_C"])
    return ee.Image(img).set({"year": int(year)})


def climate_temperature_tile_template(
    source: str = "era5land",
    year: Optional[int] = None,
    y1: Optional[int] = None,
    y2: Optional[int] = None,
    vmin: Optional[float] = None,
    vmax: Optional[float] = None,
) -> Tuple[str, float, float]:
    """
    Returns an XYZ tile URL template for temperature maps from climate datasets.

    Modes:
      - Single year map (absolute):
          source=era5land|modis, year=YYYY
      - Difference map (y2 - y1):
          source=era5land|modis, y1=YYYY, y2=YYYY

    Returns (template, vmin_used, vmax_used).
    """
    _ensure_initialized()
    src = (source or "era5land").strip().lower()
    is_diff = (y1 is not None and y2 is not None)

    if src == "era5land":
        if is_diff:
            img1 = _annual_mean_era5_land_temperature(int(y1))  # Kelvin
            img2 = _annual_mean_era5_land_temperature(int(y2))  # Kelvin
            # Kelvin difference equals Celsius difference
            diff = img2.subtract(img1).rename(["dT_C"])
            vis = {
                "bands": ["dT_C"],
                "min": float(vmin if vmin is not None else -5.0),
                "max": float(vmax if vmax is not None else 5.0),
                "palette": ["#2166ac", "#67a9cf", "#f7f7f7", "#f4a582", "#b2182b"],
            }
            info = diff.getMapId(vis)
            template = info["tile_fetcher"].url_format
            return template, float(vis["min"]), float(vis["max"])
        else:
            img = _annual_mean_era5_land_temperature(int(year or 2000))  # Kelvin
            # Convert to Celsius for visualization
            temp_c = img.select("t2m").add(-273.15).rename(["T2M_C"])
            vis = {
                "bands": ["T2M_C"],
                "min": float(vmin if vmin is not None else -30.0),
                "max": float(vmax if vmax is not None else 30.0),
                "palette": [
                    "#313695", "#4575b4", "#74add1", "#abd9e9", "#e0f3f8",
                    "#ffffbf", "#fee090", "#fdae61", "#f46d43", "#d73027", "#a50026"
                ],
            }
            info = temp_c.getMapId(vis)
            template = info["tile_fetcher"].url_format
            return template, float(vis["min"]), float(vis["max"])

    elif src == "modis":
        if is_diff:
            img1 = _annual_mean_modis_lst_day_c(int(y1))  # Celsius
            img2 = _annual_mean_modis_lst_day_c(int(y2))  # Celsius
            diff = img2.subtract(img1).rename(["dLST_C"])
            vis = {
                "bands": ["dLST_C"],
                "min": float(vmin if vmin is not None else -5.0),
                "max": float(vmax if vmax is not None else 5.0),
                "palette": ["#2166ac", "#67a9cf", "#f7f7f7", "#f4a582", "#b2182b"],
            }
            info = diff.getMapId(vis)
            template = info["tile_fetcher"].url_format
            return template, float(vis["min"]), float(vis["max"])
        else:
            img = _annual_mean_modis_lst_day_c(int(year or 2000))  # Celsius
            vis = {
                "bands": ["LST_Day_C"],
                "min": float(vmin if vmin is not None else -30.0),
                "max": float(vmax if vmax is not None else 45.0),
                "palette": [
                    "#313695", "#4575b4", "#74add1", "#abd9e9", "#e0f3f8",
                    "#ffffbf", "#fee090", "#fdae61", "#f46d43", "#d73027", "#a50026"
                ],
            }
            info = img.getMapId(vis)
            template = info["tile_fetcher"].url_format
            return template, float(vis["min"]), float(vis["max"])

    else:
        raise ValueError(f"Unsupported climate source: {source!r}")
