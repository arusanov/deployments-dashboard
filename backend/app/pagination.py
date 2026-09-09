"""Browse by sort key and ID, using signed cursors bound to the query and dataset."""

from typing import Literal

from app.cursors import DateCursor, StringCursor, fingerprint
from app.dependencies import RequestServices
from app.deployments import query, sort_order
from app.models import MongoRecord
from app.schemas import BrowseFilters, DeploymentOut, DeploymentPage


async def browse(services: RequestServices, filters: BrowseFilters) -> DeploymentPage:
    generation = services.generation
    boundary = (
        services.cursors.decode(filters.cursor, filters, generation)
        if filters.cursor
        else None
    )
    backward = boundary is not None and boundary.direction == "backward"
    ordering = sort_order(filters)
    field, order = ordering[0]
    predicate = query(filters)
    if boundary:
        # Reverse both the primary order and ID tie-breaker for backward traversal.
        comparison = "$gt" if (order == 1) != backward else "$lt"
        predicate["$and"].append({
            "$or": [
                {field: {comparison: boundary.boundary}},
                {
                    field: boundary.boundary,
                    "deployment_id": {comparison: str(boundary.deployment_id)},
                },
            ]
        })
    limit = filters.limit
    # One lookahead row determines continuation without an exact count or offset.
    # This bounds materialized records, not the work needed to filter them.
    records = (
        await services.db.deployments
        .find(predicate)
        .sort([
            (key, -direction if backward else direction) for key, direction in ordering
        ])
        .limit(limit + 1)
        .to_list(length=limit + 1)
    )
    more = len(records) > limit
    records = records[:limit]
    if backward:
        records.reverse()

    def token(record: MongoRecord, direction: Literal["forward", "backward"]) -> str:
        return services.cursors.encode(
            (DateCursor if field in {"created_at", "updated_at"} else StringCursor)(
                generation=generation,
                fingerprint=fingerprint(filters),
                direction=direction,
                boundary=record[field],
                deployment_id=record["deployment_id"],
            )
        )

    next_cursor = previous_cursor = None
    if records:
        if (backward and boundary) or (not backward and more):
            next_cursor = token(records[-1], "forward")
        if (backward and more) or (not backward and boundary):
            previous_cursor = token(records[0], "backward")
    elif boundary:
        # An empty live page can still navigate back after its records disappear.
        reverse = boundary.model_copy(
            update={"direction": "forward" if backward else "backward"}
        )
        if backward:
            next_cursor = services.cursors.encode(reverse)
        else:
            previous_cursor = services.cursors.encode(reverse)
    return DeploymentPage(
        items=[DeploymentOut.from_record(record) for record in records],
        limit=limit,
        next_cursor=next_cursor,
        previous_cursor=previous_cursor,
    )
