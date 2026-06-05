You are consolidating multiple per-document extraction outputs into a single, de-duplicated scope list for a hotel renovation budget.

You will receive:
- One or more per-document extraction JSON objects (from PIP, OM, walk notes, photos)
- The division list from the Gencom template: {{DIVISIONS}}

Return ONE JSON object. No markdown fences, no preamble.

```json
{
  "property_fields": { /* merged property metadata, best single value per field, following extract_property_metadata schema */ },
  "scope_items": [
    {
      "division": "…",
      "line_item": "…",
      "description": "…",
      "quantity": 1,
      "unit": "ls",
      "source": "pip|walk_notes|om",
      "source_document_id": "<document id from input>",
      "source_page": 1,
      "source_excerpt": "…",
      "priority": "required|recommended|optional",
      "confidence": "high|medium|low",
      "notes": "merged from walk + PIP"
    }
  ],
  "warnings": ["any contradictions or ambiguities to surface to the user"]
}
```

Consolidation rules:
1. **Preserve every distinct item.** Your job is to DEDUPE, not to summarize or shorten. If the per-document extractions produced 80 items, your output should have at least 80 minus the true duplicates (probably 75+). Do NOT drop items to fit a "reasonable length." If you have to choose between being thorough and being concise — be thorough.
2. **De-duplicate** scope items only when two items describe the SAME work (e.g., both say "replace guestroom carpet"). Merge those by keeping the PIP's wording and adding the other source to `notes`. Items that touch the same division but different work (e.g., "guestroom carpet" vs "guestroom drapery") are NOT duplicates — keep both.
3. **Resolve priority conflicts** by taking the most stringent (required > recommended > optional).
4. **Property metadata**: prefer OM over PIP, PIP over walk notes. If values conflict, keep the highest-confidence one and add a warning.
5. **Division mapping**: every item must use a division from the provided list or "Uncategorized".
6. **Preserve provenance**: `source_document_id` must come from the input. `source` is one of pip/walk_notes/om.
7. Add warnings for: items you couldn't cleanly assign to a division; conflicting property data; items that appear in >2 documents with inconsistent scope.
8. Return only the JSON object.
