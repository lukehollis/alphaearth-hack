from __future__ import annotations

import os
import json
from typing import List, Sequence, Tuple

import ee


_INITIALIZED = False


def _ee_project() -> str | None:
    return os.getenv("EE_PROJECT") or os.getenv("GOOGLE_CLOUD_PROJECT")


def _ensure_initialized() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        print("EE already initialized")
        return
    project = _ee_project()
    print(f"Initializing EE with project: {project}")
    try:
        # Check for service account credentials
        credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        print(f"Credentials path: {credentials_path}")
        if credentials_path and os.path.exists(credentials_path):
            # Use service account credentials explicitly
            import google.auth
            from google.oauth2 import service_account

            credentials = service_account.Credentials.from_service_account_file(
                credentials_path, scopes=['https://www.googleapis.com/auth/earthengine']
            )
            ee.Initialize(credentials=credentials, project=project)
            print("Initialized with service account")
        else:
            # Fall back to ADC (includes stored OAuth from 'earthengine authenticate')
            ee.Initialize(project=project)
            print("Initialized with ADC")
    except Exception as e:
        # Provide a clear guidance error message.
        raise RuntimeError(
            "Earth Engine initialization failed. "
            "Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON file path that "
            "has Earth Engine access and set EE_PROJECT (or GOOGLE_CLOUD_PROJECT) to your GCP project. "
            f"Underlying error: {e}"
        )
    _INITIALIZED = True


def _to_bands_list(bands: Sequence[str] | None) -> List[str]:
    if bands is None:
        return ["A01", "A16", "A09"]
    return [str(b).strip() for b in bands if str(b).strip()]


def alphaearth_image_for_year(year: int, geometry: Dict[str, Any] | None = None) -> ee.Image:
    """Returns the AlphaEarth Satellite Embedding image for the calendar year."""
    _ensure_initialized()
    start = f"{int(year)}-01-01"
    end = f"{int(year) + 1}-01-01"
    print(f"Fetching image for year {year}, date range: {start} to {end}")
    col = ee.ImageCollection("GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL")
    print(f"Collection size: {col.size().getInfo()}")
    col = col.filterDate(start, end)
    if geometry is not None:
        col = col.filterBounds(ee.Geometry(geometry))
    print(f"Collection size: {col.size().getInfo()}")
    size = col.size().getInfo()
    if size == 0:
        raise ValueError(f"No AlphaEarth image available for year {year} covering the geometry")
    img = col.mosaic()
    if img is None:
        raise ValueError(f"No AlphaEarth image available for year {year}")
    print(f"Fetched image ID: {img.id().getInfo()}")
    return ee.Image(img)


def alphaearth_tile_template(
    year: int,
    bands: Sequence[str] | None = None,
    vmin: float = -0.3,
    vmax: float = 0.3,
) -> Tuple[str, List[str], float, float]:
    """
    Builds a public Earth Engine tile URL template for the AlphaEarth embeddings for a given year.

    Returns (template, bands_used, min, max)

    The returned template is suitable for Leaflet XYZ tiles, e.g.:
      L.tileLayer(template, { attribution: 'AlphaEarth via GEE' })
    """
    _ensure_initialized()
    used_bands = _to_bands_list(bands)
    img = alphaearth_image_for_year(year)
    vis = {"bands": used_bands, "min": float(vmin), "max": float(vmax)}

    info = img.getMapId(vis)  # Dict with token and a tile_fetcher
    try:
        template = info["tile_fetcher"].url_format  # Newer API
    except Exception:
        # Fallback for older return shape
        mapid = info.get("mapid") or info.get("mapId")
        token = info.get("token")
        if not mapid or not token:
            raise RuntimeError("Unexpected Earth Engine map id response; missing mapid/token.")
        template = f"https://earthengine.googleapis.com/map/{mapid}/{{z}}/{{x}}/{{y}}?token={token}"

    return template, used_bands, float(vmin), float(vmax)
