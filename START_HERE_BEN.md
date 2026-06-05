# Gencom Dashboard — Setup & Run (Windows)

This is the Gencom internal-tools dashboard (Full Budget Generator, Capex
Tracker, Schedule Generator, Meeting Scheduler, Org Chart, and more).
Follow these steps to run it on your machine.

------------------------------------------------------------------------
## 1. Install these first (one time)

- **Python 3.12+**  — check by running `py --version` in PowerShell
- **Node.js 20 LTS** — check by running `node --version`

If either is missing: Python from https://python.org (tick "Add to PATH"),
Node from https://nodejs.org (the LTS button).

------------------------------------------------------------------------
## 2. Open PowerShell IN this folder

In File Explorer, open this folder, click the address bar at the top,
type `powershell`, and press Enter. A PowerShell window opens already
pointed at this folder (the prompt ends with `...\gencom-stay>`).

------------------------------------------------------------------------
## 3. One-time setup

Run these **one block at a time** — paste the block, press Enter, and wait
for it to finish before doing the next.

### Backend
```
cd backend
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
cd ..
```
(Optional: open `backend\.env` in Notepad and paste your Anthropic API key
after `ANTHROPIC_API_KEY=` — only needed for the AI-powered features.)

### Frontend
```
cd frontend
npm install
cd ..
```
`npm install` prints a lot of text and takes a few minutes — that's normal.
Wait until the blinking prompt returns.

------------------------------------------------------------------------
## 4. Run it (this is all you do every time after setup)

From this folder:
```
.\start.ps1
```
If you ever see "running scripts is disabled on this system", use this
instead:
```
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Two windows open (backend + frontend). Wait ~15 seconds, then open your
browser to:

    http://localhost:5173

To stop the app, close those two PowerShell windows.

------------------------------------------------------------------------
## Good to know

- The included `backend/db.sqlite` already has the cost database seeded, so
  you can skip any seeding steps in the older README.
- On startup the script may say a couple of *other* embedded apps
  (Catering, Inbox Briefing) "weren't found" — that's expected and fine;
  they aren't part of this package.
- There are two older docs in here (`README.md`, `READ_ME_FIRST_GencomStay.md`)
  with more detail, but the steps above are all you need to run it.
- Prefer git? The canonical source is on GitHub:
  repo `amitwaisleder-blip/gencom-stay`, branch `claude/intelligent-allen-HeQHP`.
