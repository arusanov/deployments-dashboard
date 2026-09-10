from datetime import UTC, datetime, timedelta
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

MAX_ATTRIBUTES = 100
SEARCH_MAX_LENGTH = 200
ATTRIBUTE_KEY_MIN_LENGTH = 1
ATTRIBUTE_KEY_MAX_LENGTH = 128
ATTRIBUTE_VALUE_MAX_LENGTH = 4096
CURSOR_MAX_LENGTH = 32768

RETENTION = timedelta(days=30)
RETENTION_SECONDS = int(RETENTION.total_seconds())


def now() -> datetime:
    return datetime.now(UTC)


def read_cursor_secret(path: Path | None) -> SecretStr:
    if path is None:
        msg = "Set CURSOR_SECRET or CURSOR_SECRET_FILE"
        raise ValueError(msg)
    return SecretStr(path.read_text(encoding="utf-8").strip())


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    cors_origins: list[str] = ["http://localhost:3000"]

    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "deployments"
    cursor_secret_file: Path | None = None
    cursor_secret: SecretStr = Field(
        default_factory=lambda data: read_cursor_secret(data["cursor_secret_file"]),
        min_length=32,
    )
    mongo_timeout_ms: int = Field(default=3000, ge=100, le=30000)
