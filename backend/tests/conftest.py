import os
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import UUID, uuid4

import httpx
import pytest
from asgi_lifespan import LifespanManager
from fastapi import FastAPI
from pydantic import SecretStr
from pymongo import AsyncMongoClient

from app.attributes import encode_attributes
from app.config import Settings
from app.init_db import prepare
from app.main import create_app
from app.models import Database, MongoRecord
from tests.helpers import PREFIX


class RecordFactory(Protocol):
    def __call__(self, number: int = 1, **overrides: Any) -> MongoRecord: ...


SECRET = "isolated-tests-stable-secret-32-characters"


def assert_test_database(name: str) -> None:
    if not name.startswith("test_deployments_") or name == "deployments":
        msg = "Refusing destructive operations on a non-test database"
        raise RuntimeError(msg)


@pytest.fixture
def disable_dotenv(monkeypatch: pytest.MonkeyPatch) -> None:
    # Local configuration must never affect disposable test settings.
    monkeypatch.setitem(Settings.model_config, "env_file", None)


@pytest.fixture
async def db() -> AsyncGenerator[Database, None]:
    name = f"test_deployments_{uuid4().hex}"
    assert_test_database(name)
    async with AsyncMongoClient[MongoRecord](
        os.getenv("TEST_MONGO_URI", "mongodb://localhost:27017"),
        tz_aware=True,
        serverSelectionTimeoutMS=3000,
    ) as mongo:
        database = mongo[name]
        await prepare(database)
        yield database
        assert_test_database(name)
        await mongo.drop_database(name)


@pytest.fixture
def settings(db: Database) -> Settings:
    return Settings(
        mongo_uri=os.getenv("TEST_MONGO_URI", "mongodb://localhost:27017"),
        mongo_db=db.name,
        cursor_secret=SecretStr(SECRET),
    )


@pytest.fixture
def app(settings: Settings) -> FastAPI:
    return create_app(settings)


@pytest.fixture
async def client(app: FastAPI) -> AsyncGenerator[httpx.AsyncClient, None]:
    async with (
        LifespanManager(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client,
    ):
        yield client


@pytest.fixture
def record() -> RecordFactory:
    def make(number: int = 1, **overrides: Any) -> MongoRecord:
        attributes = overrides.pop(
            "attributes", {"name": "checkout-api", "team": "payments"}
        )
        return {
            "deployment_id": str(UUID(int=number)),
            "version": "1.0.0",
            "status": "active",
            "type": "web_service",
            "environment": "production",
            "attrs": encode_attributes(attributes),
            "created_by": "jane@example.com",
            "created_at": datetime(2026, 1, 1, tzinfo=UTC),
            "updated_at": datetime(2026, 1, 1, tzinfo=UTC),
            "deleted_at": None,
            "revision": 1,
            "name_sort": attributes.get("name", "").lower(),
            **overrides,
        }

    return make


@pytest.fixture
async def deployment(db: Database, record: RecordFactory) -> MongoRecord:
    value = record()
    await db.deployments.insert_one(value)
    return value


@pytest.fixture
def url(deployment: MongoRecord) -> str:
    return f"{PREFIX}/{deployment['deployment_id']}"
