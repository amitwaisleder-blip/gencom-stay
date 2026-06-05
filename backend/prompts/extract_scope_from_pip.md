You are extracting a renovation scope from a hotel Property Improvement Plan (PIP).

The user has provided a **list of division names** from their Gencom Excel budget template. **You MUST map every scope item to one of these divisions** (use exact spelling). If an item cannot be cleanly mapped, use division "Uncategorized".

Available divisions: {{DIVISIONS}}

Return ONLY a JSON object matching this shape. No markdown fences, no preamble.

```json
{
  "items": [
    {
      "division": "GUESTROOMS",
      "sub_area": "Guestroom",
      "line_item": "Replace guestroom televisions",
      "description": "Replace all televisions with 55\" minimum. Note: approx. 10% of rooms already have 55\" TVs installed.",
      "quantity": 1,
      "unit": "ls",
      "source_page": 4,
      "source_excerpt": "Replace televisions with new televisions that meet brand minimum size (currently 55\").",
      "priority": "required|recommended|optional",
      "confidence": "high|medium|low"
    }
  ]
}
```

## Sub-area (optional but highly encouraged)

For each item, set `sub_area` to one of the specific spaces below — this groups items within a division for clearer budgets. Use the EXACT spelling. If unclear, omit `sub_area`.

Allowed values per division:

**COMMON AREA** — Porte-cochère · Valet drop-off · Lobby · Elevator lobbies · Elevator cabs · Public restrooms (Lobby) · Fitness center · Yoga / movement studio · Locker rooms · Spa · Game room · Club lounge · Executive lounge · Concierge lounge · Lounge pantry · Gift shop · Sundries shop · Business center · Third-party retail · Ice alcoves / Vending alcoves · Administrative offices · Employee entrance · Employee dining / cafeteria · Employee locker rooms · Uniform room · Receiving / loading dock · Housekeeping · Laundry

**F&B** — Signature restaurant · All-day dining / breakfast room · Specialty restaurant · Rooftop restaurant · Lobby lounge · Bar · Pool bar · Coffee shop · Grab-and-go market

**MEETING SPACE** — Ballroom · Junior ballroom · Breakout meeting rooms · Boardrooms · Exec meeting suites · Pre-function · Exhibit hall · Outdoor event space · Event restroom clusters

**CORRIDORS** — Guestroom Corridor · Elevator Lobby · Service Corridor · BOH Corridor

**GUESTROOMS** — Guestroom Entry · Guestroom · Guestroom Bathroom · Guestroom Closet · Balcony / Terrace

**SUITES / SIGNATURE SUITES** — Suite Entry · Suite · Suite Bathroom · Powder Room · Living Room / Parlor · Dining Area · Kitchenette / Wet Bar · Dressing Room · Balcony / Terrace · Master Bedroom · Master Bathroom

**DEFERRED MAINTENANCE** — Roof · Exterior Envelope · Structural · HVAC · Electrical · Plumbing · Fire & Life Safety · Vertical Transport · Pool & Water Features · Laundry · IT / Low Voltage · Site & Hardscape · Landscape & Irrigation · Parking Garage · Back of House · Guestroom MEP

Rules:
- **COMPLETENESS IS PRIORITY ONE.** Scan the ENTIRE document end-to-end. Every major area that appears in the PIP MUST be represented — exterior, lobby, public restrooms, F&B outlets, meeting spaces, corridors, elevators/vertical transport, guestroom entry, guestroom interior (casegoods/softgoods/finishes), guestroom bath, suites, BOH, MEP/life safety, signage, design admin. Do NOT stop early. If the PIP has 150 requirements, return 150 items — never group or summarize to shorten the response.
- Produce ONE item per distinct scope requirement. Do not collapse multiple distinct requirements into a compound line like "Guestroom renovation including new carpet, drapery, headboards…" — split those into separate items.
- Even if you cannot pull a verbatim quote, include the item. Put a paraphrase (in quotes you wrote yourself is OK) in `source_excerpt` and mark confidence "low". **Better to include an imperfect item than to skip a real one.**
- `line_item` is a short 2-6 word label suitable for a budget line item. `description` is the fuller PIP directive.
- `priority`: PIPs typically mark items as Required, Recommended, or Suggested. If unmarked, infer: "provide", "replace", "install" wording → required; "consider", "review", "align on" → recommended.
- `quantity` and `unit`: leave quantity at 1 and unit at "ls" (lump sum) unless the PIP gives a specific count (e.g., "provide 6 new doors" → quantity 6, unit "each"). For per-key items, use unit "per key".
- `source_excerpt` is a short quote (<250 chars). Prefer verbatim from the PIP; paraphrase only if the passage is too long to quote directly.
- `source_page` is the page the item appears on (1-indexed).
- Map items to divisions based on content:
  - Module GR / Project Administration / Signage → "Uncategorized" or first design-consulting-style division
  - Module 1 (Site & Building Exterior) → usually best mapped to "DEFERRED MAINTENANCE" or "MISC. ITEMS"
  - Module 2 (Lobby, Public Restrooms) → "COMMON AREA"
  - Module 3 (F&B, restaurants, bars) → "F&B"
  - Module 4 (Recreation, Fitness, Pool) → "COMMON AREA" or closest match
  - Module 6 (Meeting Spaces, Ballroom) → "COMMON AREA" or "MEETING SPACE" if in the division list
  - Module 7 (Guestrooms, Bathrooms) → "GUESTROOMS"
  - Guestroom Corridor → "CORRIDORS"
  - Suites → "SUITES"
- **Before finishing, mentally enumerate the divisions you have items for.** If a major module in the PIP (especially Guestrooms or Bathrooms — these are almost always present in a PIP and usually the largest section) is missing from your output, go back and add it. An extraction that has 0 GUESTROOMS items from a brand PIP is almost always a mistake.
- Return only the JSON object.
