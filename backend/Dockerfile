# syntax=docker/dockerfile:1
FROM node:24.20.0-trixie-slim AS node-tools

FROM python:3.12-slim-trixie AS builder
COPY --from=ghcr.io/astral-sh/uv:0.12.10 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-dev --no-install-project
COPY backend/app ./app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-editable --reinstall-package deployments-backend

FROM builder AS tools
COPY --from=node-tools /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 \
    && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-editable
COPY backend/tests ./tests
COPY backend/openapi.json ./
COPY seed /seed
ENV PATH="/app/.venv/bin:$PATH"
CMD ["pytest"]

FROM python:3.12-slim-trixie AS runtime
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --no-create-home app \
    && mkdir -p /var/lib/deployments && chown app:app /var/lib/deployments
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:create_app", "--host", "0.0.0.0", "--port", "8000", "--factory"]
