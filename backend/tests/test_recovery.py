import asyncio
from typing import Any
from unittest.mock import patch

import httpx
import pytest
from asgi_lifespan import LifespanManager
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import AutoReconnect

from app.config import Settings
from app.main import create_app
from app.models import Database
from tests.helpers import edit


@pytest.mark.parametrize("after_write", [False, True])
async def test_connection_failure_requires_reconciliation(
    client: httpx.AsyncClient,
    settings: Settings,
    db: Database,
    url: str,
    *,
    after_write: bool,
) -> None:
    original = AsyncCollection.find_one_and_update
    calls = 0

    async def fault(*args: Any, **kwargs: Any) -> Any:
        nonlocal calls
        calls += 1
        if after_write:
            await original(*args, **kwargs)
        msg = "injected lost connection"
        raise AutoReconnect(msg)

    with patch.object(AsyncCollection, "find_one_and_update", fault):
        assert (await edit(client, url, name="authoritative")).status_code == 503
        assert (await client.get("/health/ready")).status_code == 200
    assert calls == 1
    restarted = create_app(settings)
    async with (
        LifespanManager(restarted),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=restarted), base_url="http://test"
        ) as returning,
    ):
        current = (await returning.get(url)).json()
        assert current["revision"] == (2 if after_write else 1)
        assert (current["attributes"]["name"] == "authoritative") == after_write
        assert (
            await edit(returning, url, current["revision"], name="manual retry")
        ).status_code == 200
    assert "sync_state" not in await db.list_collection_names()


async def test_independent_application_instances_race(
    client: httpx.AsyncClient,
    settings: Settings,
    url: str,
) -> None:
    second = create_app(settings)
    original = AsyncCollection.find_one_and_update
    arrived = 0
    both_ready = asyncio.Event()

    async def barrier(*args: Any, **kwargs: Any) -> Any:
        nonlocal arrived
        arrived += 1
        if arrived == 2:
            both_ready.set()
        await asyncio.wait_for(both_ready.wait(), timeout=3)
        return await original(*args, **kwargs)

    async with (
        LifespanManager(second),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=second), base_url="http://test"
        ) as other,
    ):
        with patch.object(AsyncCollection, "find_one_and_update", barrier):
            results = await asyncio.gather(
                edit(client, url, name="first"), edit(other, url, team="second")
            )
        assert sorted(result.status_code for result in results) == [200, 412]
        winner = next(result.json() for result in results if result.status_code == 200)
        current = (await other.get(url)).json()
        assert current == winner
        assert current["revision"] == 2
