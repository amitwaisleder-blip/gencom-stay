# Gencom Dashboard — launches backend (FastAPI :8000), frontend (Vite :5173),
# and the Gencom Catering Next.js app (:3002). The catering app is embedded
# in the dashboard via iframe; without its server up, the /catering route
# shows "127.0.0.1 refused to connect", which is why we boot it here.
# Usage from PowerShell:   .\start.ps1
# First run: see README.md for setup.

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition

$BackendDir = Join-Path $ProjectRoot "backend"
$FrontendDir = Join-Path $ProjectRoot "frontend"
$CateringDir = Join-Path (Split-Path -Parent $ProjectRoot) "gencom-catering-request"
$InboxBriefingDir = Join-Path (Split-Path -Parent $ProjectRoot) "inbox-briefing"
$InboxBriefingBackendDir = Join-Path $InboxBriefingDir "backend"
$InboxBriefingFrontendDir = Join-Path $InboxBriefingDir "frontend"
$InboxBriefingVenvActivate = Join-Path $InboxBriefingBackendDir "venv\Scripts\Activate.ps1"
$VenvActivate = Join-Path $BackendDir "venv\Scripts\Activate.ps1"
$EnvFile = Join-Path $BackendDir ".env"

# Auto-detect Node: prefer system install, fall back to portable at C:\Users\<you>\nodejs\node-v20*\
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    $portable = Get-ChildItem "$env:USERPROFILE\nodejs" -Directory -Filter "node-v*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($portable) {
        $env:Path = "$($portable.FullName);$env:Path"
        Write-Host "Using portable Node at $($portable.FullName)" -ForegroundColor Cyan
    } else {
        Write-Host "Node.js not found. Install from https://nodejs.org or extract a portable zip to $env:USERPROFILE\nodejs\" -ForegroundColor Red
        exit 1
    }
}

if (-not (Test-Path $VenvActivate)) {
    Write-Host "Backend venv not found. Run these once:" -ForegroundColor Yellow
    Write-Host "  cd backend"
    Write-Host "  py -3.12 -m venv venv"
    Write-Host "  .\venv\Scripts\Activate.ps1"
    Write-Host "  pip install -r requirements.txt"
    exit 1
}

if (-not (Test-Path $EnvFile)) {
    Write-Host "Creating backend/.env from .env.example" -ForegroundColor Cyan
    Copy-Item (Join-Path $BackendDir ".env.example") $EnvFile
}

if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
    Push-Location $FrontendDir
    npm install
    Pop-Location
}

# Catering app sits next to pip-budget-app/ — install deps if missing so the
# first-run experience doesn't dump the user into a broken iframe.
$cateringAvailable = Test-Path $CateringDir
if ($cateringAvailable -and -not (Test-Path (Join-Path $CateringDir "node_modules"))) {
    Write-Host "Installing catering app dependencies..." -ForegroundColor Cyan
    Push-Location $CateringDir
    npm install
    Pop-Location
}

Write-Host "Starting backend on http://localhost:8000" -ForegroundColor Green
$backend = Start-Process -PassThru -WorkingDirectory $BackendDir powershell -ArgumentList "-NoExit", "-Command", `
    "& '$VenvActivate'; uvicorn main:app --reload --port 8000"

Write-Host "Starting frontend on http://localhost:5173" -ForegroundColor Green
$frontend = Start-Process -PassThru -WorkingDirectory $FrontendDir powershell -ArgumentList "-NoExit", "-Command", "npm run dev"

# Catering Next.js app on :3002 — embedded by the dashboard's /catering route.
# Auto-binds to 127.0.0.1 via its package.json dev script.
$catering = $null
if ($cateringAvailable) {
    Write-Host "Starting catering app on http://127.0.0.1:3002" -ForegroundColor Green
    $catering = Start-Process -PassThru -WorkingDirectory $CateringDir powershell -ArgumentList "-NoExit", "-Command", "npm run dev"
} else {
    Write-Host "Catering app not found at $CateringDir — /catering will show a 'server unreachable' message." -ForegroundColor Yellow
}

# Inbox Briefing app sits next to pip-budget-app/ — its own FastAPI + Vite
# stack on :8001 / :5180. The dashboard's /inbox-briefing route embeds it
# in an iframe; without these servers the iframe shows the
# "server unreachable" message.
$inboxBriefingAvailable = Test-Path $InboxBriefingBackendDir
$inboxBackend = $null
$inboxFrontend = $null
if ($inboxBriefingAvailable) {
    if (-not (Test-Path $InboxBriefingVenvActivate)) {
        Write-Host "Inbox Briefing venv missing — run inbox-briefing\start.ps1 once to bootstrap, then re-run this." -ForegroundColor Yellow
    } else {
        if (-not (Test-Path (Join-Path $InboxBriefingFrontendDir "node_modules"))) {
            Write-Host "Installing Inbox Briefing frontend dependencies..." -ForegroundColor Cyan
            Push-Location $InboxBriefingFrontendDir
            npm install
            Pop-Location
        }
        Write-Host "Starting Inbox Briefing backend on http://127.0.0.1:8001" -ForegroundColor Green
        $inboxBackend = Start-Process -PassThru -WorkingDirectory $InboxBriefingBackendDir powershell -ArgumentList "-NoExit", "-Command", `
            "& '$InboxBriefingVenvActivate'; uvicorn main:app --host 127.0.0.1 --port 8001 --reload"
        Write-Host "Starting Inbox Briefing frontend on http://127.0.0.1:5180" -ForegroundColor Green
        $inboxFrontend = Start-Process -PassThru -WorkingDirectory $InboxBriefingFrontendDir powershell -ArgumentList "-NoExit", "-Command", "npm run dev"
    }
} else {
    Write-Host "Inbox Briefing app not found at $InboxBriefingDir — /inbox-briefing will show a 'server unreachable' message." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "All processes started in new terminal windows." -ForegroundColor Green
Write-Host "Open http://localhost:5173 in your browser."
Write-Host ""
Write-Host "Close the spawned windows to stop the app, or:"
$ids = @($backend.Id, $frontend.Id)
if ($catering) { $ids += $catering.Id }
if ($inboxBackend) { $ids += $inboxBackend.Id }
if ($inboxFrontend) { $ids += $inboxFrontend.Id }
Write-Host "  Stop-Process -Id $($ids -join ', ')"
