from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.attributes import decode_attributes
from app.config import (
    ATTRIBUTE_KEY_MAX_LENGTH,
    ATTRIBUTE_KEY_MIN_LENGTH,
    ATTRIBUTE_VALUE_MAX_LENGTH,
    CURSOR_MAX_LENGTH,
    SEARCH_MAX_LENGTH,
)
from app.models import (
    DeploymentFields,
    DeploymentType,
    Environment,
    MongoRecord,
    Status,
)


class DeploymentOut(DeploymentFields):
    model_config = ConfigDict(from_attributes=True)
    attributes: dict[str, str]

    @classmethod
    def from_record(cls, record: MongoRecord) -> Self:
        return cls.model_validate(
            record | {"attributes": decode_attributes(record["attrs"])}
        )


class DeploymentPage(BaseModel):
    items: list[DeploymentOut]
    limit: int
    next_cursor: str | None
    previous_cursor: str | None


class Filters(BaseModel):
    q: str = Field(default="", max_length=SEARCH_MAX_LENGTH)
    status: list[Status] = []
    type: list[DeploymentType] = []
    environment: list[Environment] = []
    deleted: Literal["exclude", "only", "include"] = "exclude"
    sort_by: Literal[
        "created_at",
        "updated_at",
        "name",
        "status",
        "type",
        "environment",
        "created_by",
    ] = "created_at"
    sort_order: Literal["asc", "desc"] = "desc"

    @field_validator("q", mode="before")
    @classmethod
    def trim_search(cls, value: str) -> str:
        return value.strip()


AttributeKey = Annotated[
    str,
    StringConstraints(
        min_length=ATTRIBUTE_KEY_MIN_LENGTH,
        max_length=ATTRIBUTE_KEY_MAX_LENGTH,
        pattern="^[^.$\x00][^.\x00]*$",
    ),
]
AttributeValue = Annotated[
    str, StringConstraints(strict=True, max_length=ATTRIBUTE_VALUE_MAX_LENGTH)
]


class AttributePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attributes: dict[AttributeKey, AttributeValue | None] = Field(
        min_length=1,
        # patternProperties alone permits unmatched keys and omits key length bounds.
        # Make the exported contract reflect the runtime AttributeKey validation.
        json_schema_extra={
            "additionalProperties": False,
            "propertyNames": {
                "minLength": ATTRIBUTE_KEY_MIN_LENGTH,
                "maxLength": ATTRIBUTE_KEY_MAX_LENGTH,
            },
        },
    )


class BrowseFilters(Filters):
    model_config = ConfigDict(extra="forbid")
    limit: int = Field(default=50, ge=1, le=50)
    cursor: str | None = Field(default=None, min_length=1, max_length=CURSOR_MAX_LENGTH)


class ValidationIssue(BaseModel):
    location: list[str | int]
    message: str
    type: str


class Error(BaseModel):
    code: str
    message: str
    details: list[ValidationIssue] | None = None


class APIError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: list[ValidationIssue] | None = None,
    ) -> None:
        self.status = status
        self.body = Error(code=code, message=message, details=details)


class Health(BaseModel):
    status: Literal["ok"] = "ok"


ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    status: {"model": Error} for status in (404, 409, 412, 422, 428, 503)
}
