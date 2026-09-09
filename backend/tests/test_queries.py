import operator
from datetime import timedelta

import httpx
import pytest

from app.config import now
from app.models import Database
from tests.conftest import RecordFactory
from tests.helpers import PREFIX


@pytest.mark.parametrize(
    "search", ["CHECKOUT", "jAnE@", "PAYMENTS", "000000000001", "  checkout  "]
)
@pytest.mark.usefixtures("deployment")
async def test_search_fields(client: httpx.AsyncClient, search: str) -> None:
    result = await client.get(PREFIX, params={"q": search})
    assert result.status_code == 200, result.text
    assert len(result.json()["items"]) == 1


async def test_arbitrary_literal_search(
    client: httpx.AsyncClient, db: Database, record: RecordFactory
) -> None:
    await db.deployments.insert_many([
        record(1, attributes={"new": "literal.*[x]", "left": "abc", "right": "def"}),
        record(2, attributes={"new": "literalanythingx"}),
    ])
    for search, total in [(".*[x]", 1), ("abcdef", 0), ("new", 0), ("", 2), ("   ", 2)]:
        response = await client.get(PREFIX, params={"q": search})
        assert len(response.json()["items"]) == total
    assert (await client.get(PREFIX, params={"q": "a" * 201})).status_code == 422


@pytest.mark.parametrize(
    "case",
    [("ς", "Σ", True), ("İ", "i", False), ("PAYMENTS", "payments", True)],
)
async def test_unicode_attribute_search(
    client: httpx.AsyncClient,
    db: Database,
    record: RecordFactory,
    case: tuple[str, str, bool],
) -> None:
    value, search, matches = case
    await db.deployments.insert_one(record(attributes={"custom": value}))
    response = await client.get(PREFIX, params={"q": search})
    assert response.status_code == 200
    assert len(response.json()["items"]) == int(matches)


async def test_full_uuid_search_includes_other_values(
    client: httpx.AsyncClient, db: Database, record: RecordFactory
) -> None:
    first = record(1)
    identifier = first["deployment_id"]
    await db.deployments.insert_many([
        first,
        record(2, attributes={"reference": f"deployment {identifier}"}),
        record(3, created_by=f"{identifier}@example.com"),
    ])
    response = await client.get(PREFIX, params={"q": identifier})
    assert response.status_code == 200
    assert len(response.json()["items"]) == 3


async def test_filters(
    client: httpx.AsyncClient, db: Database, record: RecordFactory
) -> None:
    await db.deployments.insert_many([
        record(1),
        record(2, status="failed"),
        record(3, type="worker", environment="staging"),
        record(4, status="stopped", environment="development"),
    ])
    cases: list[tuple[dict[str, str | list[str]], int]] = [
        ({"status": ["active", "failed"]}, 3),
        ({"type": ["worker", "cron_job"]}, 1),
        ({"environment": ["staging", "development"]}, 2),
        (
            {
                "status": ["active", "failed"],
                "type": "web_service",
                "environment": "production",
            },
            2,
        ),
        ({"status": "failed", "q": "checkout"}, 1),
    ]
    for params, total in cases:
        result = await client.get(PREFIX, params=params)
        assert len(result.json()["items"]) == total, result.text


@pytest.mark.parametrize(
    "field",
    ["created_at", "updated_at", "name", "status", "type", "environment", "created_by"],
)
@pytest.mark.parametrize("order", ["asc", "desc"])
async def test_sort_and_ties(
    client: httpx.AsyncClient,
    db: Database,
    record: RecordFactory,
    field: str,
    order: str,
) -> None:
    docs = [record(3), record(1), record(2)]
    if field == "name":
        docs[0]["attrs"] = [{"k": "name", "v": "ZEBRA"}]
        docs[0]["name_sort"] = "zebra"
        docs[1]["attrs"] = []
        docs[1]["name_sort"] = ""
    elif field in {"created_at", "updated_at"}:
        docs[0][field] += timedelta(days=1)
    elif field == "status":
        docs[0][field] = "stopped"
    elif field == "type":
        docs[0][field] = "worker"
    elif field == "environment":
        docs[0][field] = "staging"
    else:
        docs[0][field] = "zoe@example.com"
    await db.deployments.insert_many(docs)
    key = "name_sort" if field == "name" else field
    expected = sorted(
        docs,
        key=operator.itemgetter(key, "deployment_id"),
        reverse=order == "desc",
    )
    params = {"sort_by": field, "sort_order": order, "limit": "1"}
    first = (await client.get(PREFIX, params=params)).json()
    second = (
        await client.get(PREFIX, params=params | {"cursor": first["next_cursor"]})
    ).json()
    third = (
        await client.get(PREFIX, params=params | {"cursor": second["next_cursor"]})
    ).json()
    assert [
        r["deployment_id"] for r in first["items"] + second["items"] + third["items"]
    ] == [r["deployment_id"] for r in expected]
    previous = (
        await client.get(PREFIX, params=params | {"cursor": second["previous_cursor"]})
    ).json()
    assert previous["items"] == first["items"]
    assert previous["previous_cursor"] is None
    assert third["next_cursor"] is None


async def test_visibility(
    client: httpx.AsyncClient, db: Database, record: RecordFactory
) -> None:
    await db.deployments.insert_many([
        record(1),
        record(2, deleted_at=now() - timedelta(days=1)),
        record(3, deleted_at=now() - timedelta(days=31)),
    ])
    for deleted, total in [("exclude", 1), ("only", 1), ("include", 2)]:
        result = await client.get(PREFIX, params={"deleted": deleted})
        assert len(result.json()["items"]) == total


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 201},
        {"limit": 0},
        {"offset": -1},
        {"status": "bad"},
        {"deleted": "bad"},
        {"sort_by": "attributes"},
    ],
)
async def test_invalid_queries(
    client: httpx.AsyncClient, params: dict[str, str | int]
) -> None:
    assert (await client.get(PREFIX, params=params)).status_code == 422
