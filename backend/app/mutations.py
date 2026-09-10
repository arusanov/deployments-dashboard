"""Match revision and lifecycle atomically so only one writer can accept a revision."""

from pymongo import ReturnDocument

from app.attributes import encode_attributes
from app.config import RETENTION_SECONDS
from app.deployments import MutationAction, get_record, validate_mutation
from app.models import Collection, MongoRecord
from app.schemas import APIError, AttributePatch, DeploymentOut


async def mutate(
    collection: Collection,
    deployment_id: str,
    revision: int,
    action: MutationAction,
    patch: AttributePatch | None = None,
) -> DeploymentOut:
    record = await get_record(collection, deployment_id, include_deleted=True)
    if record["revision"] != revision:
        raise APIError(412, "revision_conflict", "The deployment has changed")
    attributes = validate_mutation(record, action, patch)
    update: MongoRecord = {
        "updated_at": "$$NOW",
        "revision": {"$add": ["$revision", 1]},
    }
    if attributes is not None:
        update |= {
            # Pipeline expressions must not interpret user values such as "$status".
            "attrs": {"$literal": encode_attributes(attributes)},
            "name_sort": {"$literal": attributes.get("name", "").lower()},
        }
    elif action == "delete":
        update["deleted_at"] = "$$NOW"
    else:
        update["deleted_at"] = None
    condition: MongoRecord = {
        # Recheck both revision and lifecycle after validation, in the atomic write.
        "deployment_id": deployment_id,
        "revision": revision,
        "deleted_at": record["deleted_at"],
    }
    if action == "restore":
        # A restore queued before expiry may execute after it; use MongoDB's clock.
        condition["$expr"] = {
            "$gt": [
                {"$add": ["$deleted_at", RETENTION_SECONDS * 1000]},
                "$$NOW",
            ]
        }
    result = await collection.find_one_and_update(
        condition, [{"$set": update}], return_document=ReturnDocument.AFTER
    )
    if result is None:
        current = await get_record(collection, deployment_id, include_deleted=True)
        if current["revision"] != revision:
            raise APIError(412, "revision_conflict", "The deployment has changed")
        raise APIError(404, "not_found", "Deployment not found")
    return DeploymentOut.from_record(result)
