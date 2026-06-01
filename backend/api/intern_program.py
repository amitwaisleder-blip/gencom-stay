"""Intern Program backend — single endpoint right now: parse a resume
PDF/DOCX with Claude and return structured fields the Add-intern dialog
can pre-fill. The InternProgram module otherwise lives entirely in
browser localStorage; this is the only piece that needs server help
because PDF parsing isn't reasonable to do in the browser.
"""
from __future__ import annotations

import io
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from config import UPLOADS_DIR
from services.claude_client import (
    ClaudeError,
    complete_json,
    pdf_block,
    text_block,
)


router = APIRouter(prefix="/api/intern-program", tags=["intern-program"])


SYSTEM_PROMPT = """You are parsing a college intern's resume. Read the
document and return a strict JSON object that matches this exact shape
(every key present; arrays empty when nothing was found; null where
appropriate):

{
  "name": "string — full name as it appears at the top",
  "school": "string — current/most-recent school name",
  "bio": "string — 1-2 sentences in the candidate's voice summarizing what they study and what kind of work they're drawn to. Infer from the resume; don't invent specifics.",
  "education": [
    {
      "school": "string",
      "degree": "string — e.g. 'B.S.' / 'M.A.' / 'B.A.' / 'B.Eng.'",
      "field": "string|null — major or field of study",
      "startYear": number,
      "endYear": number|null,
      "gpa": "string|null — keep their formatting (e.g. '3.8/4.0')",
      "honors": "string|null — 'cum laude', 'Dean's List', etc, joined by '; '"
    }
  ],
  "experience": [
    {
      "company": "string",
      "role": "string",
      "startDate": "YYYY-MM",
      "endDate": "YYYY-MM|null — null when 'present'",
      "description": "string — the candidate's own bullets, joined into one paragraph with '; ' between bullets. Keep verbs and metrics."
    }
  ],
  "projects": [
    {
      "name": "string",
      "description": "string — 1-2 sentence summary",
      "link": "string|null",
      "technologies": ["string", ...]
    }
  ],
  "links": [
    { "label": "string — e.g. 'GitHub', 'LinkedIn', 'Portfolio'", "url": "string" }
  ]
}

Rules:
- Years are integers. Months are 1-12 in date strings.
- Don't invent fields the resume doesn't have — null/empty.
- Don't hallucinate skills or honors.
- Keep the candidate's own wording; don't paraphrase aggressively.
- Return ONLY the JSON object. No prose, no markdown fences.
"""


@router.post("/parse-resume")
async def parse_resume(file: UploadFile = File(...)) -> dict:
    """Accept a PDF or DOCX, return structured intern fields. Frontend
    pre-fills the Add-intern dialog with the response."""

    filename = file.filename or "resume"
    ext = Path(filename).suffix.lower()
    if ext not in {".pdf", ".docx", ".doc", ".txt"}:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type {ext or '(none)'}. Use .pdf, .docx, .doc, or .txt.",
        )

    # Persist to disk so pdf_block can hand the path to Claude. Cleaned
    # up immediately after the call returns — we don't keep resumes on
    # the server (the dialog stores the parsed output in localStorage).
    staging = UPLOADS_DIR / "intern-resumes-tmp"
    staging.mkdir(parents=True, exist_ok=True)
    tmp_path = staging / f"{uuid.uuid4().hex}{ext}"
    try:
        with tmp_path.open("wb") as out:
            shutil.copyfileobj(file.file, out)
    finally:
        await file.close()

    try:
        if ext == ".pdf":
            user_content = [pdf_block(tmp_path), text_block("Parse this resume.")]
        else:
            text = _read_text(tmp_path, ext)
            if not text.strip():
                raise HTTPException(
                    status_code=400,
                    detail="Couldn't extract any text from that file. Try uploading the PDF version.",
                )
            user_content = [text_block(f"Parse this resume:\n\n{text}")]

        try:
            parsed = complete_json(
                system=SYSTEM_PROMPT,
                user_content=user_content,
                max_tokens=4000,
            )
        except ClaudeError as e:
            raise HTTPException(status_code=502, detail=str(e))

        return _normalize(parsed)
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass


def _read_text(path: Path, ext: str) -> str:
    """Extract plain text for non-PDF inputs. PDFs are sent to Claude
    directly via pdf_block so we don't reimplement Claude's PDF parsing."""

    if ext == ".txt":
        return path.read_text(encoding="utf-8", errors="replace")
    if ext in {".docx", ".doc"}:
        try:
            from docx import Document  # type: ignore
        except ImportError:
            raise HTTPException(
                status_code=500,
                detail="python-docx not installed on the server. Convert the resume to PDF and re-upload.",
            )
        try:
            doc = Document(str(path))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Couldn't open as DOCX: {e}")
        parts: list[str] = [p.text for p in doc.paragraphs if p.text]
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    if cell.text:
                        parts.append(cell.text)
        return "\n".join(parts)
    return ""


def _normalize(parsed: object) -> dict:
    """Coerce Claude's response into the exact shape the frontend
    expects — fill in missing keys with sensible defaults so the dialog
    can rely on the response without null-checking every field."""

    if not isinstance(parsed, dict):
        return {
            "name": "",
            "school": "",
            "bio": "",
            "education": [],
            "experience": [],
            "projects": [],
            "links": [],
        }
    return {
        "name": str(parsed.get("name") or "").strip(),
        "school": str(parsed.get("school") or "").strip(),
        "bio": str(parsed.get("bio") or "").strip(),
        "education": _coerce_list(parsed.get("education")),
        "experience": _coerce_list(parsed.get("experience")),
        "projects": _coerce_list(parsed.get("projects")),
        "links": _coerce_list(parsed.get("links")),
    }


def _coerce_list(value: object) -> list:
    return value if isinstance(value, list) else []


# Suppress an unused-import warning when this file is imported but no
# request hits the route — keeping io import for forward compatibility
# if we add streaming back later.
_ = io
