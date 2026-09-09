from dataclasses import dataclass
from typing import Annotated, cast

from fastapi import Depends, Request

from app.cursors import CursorCodec
from app.models import Database


class Services:
    def __init__(self, db: Database, secret: str) -> None:
        self.db = db
        self.cursors = CursorCodec(secret)


@dataclass(frozen=True)
class RequestServices:
    db: Database
    cursors: CursorCodec
    generation: str


async def service(request: Request) -> RequestServices:
    generation = cast("str", await request.app.state.ensure_ready())
    shared = cast("Services", request.app.state.services)
    return RequestServices(shared.db, shared.cursors, generation)


Service = Annotated[RequestServices, Depends(service)]
