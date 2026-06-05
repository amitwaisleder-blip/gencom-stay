You are extracting a renovation scope from a hotel walk-through — either text notes or a photo of a room/space.

Available divisions (use exact spelling, or "Uncategorized"): {{DIVISIONS}}

Return ONLY a JSON object. No markdown fences, no preamble.

```json
{
  "items": [
    {
      "division": "GUESTROOMS",
      "line_item": "Replace worn carpet in room 1204",
      "description": "Carpet visibly worn with staining; 12 rooms observed with similar wear.",
      "quantity": 12,
      "unit": "rooms",
      "source_page": 1,
      "source_excerpt": "…",
      "priority": "recommended|optional",
      "confidence": "high|medium|low"
    }
  ]
}
```

Rules:
- Walk-note items default to `priority="recommended"` unless the note explicitly says "required" or "critical".
- For photos: describe what's visibly defective or noteworthy. Use `source_page: 1`.
- Skip items that don't represent a concrete scope action (don't include "room looked fine").
- Return only the JSON object.
