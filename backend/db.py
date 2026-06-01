from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from config import DB_PATH


engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from models import entities  # noqa: F401
    from sqlalchemy import text

    Base.metadata.create_all(bind=engine)

    # Lightweight additive-only migration: add new nullable columns if missing.
    # Keeps existing user data intact as the schema evolves during v1.
    with engine.begin() as conn:
        def has_column(table: str, column: str) -> bool:
            rows = conn.execute(text(f"PRAGMA table_info({table})")).all()
            return column in {r[1] for r in rows}

        if not has_column("scenarios", "soft_cost_breakdown"):
            conn.execute(text("ALTER TABLE scenarios ADD COLUMN soft_cost_breakdown JSON"))
        if not has_column("properties", "soft_costs_synced"):
            conn.execute(text("ALTER TABLE properties ADD COLUMN soft_costs_synced BOOLEAN DEFAULT 1"))
        if not has_column("properties", "intake_answers"):
            conn.execute(text("ALTER TABLE properties ADD COLUMN intake_answers JSON"))
        if not has_column("scope_items", "multiplier_basis"):
            conn.execute(text("ALTER TABLE scope_items ADD COLUMN multiplier_basis VARCHAR"))
        if not has_column("scope_items", "sub_area"):
            conn.execute(text("ALTER TABLE scope_items ADD COLUMN sub_area VARCHAR"))
        if not has_column("lunch_favorites", "rank"):
            conn.execute(text("ALTER TABLE lunch_favorites ADD COLUMN rank INTEGER"))

        # Capex Tracker — enrichment fields added after initial schema. Each
        # column is nullable so existing rows are unaffected.
        if has_column("capex_hotels", "name"):
            for col, ddl in [
                ("address", "VARCHAR"),
                ("city", "VARCHAR"),
                ("state", "VARCHAR"),
                ("country", "VARCHAR"),
                ("keys", "INTEGER"),
                ("year_built", "INTEGER"),
                ("last_renovation", "INTEGER"),
                ("current_brand", "VARCHAR"),
                ("current_flag", "VARCHAR"),
                ("property_type", "VARCHAR"),
                ("floors", "INTEGER"),
                ("notes", "TEXT"),
                ("enrichment_confidence", "VARCHAR"),
            ]:
                if not has_column("capex_hotels", col):
                    conn.execute(text(f"ALTER TABLE capex_hotels ADD COLUMN {col} {ddl}"))

        if has_column("capex_lines", "code") and not has_column("capex_lines", "vendor"):
            conn.execute(text("ALTER TABLE capex_lines ADD COLUMN vendor VARCHAR"))
        if has_column("capex_lines", "code") and not has_column("capex_lines", "breakdown"):
            conn.execute(text("ALTER TABLE capex_lines ADD COLUMN breakdown JSON"))
        if has_column("capex_hotels", "name") and not has_column("capex_hotels", "logo_path"):
            conn.execute(text("ALTER TABLE capex_hotels ADD COLUMN logo_path VARCHAR"))
        if has_column("capex_lines", "code") and not has_column("capex_lines", "cashflow"):
            conn.execute(text("ALTER TABLE capex_lines ADD COLUMN cashflow JSON"))
        if has_column("capex_lines", "code") and not has_column("capex_lines", "status"):
            conn.execute(text("ALTER TABLE capex_lines ADD COLUMN status VARCHAR"))
        if has_column("capex_invoices", "vendor"):
            if not has_column("capex_invoices", "date_paid"):
                conn.execute(text("ALTER TABLE capex_invoices ADD COLUMN date_paid VARCHAR"))
            if not has_column("capex_invoices", "payment_notes"):
                conn.execute(text("ALTER TABLE capex_invoices ADD COLUMN payment_notes TEXT"))
            if not has_column("capex_invoices", "splits"):
                conn.execute(text("ALTER TABLE capex_invoices ADD COLUMN splits JSON"))

        # capex_projects — month-level granularity for project start/end.
        # Nullable so existing year-only rows are unaffected.
        if has_column("capex_projects", "year_start"):
            if not has_column("capex_projects", "month_start"):
                conn.execute(text("ALTER TABLE capex_projects ADD COLUMN month_start INTEGER"))
            if not has_column("capex_projects", "month_end"):
                conn.execute(text("ALTER TABLE capex_projects ADD COLUMN month_end INTEGER"))
