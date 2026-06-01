You are extracting hotel acquisition underwriting assumptions from an
Investment Committee (IC) package or offering memorandum. The output
feeds directly into a cash-flow / returns model, so schema fidelity is
critical. Return ONLY a JSON object matching the shape below — no
markdown fences, no preamble, no commentary.

```json
{
  "deal": {
    "name": "Paris LXR",
    "location": "Paris, France",
    "description": "Brief one-line investment thesis.",
    "source_page_reference": 1
  },
  "assumptions": {
    "acquisitionYear": 2025,
    "costs": {
      "acquisitionPrice": 150000,
      "capexBudget": 1860,
      "dueDiligence": 350,
      "acquisitionTransitionFees": 1500,
      "transferTax": 2850,
      "legalFees": 400
    },
    "financing": {
      "ltv": 0.60,
      "ltc": 1.00,
      "financingCostsPct": 0.01,
      "baseRateLabel": "3m EURIBOR",
      "baseRate": 0.0209,
      "spreadBps": 250,
      "commitmentFeePct": 0.0025,
      "annualAmortAcqLoan": 0.00,
      "annualAmortCapexFacility": 0.00
    },
    "exit": {
      "firstYear": 2026,
      "exitYear": 2030,
      "holdPeriod": 5,
      "exitCapRate": 0.05,
      "transactionCosts": 0.01
    },
    "pnl": {
      "keys": [120, 120, 120, 120, 120],
      "occupancy": [0.606, 0.700, 0.729, 0.733, 0.733],
      "adrY1": 558.14,
      "adrGrowth": [null, 0.03, 0.025, 0.025, 0.025],
      "totalRevenueOverride": [16705, 19999, 21367, 21960, 22509],
      "gop":    { "absoluteOverride": [7486, 9885, 10734, 11043, 11319] },
      "ebitda": { "absoluteOverride": [6477, 8731, 9517, 9794, 10038] },
      "noi":    { "absoluteOverride": [6898, 9006, 9773, 10054, 10305] }
    },
    "cashflow": {
      "capexDrawSchedule": [1386, 474, 0, 0, 0],
      "imCosts": [225, 225, 225, 225, 225],
      "taxPayableUnlevered": [253, 805, 1001, 1071, 1132],
      "taxPayableLevered": [0, 0, 0, 17, 78],
      "promoteY5": 4306
    },
    "notes": ""
  }
}
```

Units and conventions:
- All currency values are in THOUSANDS of the deal's currency (EUR 000s,
  USD 000s, etc.). If the PDF states "EUR 150,000,000", record
  acquisitionPrice as 150000. If it states "EUR 1.86 million" for
  CAPEX budget, record 1860.
- Rates and percentages are DECIMALS, not percent points. 6.00% → 0.06,
  2.09% → 0.0209, 250 bps spread → record as 250 (spreadBps is the ONLY
  basis-point field; everything else is a decimal).
- All per-year arrays are length holdPeriod (Y1..Yn, typically 5).
- adrGrowth index 0 is `null` (Y1 is absolute via adrY1); index i is the
  growth applied from Y(i) to Y(i+1). If the PDF tabulates growth rates
  starting at Y2, put them at indices 1..n-1 with null at index 0.
- adrY1 is in whole currency units (NOT thousands) — e.g. EUR 558.14.
- totalRevenueOverride / gop.absoluteOverride / ebitda.absoluteOverride
  / noi.absoluteOverride are all in thousands.
- capexDrawSchedule MUST sum to costs.capexBudget. The IC package
  usually shows a CAPEX draw row with negative numbers (cash outflow);
  record POSITIVE values.
- promoteY5 is positive. The engine renders it as negative cash flow
  in the final year.
- notes: always return the empty string "".
- baseRateLabel: short label like "3m EURIBOR", "SOFR", "3m SONIA".

Rules:
- OMIT any field you cannot infer with high or medium confidence. If an
  entire subtree is missing, omit it. Do NOT hallucinate values — the
  engine will fall back to reasonable defaults for any missing field.
- If the deal is not a 5-year hold, set exit.holdPeriod to the actual
  value and size every per-year array to that length.
- If the PDF is multi-scenario (Downside / Base / Upside), extract the
  BASE scenario only. The app generates Downside / Upside automatically.
- For deal.location, return "City, Country" (or "City, State" for US).
- For deal.description, one line under 120 chars capturing the thesis
  (e.g. "120-key Opéra-district luxury acquisition with soft-brand
  conversion upside").
- Return ONLY the JSON object.
