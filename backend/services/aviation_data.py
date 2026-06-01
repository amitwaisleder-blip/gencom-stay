"""External aviation data: aircraft images (Wikipedia, free), flight status
(FlightAware AeroAPI, paid), and weather (OpenWeatherMap, free tier).

Each fetcher handles "not configured" gracefully so the frontend can show a
clear placeholder instead of breaking. Responses are cached in-process with
short TTLs — FlightAware's terms require we not redistribute their data and
only expose it to the current requester, so cache sizes are small."""
from __future__ import annotations

import logging
import time
from typing import Any, Optional
from urllib.parse import quote

import httpx

from config import settings


logger = logging.getLogger(__name__)


# ------------------------------------------------------------------
# Simple TTL cache (thread-unsafe — we only serve from the single
# uvicorn worker for now, so this is fine).
# ------------------------------------------------------------------
_cache: dict[str, tuple[float, Any]] = {}


def _cache_get(key: str, ttl: float) -> Any | None:
    hit = _cache.get(key)
    if not hit:
        return None
    ts, val = hit
    if time.time() - ts > ttl:
        _cache.pop(key, None)
        return None
    return val


def _cache_set(key: str, val: Any) -> None:
    _cache[key] = (time.time(), val)


# ------------------------------------------------------------------
# Wikipedia aircraft image lookup
# ------------------------------------------------------------------
# Map common aircraft-type strings to Wikipedia page titles. Wikipedia's
# opensearch handles free-text decently, but pinning the popular models
# avoids disambiguation pages. User-typed values fall through to search.
AIRCRAFT_PAGE_OVERRIDES: dict[str, str] = {
    # Private
    "gulfstream g650": "Gulfstream G650",
    "gulfstream g650er": "Gulfstream G650",
    "gulfstream g550": "Gulfstream G550",
    "gulfstream g500": "Gulfstream G500/G600",
    "gulfstream g600": "Gulfstream G500/G600",
    "gulfstream g280": "Gulfstream G280",
    "bombardier global 7500": "Bombardier Global 7500",
    "global 7500": "Bombardier Global 7500",
    "bombardier global 6500": "Bombardier Global 5500/6500",
    "global 6500": "Bombardier Global 5500/6500",
    "bombardier challenger 350": "Bombardier Challenger 350",
    "challenger 350": "Bombardier Challenger 350",
    "bombardier challenger 650": "Bombardier Challenger 650",
    "challenger 650": "Bombardier Challenger 650",
    "cessna citation longitude": "Cessna Citation Longitude",
    "citation longitude": "Cessna Citation Longitude",
    "cessna citation latitude": "Cessna Citation Latitude",
    "citation latitude": "Cessna Citation Latitude",
    "dassault falcon 7x": "Dassault Falcon 7X",
    "falcon 7x": "Dassault Falcon 7X",
    "dassault falcon 8x": "Dassault Falcon 8X",
    "falcon 8x": "Dassault Falcon 8X",
    "embraer praetor 600": "Embraer Praetor 600",
    "praetor 600": "Embraer Praetor 600",
    "embraer phenom 300": "Embraer Phenom 300",
    "phenom 300": "Embraer Phenom 300",
    # Commercial
    "boeing 737-800": "Boeing 737 Next Generation",
    "boeing 737-900": "Boeing 737 Next Generation",
    "boeing 737 max 8": "Boeing 737 MAX",
    "boeing 737 max 9": "Boeing 737 MAX",
    "boeing 737 max": "Boeing 737 MAX",
    "boeing 757": "Boeing 757",
    "boeing 767": "Boeing 767",
    "boeing 777": "Boeing 777",
    "boeing 777-300er": "Boeing 777",
    "boeing 787": "Boeing 787 Dreamliner",
    "boeing 787-8": "Boeing 787 Dreamliner",
    "boeing 787-9": "Boeing 787 Dreamliner",
    "boeing 787-10": "Boeing 787 Dreamliner",
    "airbus a220": "Airbus A220",
    "airbus a319": "Airbus A319",
    "airbus a320": "Airbus A320",
    "airbus a320neo": "Airbus A320neo family",
    "airbus a321": "Airbus A321",
    "airbus a321neo": "Airbus A320neo family",
    "airbus a330": "Airbus A330",
    "airbus a330-900": "Airbus A330neo",
    "airbus a350": "Airbus A350",
    "airbus a350-900": "Airbus A350",
    "airbus a350-1000": "Airbus A350",
    "airbus a380": "Airbus A380",
    "embraer e175": "Embraer E-Jet E2 family",
    "embraer e190": "Embraer E-Jet E2 family",
}


def _normalize(s: str) -> str:
    return " ".join(s.lower().replace("-", " ").split())


async def aircraft_image(query: str) -> dict | None:
    """Return { imageUrl, caption, source, sourceUrl } for the given aircraft
    type string, or None if nothing matched. Uses Wikipedia's public REST
    summary endpoint — no API key required."""
    if not query or not query.strip():
        return None

    cache_key = f"ac_img::{_normalize(query)}"
    cached = _cache_get(cache_key, ttl=7 * 86400)  # 1 week
    if cached is not None:
        return cached

    q = _normalize(query)
    title = AIRCRAFT_PAGE_OVERRIDES.get(q)

    # Wikipedia's API strictly enforces its User-Agent policy (requires
    # identifiable app + contact). Without this we get 403.
    ua = "AirKarim/0.1 (https://gencomgrp.com; bdennis@gencomgrp.com) httpx"
    async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": ua, "Accept": "application/json"}) as client:
        if not title:
            # Fallback — opensearch API to find the best Wikipedia page.
            try:
                r = await client.get(
                    "https://en.wikipedia.org/w/api.php",
                    params={"action": "opensearch", "search": query, "limit": 1, "format": "json"},
                )
                r.raise_for_status()
                data = r.json()
                if isinstance(data, list) and len(data) > 1 and data[1]:
                    title = data[1][0]
            except Exception as e:
                logger.warning("wiki opensearch failed: %s", e)
                _cache_set(cache_key, None)
                return None
        if not title:
            _cache_set(cache_key, None)
            return None

        # Summary endpoint gives us a thumbnail + canonical URL cheaply.
        try:
            r2 = await client.get(
                f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(title.replace(' ', '_'))}",
            )
            if r2.status_code == 404:
                _cache_set(cache_key, None)
                return None
            r2.raise_for_status()
            j = r2.json()
        except Exception as e:
            logger.warning("wiki summary failed for %s: %s", title, e)
            _cache_set(cache_key, None)
            return None

    # Prefer the larger originalimage if present, else thumbnail.
    img = j.get("originalimage") or j.get("thumbnail")
    if not img or not img.get("source"):
        _cache_set(cache_key, None)
        return None

    out = {
        "imageUrl": img["source"],
        "caption": j.get("title") or title,
        "source": "Wikipedia",
        "sourceUrl": (j.get("content_urls") or {}).get("desktop", {}).get("page"),
    }
    _cache_set(cache_key, out)
    return out


# ------------------------------------------------------------------
# FlightAware AeroAPI
# ------------------------------------------------------------------
async def flight_status(ident: str, date: Optional[str] = None) -> dict:
    """Fetch live position / ETA for a flight. `ident` is the IATA/ICAO call
    sign ("AA2234") or a tail number ("N123AB"). Returns a `configured` flag
    so the UI can render a clear placeholder when no API key is set."""
    if not settings.flightaware_api_key:
        return {"configured": False, "reason": "FLIGHTAWARE_API_KEY not set"}
    if not ident:
        return {"configured": True, "error": "No flight identifier"}

    cache_key = f"fa::{ident}::{date or 'latest'}"
    cached = _cache_get(cache_key, ttl=60)  # 1 minute — live data
    if cached is not None:
        return cached

    url = f"https://aeroapi.flightaware.com/aeroapi/flights/{quote(ident)}"
    params: dict[str, Any] = {}
    if date:
        # start/end = that calendar day
        params["start"] = f"{date}T00:00:00Z"
        params["end"] = f"{date}T23:59:59Z"

    async with httpx.AsyncClient(timeout=15.0, headers={
        "x-apikey": settings.flightaware_api_key,
        "Accept": "application/json",
    }) as client:
        try:
            r = await client.get(url, params=params)
            if r.status_code == 401:
                return {"configured": False, "reason": "Invalid FlightAware key"}
            r.raise_for_status()
            j = r.json()
        except Exception as e:
            logger.warning("flightaware failed: %s", e)
            return {"configured": True, "error": str(e)}

    flights = j.get("flights") or []
    if not flights:
        return {"configured": True, "status": "unknown", "detail": "No matching flight."}

    # Pick the most-recent / active flight.
    f = sorted(flights, key=lambda x: x.get("scheduled_out") or "", reverse=True)[0]

    out = {
        "configured": True,
        "ident": f.get("ident"),
        "tail": f.get("registration"),
        "aircraft_type": f.get("aircraft_type"),
        "status": f.get("status"),
        "progress_percent": f.get("progress_percent"),
        "scheduled_out": f.get("scheduled_out"),
        "scheduled_in": f.get("scheduled_in"),
        "estimated_in": f.get("estimated_in"),
        "actual_in": f.get("actual_in"),
        "origin": (f.get("origin") or {}).get("code_iata") or (f.get("origin") or {}).get("code"),
        "destination": (f.get("destination") or {}).get("code_iata") or (f.get("destination") or {}).get("code"),
        "last_position": f.get("last_position"),
        "waypoints": None,  # omit — too heavy for the phone tile
    }
    _cache_set(cache_key, out)
    return out


# ------------------------------------------------------------------
# OpenWeatherMap
# ------------------------------------------------------------------
# Approximate airport coordinates for the commonly-used codes. Matches the
# frontend AIRPORTS map in phoneBits.tsx so both stay consistent.
AIRPORT_COORDS: dict[str, tuple[float, float]] = {
    "MIA": (25.79, -80.29), "MCO": (28.43, -81.31), "LGA": (40.77, -73.87),
    "JFK": (40.64, -73.78), "EWR": (40.69, -74.17), "LAX": (33.94, -118.41),
    "SFO": (37.62, -122.38), "ORD": (41.98, -87.90), "DFW": (32.90, -97.04),
    "LHR": (51.47, -0.45), "CDG": (49.01, 2.55), "FCO": (41.80, 12.24),
    "MAD": (40.49, -3.57), "DXB": (25.25, 55.36), "DOH": (25.27, 51.53),
    "HND": (35.55, 139.78), "NRT": (35.77, 140.39), "HKG": (22.31, 113.91),
    "SIN": (1.36, 103.99), "GRU": (-23.43, -46.47), "GIG": (-22.81, -43.25),
    "CUN": (21.04, -86.87), "LAS": (36.08, -115.15), "ATL": (33.64, -84.43),
    "BOS": (42.36, -71.01), "IAD": (38.94, -77.46), "DCA": (38.85, -77.04),
    "SEA": (47.45, -122.31), "DEN": (39.86, -104.67), "AMS": (52.31, 4.76),
    "FRA": (50.04, 8.57), "ZRH": (47.46, 8.55), "IST": (41.28, 28.72),
    "SVO": (55.97, 37.41),
}


async def weather_for_airport(iata: str, hours: int = 48) -> dict:
    """Forecast + slot-risk signal for an airport over the next `hours`.
    Returns configured:false when no API key is set."""
    if not settings.openweather_api_key:
        return {"configured": False, "reason": "OPENWEATHER_API_KEY not set"}
    code = (iata or "").strip().upper()
    if not code:
        return {"configured": True, "error": "No airport code"}

    cache_key = f"wx::{code}::{hours}"
    cached = _cache_get(cache_key, ttl=600)  # 10 min
    if cached is not None:
        return cached

    coords = AIRPORT_COORDS.get(code)
    lat, lon = coords if coords else (None, None)

    async with httpx.AsyncClient(timeout=15.0) as client:
        # If we don't know the coords, resolve via OpenWeather geo search.
        if lat is None:
            try:
                r = await client.get(
                    "https://api.openweathermap.org/geo/1.0/direct",
                    params={"q": code, "limit": 1, "appid": settings.openweather_api_key},
                )
                r.raise_for_status()
                hits = r.json()
                if hits:
                    lat = hits[0].get("lat")
                    lon = hits[0].get("lon")
            except Exception as e:
                logger.warning("openweather geo failed: %s", e)

        if lat is None:
            return {"configured": True, "error": f"Unknown airport: {code}"}

        try:
            r2 = await client.get(
                "https://api.openweathermap.org/data/2.5/forecast",
                params={"lat": lat, "lon": lon, "units": "imperial", "appid": settings.openweather_api_key},
            )
            if r2.status_code == 401:
                return {"configured": False, "reason": "Invalid OpenWeather key"}
            r2.raise_for_status()
            j = r2.json()
        except Exception as e:
            logger.warning("openweather forecast failed: %s", e)
            return {"configured": True, "error": str(e)}

    # Build a compact list of 3-hour forecast slots up to `hours` out.
    steps = max(1, min(40, hours // 3))
    entries = (j.get("list") or [])[:steps]
    forecast = []
    slot_risk = "low"
    for e in entries:
        main = e.get("main") or {}
        weather = (e.get("weather") or [{}])[0]
        wind = e.get("wind") or {}
        vis = e.get("visibility")
        gust = wind.get("gust")
        wind_speed = wind.get("speed")
        entry_risk = "low"
        if weather.get("main") in ("Thunderstorm", "Snow"):
            entry_risk = "high"
        elif weather.get("main") in ("Rain", "Drizzle") and (wind_speed or 0) > 20:
            entry_risk = "medium"
        elif (wind_speed or 0) > 30 or (gust or 0) > 40:
            entry_risk = "medium"
        elif vis is not None and vis < 3000:
            entry_risk = "medium"
        if entry_risk == "high":
            slot_risk = "high"
        elif entry_risk == "medium" and slot_risk == "low":
            slot_risk = "medium"
        forecast.append({
            "time": e.get("dt_txt"),
            "tempF": main.get("temp"),
            "summary": weather.get("main"),
            "description": weather.get("description"),
            "icon": weather.get("icon"),
            "wind_mph": wind_speed,
            "gust_mph": gust,
            "visibility_m": vis,
            "risk": entry_risk,
        })

    city = (j.get("city") or {}).get("name")
    out = {
        "configured": True,
        "airport": code,
        "city": city,
        "lat": lat,
        "lon": lon,
        "forecast": forecast,
        "slot_risk": slot_risk,
    }
    _cache_set(cache_key, out)
    return out
