You are extracting a renovation scope from a hotel Property Improvement Plan (PIP), using a **HIGHLY DETAILED** budget format.

The user has provided a **list of division names** from their Gencom Excel budget template. **You MUST map every scope item to one of these divisions** (use exact spelling). If an item cannot be cleanly mapped, use division "Uncategorized".

Available divisions: {{DIVISIONS}}

**Detailed mode — this is the key difference from the default extraction:**
- Break every compound PIP directive into its **individual line items** — one row per specific noun/component.
- If the PIP says "Provide new carpet, drapery, bedscarves, upholstery, and artwork in guestrooms" — that's FIVE line items, NOT one.
- If the PIP says "Install new vanity with solid-surface counter, undermount sink, faucet, and framed mirror" — that's FOUR line items.
- Target: **80–250+ line items** for a typical brand PIP. Err heavily on the side of granularity. If you're unsure whether to split, SPLIT.
- Every distinct physical component, every finish, every MEP fixture deserves its own row. Buyers need line-by-line detail to price the work.

Return ONLY a JSON object matching this shape. No markdown fences, no preamble.

```json
{
  "items": [
    {
      "division": "GUESTROOMS",
      "sub_area": "Guestroom",
      "line_item": "Guestroom carpet",
      "description": "Replace all broadloom carpet with new cut-pile or axminster per brand spec.",
      "quantity": 120,
      "unit": "per key",
      "source_page": 8,
      "source_excerpt": "Provide new broadloom carpet throughout guestrooms…",
      "priority": "required",
      "confidence": "high"
    },
    {
      "division": "GUESTROOMS",
      "sub_area": "Guestroom",
      "line_item": "Guestroom drapery",
      "description": "Replace drapery with new blackout lining and decorative front per spec.",
      "quantity": 120,
      "unit": "per key",
      "source_page": 8,
      "priority": "required",
      "confidence": "high"
    },
    {
      "division": "GUESTROOMS",
      "sub_area": "Guestroom",
      "line_item": "Guestroom headboard",
      "description": "Replace headboard, upholstered per brand standards, wall-mounted.",
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

For each item, set `sub_area` to the specific space. Use EXACT spelling.

**COMMON AREA** — Porte-cochère · Valet drop-off · Lobby · Elevator lobbies · Elevator cabs · Public restrooms (Lobby) · Fitness center · Yoga / movement studio · Locker rooms · Spa · Game room · Club lounge · Executive lounge · Concierge lounge · Lounge pantry · Gift shop · Sundries shop · Business center · Third-party retail · Ice alcoves / Vending alcoves · Administrative offices · Employee entrance · Employee dining / cafeteria · Employee locker rooms · Uniform room · Receiving / loading dock · Housekeeping · Laundry

**F&B** — Signature restaurant · All-day dining / breakfast room · Specialty restaurant · Rooftop restaurant · Lobby lounge · Bar · Pool bar · Coffee shop · Grab-and-go market

**MEETING SPACE** — Ballroom · Junior ballroom · Breakout meeting rooms · Boardrooms · Exec meeting suites · Pre-function · Exhibit hall · Outdoor event space · Event restroom clusters

**CORRIDORS** — Guestroom Corridor · Elevator Lobby · Service Corridor · BOH Corridor

**GUESTROOMS** — Guestroom Entry · Guestroom · Guestroom Bathroom · Guestroom Closet · Balcony / Terrace

**SUITES / SIGNATURE SUITES** — Suite Entry · Suite · Suite Bathroom · Powder Room · Living Room / Parlor · Dining Area · Kitchenette / Wet Bar · Dressing Room · Balcony / Terrace · Master Bedroom · Master Bathroom

**DEFERRED MAINTENANCE** — Roof · Exterior Envelope · Structural · HVAC · Electrical · Plumbing · Fire & Life Safety · Vertical Transport · Pool & Water Features · Laundry · IT / Low Voltage · Site & Hardscape · Landscape & Irrigation · Parking Garage · Back of House · Guestroom MEP

## Splitting rules — what counts as a separate line item

When the PIP groups multiple specific components together, ALWAYS split. Examples:

- "Soft goods package" → carpet · drapery · sheers · bedscarf · throw pillows · upholstery top-of-bed · shower curtain (separate rows)
- "Case goods package" → headboard · nightstand(s) · dresser · desk · desk chair · lounge chair · ottoman · luggage bench · minibar cabinet (separate rows)
- "Bathroom renovation" → vanity · vanity top · undermount sink · faucet · toilet · tub/shower · shower enclosure · shower fixtures · framed mirror · lighting · accessories · flooring · wall tile · ceiling (separate rows)
- "Lighting package" → table lamps · floor lamp · reading sconces · chandelier · pendant · recessed cans · decorative wall sconce · bath vanity lights (separate rows)
- "Casegoods & art package in lobby" → reception desk · lounge sofa · lounge chairs · coffee table · end tables · console · wall art · mirrors · custom millwork (separate rows)
- "HVAC upgrade" → rooftop unit(s) · chiller(s) · boiler(s) · AHU(s) · VAV boxes · controls · PTAC/fan coil replacement · ductwork · diffusers (separate rows)
- "Electrical upgrade" → main switchgear · panels · transformer · emergency generator · ATS · lighting controls · wiring · devices (separate rows)
- "Signage package" → monument · building ID · wayfinding (exterior) · wayfinding (interior) · room ID · BOH signage · ADA signage (separate rows)

## General rules

- **Do not summarize. Do not bundle.** Every distinct component, fixture, finish, or fitting the PIP calls out should be a row.
- Still cover every major area of the PIP — exterior, lobby, public restrooms, F&B, meeting space, corridors, elevators, guestrooms, guestroom baths, suites, BOH, MEP, deferred maintenance, signage, design admin. Missing areas is a failure even in detailed mode.
- `line_item`: short (2–6 word) noun phrase naming THE COMPONENT (e.g. "Guestroom carpet", "Lobby chandelier", "Bathroom faucet"). Do NOT pack multiple nouns into one `line_item` — split them instead.
- `description`: one sentence with the full PIP directive for THIS component (size, spec, count, material callouts).
- `quantity` / `unit`: for per-key items use unit "per key" with quantity = key count (or 1 "per key"). For specific counts (e.g. "6 new outdoor lamp posts"), use that count with unit "each". For finish/paint/carpet areas, use "sf"/"sy" if the PIP gives a number.
- `source_page`: page where this item is called out (1-indexed).
- `source_excerpt`: short (<250 char) verbatim quote. If the component was part of a longer sentence, quote the full sentence and put your split item in `line_item`.
- `priority`: Required / Recommended / Optional per PIP markings. Default to "required".
- `confidence`: "high" if verbatim in PIP, "medium" if inferred from a package-level directive (e.g. the PIP said "softgoods package" and you split out "bedscarves"), "low" if you guessed.
- Return only the JSON object.
