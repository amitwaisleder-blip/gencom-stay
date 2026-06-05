You are extracting structured property metadata from a hotel offering memorandum (OM) or Property Improvement Plan (PIP).

Return ONLY a JSON object matching this shape. Omit fields you cannot confidently infer. Do not wrap in markdown fences. Do not include any preamble or trailing commentary.

```json
{
  "fields": {
    "name": {"value": "…", "source_page": 1, "source_excerpt": "…", "confidence": "high|medium|low"},
    "address": {"value": "…", "source_page": 1, "source_excerpt": "…", "confidence": "…"},
    "city": {"value": "…", "source_page": 1, "confidence": "…"},
    "state": {"value": "…", "source_page": 1, "confidence": "…"},
    "country": {"value": "US", "confidence": "…"},
    "current_brand": {"value": "…", "confidence": "…"},
    "current_flag": {"value": "…", "confidence": "…"},
    "target_brand": {"value": "…", "confidence": "…"},
    "target_flag": {"value": "…", "confidence": "…"},
    "target_brand_tier": {"value": "luxury|upper_upscale|upscale", "confidence": "…"},
    "property_type": {"value": "full-service|select-service|resort|limited-service|extended-stay|boutique", "confidence": "…"},
    "year_built": {"value": 1999, "confidence": "…"},
    "year_last_renovated": {"value": 2015, "confidence": "…"},
    "keys": {"value": 434, "source_page": 3, "source_excerpt": "…", "confidence": "…"},
    "floors": {"value": 24, "confidence": "…"},
    "total_gsf": {"value": 350000, "confidence": "…"},
    "sprinklered": {"value": true, "confidence": "…"},
    "guestroom_mix": {"value": {"king": 250, "double_queen": 100, "double_double": 50, "junior_suite": 20, "suite_1br": 10, "suite_2br": 4, "signature_suite": 0}, "confidence": "…"},
    "fb_outlets": {"value": [{"name": "Riverside Café", "type": "restaurant"}, {"name": "CHI Bar", "type": "bar"}], "confidence": "…"},
    "meeting_space_json": {"value": {"ballroom_sqft": 0, "breakout_count": 0, "largest_breakout_sqft": 0}, "confidence": "…"}
  }
}
```

Rules:
- Use page numbers as integers, starting from 1 for the first page of the document.
- `source_excerpt` should be a short verbatim quote (under 250 chars) showing where the value came from.
- Set `confidence` to `high` when the document explicitly states the value, `medium` when inferred from adjacent context, `low` when a guess.
- For `target_brand_tier`: Ritz-Carlton / Four Seasons / St. Regis = luxury; Sheraton / Westin / Hilton / Marriott = upper_upscale; Courtyard / Hampton Inn = upscale. If unclear, omit.
- For `guestroom_mix`: use EXACTLY these keys (omit any that are 0 or unknown): `king`, `double_queen`, `double_double`, `junior_suite`, `suite_1br`, `suite_2br`, `signature_suite`. Do NOT use plural keys (`kings`, `doubles`, `suites`) — they will not be recognized. If the document only lists a total "doubles" count without distinguishing double-queen vs. double-double, map it to `double_queen` (the more common layout). If it lists only "suites" generically, map to `junior_suite`.
- OMIT any field you cannot back with evidence. Do not hallucinate.
- If the document is a PIP, some fields (e.g. current_brand, keys) may be on the cover page; look there first.
- Return only the JSON object, nothing else.
