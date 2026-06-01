from pathlib import Path
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
EXPORTS_DIR = DATA_DIR / "exports"
TEMPLATE_PATH = DATA_DIR / "template.xlsx"
TEMPLATE_MAP_PATH = BACKEND_DIR / "template_map.json"
DB_PATH = BACKEND_DIR / "db.sqlite"

# Force .env to override system env (Windows often has an empty ANTHROPIC_API_KEY
# env var lying around which pydantic-settings would otherwise prefer).
load_dotenv(BACKEND_DIR / ".env", override=True)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    anthropic_api_key: str = ""
    extraction_model: str = "claude-opus-4-7"
    secondary_model: str = "claude-sonnet-4-6"
    # Optional — enable real flight-status + weather in the AirKarim preview.
    # Leave blank to show the "not configured" placeholder.
    flightaware_api_key: str = ""
    openweather_api_key: str = ""


settings = Settings()
