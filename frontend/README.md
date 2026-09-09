# Frontend

Next.js, React, MUI, and Virtuoso. [DECISIONS.md](../DECISIONS.md) explains state
ownership, scrolling, caching, and write recovery.

## Development

Keep MongoDB and the API in Docker. From the repository root:

```sh
docker compose stop frontend
docker compose up --build -d --wait backend
cd frontend
nvm install
nvm use
npm ci
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000>. Node 24 is pinned in `.nvmrc`; npm uses the lockfile.
`NEXT_PUBLIC_API_BASE_URL` defaults to `http://localhost:8000` and is embedded at
build time. Rebuild after changing it. See [backend configuration](../backend/README.md#run-the-stack-with-docker-compose)
for alternate ports and CORS.

For a production build, stop the development server or use a separate workspace/port:

```sh
npm run build
npm start
```

`npm start` runs the standalone server with its static assets.

## Checks

From `frontend/`:

```sh
npm run lint
npm run format:check
npm run typecheck
npm run knip
npm test
npm run build
npm run api:check
```

`npm run format` applies Prettier. ESLint warnings and unused code/dependencies
fail checks. Build separately when keeping a development server running.

## Generated API contract

After changing backend models, [refresh OpenAPI](../backend/README.md#openapi-snapshot),
then run from `frontend/`:

```sh
npm run api:generate
npm run api:check
```

Generation is offline. `src/api/generated/schema.ts` supplies types and enum values;
`src/api/options.ts` supplies UI labels. `src/config.ts` holds UI defaults and browse
limits. Server validation remains authoritative.

## Code map

Paths are relative to `src/`:

| Path                                                           | Responsibility                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `deployments/dashboard.tsx`, `deployments/browse-window.tsx`   | Navigation, stable controls, browse activation and recovery        |
| `deployments/hooks/`                                           | Paging, anchors, editors, detail reads                             |
| `deployments/mutations/`, `deployments/drafts.ts`              | Submissions, versioned drafts, write review                        |
| `cache/`                                                       | Query keys, bounded windows, provider stores and viewport metadata |
| `api/`                                                         | Typed requests, errors, generated contract                         |
| `components/`, `deployments/details/`, `deployments/table.tsx` | Shared controls, drawer, virtual table                             |

## Editing controls

Names/descriptions: Enter or leaving the editor saves, Escape cancels, and
Shift+Enter adds a description newline. Save/Cancel controls do not trigger blur
saving. Attributes use explicit Save/Cancel; closing details preserves the draft.
Tags show two custom attributes; **+N** opens the full list.

The connection indicator opens errors and retry. **Restart browsing** recovers a
window that cannot scroll without clearing unsaved work. See
[behavior rules](../DECISIONS.md#scrolling-refresh-and-recovery) for details.

## Disposable end-to-end tests

Requires Python 3, Node 24/npm, and Docker Compose 2.24.4+. From the root:

```sh
python3 scripts/verify.py frontend
# Override occupied ports:
python3 scripts/verify.py frontend --api-port 18110 --frontend-port 3011 --image-port 13110
```

Defaults: API **18000**, browser server **3001**, image smoke test **13000**.
The runner seeds an isolated database, runs all checks and production desktop
Chromium E2E in a temporary workspace, then checks the Docker frontend image.
It sets `TEST_API_URL`, `NEXT_PUBLIC_API_BASE_URL`, `TEST_FRONTEND_PORT`, and CORS
consistently. Published services bind to loopback.

Exit/interruption removes only this run's resources. Failures retain their exit
status and reports at the printed path; cleanup failure also exits nonzero.

Vitest covers debounce/IME, cache bounds, polling, cancellation, draft versions,
conflicts, uncertain writes, dismissed review, and acknowledged-save/refresh errors.
Playwright covers real CRUD, reload, accessibility, scroll anchors and input methods,
eviction, draft unmounts, and stable layout/focus during polling. Browser tests use
desktop Chromium only; responsive behavior remains, with no mobile/resize tests.
