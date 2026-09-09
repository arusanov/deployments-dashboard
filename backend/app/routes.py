import re
from http import HTTPStatus
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response

from app.dependencies import Service
from app.deployments import get_record
from app.mutations import mutate
from app.pagination import browse
from app.schemas import (
    ERROR_RESPONSES,
    APIError,
    AttributePatch,
    BrowseFilters,
    DeploymentOut,
    DeploymentPage,
)

router = APIRouter(
    prefix="/api/deployments", tags=["deployments"], responses=ERROR_RESPONSES
)


def expected_revision(
    if_match: Annotated[str, Header(description='Revision ETag, e.g. "1"')],
) -> int:
    if not re.fullmatch(r'"[1-9][0-9]{0,18}"', if_match):
        raise APIError(
            422, "invalid_input", 'If-Match must be one quoted integer, e.g. "1"'
        )
    revision = int(if_match[1:-1])
    if revision > 2**63 - 1:
        raise APIError(422, "invalid_input", "Revision is outside the supported range")
    return revision


Revision = Annotated[int, Depends(expected_revision)]


@router.get("")
async def list_deployments(
    services: Service,
    filters: Annotated[BrowseFilters, Query()],
) -> DeploymentPage:
    return await browse(services, filters)


@router.get("/{deployment_id}")
async def detail(
    deployment_id: UUID,
    services: Service,
    response: Response,
    *,
    include_deleted: bool = False,
) -> DeploymentOut:
    record = await get_record(
        services.db.deployments, str(deployment_id), include_deleted=include_deleted
    )
    response.headers["ETag"] = f'"{record["revision"]}"'
    return DeploymentOut.from_record(record)


@router.patch("/{deployment_id}")
async def patch(
    deployment_id: UUID,
    body: AttributePatch,
    revision: Revision,
    services: Service,
    response: Response,
) -> DeploymentOut:
    record = await mutate(
        services.db.deployments, str(deployment_id), revision, "patch", body
    )
    response.headers["ETag"] = f'"{record.revision}"'
    return record


@router.delete("/{deployment_id}", status_code=204)
async def delete(
    deployment_id: UUID, revision: Revision, services: Service
) -> Response:
    record = await mutate(
        services.db.deployments, str(deployment_id), revision, "delete"
    )
    return Response(status_code=204, headers={"ETag": f'"{record.revision}"'})


@router.post("/{deployment_id}/restore")
async def restore(
    deployment_id: UUID,
    revision: Revision,
    services: Service,
    response: Response,
) -> DeploymentOut:
    try:
        record = await mutate(
            services.db.deployments, str(deployment_id), revision, "restore"
        )
    except APIError as error:
        if error.status == HTTPStatus.NOT_FOUND and error.body.code == "not_found":
            raise APIError(
                404,
                "not_found",
                "Deployment not found or its 30-day recovery period has expired.",
            ) from error
        raise
    response.headers["ETag"] = f'"{record.revision}"'
    return record
