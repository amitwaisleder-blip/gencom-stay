# Gencom Stay — Collaborator Guide

Thanks for helping out! This is a copy of the **Gencom Dashboard** app. You'll be
working on **one feature: "Gencom Stay."** The rest of the app is here only so the
feature runs and renders — you don't need to touch anything else.

You do **not** need git, and you do **not** need an Anthropic API key for Gencom Stay.

---

## 1. What you'll be editing

**Only these files/folders are "Gencom Stay."** Please keep your changes inside them:

- `frontend/src/pages/GencomStay/`  ← the whole UI (this is the main one)
- `backend/api/gencom_stay.py`       ← the server logic (save/load properties, image upload)

If you think you need to change anything **outside** those two — especially
`frontend/src/App.tsx`, `backend/main.py`, or `backend/models/entities.py` — please
message Ben first. Those are shared "wiring" files and need to be merged carefully.

---

## 2. One-time setup (Windows 11)

You need **Python 3.12+** and **Node.js 20**. Then open **PowerShell** in this folder and run:

```powershell
# Backend
cd backend
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env          # leave ANTHROPIC_API_KEY blank — Gencom Stay doesn't use it
cd ..

# Frontend
cd frontend
npm install
cd ..
```

> If `py -3.12` isn't found, install Python 3.12 from python.org (check "Add to PATH").
> If `node`/`npm` isn't found, install Node 20 LTS from nodejs.org.

---

## 3. Running it

From this folder in PowerShell:

```powershell
.\start.ps1
```

Then open **http://localhost:5173** and click into **Gencom Stay** in the left nav.

Notes:
- The startup script may say a couple of *other* apps (Catering, Inbox Briefing)
  weren't found — **that's expected and fine.** They're not included. Gencom Stay
  still works.
- If a route other than Gencom Stay shows an error, ignore it — only Gencom Stay
  matters here.
- The database starts empty; Gencom Stay shows its built-in seed properties until
  you add your own.

To stop: close the PowerShell windows that popped up.

---

## 4. When you're done — sending it back

1. **Close** the running app (close the spawned PowerShell windows).
2. Zip up **this whole folder** again (right-click → *Send to* → *Compressed (zipped) folder*).
   - It's fine to leave `node_modules` / `venv` in or take them out — Ben only pulls
     the Gencom Stay files back, so the rest is ignored.
3. Send the zip back to Ben.

That's it — Ben re-integrates your Gencom Stay changes on his side automatically.

---

**Questions?** Email Ben at bdennis@gencomgrp.com.
