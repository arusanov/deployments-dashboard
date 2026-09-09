from typing import Any
from unittest.mock import patch

import httpx
import pytest
from asgi_lifespan import LifespanManager
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import AutoReconnect

from app.config import Settings
from app.init_db import prepare
from app.main import create_app
from app.models import Database
from tests.helpers import PREFIX, edit


@pytest.mark.parametrize("failure", ["missing", "connection"])
async def test_failed_startup_requires_preparation_and_restart(
    db: Database, settings: Settings, url: str, failure: str
) -> None:
    if failure == "missing":
        await db.deployments.drop_index("deleted_at_1_name_sort_1_deployment_id_1")
    app = create_app(settings)
    original = AsyncCollection.index_information

    async def inspect(*args: Any, **kwargs: Any) -> Any:
        if failure == "connection":
            message = "startup outage"
            raise AutoReconnect(message)
        return await original(*args, **kwargs)

    with patch.object(AsyncCollection, "index_information", inspect):
        async with (
            LifespanManager(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client,
        ):
            before = await db.deployments.find_one({})
            assert (await client.get("/health/live")).status_code == 200
            for response in (
                await client.get("/health/ready"),
                await client.get(PREFIX),
                await client.get(url),
                await edit(client, url, name="blocked"),
                await client.delete(url, headers={"If-Match": '"1"'}),
                await client.post(url + "/restore", headers={"If-Match": '"1"'}),
            ):
                assert response.status_code == 503
            assert await db.deployments.find_one({}) == before
            await prepare(db)
            assert (await client.get("/health/ready")).status_code == 503
    async with (
        LifespanManager(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as restarted,
    ):
        assert (await restarted.get("/health/ready")).status_code == 200
        assert (await restarted.get(url)).status_code == 200


async def test_requests_never_ping_or_inspect_indexes(
    client: httpx.AsyncClient, url: str
) -> None:
    with (
        patch.object(AsyncDatabase, "command", side_effect=AssertionError("No ping")),
        patch.object(
            AsyncCollection,
            "index_information",
            side_effect=AssertionError("Startup only"),
        ),
    ):
        assert (await client.get("/health/ready")).status_code == 200
        assert (await client.get(PREFIX)).status_code == 200
        assert (await client.get(url)).status_code == 200
        assert (await edit(client, url, name="saved")).status_code == 200
