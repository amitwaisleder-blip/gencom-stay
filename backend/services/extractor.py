"""Extraction orchestrator — spec §5.

Two-phase:
  1. Per-document extraction (one Claude call per document)
  2. Consolidation (one Claude call that merges + de-dupes)

Property fields are written to the Property row (with `field_provenance`).
Scope items are created in ScopeItem with source, source_page, source_excerpt.
Cost matching runs on each new item after insertion.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from config import UPLOADS_DIR
from models.entities import Document, Property, ScopeItem
from services import claude_client, template_ingest
from services.claude_client import ClaudeError, load_prompt, pdf_block, image_block, text_block
from services.cost_engine import apply_match_to_scope_item


logger = logging.getLogger(__name__)


WRITABLE_PROPERTY_FIELDS = {
    "name", "address", "city", "state", "country",
    "current_brand", "current_flag", "target_brand", "target_flag", "target_brand_tier",
    "property_type", "year_built", "year_last_renovated", "keys",
    "floors", "total_gsf", "sprinklered",
    "guestroom_mix", "fb_outlets", "meeting_space_json",
}


# Canonical guestroom_mix keys the frontend catalog understands.
_GUESTROOM_MIX_KEYS = {
    "king", "double_queen", "double_double",
    "junior_suite", "suite_1br", "suite_2br", "signature_suite",
}


def _normalize_guestroom_mix(val: Any) -> dict | None:
    """Map legacy / loose Claude output to the canonical guestroom_mix schema
    used by the frontend catalog. Returns None if the input isn't a dict."""
    if not isinstance(val, dict):
        return None
    out: dict[str, int] = {}
    # Carry through any already-canonical keys.
    for k in _GUESTROOM_MIX_KEYS:
        if k in val and isinstance(val[k], (int, float)):
            out[k] = int(val[k])
    # Map legacy plural keys — lossy fallback. `doubles` → double_queen (more
    # common layout); `suites` → junior_suite (catalog's default).
    legacy_map = {
        "kings": "king",
        "doubles": "double_queen",
        "double": "double_queen",
        "queens": "double_queen",
        "suites": "junior_suite",
        "suite": "junior_suite",
    }
    for legacy_key, canonical_key in legacy_map.items():
        if legacy_key in val and canonical_key not in out:
            v = val[legacy_key]
            if isinstance(v, (int, float)):
                out[canonical_key] = int(v)
    return out or None


def _doc_content_blocks(doc: Document) -> list[dict]:
    p = UPLOADS_DIR.parent.parent / doc.file_path if not Path(doc.file_path).is_absolute() else Path(doc.file_path)
    # doc.file_path is stored as absolute already by documents.py
    if not p.exists():
        p = Path(doc.file_path)
    ext = p.suffix.lower()
    if ext == ".pdf":
        return [pdf_block(p)]
    if ext in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
        return [image_block(p)]
    if ext in (".txt", ".md"):
        return [text_block(p.read_text(encoding="utf-8", errors="replace"))]
    if ext == ".docx":
        try:
            return [text_block(_extract_docx_text(p))]
        except Exception as e:
            logger.exception("docx extraction failed for %s", p)
            return [text_block(f"[Could not read docx file: {p.name}: {e}]")]
    return [text_block(f"[Unsupported file type: {p.name}]")]


def _extract_docx_text(path: Path) -> str:
    """Extract text from a .docx file PRESERVING document order and table
    structure. Prior implementation flattened every <w:p> into a single stream
    which destroyed row/column context — critical for PIP task-breakdown docs
    that are heavily tabular. Scope sections with their task tables were
    effectively unreadable.

    This walks the body's top-level elements in order:
      - <w:p> paragraphs emit their concatenated text (one line).
      - <w:tbl> tables emit a markdown-style table (cells joined by " | ",
        rows by newline), flanked by blank lines.
    Headings keep their text; we annotate them with a trailing marker so
    Claude can tell them apart from body paragraphs.
    """
    import zipfile
    import xml.etree.ElementTree as ET

    W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    W = "{" + W_NS + "}"

    with zipfile.ZipFile(path) as z:
        with z.open("word/document.xml") as f:
            tree = ET.parse(f)

    root = tree.getroot()
    body = root.find(W + "body")
    if body is None:
        return ""

    def para_text(p: ET.Element) -> str:
        parts: list[str] = []
        for t in p.iter(W + "t"):
            parts.append(t.text or "")
        # Replace w:tab with "  " and w:br with " " for readability.
        # (They're siblings of <w:t> inside <w:r>; the .iter above misses them.)
        text = "".join(parts).strip()
        return text

    def para_style(p: ET.Element) -> str | None:
        pPr = p.find(W + "pPr")
        if pPr is None:
            return None
        style = pPr.find(W + "pStyle")
        if style is None:
            return None
        return style.get(W + "val")

    def cell_text(tc: ET.Element) -> str:
        lines: list[str] = []
        for p in tc.findall(W + "p"):
            t = para_text(p)
            if t:
                lines.append(t)
        # Single cell → join paragraphs with " / " to keep on one row.
        return " / ".join(lines)

    def render_table(tbl: ET.Element) -> str:
        lines: list[str] = []
        for tr in tbl.findall(W + "tr"):
            cells = [cell_text(tc) for tc in tr.findall(W + "tc")]
            # Drop entirely-empty rows.
            if any(c.strip() for c in cells):
                lines.append(" | ".join(cells))
        if not lines:
            return ""
        return "\n".join(lines)

    out: list[str] = []
    for el in body:
        tag = el.tag
        if tag == W + "p":
            text = para_text(el)
            if not text:
                out.append("")  # preserve blank lines for paragraph breaks
                continue
            style = para_style(el) or ""
            style_low = style.lower()
            if style_low.startswith("heading") or "title" in style_low:
                out.append("")
                out.append(f"## {text}")
                out.append("")
            else:
                out.append(text)
        elif tag == W + "tbl":
            table = render_table(el)
            if table:
                out.append("")
                out.append(table)
                out.append("")
        elif tag == W + "sectPr":
            continue
        else:
            # Any other block: fall back to concatenated text content.
            fallback = "".join(t.text or "" for t in el.iter(W + "t")).strip()
            if fallback:
                out.append(fallback)

    # Collapse 3+ blank lines to 2 for a cleaner read.
    text = "\n".join(out)
    while "\n\n\n\n" in text:
        text = text.replace("\n\n\n\n", "\n\n\n")
    return text.strip()


def extract_one_document(
    db: Session,
    document: Document,
    divisions: list[str],
    granularity: str = "standard",
) -> dict:
    """Run both metadata + scope extraction against a single document.
    Returns combined JSON.

    `granularity` controls which scope-extraction prompt variant is used
    for PIP documents:
      * "compact"   — roll up into ~15–30 area-level line items
      * "standard"  — the default extraction (one item per requirement)
      * "detailed"  — split every compound directive into individual
                      components (80–250+ rows)
    """
    content = _doc_content_blocks(document)

    out: dict[str, Any] = {"document_id": document.id, "document_type": document.document_type}

    if document.document_type in ("om", "pip"):
        meta_prompt = load_prompt("extract_property_metadata")
        try:
            out["property"] = claude_client.complete_json(
                system=meta_prompt,
                user_content=[text_block("Extract property metadata from the attached document."), *content],
                max_tokens=32000,
            )
        except ClaudeError as e:
            out["property_error"] = str(e)

    if document.document_type in ("pip", "walk_notes", "walk_photo", "brochure"):
        if document.document_type == "pip":
            scope_prompt_name = {
                "compact":  "extract_scope_from_pip_compact",
                "detailed": "extract_scope_from_pip_detailed",
            }.get(granularity, "extract_scope_from_pip")
        else:
            scope_prompt_name = "extract_scope_from_walk_notes"
        scope_prompt = load_prompt(scope_prompt_name, {"DIVISIONS": ", ".join(divisions)})
        try:
            out["scope"] = claude_client.complete_json(
                system=scope_prompt,
                user_content=[text_block(f"Extract scope items. This document is a {document.document_type}."), *content],
                max_tokens=32000,
            )
        except ClaudeError as e:
            out["scope_error"] = str(e)

    return out


def consolidate(db: Session, per_doc_outputs: list[dict], divisions: list[str]) -> dict:
    """Second-phase merge across all per-doc outputs."""
    prompt = load_prompt("consolidate_extraction", {"DIVISIONS": ", ".join(divisions)})
    summary_blocks = [text_block(
        "Below are the per-document extraction JSON objects. "
        "Consolidate them per the system prompt rules."
    )]
    for out in per_doc_outputs:
        summary_blocks.append(text_block(
            f"\n---\nDocument: id={out['document_id']}, type={out['document_type']}\n"
            f"{_stringify(out)}"
        ))
    return claude_client.complete_json(
        system=prompt,
        user_content=summary_blocks,
        max_tokens=32000,
    )


def _stringify(obj: Any) -> str:
    import json as _j
    try:
        return _j.dumps(obj, ensure_ascii=False, indent=2)[:20000]
    except Exception:
        return str(obj)[:20000]


def _apply_property_fields(prop: Property, fields: dict, source_document_id: str | None) -> list[str]:
    """Write consolidated property fields to the Property row, updating field_provenance.
    Returns list of field names that were updated.
    """
    updated: list[str] = []
    provenance = dict(prop.field_provenance or {})
    for key, entry in (fields or {}).items():
        if key not in WRITABLE_PROPERTY_FIELDS:
            continue
        if entry is None:
            continue
        # entry may be {value, source_page, source_excerpt, confidence} or a raw value.
        if isinstance(entry, dict) and "value" in entry:
            val = entry.get("value")
            meta = {
                "source": "om" if source_document_id else "ai",
                "source_document_id": entry.get("source_document_id") or source_document_id,
                "source_page": entry.get("source_page"),
                "source_excerpt": entry.get("source_excerpt"),
                "confidence": entry.get("confidence", "medium"),
                "ai_extracted": True,
                "edited_by_user": False,
            }
        else:
            val = entry
            meta = {"source": "ai", "ai_extracted": True, "edited_by_user": False, "confidence": "medium"}
        # Don't overwrite a user-edited field.
        existing = provenance.get(key)
        if existing and existing.get("edited_by_user"):
            continue
        if key == "guestroom_mix":
            normalized = _normalize_guestroom_mix(val)
            if normalized is None:
                continue
            val = normalized
        setattr(prop, key, val)
        provenance[key] = meta
        updated.append(key)
    prop.field_provenance = provenance
    return updated


def _apply_scope_items(
    db: Session, property_: Property, scope_items: list[dict], documents: list[Document],
) -> tuple[int, list[str]]:
    """Create ScopeItem rows from the consolidated list. Returns (count, warnings)."""
    warnings: list[str] = []
    created = 0
    doc_by_id = {d.id: d for d in documents}
    # Normalize guestroom / corridor quantities against the setup page data so
    # qty reflects actual key or floor counts, not whatever Claude guessed.
    scope_items = _normalize_guestroom_and_corridor_qty(property_, scope_items or [])
    for raw in scope_items or []:
        try:
            division = raw.get("division") or "Uncategorized"
            line_item = (raw.get("line_item") or "").strip()
            if not line_item:
                warnings.append("Skipped scope item with empty line_item")
                continue
            source = raw.get("source") or "pip"
            source_doc_id = raw.get("source_document_id")
            if source_doc_id and source_doc_id not in doc_by_id:
                # ID came back from Claude but doesn't match any provided doc — drop it.
                source_doc_id = None

            basis = raw.get("multiplier_basis")
            if basis not in ("keys", "floors", "keys_pct", "doubles", "suites"):
                basis = None
            item = ScopeItem(
                property_id=property_.id,
                division=division,
                sub_area=(raw.get("sub_area") or None),
                line_item=line_item[:200],
                description=(raw.get("description") or "")[:2000] or None,
                quantity=float(raw.get("quantity") or 1),
                unit=(raw.get("unit") or "ls")[:20],
                multiplier_basis=basis,
                source=source if source in ("pip", "walk_notes", "om", "manual") else "pip",
                source_document_id=source_doc_id,
                source_page=raw.get("source_page"),
                source_excerpt=(raw.get("source_excerpt") or "")[:1000] or None,
                priority=raw.get("priority") if raw.get("priority") in ("required", "recommended", "optional", "na") else "na",
                confidence=raw.get("confidence") if raw.get("confidence") in ("high", "medium", "low") else "medium",
                notes=raw.get("notes"),
                included_in_budget=True,
            )
            # Auto-populate a cost from the DB. Only `high` confidence matches
            # (exact name hit in the target tier) actually propagate — fuzzy /
            # cross-tier / no-match items stay uncosted so the user sees the
            # gap instead of adopting a noisy estimate. Runs BEFORE insert so
            # the item has its cost on first render.
            match = apply_match_to_scope_item(db, item, property_.target_brand_tier)
            if match.confidence != "high":
                # Roll back the low-confidence match — leave uncosted.
                item.suggested_unit_cost = None
                item.cost_db_item_id = None
            db.add(item)
            db.flush()
            _auto_assign_scenarios(db, property_.id, item)
            created += 1
        except Exception as e:
            warnings.append(f"Failed to create scope item {raw.get('line_item', '?')}: {e}")
    return created, warnings


def _auto_assign_scenarios(db: Session, property_id: str, item: ScopeItem):
    # Mirror of api/scope.py logic, kept here so extraction doesn't depend on the API layer.
    from models.entities import Scenario
    from sqlalchemy import select
    scenarios = db.execute(select(Scenario).where(Scenario.property_id == property_id)).scalars().all()
    for s in scenarios:
        f = s.auto_filter
        include = True
        if f and "priority_in" in f:
            include = item.priority in f["priority_in"]
        if f is None:
            include = item.included_in_budget
        if include and item not in s.scope_items:
            s.scope_items.append(item)


def run_extraction_for_document(db: Session, property_id: str, document_id: str) -> dict:
    """Re-run extraction for a single document. Soft-deletes any active
    AI-extracted scope items from this document first so retries don't
    create duplicates. Applies results directly (no consolidation).
    """
    t0 = time.time()
    prop = db.get(Property, property_id)
    if not prop:
        raise ValueError(f"Property {property_id} not found")
    doc = next((d for d in prop.documents if d.id == document_id), None)
    if not doc:
        raise ValueError(f"Document {document_id} not found on property {property_id}")

    divisions = template_ingest.list_divisions() or []

    # Soft-delete prior AI-extracted scope items from this document.
    prior = [
        s for s in prop.scope_items
        if s.source_document_id == doc.id and not s.deleted and s.source != "manual"
    ]
    for s in prior:
        s.deleted = True

    doc.extraction_status = "running"
    db.commit()

    warnings: list[str] = []
    out: dict[str, Any]
    try:
        out = extract_one_document(db, doc, divisions)
    except ClaudeError as e:
        doc.extraction_status = "failed"
        doc.extraction_error = str(e)
        doc.extraction_ran_at = datetime.now(timezone.utc)
        db.commit()
        return {
            "documents_processed": 0,
            "property_fields_updated": [],
            "scope_items_created": 0,
            "scope_items_soft_deleted": len(prior),
            "warnings": [f"{doc.filename}: {e}"],
            "duration_seconds": round(time.time() - t0, 2),
        }

    has_output = "property" in out or "scope" in out
    if has_output:
        doc.extraction_status = "complete"
        doc.extraction_error = None
    else:
        doc.extraction_status = "failed"
        doc.extraction_error = out.get("property_error") or out.get("scope_error") or "No output from Claude"
        warnings.append(f"{doc.filename}: {doc.extraction_error}")
    doc.extraction_ran_at = datetime.now(timezone.utc)

    # Build a mini "consolidated" shape straight from the per-doc output,
    # matching the fallback in run_extraction().
    property_fields = (out.get("property", {}) or {}).get("fields") or {}
    scope_items: list[dict] = []
    for item in (out.get("scope", {}) or {}).get("items") or []:
        item.setdefault("source_document_id", doc.id)
        item.setdefault("source", doc.document_type if doc.document_type in ("pip", "walk_notes", "om") else "pip")
        scope_items.append(item)

    updated_fields = _apply_property_fields(prop, property_fields, source_document_id=doc.id)
    created_count, item_warnings = _apply_scope_items(db, prop, scope_items, [doc])
    warnings.extend(item_warnings)

    db.commit()

    return {
        "documents_processed": 1 if has_output else 0,
        "property_fields_updated": updated_fields,
        "scope_items_created": created_count,
        "scope_items_soft_deleted": len(prior),
        "warnings": warnings,
        "duration_seconds": round(time.time() - t0, 2),
    }


def run_extraction_preview(
    db: Session,
    property_id: str,
    granularity: str = "standard",
) -> dict:
    """Run extraction but DO NOT commit scope items to the DB. Property fields
    are applied (they're uncontroversial), but scope suggestions are returned
    as a list so the user can review, edit, and approve them before import.

    `granularity` — "compact" | "standard" | "detailed" — controls the prompt
    used for PIP scope extraction. See extract_one_document for details.

    Returns: {
      documents_processed, property_fields_updated, scope_suggestions, warnings, duration_seconds
    }
    """
    t0 = time.time()
    prop = db.get(Property, property_id)
    if not prop:
        raise ValueError(f"Property {property_id} not found")
    documents = [d for d in prop.documents if d.document_type != "walk_photo" or d.extraction_status != "failed"]
    if not documents:
        raise ValueError("No documents to extract from")

    divisions = template_ingest.list_divisions() or []

    for d in documents:
        d.extraction_status = "running"
    db.commit()

    per_doc: list[dict] = []
    warnings: list[str] = []
    doc_labels: dict[str, str] = {d.id: d.filename for d in documents}
    for d in documents:
        try:
            out = extract_one_document(db, d, divisions, granularity=granularity)
            per_doc.append(out)
            has_output = "property" in out or "scope" in out
            if has_output:
                d.extraction_status = "complete"
                d.extraction_error = None
            else:
                d.extraction_status = "failed"
                d.extraction_error = out.get("property_error") or out.get("scope_error") or "No output from Claude"
                warnings.append(f"{d.filename}: {d.extraction_error}")
            d.extraction_ran_at = datetime.now(timezone.utc)
        except ClaudeError as e:
            d.extraction_status = "failed"
            d.extraction_error = str(e)
            warnings.append(f"{d.filename}: {e}")
        db.commit()

    # Phase 2: consolidate (only when there are 2+ docs to merge).
    # For single-doc cases, the consolidation step was shown to drop 70%+ of
    # items — Claude "consolidates" aggressively even when told not to.
    # Passing through per-doc output directly preserves every extracted item.
    consolidated = _merge_per_doc_outputs(per_doc)
    if len(per_doc) >= 2:
        try:
            claude_consolidated = consolidate(db, per_doc, divisions)
            # Only use Claude's output if it didn't drop a material number of
            # items; otherwise fall back to the raw merge.
            claude_items = claude_consolidated.get("scope_items") or []
            if len(claude_items) >= 0.8 * len(consolidated["scope_items"]):
                consolidated = claude_consolidated
            else:
                warnings.append(
                    f"Consolidation returned {len(claude_items)} items from {len(consolidated['scope_items'])} "
                    f"— using raw per-doc output instead to avoid losing items."
                )
        except ClaudeError as e:
            warnings.append(f"Consolidation failed: {e} — using raw per-doc output.")

    warnings.extend(consolidated.get("warnings") or [])

    # Apply property fields (uncontroversial).
    updated_fields = _apply_property_fields(
        prop, consolidated.get("property_fields") or {}, source_document_id=None
    )
    db.commit()

    # Enrich suggestions with the source filename for display.
    suggestions = []
    for s in consolidated.get("scope_items") or []:
        enriched = dict(s)
        sdid = s.get("source_document_id")
        if sdid and sdid in doc_labels:
            enriched["source_document_filename"] = doc_labels[sdid]
        suggestions.append(enriched)

    return {
        "documents_processed": len(per_doc),
        "property_fields_updated": updated_fields,
        "scope_suggestions": suggestions,
        "warnings": warnings,
        "duration_seconds": round(time.time() - t0, 2),
    }


def _merge_per_doc_outputs(per_doc: list[dict]) -> dict:
    """Concatenate scope items from every per-doc extraction and merge property
    fields (first-wins). Preserves every extracted item — no AI summarization.
    Used as the default unless there are 2+ docs that actually benefit from
    Claude-side dedup."""
    out: dict = {"property_fields": {}, "scope_items": [], "warnings": []}
    for p in per_doc:
        fields = (p.get("property", {}) or {}).get("fields") or {}
        for k, v in fields.items():
            out["property_fields"].setdefault(k, v)
        for item in (p.get("scope", {}) or {}).get("items") or []:
            item.setdefault("source_document_id", p["document_id"])
            item.setdefault("source", p["document_type"] if p["document_type"] in ("pip", "walk_notes", "om") else "pip")
            out["scope_items"].append(item)
    return out


def import_scope_batch(db: Session, property_id: str, items: list[dict]) -> dict:
    """Create a batch of scope items from reviewed/approved suggestions.
    Shape matches what run_extraction_preview returns (plus any edits)."""
    prop = db.get(Property, property_id)
    if not prop:
        raise ValueError(f"Property {property_id} not found")
    documents = list(prop.documents)
    created, warnings = _apply_scope_items(db, prop, items, documents)
    db.commit()
    return {
        "scope_items_created": created,
        "warnings": warnings,
    }


def run_extraction(db: Session, property_id: str) -> dict:
    """Run full two-phase extraction for a property. Returns a result summary."""
    t0 = time.time()
    prop = db.get(Property, property_id)
    if not prop:
        raise ValueError(f"Property {property_id} not found")
    documents = [d for d in prop.documents if d.document_type != "walk_photo" or d.extraction_status != "failed"]
    if not documents:
        raise ValueError("No documents to extract from")

    divisions = template_ingest.list_divisions() or []

    # Mark documents as running.
    for d in documents:
        d.extraction_status = "running"
    db.commit()

    per_doc: list[dict] = []
    warnings: list[str] = []
    for d in documents:
        try:
            out = extract_one_document(db, d, divisions)
            per_doc.append(out)
            # A document is "complete" only if we got at least one structured output.
            has_output = "property" in out or "scope" in out
            if has_output:
                d.extraction_status = "complete"
                d.extraction_error = None
            else:
                d.extraction_status = "failed"
                d.extraction_error = out.get("property_error") or out.get("scope_error") or "No output from Claude"
                warnings.append(f"{d.filename}: {d.extraction_error}")
            d.extraction_ran_at = datetime.now(timezone.utc)
        except ClaudeError as e:
            d.extraction_status = "failed"
            d.extraction_error = str(e)
            warnings.append(f"{d.filename}: {e}")
        db.commit()

    # Phase 2: consolidate (only when there are 2+ docs to merge).
    consolidated = _merge_per_doc_outputs(per_doc)
    if len(per_doc) >= 2:
        try:
            claude_consolidated = consolidate(db, per_doc, divisions)
            claude_items = claude_consolidated.get("scope_items") or []
            if len(claude_items) >= 0.8 * len(consolidated["scope_items"]):
                consolidated = claude_consolidated
            else:
                warnings.append(
                    f"Consolidation returned {len(claude_items)} items from {len(consolidated['scope_items'])} "
                    f"— using raw per-doc output instead to avoid losing items."
                )
        except ClaudeError as e:
            warnings.append(f"Consolidation failed: {e} — using raw per-doc output.")

    warnings.extend(consolidated.get("warnings") or [])

    # Apply to DB.
    updated_fields = _apply_property_fields(
        prop, consolidated.get("property_fields") or {}, source_document_id=None
    )
    created_count, item_warnings = _apply_scope_items(db, prop, consolidated.get("scope_items") or [], documents)
    warnings.extend(item_warnings)

    db.commit()

    return {
        "documents_processed": len(per_doc),
        "property_fields_updated": updated_fields,
        "scope_items_created": created_count,
        "warnings": warnings,
        "duration_seconds": round(time.time() - t0, 2),
    }


# ----------------------------------------------------------------------
# Guestroom + corridor quantity normalization
# ----------------------------------------------------------------------
# Anchors scope-item quantities to the structural data the user entered on
# Setup (room count, guestroom mix, floor count) rather than trusting
# whatever Claude guessed while reading the PIP. Rules per user feedback:
#
#   * Guestroom items default to `multiplier_basis="keys"` with qty=1 so the
#     line scales by total room count. If the guestroom mix has suite,
#     king, or queen/double counts, items whose text is clearly
#     suite/king/queen-specific switch to the matching per-room-type basis.
#   * Corridor items default to `multiplier_basis="floors"` with qty=1 so
#     the line scales by floor count.
#
# Runs just before DB insert in `_apply_scope_items` so both the full
# extraction flow AND bulk imports get the same treatment.
# ----------------------------------------------------------------------
def _normalize_guestroom_and_corridor_qty(
    property_: Property, items: list[dict],
) -> list[dict]:
    mix = property_.guestroom_mix or {}
    has_suites = sum((mix.get(k) or 0) for k in (
        "junior_suite", "suite_1br", "suite_2br", "signature_suite",
    )) > 0
    has_kings = (mix.get("king") or 0) > 0
    has_queens = ((mix.get("double_queen") or 0) + (mix.get("double_double") or 0)) > 0
    floors = property_.floors or 0

    out: list[dict] = []
    for raw in items:
        division = (raw.get("division") or "").upper().strip()
        label = (raw.get("line_item") or "").lower()
        desc = (raw.get("description") or "").lower()
        text = f"{label} {desc}"
        patched = dict(raw)

        if division == "GUESTROOMS":
            basis, unit = _pick_guestroom_basis(text, has_suites, has_kings, has_queens)
            patched["multiplier_basis"] = basis
            patched["unit"] = unit
            patched["quantity"] = 1
        elif division == "SUITES":
            # Suite division mirrors guestroom logic but prefers the suites
            # basis when the mix has suite counts.
            if has_suites:
                patched["multiplier_basis"] = "suites"
                patched["unit"] = "per suite"
            else:
                patched["multiplier_basis"] = "keys"
                patched["unit"] = "per key"
            patched["quantity"] = 1
        elif division == "CORRIDORS":
            patched["multiplier_basis"] = "floors"
            patched["unit"] = "per floor"
            patched["quantity"] = 1 if floors else (raw.get("quantity") or 1)
        out.append(patched)
    return out


def _pick_guestroom_basis(
    text: str, has_suites: bool, has_kings: bool, has_queens: bool,
) -> tuple[str, str]:
    """Look at the item wording and the available guestroom mix; pick the
    tightest per-room-type basis we have data for, falling back to `keys`."""
    wants_suite = "suite" in text or "parlor" in text or "living room" in text
    wants_king = "king" in text
    wants_queen = "queen" in text or "double-double" in text or "double double" in text or "2-queen" in text
    if wants_suite and has_suites:
        return "suites", "per suite"
    if wants_king and has_kings:
        return "kings_only", "per king"
    if wants_queen and has_queens:
        return "doubles", "per queen"
    return "keys", "per key"
