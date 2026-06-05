Fast Budget PPTX template drop-zone
===================================

Drop a `.pptx` file named **`fast_budget_template.pptx`** in this directory
and the `POST /api/fast-budget/export-pptx` endpoint will use it as the
basis for the exported deck instead of the built-in fallback generator.

Token replacement
-----------------

Wherever the template contains one of these tokens (double-braced), it will
be substituted with the live budget values on export:

- `{{PROPERTY_NAME}}` · `{{ADDRESS}}` · `{{CITY}}` · `{{STATE_OR_COUNTRY}}`
- `{{BRAND}}` · `{{TIER}}` · `{{PROPERTY_TYPE}}`
- `{{ROOM_COUNT}}` · `{{SUITE_COUNT}}`
- `{{YEAR_BUILT}}` · `{{LAST_RENOVATION}}` · `{{REGION_KEY}}`
- `{{DATE}}` (MM/DD/YY)
- `{{GRAND_LOW}}` · `{{GRAND_MID}}` · `{{GRAND_HIGH}}`
- `{{PER_KEY_LOW}}` · `{{PER_KEY_MID}}` · `{{PER_KEY_HIGH}}`
- `{{HARD_LOW}}` · `{{HARD_MID}}` · `{{HARD_HIGH}}`
- `{{SOFT_LOW}}` · `{{SOFT_MID}}` · `{{SOFT_HIGH}}`
- `{{DEV_FEE_LOW}}` · `{{DEV_FEE_MID}}` · `{{DEV_FEE_HIGH}}`
- `{{DM_SUB_LOW}}` · `{{DM_SUB_MID}}` · `{{DM_SUB_HIGH}}`
- `{{INT_SUB_LOW}}` · `{{INT_SUB_MID}}` · `{{INT_SUB_HIGH}}`
- `{{SCOPE_LOW}}` · `{{SCOPE_MID}}` · `{{SCOPE_HIGH}}`

Put the tokens in any text box, title, or table cell. Run-level formatting
(font, size, color, bold) is preserved on substitution.

When the template is missing the endpoint falls back to a minimal
auto-generated 4-slide deck (cover, estimate summary, hard-cost table,
scope narratives) so the button always returns a usable file.
