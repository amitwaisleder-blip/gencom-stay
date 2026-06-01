from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api import properties, template, scope, cost_db, scenarios, exports, documents, chat, dm_costs, pip, fast_budget, airkarim, gencom_stay, gen_cal, lunch_menu, cash_flow_returns, schedule, capex_tracker, intern_program, orgchart
from config import EXPORTS_DIR, UPLOADS_DIR
from db import init_db


def create_app() -> FastAPI:
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    init_db()

    app = FastAPI(title="PIP-to-Budget App", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(properties.router)
    app.include_router(template.router)
    app.include_router(scope.router)
    app.include_router(cost_db.router)
    app.include_router(scenarios.router)
    app.include_router(exports.router)
    app.include_router(documents.router)
    app.include_router(chat.router)
    app.include_router(dm_costs.router)
    app.include_router(pip.router)
    app.include_router(fast_budget.router)
    app.include_router(airkarim.router)
    app.include_router(gencom_stay.router)
    app.include_router(gen_cal.router)
    app.include_router(lunch_menu.router)
    app.include_router(cash_flow_returns.router)
    app.include_router(schedule.router)
    app.include_router(capex_tracker.router)
    app.include_router(intern_program.router)
    app.include_router(orgchart.router)

    app.mount("/files/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")
    app.mount("/files/exports", StaticFiles(directory=EXPORTS_DIR), name="exports")

    @app.get("/api/health")
    def health():
        return {"ok": True}

    return app


app = create_app()
