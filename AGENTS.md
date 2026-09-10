# Deployments Dashboard

Preserve REQUIREMENTS.md's eight requirements and unrelated/untracked work.
Backend: `backend/`; samples: `seed/`; dashboard: `frontend/`.
Root README owns quick start; component READMEs own setup/checks; DECISIONS.md owns
rationale/limits; DATABASE.md owns indexes and a short performance note.
Keep docs concise. Do not submit temporary benchmarks.

## Implementation

- Greenfield project: no users or deployed versions. No backward compatibility,
  migrations, backfills, upgrade handling, or historical tests/comparisons.
  Describe only the current implementation.
- Prefer small modules and established packages. Use Python 3.12/uv and locked
  dependencies; keep dynamic types at external boundaries.
- Use async PyMongo, atomic revision/lifecycle preconditions, MongoDB clocks,
  query-bound signed cursors, and thirty-day recovery.
- Preparation and sample resets are explicit commands. Startup/requests only
  validate readiness; never add automatic write recovery.
- TanStack Query owns server data; nuqs owns committed navigation; provider-created
  Zustand stores own versioned drafts/writes; provider metadata owns viewport state.
- Preserve movement-driven bidirectional Virtuoso scrolling, measured anchors,
  serialized loads/refresh, and navigation cancellation. No automatic page draining
  or manual pagination controls.
- Cursors stay in TanStack Query, outside the URL. Reload starts at page one;
  cached return restores pages and measured anchors.
- Preserve page/cache/debounce/poll limits. Invalid cursors reset once per activation;
  further failure requires explicit retry.
- Capture immutable submissions; complete only their draft version. Preserve drafts
  across navigation/validation errors. Unknown writes require reconciliation before
  explicit retry. Never retry writes automatically or undo a save after refresh failure.
  Details reuse retained rows.
- Pydantic/OpenAPI own validation. Check in OpenAPI; generate frontend types offline.
  Frontend configuration keeps only UI-used defaults/constraints.

## Verification

Run affected component checks. Mutating tests use disposable project databases;
clean up only those resources. Keep development services available; build production
browser tests in a separate workspace. Use desktop Chrome only, preserving responsive
behavior without mobile/resize tests.

Cover anchors, cache bounds, polling, draft versions, conflicts, uncertain writes,
dismissed reconciliation, and acknowledged-save/refresh regressions.
