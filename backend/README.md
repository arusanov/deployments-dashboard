# Backend

FastAPI, Python 3.12/uv, and async PyMongo. See [DECISIONS.md](../DECISIONS.md) for
write, pagination, and readiness rules; [DATABASE.md](../DATABASE.md) for indexes.

## Run the stack with Docker Compose

Use the [root quick start](../README.md#start-with-sample-data) for seed/start and
reset commands. `backend-init` prepares the database before the API starts.
Seeding stays explicit: the demo command runs it with API writers stopped;
ordinary Compose startup does not. Nonempty datasets are preserved unless reset.
Docker volumes retain MongoDB data and the generated cursor signing secret.
`CURSOR_SECRET` in `backend/.env` overrides that secret; keep it stable across restarts.

To change the API port, run from the root:

```sh
BACKEND_PORT=8001 NEXT_PUBLIC_API_BASE_URL=http://localhost:8001 docker compose up --build -d --wait
```

The browser API URL is embedded during build. To move the frontend to port 3002,
set `CORS_ORIGINS=["http://localhost:3002"]` in **`backend/.env`**, then run:

```sh
FRONTEND_PORT=3002 docker compose up --build -d --wait
```

Port/build variables may live in root `.env`. CORS belongs in `backend/.env`;
shell/root values are not forwarded. Include port 3000's origin too if needed.
Inside Docker, the API connects to `mongodb:27017`; MongoDB is unpublished.
The demo command accepts the same environment settings, including
`COMPOSE_PROJECT_NAME` to select a separate project; it uses only the main Compose file.

For manual preparation, stop the API, run
`docker compose run --rm backend-init python -m app.init_db`, then restart it.

## Run the backend directly on the host

Install Docker Compose and [uv](https://docs.astral.sh/uv/getting-started/installation/).
From the root:

```sh
docker compose -f docker-compose.yml -f docker-compose.host.yml up -d --wait mongodb
cd backend
uv sync --locked
cp .env.example .env
uv run python -c 'import secrets; print(secrets.token_urlsafe(48))'
```

Set `CURSOR_SECRET` in `.env` to the generated value and retain it across restarts.
`uv sync` installs Python 3.12 and locked dependencies in `.venv` as needed.

The host override publishes MongoDB on `127.0.0.1:27017`. For another port, set
`MONGO_PORT=27018` on the Compose command and `MONGO_URI=mongodb://localhost:27018`
in `.env`. Use both Compose files for later host-stack commands.

With the API stopped, seed an empty database, prepare, and start:

```sh
uv run --env-file .env python ../seed/seed.py
uv run python -m app.init_db
uv run uvicorn app.main:create_app --factory --reload
```

Seeding fills an empty database, including a prepared one, and skips if any
deployments exist. Skip seeding to start empty. Preparation preserves records and
generation. To **replace all deployments**, stop API writers, run
`uv run --env-file .env python ../seed/seed.py --reset`, prepare again, and restart.
Reset invalidates cursors. Startup only validates; see
[readiness behavior](../DECISIONS.md#recovery-and-preparation).

## Configuration

Commands run from `backend/` read `.env`; environment variables override it.
The seed script needs `--env-file .env` explicitly.

| Variable             | Default / requirement                                 |
| -------------------- | ----------------------------------------------------- |
| `MONGO_URI`          | `mongodb://localhost:27017`                           |
| `MONGO_DB`           | `deployments`                                         |
| `CURSOR_SECRET`      | At least 32 characters; overrides the file setting    |
| `CURSOR_SECRET_FILE` | Required if no secret is set; Compose supplies a file |
| `CORS_ORIGINS`       | JSON array; `["http://localhost:3000"]`               |
| `MONGO_TIMEOUT_MS`   | `3000`; range 100–30000                               |
| `TEST_MONGO_URI`     | Tests only; `mongodb://localhost:27017`               |

## HTTP contract

[Interactive docs](http://localhost:8000/docs) and [OpenAPI](openapi.json) define
all fields and validation limits. `/health/live` reports liveness;
`/health/ready` checks readiness. Healthy responses are `{"status":"ok"}`.

| Method | Path                            | Result                                      |
| ------ | ------------------------------- | ------------------------------------------- |
| GET    | `/api/deployments`              | `{items,limit,next_cursor,previous_cursor}` |
| GET    | `/api/deployments/{id}`         | Record and revision ETag                    |
| PATCH  | `/api/deployments/{id}`         | Updated attributes, record and ETag         |
| DELETE | `/api/deployments/{id}`         | Soft deletion; `204` and new ETag           |
| POST   | `/api/deployments/{id}/restore` | Restored record and ETag                    |

List parameters:

- `q`: literal, case-insensitive substring in ID, creator, or any attribute value;
  embedded NUL characters are rejected with `422 invalid_input`.
- Repeated `status`, `type`, `environment`: OR within a field, AND across fields.
- `deleted=exclude|only|include`: defaults to `exclude`; expired records stay hidden.
- `sort_by=created_at|updated_at|name|status|type|environment|created_by` and
  `sort_order=asc|desc`: default `created_at DESC`; ID ties follow that direction.
- `limit`: 1–50, default 50. No offsets or exact totals.
- `cursor`: pass either returned cursor with unchanged query parameters.
  Preserve the search text's case when following a cursor.
  Null means the end; `invalid_cursor` requires restarting at page one.

```sh
curl 'http://localhost:8000/api/deployments?q=checkout&status=active&environment=production'
```

Detail reads need `include_deleted=true` to include recoverable deleted records.
Mutations require the current quoted revision in `If-Match`. Replace the UUID and
example revision with values from your detail response:

```sh
curl -i 'http://localhost:8000/api/deployments/DEPLOYMENT_UUID'
curl -i -X PATCH 'http://localhost:8000/api/deployments/DEPLOYMENT_UUID' \
  -H 'Content-Type: application/json' -H 'If-Match: "1"' \
  -d '{"attributes":{"name":"checkout-api","label":null}}'
```

String values add/replace attributes; null removes keys; omitted keys stay unchanged.
Every accepted mutation increments revision. Metadata is read-only.
ETags must be a single quoted positive integer. Writes never retry automatically:
a timeout can follow a committed write, so read current detail state before retry.

Errors use `{"code":"…","message":"…","details":…}` with optional details:

| Status | Code                              | Meaning                            |
| ------ | --------------------------------- | ---------------------------------- |
| 404    | `not_found`                       | Missing, expired, or hidden record |
| 409    | `invalid_transition`              | Invalid lifecycle operation        |
| 412    | `revision_conflict`               | Stale revision                     |
| 422    | `invalid_input`, `invalid_cursor` | Invalid request                    |
| 428    | `precondition_required`           | Missing `If-Match`                 |
| 503    | `unavailable`                     | Database or preparation failure    |

Other routing errors use `http_error`. Resource responses use `Cache-Control: no-store`.
Restore's `404` explains that the record may be missing or past its recovery period;
TTL cleanup can remove the evidence needed to distinguish them.

## Checks and development

For the complete suite, from the root (Python 3 and Docker Compose 2.24.4+ required):

```sh
python3 scripts/verify.py backend
python3 -m unittest discover -s scripts -p 'test_*.py'
```

The runner uses locked tools and an isolated Compose project, including mutating
HTTP tests. It publishes no ports and removes only its own resources on exit or
interruption. Failures retain their status and logs; cleanup failure exits nonzero.
Script tests cover demo ordering, build/test/startup failures, interruption, and cleanup.

For local checks, from `backend/` with MongoDB available and Node 24 for Pyright:

```sh
uv sync --locked
uv run pytest
uv run ruff check . ../seed/seed.py
uv run ruff format --check . ../seed/seed.py
uv run mypy
uv run pyright
uv run pytest tests/test_contract.py -k exported_contract
```

Ruff, strict Mypy, and Pyright cover app, tests, and seed code. Configuration lives
in `pyproject.toml`. Format with `uv run ruff format . ../seed/seed.py`; add packages
with `uv add` or `uv add --dev` and commit the lockfile.

Tests create `test_deployments_<uuid>` databases and only clean up that prefix.
Coverage includes pagination/ties, revision races, uncertain writes, readiness,
expiry, and contract drift. Physical TTL cleanup is optional:
`uv run pytest -m ttl` may take 90 seconds.

For read-only HTTP checks against a running API:

```sh
TEST_API_URL=http://localhost:8000 uv run pytest -m http
```

## OpenAPI snapshot

From `backend/`, export without starting the API or MongoDB:

```sh
uv run python - <<'PYTHON'
import json
from pathlib import Path
from pydantic import SecretStr
from app.config import Settings
from app.main import create_app

settings = Settings(_env_file=None, cursor_secret=SecretStr("offline-contract-generation-secret-32"))
Path("openapi.json").write_text(json.dumps(create_app(settings).openapi(), indent=2) + "\n")
PYTHON
uv run pytest tests/test_contract.py -k exported_contract
```

Then [regenerate frontend types](../frontend/README.md#generated-api-contract).
