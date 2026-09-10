import logging

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pymongo.errors import PyMongoError
from starlette.exceptions import HTTPException

from app.schemas import APIError, ValidationIssue

logger = logging.getLogger(__name__)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(APIError)
    def api_error(_request: Request, exc: APIError) -> JSONResponse:
        return JSONResponse(
            exc.body.model_dump(exclude_none=True), status_code=exc.status
        )

    @app.exception_handler(RequestValidationError)
    def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        if any(
            error["loc"] == ("header", "if-match") and error["type"] == "missing"
            for error in exc.errors()
        ):
            return api_error(
                request,
                APIError(
                    428,
                    "precondition_required",
                    "Supply the deployment ETag in If-Match",
                ),
            )
        if any(error["loc"] == ("query", "cursor") for error in exc.errors()):
            return api_error(
                request, APIError(422, "invalid_cursor", "Invalid page cursor")
            )
        details = [
            ValidationIssue(
                location=list(error["loc"]),
                message=error["msg"],
                type=error["type"],
            )
            for error in exc.errors()
        ]
        return api_error(
            request, APIError(422, "invalid_input", "Invalid request", details)
        )

    @app.exception_handler(PyMongoError)
    def database_error(request: Request, exc: PyMongoError) -> JSONResponse:
        logger.warning(
            "Database operation failed for %s %s",
            request.method,
            request.url.path,
            exc_info=exc,
        )
        return api_error(request, APIError(503, "unavailable", "Database unavailable"))

    @app.exception_handler(HTTPException)
    def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        if exc.status_code == status.HTTP_400_BAD_REQUEST:
            return api_error(
                request, APIError(422, "invalid_input", "Invalid request body")
            )
        return JSONResponse(
            {"code": "http_error", "message": str(exc.detail)},
            status_code=exc.status_code,
            headers=exc.headers,
        )
