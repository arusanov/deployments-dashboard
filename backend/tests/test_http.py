import asyncio
import os
from collections.abc import AsyncGenerator
from typing import cast

import httpx
import pytest

from app.models import MongoRecord
from app.schemas import DeploymentOut, DeploymentPage
from tests.helpers import PREFIX, edit

pytestmark = pytest.mark.http


@pytest.fixture
async def http_client() -> AsyncGenerator[httpx.AsyncClient, None]:
    api_url = os.getenv("TEST_API_URL")
    if not api_url:
        pytest.skip("Set TEST_API_URL to test a running API over HTTP")
    async with httpx.AsyncClient(base_url=api_url, timeout=30) as client:
        yield client


@pytest.fixture
def writable_client(http_client: httpx.AsyncClient) -> httpx.AsyncClient:
    if os.getenv("TEST_API_ALLOW_MUTATIONS") != "1":
        pytest.skip("Mutation tests require an explicitly disposable API dataset")
    return http_client


async def active_records(client: httpx.AsyncClient) -> list[MongoRecord]:
    response = await client.get(PREFIX, params={"limit": 3})
    assert response.status_code == 200, response.text
    records = cast("list[MongoRecord]", response.json()["items"])
    assert len(records) == 3, "Seed at least three active deployments before testing"
    return records


@pytest.mark.parametrize(
    "path", ["/health/live", "/health/ready", "/docs", "/redoc", "/openapi.json"]
)
async def test_http_availability(http_client: httpx.AsyncClient, path: str) -> None:
    response = await http_client.get(path)
    assert response.status_code == 200, response.text


@pytest.mark.parametrize(
    ("path", "status"),
    [
        (PREFIX + "?limit=201", 422),
        (PREFIX + "?offset=-1", 422),
        (PREFIX + "?status=unknown", 422),
        (PREFIX + "?sort_by=unknown", 422),
        (PREFIX + "?q=%00", 422),
        (PREFIX + "/not-a-uuid", 422),
        (PREFIX + "/changes?cursor=invalid", 422),
        (PREFIX + "/changes", 422),
        ("/missing", 404),
    ],
)
async def test_http_errors(
    http_client: httpx.AsyncClient, path: str, status: int
) -> None:
    response = await http_client.get(path)
    assert response.status_code == status, response.text
    assert {"code", "message"} <= response.json().keys()


async def test_http_browse_and_cursors(http_client: httpx.AsyncClient) -> None:
    schema_response = await http_client.get("/openapi.json")
    schema_response.raise_for_status()
    assert PREFIX in schema_response.json()["paths"]
    response = await http_client.get(PREFIX, params={"limit": 3})
    assert response.status_code == 200, response.text
    DeploymentPage.model_validate(response.json())
    page = response.json()
    assert page["limit"] == 3
    assert set(page) == {"items", "limit", "next_cursor", "previous_cursor"}
    assert page["previous_cursor"] is None
    second = await http_client.get(
        PREFIX, params={"limit": 3, "cursor": page["next_cursor"]}
    )
    DeploymentPage.model_validate(second.json())
    assert len(second.json()["items"]) <= 3
    for record in page["items"]:
        detail = await http_client.get(PREFIX + "/" + record["deployment_id"])
        assert detail.status_code == 200
        assert detail.json() == record
        assert detail.headers["etag"] == f'"{record["revision"]}"'
        assert record["created_at"].endswith("Z")
        assert not {"_id", "sync_version", "name_sort"} & record.keys()
        search = await http_client.get(PREFIX, params={"q": record["deployment_id"]})
        assert search.json()["items"] == [record]


async def test_http_attribute_patch(writable_client: httpx.AsyncClient) -> None:
    client = writable_client
    record = (await active_records(client))[0]
    revision = record["revision"]
    url = PREFIX + "/" + record["deployment_id"]
    missing = await client.patch(url, json={"attributes": {"http_test": "value"}})
    assert missing.status_code == 428
    invalid = await client.patch(
        url,
        headers={"If-Match": f'"{revision}"'},
        json={"attributes": {"bad.key": "x"}},
    )
    assert invalid.status_code == 422
    patched = await edit(client, url, revision, http_test="Literal [HTTP].* Probe")
    assert patched.status_code == 200, patched.text
    DeploymentOut.model_validate(patched.json())
    assert patched.json()["attributes"] == {
        **record["attributes"],
        "http_test": "Literal [HTTP].* Probe",
    }
    assert patched.headers["etag"] == f'"{revision + 1}"'
    search = await client.get(PREFIX, params={"q": " [http].* "})
    assert search.json()["items"] == [patched.json()]
    stale = await edit(client, url, revision, http_test="stale")
    assert stale.status_code == 412
    removed = await edit(client, url, revision + 1, http_test=None)
    assert removed.status_code == 200
    assert removed.json()["attributes"] == record["attributes"]
    assert (await client.get(url)).json() == removed.json()


async def test_http_delete_and_restore(writable_client: httpx.AsyncClient) -> None:
    client = writable_client
    record = (await active_records(client))[0]
    revision = record["revision"]
    url = PREFIX + "/" + record["deployment_id"]
    deleted = await client.delete(url, headers={"If-Match": f'"{revision}"'})
    assert deleted.status_code == 204, deleted.text
    assert deleted.content == b""
    assert deleted.headers["etag"] == f'"{revision + 1}"'
    assert (await client.get(url)).status_code == 404
    hidden = await client.get(url, params={"include_deleted": "true"})
    assert hidden.status_code == 200
    assert hidden.json()["deleted_at"] is not None
    repeat = await client.delete(url, headers={"If-Match": deleted.headers["etag"]})
    assert repeat.status_code == 409
    restored = await client.post(
        url + "/restore", headers={"If-Match": deleted.headers["etag"]}
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["deleted_at"] is None
    assert restored.headers["etag"] == f'"{revision + 2}"'
    DeploymentOut.model_validate(restored.json())
    assert (await client.get(url)).json() == restored.json()


async def test_http_competing_writes(writable_client: httpx.AsyncClient) -> None:
    record = (await active_records(writable_client))[0]
    url = PREFIX + "/" + record["deployment_id"]
    results = await asyncio.gather(
        *(
            edit(writable_client, url, record["revision"], http_race=value)
            for value in ("first", "second")
        )
    )
    assert sorted(response.status_code for response in results) == [200, 412]
    detail = await writable_client.get(url)
    winner = next(response for response in results if response.status_code == 200)
    assert detail.json() == winner.json()
    assert detail.json()["revision"] == record["revision"] + 1
