import asyncio
import os
import sys
from pathlib import Path

import pytest

from app.init_db import prepare, validate_prepared
from app.models import Database, MongoRecord

BACKEND = Path(__file__).resolve().parents[1]


async def run_seed(db: Database, *args: str) -> str:
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        str(BACKEND.parent / "seed/seed.py"),
        *args,
        env={
            **os.environ,
            "PYTHONPATH": str(BACKEND),
            "MONGO_URI": os.getenv("TEST_MONGO_URI", "mongodb://localhost:27017"),
            "MONGO_DB": db.name,
        },
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    output, _ = await process.communicate()
    assert process.returncode == 0, output.decode()
    return output.decode()


@pytest.mark.parametrize("prepared", [False, True])
async def test_seed_fills_empty_database(db: Database, *, prepared: bool) -> None:
    if not prepared:
        await db.deployments.drop()
        await db.dataset.drop()
    metadata = await db.dataset.find_one({})
    await run_seed(db)
    assert await db.deployments.count_documents({}) == 5000
    assert await db.deployments.count_documents({"attrs": {"$type": "array"}}) == 5000
    assert await db.dataset.find_one({}) == metadata
    await prepare(db)
    await validate_prepared(db)
    assert len(await db.deployments.index_information()) == 10


async def test_seed_preserves_nonempty_dataset(
    db: Database, deployment: MongoRecord
) -> None:
    metadata = await db.dataset.find_one({})
    indexes = await db.deployments.index_information()
    assert "1 deployments already present; skipping seed." in await run_seed(db)
    assert await db.deployments.count_documents({}) == 1
    assert await db.deployments.find_one({}) == deployment
    assert await db.dataset.find_one({}) == metadata
    assert await db.deployments.index_information() == indexes


async def test_explicit_reset_requires_preparation(
    db: Database, deployment: MongoRecord
) -> None:
    generation = await validate_prepared(db)
    await run_seed(db, "--reset")
    assert await db.deployments.count_documents({}) == 5000
    assert (
        await db.deployments.find_one({"deployment_id": deployment["deployment_id"]})
        is None
    )
    assert await db.dataset.find_one({}) is None
    await prepare(db)
    assert await validate_prepared(db) != generation
    assert len(await db.deployments.index_information()) == 10
