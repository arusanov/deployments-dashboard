from typing import Any
from unittest.mock import patch

import httpx
import pytest
from fastapi import FastAPI
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.cursor import AsyncCursor

from app.config import Settings, now
from app.cursors import CursorCodec
from app.models import Database
from tests.conftest import RecordFactory
from tests.helpers import PREFIX, edit


@pytest.mark.parametrize("deleted", ["exclude", "only", "include"])
async def test_bounded_default_and_explicit_pages(
    client: httpx.AsyncClient, db: Database, record: RecordFactory, deleted: str
) -> None:
    await db.deployments.insert_many([
        record(i, deleted_at=now() if deleted == "only" else None) for i in range(1, 62)
    ])
    original = AsyncCursor.to_list
    reads = []

    async def bounded(cursor: AsyncCursor[Any], length: int | None = None) -> Any:
        reads.append(length)
        assert length is not None
        assert length <= 51
        return await original(cursor, length)

    with (
        patch.object(AsyncCursor, "to_list", bounded),
        patch.object(AsyncCursor, "skip", side_effect=AssertionError("No offsets")),
        patch.object(
            AsyncCollection, "count_documents", side_effect=AssertionError("No counts")
        ),
    ):
        first = (await client.get(PREFIX, params={"deleted": deleted})).json()
        assert len(first["items"]) == first["limit"] == 50
        second = (
            await client.get(
                PREFIX, params={"deleted": deleted, "cursor": first["next_cursor"]}
            )
        ).json()
        assert len(second["items"]) == 11
        assert second["next_cursor"] is None
        assert first["previous_cursor"] is None
        assert "total" not in first
        assert "offset" not in first
    assert reads == [51, 51]


async def test_fixed_page_contract(client: httpx.AsyncClient) -> None:
    assert (await client.get(PREFIX)).json()["limit"] == 50
    assert (await client.get(PREFIX, params={"limit": 7})).json()["limit"] == 7
    assert (await client.get(PREFIX, params={"limit": 51})).status_code == 422


@pytest.mark.parametrize(
    "params",
    [
        {"limit": -1},
        {"limit": 0},
        {"limit": 51},
        {"offset": 0},
        {"cursor": "x" * 32769},
    ],
)
async def test_rejected_pagination(
    client: httpx.AsyncClient, params: dict[str, str | int]
) -> None:
    assert (await client.get(PREFIX, params=params)).status_code == 422


async def test_boundaries_survive_deletion_and_movement(
    client: httpx.AsyncClient, db: Database, record: RecordFactory
) -> None:
    await db.deployments.insert_many([
        record(i, attributes={"name": chr(96 + i)}) for i in range(1, 7)
    ])
    params = {"limit": "2", "sort_by": "name", "sort_order": "asc"}
    first = (await client.get(PREFIX, params=params)).json()
    boundary = first["items"][-1]
    assert (
        await edit(client, PREFIX + "/" + boundary["deployment_id"], name="z")
    ).status_code == 200
    await db.deployments.delete_one({"deployment_id": boundary["deployment_id"]})
    second = (
        await client.get(PREFIX, params=params | {"cursor": first["next_cursor"]})
    ).json()
    assert [r["attributes"]["name"] for r in second["items"]] == ["c", "d"]
    await edit(client, PREFIX + "/" + second["items"][0]["deployment_id"], name="a")
    previous = (
        await client.get(PREFIX, params=params | {"cursor": second["previous_cursor"]})
    ).json()
    assert [r["attributes"]["name"] for r in previous["items"]] == ["a", "a"]


async def test_query_bound_tokens(
    client: httpx.AsyncClient, db: Database, record: RecordFactory
) -> None:
    await db.deployments.insert_many([record(i) for i in range(1, 4)])
    params = {"limit": "1", "q": " CHECKOUT ", "status": "active"}
    first = (await client.get(PREFIX, params=params)).json()
    token = first["next_cursor"]
    normalized = await client.get(
        PREFIX, params=params | {"q": "CHECKOUT", "cursor": token}
    )
    assert normalized.status_code == 200
    for changed in [
        {"q": "other"},
        {"q": "checkout"},
        {"limit": "2"},
        {"sort_by": "name"},
        {"sort_order": "asc"},
        {"deleted": "include"},
        {"status": "failed"},
        {"environment": "production"},
        {"type": "worker"},
    ]:
        response = await client.get(PREFIX, params=params | {"cursor": token} | changed)
        assert response.status_code == 422
        assert response.json()["code"] == "invalid_cursor"
    for invalid in ["garbage", token + "tampered"]:
        assert (
            await client.get(PREFIX, params=params | {"cursor": invalid})
        ).status_code == 422
    await db.dataset.update_one({}, {"$set": {"generation": "replacement"}})
    assert (
        await client.get(PREFIX, params=params | {"cursor": token})
    ).status_code == 422


async def test_cursor_rejects_unicode_queries_with_different_matches(
    client: httpx.AsyncClient, db: Database, record: RecordFactory
) -> None:
    await db.deployments.insert_many([
        record(i, attributes={"city": "İstanbul"}) for i in range(1, 3)
    ])
    params = {"q": "İstanbul", "limit": "1"}
    first = (await client.get(PREFIX, params=params)).json()
    assert first["next_cursor"] is not None
    changed = params | {"q": "i\u0307stanbul"}
    assert (await client.get(PREFIX, params=changed)).json()["items"] == []
    response = await client.get(
        PREFIX, params=changed | {"cursor": first["next_cursor"]}
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_cursor"


def test_removed_contract(app: FastAPI) -> None:
    contract = app.openapi()
    assert PREFIX + "/snapshot" not in contract["paths"]
    assert PREFIX + "/changes" not in contract["paths"]
    assert (
        not {"Snapshot", "Changes", "Deletion"}
        & contract["components"]["schemas"].keys()
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"boundary_type": "string"},
        {"boundary_type": "unknown"},
        {"boundary": "2026-01-01T00:00:00"},
        {"boundary": "not-a-date"},
        {"unexpected": "yes"},
    ],
)
async def test_signed_malformed_boundaries(
    client: httpx.AsyncClient,
    db: Database,
    record: RecordFactory,
    settings: Settings,
    changes: dict[str, str],
) -> None:
    await db.deployments.insert_many([record(1), record(2)])
    first = (await client.get(PREFIX, params={"limit": 1})).json()
    signer = CursorCodec(settings.cursor_secret.get_secret_value()).signer
    malformed = signer.dumps(signer.loads(first["next_cursor"]) | changes)
    response = await client.get(PREFIX, params={"limit": 1, "cursor": malformed})
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_cursor"


@pytest.mark.parametrize(
    "field",
    ["created_at", "updated_at", "name", "status", "type", "environment", "created_by"],
)
@pytest.mark.parametrize("order", ["asc", "desc"])
async def test_equal_sort_values_cross_boundaries_in_both_directions(
    client: httpx.AsyncClient,
    db: Database,
    record: RecordFactory,
    field: str,
    order: str,
) -> None:
    docs = [record(i) for i in (3, 1, 5, 2, 4)]
    await db.deployments.insert_many(docs)
    params = {"sort_by": field, "sort_order": order, "limit": "2"}
    pages = [(await client.get(PREFIX, params=params)).json()]
    while pages[-1]["next_cursor"]:
        pages.append(
            (
                await client.get(
                    PREFIX, params=params | {"cursor": pages[-1]["next_cursor"]}
                )
            ).json()
        )
    expected = sorted((doc["deployment_id"] for doc in docs), reverse=order == "desc")
    assert [row["deployment_id"] for page in pages for row in page["items"]] == expected
    for index in range(len(pages) - 1, 0, -1):
        previous = (
            await client.get(
                PREFIX, params=params | {"cursor": pages[index]["previous_cursor"]}
            )
        ).json()
        assert previous["items"] == pages[index - 1]["items"]
