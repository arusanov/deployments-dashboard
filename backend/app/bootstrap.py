import asyncio
import os
import secrets
from pathlib import Path
from tempfile import NamedTemporaryFile

from pymongo import AsyncMongoClient

from app.config import Settings
from app.init_db import prepare, validate_prepared
from app.models import Database, MongoRecord


def ensure_cursor_secret(path: Path) -> None:
    if path.exists():
        return
    # Publish a complete secret so interruption cannot leave a partially written key.
    with NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, delete=False
    ) as temporary:
        temporary.write(secrets.token_urlsafe(48))
    Path(temporary.name).replace(path)


async def bootstrap_database(db: Database) -> None:
    if await db.dataset.find_one({"_id": "current"}) is None:
        await prepare(db)
    else:
        await validate_prepared(db)


async def main() -> None:
    ensure_cursor_secret(Path(os.environ["CURSOR_SECRET_FILE"]))
    settings = Settings()
    async with AsyncMongoClient[MongoRecord](
        settings.mongo_uri,
        tz_aware=True,
        serverSelectionTimeoutMS=settings.mongo_timeout_ms,
    ) as client:
        await bootstrap_database(client[settings.mongo_db])


if __name__ == "__main__":
    asyncio.run(main())
