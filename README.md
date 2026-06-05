# PIP-to-Budget App

A local web app that ingests PIP documents, OMs, walk notes, and property photos, extracts scope and property metadata using Claude, and produces a populated Gencom Excel budget.

This is a Windows-adapted build of the spec (spec was written for macOS).

## Prerequisites

- Windows 11
- Python 3.12+ (`py --version` to verify) — already installed at `C:\Users\bdennis\AppData\Local\Programs\Python\Python312\`
- Node.js 20 LTS (`node --version`) — portable install at `C:\Users\bdennis\nodejs\node-v20.18.0-win-x64\` (auto-detected by `start.ps1`)
- An Anthropic API key
- Your Gencom Excel budget template (`.xlsx`)

> **Portable Node note:** the winget install of Node triggered a UAC prompt that didn't get clicked, so we dropped a portable Node zip at `~/nodejs/` instead. `start.ps1` finds it automatically. If you want Node on PATH permanently, run:
> `[Environment]::SetEnvironmentVariable("Path", $env:Path + ";$env:USERPROFILE\nodejs\node-v20.18.0-win-x64", "User")`

## First-run setup

Open PowerShell in the project folder (`pip-budget-app`).

```powershell
# 1. Backend
cd backend
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env      # then edit .env and fill in ANTHROPIC_API_KEY
cd ..

# 2. Frontend
cd frontend
npm install
cd ..

# 3. Template + cost seed
# Place your Gencom budget template at data/template.xlsx
# Place your FFE Pricing Database at data/cost_seed.xlsx
# (both can alternatively be uploaded via the UI once Phase B lands)

# 4. Seed the Cost Database (one time)
cd backend
.\venv\Scripts\Activate.ps1
python scripts/seed_costs.py
cd ..
```

The seed script imports:
- The `DATABASE` tab → actual-project unit costs (source="actual_project")
- The `Upscale` / `Upper Upscale` / `Luxury` tabs → Nehmer & HVS per-key benchmark ranges (source="benchmark")

Re-running the script wipes and reseeds those two sources; user-added rows (source="user_seeded") are preserved.

## Running

From the project root:

```powershell
.\start.ps1
```

This launches:

- **Backend** (FastAPI) on http://localhost:8000 — Swagger docs at http://localhost:8000/docs
- **Frontend** (Vite) on http://localhost:5173 ← open this

Each runs in its own PowerShell window; close them to stop.

### Or run each manually

```powershell
# Backend
cd backend
.\venv\Scripts\Activate.ps1
uvicorn main:app --reload --port 8000

# Frontend (in a second terminal)
cd frontend
npm run dev
```

## What's in Phase A (current)

- [x] Dashboard with property card grid (Active / Archived tabs)
- [x] Create / edit / archive / restore / duplicate / delete properties
- [x] Property Setup screen with 6 collapsible sections (Basics, Building, F&B, Systems, Documents, Walk Info)
- [x] Template ingestion — upload a Gencom `.xlsx` and detect division structure
- [x] SQLite persistence, SQLAlchemy models for all 6 entities, JSON provenance on Property

## What's next

- Phase B: Scope Review screen, Cost Database, Excel export
- Phase C: Claude API extraction from PIP/OM/walk notes
- Phase D: Budget Summary with 3 scenarios
- Phase E: Polish

## Project layout

```
pip-budget-app/
├── backend/
│   ├── main.py               # FastAPI entry
│   ├── config.py             # paths + settings
│   ├── db.py                 # SQLAlchemy engine/session
│   ├── requirements.txt
│   ├── .env                  # ANTHROPIC_API_KEY (create from .env.example)
│   ├── api/                  # Route handlers
│   │   ├── properties.py
│   │   └── template.py
│   ├── models/entities.py    # SQLAlchemy tables
│   ├── schemas/              # Pydantic schemas
│   ├── services/             # template_ingest, (soon) extractor, cost_engine
│   ├── prompts/              # (Phase C) versioned Claude prompts
│   └── db.sqlite             # created on first run
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── index.css
│   │   ├── lib/api.ts
│   │   └── pages/
│   │       ├── Dashboard.tsx
│   │       ├── PropertySetup.tsx
│   │       └── TemplateSetup.tsx
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── tsconfig.json
├── data/
│   ├── template.xlsx         # your Gencom template (not committed)
│   ├── cost_seed.csv         # Phase B seed (not committed)
│   ├── uploads/
│   └── exports/
├── start.ps1                 # launches backend + frontend
└── README.md
```

## Troubleshooting

- **`py` not found** — install Python from https://www.python.org/downloads/ and tick "Add to PATH".
- **`npm` not found** — install Node 20 LTS from https://nodejs.org.
- **Port already in use** — change the port in `start.ps1` and `frontend/vite.config.ts` (the proxy target).
- **CORS error in browser console** — check that both :8000 and :5173 are running; Vite proxies `/api` and `/files` to the backend.
