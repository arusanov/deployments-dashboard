import re
from typing import Literal

from app.attributes import decode_attributes
from app.config import MAX_ATTRIBUTES, RETENTION_SECONDS
from app.models import Collection, MongoRecord
from app.schemas import APIError, AttributePatch, Filters

type MutationAction = Literal["patch", "delete", "restore"]


def visibility(deleted: str) -> MongoRecord:
    # TTL cleanup is asynchronous; reads enforce the deadline using database time.
    recoverable = {
        "deleted_at": {"$ne": None},
        "$expr": {
            "$gt": [
                {"$add": ["$deleted_at", RETENTION_SECONDS * 1000]},
                "$$NOW",
            ]
        },
    }
    if deleted == "only":
        return recoverable
    if deleted == "include":
        return {"$or": [{"deleted_at": None}, recoverable]}
    return {"deleted_at": None}


def query(filters: Filters) -> MongoRecord:
    predicates = [visibility(filters.deleted)]
    predicates.extend(
        {field: {"$in": values}}
        for field, values in (
            ("status", filters.status),
            ("type", filters.type),
            ("environment", filters.environment),
        )
        if values
    )
    if filters.q:
        # Preserve literal substring semantics, including within each separate value.
        # Escaping prevents user input from becoming an executable regex pattern.
        pattern = re.escape(filters.q)
        predicates.append({
            "$or": [
                {field: {"$regex": pattern, "$options": "i"}}
                for field in ("deployment_id", "created_by", "attrs.v")
            ]
        })
    return {"$and": predicates}


def sort_order(filters: Filters) -> list[tuple[str, int]]:
    field = "name_sort" if filters.sort_by == "name" else filters.sort_by
    direction = 1 if filters.sort_order == "asc" else -1
    return [(field, direction), ("deployment_id", direction)]


async def get_record(
    collection: Collection, deployment_id: str, *, include_deleted: bool = False
) -> MongoRecord:
    record = await collection.find_one({
        "$and": [
            {"deployment_id": deployment_id},
            visibility("include" if include_deleted else "exclude"),
        ]
    })
    if record is None:
        raise APIError(404, "not_found", "Deployment not found")
    return record


def validate_mutation(
    record: MongoRecord, action: MutationAction, patch: AttributePatch | None
) -> dict[str, str] | None:
    deleted = record["deleted_at"] is not None
    if (action == "restore" and not deleted) or (action != "restore" and deleted):
        raise APIError(
            409, "invalid_transition", "Deployment is in an incompatible state"
        )
    if action == "patch":
        if patch is None:
            raise APIError(422, "invalid_input", "Attribute patch is required")
        merged = decode_attributes(record["attrs"]) | patch.attributes
        attributes = {key: value for key, value in merged.items() if value is not None}
        if len(attributes) > MAX_ATTRIBUTES:
            raise APIError(
                422, "invalid_input", "A deployment can have at most 100 attributes"
            )
        return attributes
    return None
