import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pymongo import AsyncMongoClient
from pymongo.errors import PyMongoError
from starlette.middleware.base import RequestResponseEndpoint

from app.config import Settings
from app.dependencies import Services
from app.errors import register_error_handlers
from app.init_db import dataset_generation, validate_indexes
from app.models import MongoRecord
from app.routes import router
from app.schemas import ERROR_RESPONSES, APIError, Health

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        client = AsyncMongoClient[MongoRecord](
            config.mongo_uri,
            tz_aware=True,
            serverSelectionTimeoutMS=config.mongo_timeout_ms,
            connectTimeoutMS=config.mongo_timeout_ms,
            socketTimeoutMS=config.mongo_timeout_ms,
            # A lost acknowledgement requires reconciliation, never a replayed write.
            retryWrites=False,
            w=1,
            journal=True,
        )
        db = client[config.mongo_db]
        app.state.services = Services(db, config.cursor_secret.get_secret_value())

        index_failure: str | None = None

        async def ensure_ready() -> str:
            if index_failure is not None:
                raise APIError(503, "unavailable", index_failure)
            # This read also verifies connectivity; generation belongs to this request.
            return await dataset_generation(db)

        app.state.ensure_ready = ensure_ready
        try:
            try:
                await validate_indexes(db)
            except (RuntimeError, PyMongoError):
                index_failure = (
                    "Startup index validation failed; prepare the database and restart"
                )
                logger.warning(index_failure)
            try:
                await ensure_ready()
            except (APIError, PyMongoError):
                # Metadata/connectivity failures after index validation can recover.
                logger.warning("Database unavailable or unprepared at startup")
            yield
        finally:
            await client.close()

    app = FastAPI(title="Deployments API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_methods=["GET", "PATCH", "DELETE", "POST"],
        allow_headers=["Content-Type", "If-Match"],
        expose_headers=["ETag"],
    )

    register_error_handlers(app)

    @app.middleware("http")
    async def cache_headers(
        request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/health/live")
    async def live() -> Health:
        return Health()

    @app.get("/health/ready", responses=ERROR_RESPONSES)
    async def ready(request: Request) -> Health:
        await request.app.state.ensure_ready()
        return Health()

    app.include_router(router)
    return app
