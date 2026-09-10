import asyncio
import time
from datetime import UTC, timedelta
from typing import Any
from unittest.mock import patch

import httpx
import pytest
import time_machine
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import AutoReconnect

from app.config import RETENTION, RETENTION_SECONDS
from app.deployments import visibility
from app.models import Database
from tests.conftest import RecordFactory
from tests.helpers import PREFIX, edit


@pytest.mark.parametrize("clock_offset", [-180, 180])
async def test_retention_uses_database_clock(
    client: httpx.AsyncClient, db: Database, url: str, clock_offset: int
) -> None:
    server_time = (await db.command("hello"))["localTime"]
    with time_machine.travel(server_time + timedelta(seconds=clock_offset), tick=False):
        await db.deployments.update_one(
            {},
            {
                "$set": {
                    "deleted_at": server_time - RETENTION + timedelta(seconds=60),
                    "revision": 2,
                }
            },
        )
        assert (
            await client.get(url, params={"include_deleted": True})
        ).status_code == 200
        assert (
            len((await client.get(PREFIX, params={"deleted": "only"})).json()["items"])
            == 1
        )
        response = await client.post(url + "/restore", headers={"If-Match": '"2"'})
        assert response.status_code == 200
        assert response.json()["revision"] == 3
        await db.deployments.update_one(
            {},
            {
                "$set": {
                    "deleted_at": server_time - RETENTION,
                }
            },
        )
        for response in (
            await client.get(url, params={"include_deleted": True}),
            await client.post(url + "/restore", headers={"If-Match": '"3"'}),
            await client.delete(url, headers={"If-Match": '"3"'}),
            await edit(client, url, 3, name="expired"),
        ):
            assert response.status_code == 404
            if response.request.method == "POST":
                assert response.json()["code"] == "not_found"
                assert (
                    "30-day recovery period has expired" in response.json()["message"]
                )
        assert (await client.get(PREFIX, params={"deleted": "include"})).json()[
            "items"
        ] == []


async def test_missing_restore_explains_recovery_limit(
    client: httpx.AsyncClient, db: Database, url: str
) -> None:
    await db.deployments.delete_one({})
    response = await client.post(url + "/restore", headers={"If-Match": '"1"'})
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    assert response.json()["message"] == (
        "Deployment not found or its 30-day recovery period has expired."
    )


async def test_repeated_delete_never_extends_retention(
    client: httpx.AsyncClient, url: str
) -> None:
    await client.delete(url, headers={"If-Match": '"1"'})
    original = (await client.get(url, params={"include_deleted": True})).json()
    assert (await client.delete(url, headers={"If-Match": '"2"'})).status_code == 409
    assert (await client.get(url, params={"include_deleted": True})).json() == original


@pytest.mark.parametrize("phase", ["execute", "before_apply", "after_apply"])
async def test_restore_crosses_database_deadline(
    client: httpx.AsyncClient, db: Database, url: str, phase: str
) -> None:
    server = await db.command("hello")
    deadline = server["localTime"].replace(tzinfo=UTC) + timedelta(milliseconds=200)
    deleted_at = deadline - RETENTION
    await db.deployments.update_one(
        {}, {"$set": {"deleted_at": deleted_at, "revision": 2}}
    )
    original_apply = AsyncCollection.find_one_and_update

    async def delayed_apply(*args: Any, **kwargs: Any) -> Any:
        await asyncio.sleep(0.21)
        assert (await db.command("hello"))["localTime"].replace(tzinfo=UTC) >= deadline
        if phase == "before_apply":
            message = "crash before execution"
            raise AutoReconnect(message)
        result = await original_apply(*args, **kwargs)
        if phase == "after_apply":
            message = "crash after execution"
            raise AutoReconnect(message)
        return result

    # The application clock stays before expiry as database time crosses it.
    with time_machine.travel(deadline - timedelta(milliseconds=1), tick=False):
        with (
            patch.object(AsyncCollection, "find_one_and_update", delayed_apply),
        ):
            response = await client.post(url + "/restore", headers={"If-Match": '"2"'})
        assert response.status_code == (404 if phase == "execute" else 503)
        if phase == "execute":
            assert response.json()["code"] == "not_found"
            assert "30-day recovery period has expired" in response.json()["message"]
        stored = await db.deployments.find_one({})
        assert stored is not None
        assert stored["revision"] == 2
        assert stored["deleted_at"] == deleted_at


@pytest.mark.ttl
async def test_actual_mongodb_ttl(db: Database, record: RecordFactory) -> None:
    server = await db.command("hello")
    document = record(deleted_at=server["localTime"] - RETENTION - timedelta(seconds=1))
    await db.deployments.insert_one(document)
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if (
            await db.deployments.find_one({"deployment_id": document["deployment_id"]})
            is None
        ):
            return
        await asyncio.sleep(1)
    pytest.fail(
        "MongoDB did not physically clean up the expired record within 90 seconds"
    )


@pytest.mark.usefixtures("deployment")
@pytest.mark.parametrize("remaining_ms", [-1, 0, 1])
async def test_exact_database_clock_boundary(db: Database, remaining_ms: int) -> None:
    # One command shares $$NOW, so equality is deterministic without host-clock mocks.
    cursor = await db.deployments.aggregate([
        {
            "$set": {
                "deleted_at": {
                    "$subtract": [
                        "$$NOW",
                        RETENTION_SECONDS * 1000 - remaining_ms,
                    ]
                }
            }
        },
        {"$match": visibility("only")},
    ])
    assert len(await cursor.to_list()) == (1 if remaining_ms > 0 else 0)
