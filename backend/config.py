import os
from dataclasses import dataclass
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent


def _read_cors_origins() -> tuple[str, ...]:
    configured_origins = os.getenv("FPL_ML_CORS_ORIGINS")
    if configured_origins is None:
        return (
            "http://localhost:8081",
            "http://127.0.0.1:8081",
            "http://localhost:19006",
            "http://127.0.0.1:19006",
        )

    return tuple(
        origin.strip().rstrip("/")
        for origin in configured_origins.split(",")
        if origin.strip()
    )


@dataclass(frozen=True)
class Settings:
    fpl_api_base_url: str = os.getenv(
        "FPL_API_BASE_URL",
        "https://fantasy.premierleague.com/api",
    ).rstrip("/")
    fpl_api_timeout_seconds: float = float(
        os.getenv("FPL_API_TIMEOUT_SECONDS", "15")
    )
    model_path: Path = Path(
        os.getenv(
            "FPL_MODEL_PATH",
            str(BACKEND_DIR / "models" / "model_v1.joblib"),
        )
    )
    cors_origins: tuple[str, ...] = _read_cors_origins()
    cors_origin_regex: str = os.getenv(
        "FPL_ML_CORS_ORIGIN_REGEX",
        r"^https?://(localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(:\d+)?$",
    )


settings = Settings()
