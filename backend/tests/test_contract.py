import json
from pathlib import Path
from typing import Any
from unittest.mock import patch

import httpx
import pytest
from pydantic import SecretStr
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.errors import AutoReconnect

from app.config import Settings as AppSettings
from app.init_db import prepare
from app.main import create_app
from app.models import Database
from app.schemas import DeploymentOut, DeploymentPage
from tests.conftest import SECRET, assert_test_database
from tests.helpers import PREFIX, edit


async def test_successful_contract_examples(
    client: httpx.AsyncClient, url: str
) -> None:
    examples = [
        (PREFIX, "GET", await client.get(PREFIX)),
        (PREFIX + "/{deployment_id}", "GET", await client.get(url)),
        (PREFIX + "/{deployment_id}", "PATCH", await edit(client, url, name="example")),
        (
            PREFIX + "/{deployment_id}",
            "DELETE",
            await client.delete(url, headers={"If-Match": '"2"'}),
        ),
        (
            PREFIX + "/{deployment_id}/restore",
            "POST",
            await client.post(url + "/restore", headers={"If-Match": '"3"'}),
        ),
    ]
    for path, method, response in examples:
        assert response.is_success
        if method == "DELETE":
            assert response.content == b""
        else:
            model = DeploymentPage if path == PREFIX else DeploymentOut
            assert (
                model.model_validate(response.json()).model_dump(mode="json")
                == response.json()
            )


async def test_serialization_errors_and_docs(
    client: httpx.AsyncClient, url: str
) -> None:
    response = await client.get(url)
    record = response.json()
    assert isinstance(record["deployment_id"], str)
    assert record["created_at"].endswith("Z")
    assert not {"_id", "sync_version", "name_sort", "revision_id"} & record.keys()
    for path in ("/openapi.json", "/docs", "/redoc", "/health/live", "/health/ready"):
        assert (await client.get(path)).status_code == 200
    for path, status in [
        ("/missing", 404),
        (PREFIX + "/not-a-uuid", 422),
        (PREFIX + "/00000000-0000-0000-0000-000000000099", 404),
    ]:
        response = await client.get(path)
        assert response.status_code == status
        assert {"code", "message"} <= response.json().keys()


async def test_database_failure_and_recovery(client: httpx.AsyncClient) -> None:
    with patch.object(
        AsyncCollection, "find_one", side_effect=AutoReconnect("database down")
    ):
        assert (await client.get("/health/live")).status_code == 200
        for path in (PREFIX, "/health/ready"):
            response = await client.get(path)
            assert response.status_code == 503
            assert response.json() == {
                "code": "unavailable",
                "message": "Database unavailable",
            }
    assert (await client.get("/health/ready")).status_code == 200


async def test_running_requests_do_not_reinspect_changed_indexes(
    client: httpx.AsyncClient, db: Database
) -> None:
    await db.deployments.drop_index("deleted_at_1_name_sort_1_deployment_id_1")
    before = await db.deployments.index_information()
    assert (await client.get("/health/ready")).status_code == 200
    assert await db.deployments.index_information() == before


def test_database_safety_guard() -> None:
    for name in ("deployments", "production", "test"):
        with pytest.raises(RuntimeError, match="Refusing"):
            assert_test_database(name)


def test_openapi_browse_and_attribute_constraints() -> None:
    contract = create_app(AppSettings(cursor_secret=SecretStr(SECRET))).openapi()
    parameters = contract["paths"][PREFIX]["get"]["parameters"]
    names = {parameter["name"] for parameter in parameters}
    assert names == {
        "q",
        "status",
        "type",
        "environment",
        "deleted",
        "sort_by",
        "sort_order",
        "limit",
        "cursor",
    }
    attributes = contract["components"]["schemas"]["AttributePatch"]["properties"][
        "attributes"
    ]
    assert attributes["propertyNames"] == {"minLength": 1, "maxLength": 128}
    assert attributes["additionalProperties"] is False


def test_exported_contract_is_current() -> None:
    # Constructing the schema never enters lifespan or connects to MongoDB.
    contract = create_app(AppSettings(cursor_secret=SecretStr(SECRET))).openapi()
    snapshot = Path(__file__).resolve().parents[1] / "openapi.json"
    assert json.loads(snapshot.read_text(encoding="utf-8")) == contract


async def test_all_data_endpoints_require_preparation(
    client: httpx.AsyncClient, db: Database, url: str
) -> None:
    await db.dataset.drop()
    before = await db.deployments.find_one({})
    for response in (
        await client.get(PREFIX),
        await client.get(url),
        await edit(client, url, name="must not write"),
        await client.delete(url, headers={"If-Match": '"1"'}),
        await client.post(url + "/restore", headers={"If-Match": '"1"'}),
    ):
        assert response.status_code == 503
        assert response.json()["code"] == "unavailable"
    assert await db.deployments.find_one({}) == before
    assert (await client.get("/health/live")).status_code == 200
    await prepare(db)
    assert (await client.get(url)).status_code == 200
    assert (await edit(client, url, name="prepared")).status_code == 200


@pytest.mark.parametrize("cursor", ["", "x" * 32769])
async def test_cursor_validation_uses_recoverable_error_code(
    client: httpx.AsyncClient, cursor: str
) -> None:
    response = await client.get(PREFIX, params={"cursor": cursor})
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_cursor"


async def test_list_reuses_validated_metadata_once_per_request(
    client: httpx.AsyncClient, url: str
) -> None:
    original = AsyncCollection.find_one
    reads = 0

    async def counted(collection: Any, *args: Any, **kwargs: Any) -> Any:
        nonlocal reads
        if collection.name == "dataset":
            reads += 1
        return await original(collection, *args, **kwargs)

    with patch.object(AsyncCollection, "find_one", counted):
        for _ in range(2):
            before = reads
            assert (await client.get(PREFIX)).status_code == 200
            assert reads == before + 1
    assert (await client.get(url)).status_code == 200
