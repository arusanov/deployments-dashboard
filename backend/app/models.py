from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator
from pymongo import IndexModel
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.asynchronous.database import AsyncDatabase

from app.attributes import StoredAttribute, decode_attributes
from app.config import MAX_ATTRIBUTES, RETENTION_SECONDS

type MongoRecord = dict[str, Any]
type Database = AsyncDatabase[MongoRecord]
type Collection = AsyncCollection[MongoRecord]

Status = Literal["active", "failed", "stopped"]
DeploymentType = Literal["web_service", "worker", "cron_job"]
Environment = Literal["production", "staging", "development"]


class DeploymentFields(BaseModel):
    deployment_id: UUID
    version: str
    status: Status
    type: DeploymentType
    environment: Environment
    created_at: datetime
    created_by: str
    updated_at: datetime
    deleted_at: datetime | None = None
    revision: int = Field(ge=1)


class Deployment(DeploymentFields):
    attrs: list[StoredAttribute] = Field(max_length=MAX_ATTRIBUTES)
    name_sort: str

    @field_validator("attrs")
    @classmethod
    def unique_attributes(cls, value: list[StoredAttribute]) -> list[StoredAttribute]:
        decode_attributes(value)
        return value


# Active sorts fix deleted_at to null. Both sort keys reverse together, so one
# ascending compound index supports either direction for each primary field.
INDEXES = [
    IndexModel("deployment_id", unique=True),
    *[
        IndexModel([("deleted_at", 1), (field, 1), ("deployment_id", 1)])
        for field in (
            "created_at",
            "updated_at",
            "name_sort",
            "status",
            "type",
            "environment",
            "created_by",
        )
    ],
    IndexModel("deleted_at", expireAfterSeconds=RETENTION_SECONDS),
]
