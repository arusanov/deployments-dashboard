# Implementation decisions

Next.js, FastAPI, and MongoDB satisfy the eight [assignment requirements](REQUIREMENTS.md).
Setup and checks live in the component READMEs.

## Requirement map

| Requirement                 | Implementation                                                                                                                                      | Boundary                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1. Browse 5,000+ records    | [Cursor pagination](backend/app/pagination.py), 50 rows per page, three retained pages, [virtual table](frontend/src/deployments/table.tsx)         | No exact totals or random page jumps                           |
| 2. Search and filters       | [300 ms debounce](frontend/src/deployments/hooks/use-search.ts), [substring search and filters](backend/app/deployments.py)                         | Results require a request; search can scan                     |
| 3. Sorting                  | [Server ordering](backend/app/deployments.py) with direction-matched ID ties                                                                        | Browse indexes add storage and write work                      |
| 4. Reuse on return          | [Ten cached windows](frontend/src/cache/windows.ts), five-minute retention, [measured anchors](frontend/src/deployments/hooks/use-scroll-anchor.ts) | Mounted session only; reload fetches page one and loses drafts |
| 5. Inline edits             | [Versioned drafts](frontend/src/deployments/drafts.ts) and [revision preconditions](backend/app/mutations.py)                                       | Conflicts require review                                       |
| 6. Attribute management     | [Retained-row details](frontend/src/deployments/hooks/use-deployment-detail.ts), explicit Save/Cancel, [server validation](backend/app/schemas.py)  | Other metadata is read-only                                    |
| 7. Thirty-day recovery      | [Soft deletion and database-clock eligibility](backend/app/mutations.py), [TTL cleanup](backend/app/models.py)                                      | Physical deletion can lag the deadline                         |
| 8. Freshness across viewers | [Three-second polling and focus/reconnect refresh](frontend/src/deployments/hooks/use-deployment-pages.ts)                                          | Outages and slow reads delay visibility                        |

## API and validation

Pydantic/OpenAPI define validation. The checked-in schema generates TypeScript
contracts offline; `openapi-fetch` uses those types for requests. Browser checks
catch unusable responses and duplicate attribute keys; server errors leave drafts
editable. Direct async PyMongo keeps conditional writes and cursor queries explicit.
Next.js provides the shell and build; Client Components handle interaction.

## Browsing and search

Signed cursors bind the sort boundary and ID to direction, normalized query, and
dataset generation. They prevent tampering, not unauthorized access. Requests
fetch at most `limit + 1` records to detect continuation, without offsets.
Concurrent changes can cause repeats or omissions; displayed duplicates use the
newest revision. A cursor still works if its boundary record moves or disappears.

Search uses literal, case-insensitive substrings within individual values.
Matching within values is chosen over indexable prefix-only search, accepting scans.
Filters use OR within a field and AND across fields. Search commits after 300 ms; Enter
and clear commit immediately, and IME waits for composition. Filters/sorting commit
immediately. Names sort by a stored lowercase key, without locale collation.
See [indexes and performance](DATABASE.md) for query costs.

MongoDB [stores attributes](backend/app/attributes.py) as `attrs: [{k, v}]`;
API payloads use maps. Original
values support literal case-insensitive search through `attrs.v`, without per-row
map conversion or lowercase copies. Seed generation uses this storage shape.
Patches merge by unique key and atomically rebuild the array with `name_sort`.

## State ownership

| State                                            | Owner                                   |
| ------------------------------------------------ | --------------------------------------- |
| Server pages, cursors, fallback details          | TanStack Query                          |
| Committed search, filters, sort, view, selection | nuqs URL state                          |
| Versioned drafts, submissions, unresolved writes | Provider-created Zustand stores         |
| Scroll anchors and window recency                | Provider metadata, evicted with queries |
| Menus and editor focus                           | Local React state                       |

Separate drafts protect unsaved work from server refreshes. Provider stores isolate
dashboard sessions and let editors subscribe to individual drafts. Cursors stay
in query pages, outside the URL. Requirement 4 covers the mounted session: cached
return restores pages and anchors; reload keeps URL settings but loses pages and drafts.

## Scrolling, refresh, and recovery

MUI renders the table; Virtuoso virtualizes rows. Each window keeps three pages of
fifty rows. Measured scroll movement loads one adjacent page; data arrival never
loads further pages automatically. Loads and refreshes serialize; navigation cancels
pending work. Wheel, keyboard, and scrollbar input share these rules.

Anchors keep the visible record and pixel offset stable through prepend, eviction,
and refresh. If that record disappears, restoration uses the next surviving neighbor,
then the previous one. Restoration suppresses accidental page loads.

The active window refreshes its cursor chain sequentially every 3,000 ms.
Hidden/offline/inactive windows do not poll; focus/reconnect resumes reads.
The session retains ten windows at most; inactive windows expire after five minutes.
Polling needs no separate notification service, but does not guarantee freshness.

Invalid cursors reset once per activation; further failure requires explicit retry.
**Restart browsing** handles windows with an adjacent cursor but no scroll range.
It resets that window and anchor, preserves selection/drafts, and consumes the same
recovery allowance. Navigation cancels recovery.

Connection errors use a stable header slot to avoid moving the table. Its query
observer stays with the results reader to share recovery and cancellation. One
toast host uses notice IDs so an earlier timeout cannot dismiss newer feedback.
Dismissing feedback does not resolve an uncertain write.

## Writes and drafts

Mutations carry a quoted revision in `If-Match`. An atomic MongoDB update rechecks
revision and lifecycle, applies changes with database-clock timestamps, and increments
the revision. Only one writer can succeed for a given revision across API instances.

Immutable submissions complete only their draft version, preserving newer typing.
Drafts survive navigation, unmounts, and validation errors. Unchanged saves make no
request; one write or reconciliation runs at a time per tab to prevent duplicates.

Acknowledged patches/restores update retained rows, then refresh membership/order.
Refresh failure never reverses a save. DELETE returns only ID/revision, so its row
may look unchanged until refresh succeeds. Inactive windows become stale without fetching.

Timeouts can occur after commit. Writes never retry automatically. Reconciliation
reads current detail state for explicit acceptance or retry; already-applied values
need no new write. Dismissing review preserves this obligation, and late results
do not reopen it. This avoids a separate operation journal.

## Recovery and preparation

Soft deletion retains the record for thirty days. MongoDB-clock predicates enforce
visibility and restore eligibility; the atomic restore rechecks expiry. Repeated
deletion cannot extend retention. TTL handles eventual physical cleanup.

Preparation creates indexes and dataset metadata, preserving records and generation
on repeat. Explicit reset replaces the dataset and generation. Runtime only validates;
there are no migrations, backfills, or compatibility paths.

Startup checks indexes once. Failure keeps liveness but gates readiness/data with
`503` until preparation and restart. After successful validation, each readiness/data
request reads metadata once for connectivity, preparation, and request-scoped generation.
No separate ping or index inspection occurs. Outages/missing metadata can recover when
the dependency returns; index changes are detected on restart.

## Known limits

[Performance limits](DATABASE.md#performance) include scans, full-map payloads, and
memory use. Cache counts/time do not bound bytes or unsaved drafts. Browsing is live,
not a snapshot. Durable drafts and cross-tab cache sharing are not implemented.

This local assignment excludes authentication, audit history, production operations,
and sustained load testing. Published ports bind to loopback; host MongoDB access
requires the explicit override. Verification targets desktop Chromium, without
mobile/resize testing or other browsers. Component guides own test commands.
