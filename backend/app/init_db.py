import asyncio
from uuid import uuid4

from pymongo import AsyncMongoClient

from app.config import Settings
from app.models import INDEXES, Database, MongoRecord
from app.schemas import APIError


async def prepare(db: Database) -> None:
    await db.deployments.create_indexes(INDEXES)
    # Keep the generation stable across preparation so existing cursors remain valid.
    await db.dataset.update_one(
        {"_id": "current"},
        {"$setOnInsert": {"schema_version": 1, "generation": str(uuid4())}},
        upsert=True,
    )


async def dataset_generation(db: Database) -> str:
    state = await db.dataset.find_one({"_id": "current"})
    if (
        not state
        or state.get("schema_version") != 1
        or not isinstance(state.get("generation"), str)
    ):
        raise APIError(
            503, "unavailable", "Run database preparation before serving requests"
        )
    return str(state["generation"])


async def validate_prepared(db: Database) -> str:
    generation = await dataset_generation(db)
    await validate_indexes(db)
    return generation


async def validate_indexes(db: Database) -> None:
    indexes = await db.deployments.index_information()
    for expected in INDEXES:
        spec = expected.document
        actual = indexes.get(spec["name"], {})
        if any(
            actual.get(key) != value
            for key, value in spec.items()
            if key not in {"name", "key"}
        ) or actual.get("key") != list(spec["key"].items()):
            msg = "Required indexes are missing; run python -m app.init_db"
            raise RuntimeError(msg)


async def main() -> None:
    settings = Settings()
    async with AsyncMongoClient[MongoRecord](
        settings.mongo_uri, tz_aware=True
    ) as client:
        await prepare(client[settings.mongo_db])
    print("Database prepared; existing dataset generation preserved.")


if __name__ == "__main__":
    asyncio.run(main())
