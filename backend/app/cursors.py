"""Sign cursor boundaries bound to direction, generation, and normalized query."""

import hashlib
import json
from typing import Annotated, Literal
from uuid import UUID

from itsdangerous import BadData, URLSafeSerializer
from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    ValidationError,
)

from app.schemas import APIError, BrowseFilters


class CursorFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    generation: str
    fingerprint: str
    direction: Literal["forward", "backward"]
    deployment_id: UUID


class DateCursor(CursorFields):
    boundary_type: Literal["datetime"] = "datetime"
    boundary: AwareDatetime


class StringCursor(CursorFields):
    boundary_type: Literal["string"] = "string"
    boundary: str


type Cursor = Annotated[DateCursor | StringCursor, Field(discriminator="boundary_type")]
cursor_adapter: TypeAdapter[Cursor] = TypeAdapter(Cursor)


def fingerprint(filters: BrowseFilters) -> str:
    # Bind boundaries to query meaning, not filter order or search capitalization.
    normalized = filters.model_dump(exclude={"cursor"})
    normalized["q"] = filters.q.lower()
    for field in ("status", "type", "environment"):
        normalized[field] = sorted(set(normalized[field]))
    return hashlib.sha256(json.dumps(normalized, sort_keys=True).encode()).hexdigest()


def validate_cursor(cursor: Cursor, filters: BrowseFilters, generation: str) -> None:
    date_sort = filters.sort_by in {"created_at", "updated_at"}
    if date_sort != (cursor.boundary_type == "datetime"):
        raise APIError(
            422, "invalid_cursor", "Cursor does not match this result window"
        )
    if cursor.fingerprint != fingerprint(filters) or cursor.generation != generation:
        raise APIError(
            422, "invalid_cursor", "Cursor does not match this result window"
        )


class CursorCodec:
    def __init__(self, secret: str) -> None:
        self.signer = URLSafeSerializer(secret, salt="deployments-pagination")

    def encode(self, cursor: Cursor) -> str:
        return self.signer.dumps(cursor.model_dump(mode="json"))

    def decode(self, token: str, filters: BrowseFilters, generation: str) -> Cursor:
        try:
            cursor = cursor_adapter.validate_python(self.signer.loads(token))
            validate_cursor(cursor, filters, generation)
        except (BadData, ValidationError, ValueError, TypeError) as exc:
            raise APIError(
                422,
                "invalid_cursor",
                "Invalid pagination cursor; restart browsing",
            ) from exc
        else:
            return cursor
