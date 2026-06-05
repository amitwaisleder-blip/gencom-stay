You are extracting a SINGLE BLOCK of hotel acquisition underwriting
assumptions from a source document. The user uploaded this document
specifically to update the **{{block_name}}** section of an existing
deal model. Return ONLY a JSON object matching the shape below — no
markdown fences, no preamble, no commentary.

## Output schema

Return EXACTLY this shape:

```json
{
  "assumptions": {
    "{{block_key}}": { ... }
  }
}
```

Populate ONLY the `{{block_key}}` subtree. Do NOT include any other
keys (no `costs` if the block is `financing`, no `pnl` if the block is
`exit`, etc.). The deal's other assumptions stay as-is and we merge
your extraction in.

## What to fill in

{{block_description}}

## Units and conventions

- All currency values are in THOUSANDS of the deal's currency (EUR
  000s, USD 000s, etc.). "EUR 150,000,000" → 150000.
- Rates and percentages are DECIMALS, not percent points. 6.00% → 0.06,
  2.09% → 0.0209. The ONLY basis-point field is `spreadBps` — record
  "250 bps" as the integer 250.
- All per-year arrays are length holdPeriod (Y1..Yn, typically 5). If
  the existing model is, say, a 7-year hold and the source doc shows
  only 5 years, pad with the last value or omit the array.
- adrGrowth index 0 is `null` (Y1 is absolute via adrY1); index i is
  the growth applied from Y(i) to Y(i+1).
- adrY1 is in whole currency units (NOT thousands).
- override fields (totalRevenueOverride, gop.absoluteOverride, etc.)
  are in thousands.
- capexDrawSchedule values are POSITIVE (cash outflow is implied).
- promoteY5 is positive.

## Rules

- OMIT any field you cannot infer with high or medium confidence. The
  engine will keep the existing model values for any field you omit —
  better to leave a field alone than to overwrite with a guess.
- If the source doc covers material outside the {{block_name}} block,
  IGNORE it. Don't try to "be helpful" by populating other subtrees;
  the user uploaded this specifically to update {{block_name}}.
- Return ONLY the JSON object, no markdown fences.
