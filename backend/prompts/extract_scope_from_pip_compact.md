You are extracting a renovation scope from a hotel Property Improvement Plan (PIP), using a **COMPACT** budget format.

The user has provided a **list of division names** from their Gencom Excel budget template. **You MUST map every scope item to one of these divisions** (use exact spelling). If an item cannot be cleanly mapped, use division "Uncategorized".

Available divisions: {{DIVISIONS}}

**Compact mode — this is the key difference from the default extraction:**
- Roll related requirements up into a **single area-level line item** per major space.
- Target: **15–30 line items total** across the whole PIP — NOT one per requirement.
- Each line item represents a WHOLE AREA's renovation package (e.g. "Lobby — full renovation", "Guestroom — softgoods + casegoods + finishes", "Guestroom bathroom — full gut").
- The `description` field then lists the sub-requirements that roll up into that line, as a semicolon-separated narrative. That way nothing is lost — it's just consolidated.
- Use `line_item` for the short area label; use `description` to capture the underlying detail.

Return ONLY a JSON object matching this shape. No markdown fences, no preamble.

```json
{
  "items": [
    {
      "division": "COMMON AREA",
      "sub_area": "Lobby",
      "line_item": "Lobby — full renovation",
      "description": "Replace flooring; install new reception desk; replace all lounge furniture; new custom chandelier; repaint walls; refinish columns; new artwork package; upgrade BGM/AV system.",
      "quantity": 1,
      "unit": "ls",
      "source_page": 3,
      "source_excerpt": "Lobby: Module 2.1 — Provide full renovation per brand standards including all finishes, lighting, casegoods, softgoods…",
      "priority": "required",
      "confidence": "high"
    },
    {
      "division": "GUESTROOMS",
      "sub_area": "Guestroom",
      "line_item": "Guestroom — softgoods + casegoods",
      "description": "Replace carpet, drapery, bedscarves, upholstery; replace headboard, desk/chair, dresser, night stands; refresh artwork; replace in-room TV.",
      "quantity": 120,
      "unit": "per key",
      "source_page": 8,
      "priority": "required",
      "confidence": "high"
    }
  ]
}
```

## Sub-area (always set one)

For each item, set `sub_area` to the specific space being renovated. Use EXACT spelling from the list.

**COMMON AREA** — Porte-cochère · Valet drop-off · Lobby · Elevator lobbies · Elevator cabs · Public restrooms (Lobby) · Fitness center · Yoga / movement studio · Locker rooms · Spa · Game room · Club lounge · Executive lounge · Concierge lounge · Lounge pantry · Gift shop · Sundries shop · Business center · Third-party retail · Ice alcoves / Vending alcoves · Administrative offices · Employee entrance · Employee dining / cafeteria · Employee locker rooms · Uniform room · Receiving / loading dock · Housekeeping · Laundry

**F&B** — Signature restaurant · All-day dining / breakfast room · Specialty restaurant · Rooftop restaurant · Lobby lounge · Bar · Pool bar · Coffee shop · Grab-and-go market

**MEETING SPACE** — Ballroom · Junior ballroom · Breakout meeting rooms · Boardrooms · Exec meeting suites · Pre-function · Exhibit hall · Outdoor event space · Event restroom clusters

**CORRIDORS** — Guestroom Corridor · Elevator Lobby · Service Corridor · BOH Corridor

**GUESTROOMS** — Guestroom Entry · Guestroom · Guestroom Bathroom · Guestroom Closet · Balcony / Terrace

**SUITES / SIGNATURE SUITES** — Suite Entry · Suite · Suite Bathroom · Powder Room · Living Room / Parlor · Dining Area · Kitchenette / Wet Bar · Dressing Room · Balcony / Terrace · Master Bedroom · Master Bathroom

**DEFERRED MAINTENANCE** — Roof · Exterior Envelope · Structural · HVAC · Electrical · Plumbing · Fire & Life Safety · Vertical Transport · Pool & Water Features · Laundry · IT / Low Voltage · Site & Hardscape · Landscape & Irrigation · Parking Garage · Back of House · Guestroom MEP

## Rules

- Produce ONE line item per major area in the PIP. Do NOT split a single area (like "Lobby") into multiple specific items. Roll the detail into `description`.
- Still cover every major area the PIP addresses — exterior, lobby, public restrooms, F&B outlets, meeting space, corridors, elevators, guestrooms, guestroom bathrooms, suites, BOH, MEP/life safety, signage, deferred maintenance. Missing an area that's in the PIP is a failure.
- `line_item`: 3–8 word label describing the AREA + the work type (e.g. "Lobby — full renovation", "Guestroom Bathroom — full gut", "Ballroom — softgoods refresh"). Avoid compound narratives here.
- `description`: a semicolon-separated list of the sub-requirements that are being rolled up into this line. This is where the granular PIP detail lives — it gets re-expanded later via "+ Add Scope" if the user wants more granularity.
- `quantity` / `unit`: when the area is per-key (guestrooms, bathrooms, room corridors) use unit "per key" and set quantity to the key count if known, else 1 "ls". For suites / signature suites, use the count if known. For single rooms (lobby, ballroom), use 1 "ls".
- `source_page`: page the PIP first introduces this area (1-indexed).
- `source_excerpt`: short (<250 char) verbatim quote from the PIP's intro/summary for that area.
- `priority`: use "required" unless the PIP explicitly marks an entire area as recommended / optional.
- Return only the JSON object.
