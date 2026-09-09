import asyncio

import httpx
import pytest

from app.models import Database, MongoRecord
from tests.helpers import edit


async def test_merge_remove_and_etags(
    client: httpx.AsyncClient, url: str, db: Database
) -> None:
    assert (await client.get(url)).headers["etag"] == '"1"'
    result = await edit(client, url, name="NEW Name", description="hello", team=None)
    assert result.status_code == 200, result.text
    assert result.headers["etag"] == '"2"'
    assert result.json()["attributes"] == {"name": "NEW Name", "description": "hello"}
    result = await edit(client, url, 2, description=None, missing=None)
    assert result.json()["attributes"] == {"name": "NEW Name"}
    stored = await db.deployments.find_one({})
    assert stored is not None
    assert stored["name_sort"] == "new name"
    assert stored["revision"] == 3
    assert stored["attrs"] == [{"k": "name", "v": "NEW Name"}]
    assert "attrs" not in result.json()
    assert "sync_version" not in stored
    assert "revision_id" not in stored


async def test_literal_attributes_and_empty_map(
    client: httpx.AsyncClient, url: str, db: Database
) -> None:
    attributes = {"name": "$status", "custom": "$$NOW", "team": None}
    response = await edit(client, url, **attributes)
    assert response.status_code == 200
    assert response.json()["attributes"] == {"name": "$status", "custom": "$$NOW"}
    stored = await db.deployments.find_one({})
    assert stored is not None
    assert stored["attrs"] == [
        {"k": "name", "v": "$status"},
        {"k": "custom", "v": "$$NOW"},
    ]
    assert stored["name_sort"] == "$status"
    response = await edit(client, url, 2, name=None, custom=None)
    assert response.json()["attributes"] == {}
    stored = await db.deployments.find_one({})
    assert stored is not None
    assert stored["attrs"] == []
    assert not stored["name_sort"]


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"attributes": {}},
        {"attributes": {"": "x"}},
        {"attributes": {"a.b": "x"}},
        {"attributes": {"$bad": "x"}},
        {"attributes": {"nul\x00": "x"}},
        {"attributes": {"x" * 129: "x"}},
        {"attributes": {"x": "x" * 4097}},
        {"attributes": {"x": 1}},
        {"attributes": {"x": True}},
        {"attributes": {"x": []}},
        {"attributes": {"name": "x"}, "status": "failed"},
    ],
)
async def test_invalid_patches(
    client: httpx.AsyncClient, url: str, body: MongoRecord
) -> None:
    result = await client.patch(url, json=body, headers={"If-Match": '"1"'})
    assert result.status_code == 422
    assert result.json()["code"] == "invalid_input"


async def test_attribute_limits(client: httpx.AsyncClient, url: str) -> None:
    result = await edit(client, url, **{f"k{i}": "v" for i in range(98)})
    assert result.status_code == 200
    assert len(result.json()["attributes"]) == 100
    assert (await edit(client, url, 2, extra="v")).status_code == 422
    assert (await edit(client, url, 2, k0=None, extra="v")).status_code == 200
    assert (
        await edit(client, url, 3, **{"k" * 128: "v" * 4096}, extra=None)
    ).status_code == 200


@pytest.mark.parametrize(
    ("header", "status"),
    [(None, 428), ('"2"', 412), ("1", 422), ("*", 422), ('W/"1"', 422)],
)
async def test_preconditions(
    client: httpx.AsyncClient, url: str, header: str | None, status: int
) -> None:
    response = await client.patch(
        url,
        headers={"If-Match": header} if header else {},
        json={"attributes": {"name": "x"}},
    )
    assert response.status_code == status


async def test_competing_writes(client: httpx.AsyncClient, url: str) -> None:
    results = await asyncio.gather(
        edit(client, url, name="one"), edit(client, url, name="two")
    )
    assert sorted(result.status_code for result in results) == [200, 412]
    assert (await client.get(url)).json()["revision"] == 2


async def test_lifecycle_and_races(client: httpx.AsyncClient, url: str) -> None:
    assert (
        await client.post(url + "/restore", headers={"If-Match": '"1"'})
    ).status_code == 409
    responses = await asyncio.gather(
        client.delete(url, headers={"If-Match": '"1"'}), edit(client, url, name="race")
    )
    assert sorted(r.status_code for r in responses) in ([204, 412], [200, 412])
    current = (await client.get(url, params={"include_deleted": True})).json()
    if current["deleted_at"] is None:
        assert (
            await client.delete(url, headers={"If-Match": '"2"'})
        ).status_code == 204
        current["revision"] = 3
    revision = current["revision"]
    assert (await client.get(url)).status_code == 404
    assert (await edit(client, url, revision, name="no")).status_code == 409
    headers = {"If-Match": f'"{revision}"'}
    assert (await client.delete(url, headers=headers)).status_code == 409
    responses = await asyncio.gather(
        client.post(url + "/restore", headers=headers),
        client.delete(url, headers=headers),
    )
    assert responses[0].status_code == 200
    assert responses[1].status_code in {409, 412}
    assert (await client.get(url)).status_code == 200
