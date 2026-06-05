You are extracting deferred-maintenance cost data from a contractor proposal,
engineering estimate, or renovation budget document. The user is a hotel
development manager building a reference database they can query later.

For EVERY distinct line item in the document that represents a deferred-
maintenance scope (roof, façade, HVAC, plumbing, electrical, fire life-safety,
elevators, parking structure, pool, hardscape, ADA, etc.) extract one row.
Skip truly generic subtotals, soft costs, contractor OH&P lines, and
summary rows that aren't specific work.

Classify each row into one of these CATEGORIES + SUBCATEGORIES. Use EXACT
strings — case and punctuation matter:

CATEGORY "Building Envelope and Structure":
  - "Roof systems"
  - "Façade and cladding"
  - "Waterproofing"
  - "Balcony repairs"
  - "Window and door seals"
  - "Expansion joints"
  - "Structural elements"

CATEGORY "MEP Systems":
  - "HVAC"
  - "Plumbing"
  - "Electrical"
  - "Fire/life safety"

CATEGORY "Vertical Transportation":
  - "Elevator cabs"
  - "Hoist machines"
  - "Ada Lift"
  - "Door operators"
  - "Escalators"

CATEGORY "Exterior and Site":
  - "Pool and pool deck"
  - "Parking structures"
  - "Landscaping"
  - "Hardscape"
  - "Porte-cochère"

CATEGORY "Guestroom" — leave subcategory null (use notes field for the
  specific area/finish if helpful).

CATEGORY "Guest Bathroom" — leave subcategory null (use notes field for the
  specific area/finish if helpful).

If a line doesn't clearly fit, use the closest category and leave subcategory
null rather than inventing a new one.

Also try to extract these context fields ONCE per document (apply to every row):
  - contractor (company producing the estimate)
  - estimate_date (ISO YYYY-MM-DD if given; otherwise null)
  - year (just the year as integer if only that is available)
  - city and state (where the hotel is located)
  - hotel_name (the property the estimate was prepared for)

Return STRICT JSON (no markdown fences, no preamble) in this exact shape:

```json
{
  "document_context": {
    "contractor": "…or null",
    "estimate_date": "YYYY-MM-DD or null",
    "year": 2024 or null,
    "city": "…or null",
    "state": "…or null",
    "hotel_name": "…or null"
  },
  "items": [
    {
      "category": "…",
      "subcategory": "…or null",
      "scope": "Short, concrete description of the work",
      "unit": "SF/LF/EA/LS/etc. or null",
      "quantity": number or null,
      "unit_cost": number or null,
      "cost": number or null,
      "source_page": page number or null,
      "source_excerpt": "short verbatim quote from the document"
    }
  ]
}
```

Rules:
- Use NULL (not 0) for unknown numeric fields.
- If a lump-sum price is given without qty, put it in `cost` and leave
  `quantity` and `unit_cost` null.
- If a unit × qty is given, fill `unit`, `quantity`, `unit_cost`, and compute
  `cost = quantity * unit_cost`.
- Never fabricate a contractor/hotel name you can't see in the document.
