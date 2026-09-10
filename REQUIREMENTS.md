# Deployments Dashboard

The assignment and evaluation criteria are preserved below. See [README.md](README.md)
for startup instructions and [DECISIONS.md](DECISIONS.md) for implementation tradeoffs.

## Background

You're building an internal dashboard for a platform team. The system manages deployment records — each deployment has metadata and user-defined key-value attributes (like tags or labels). The platform has thousands of deployments across multiple teams.

## Tech Stack

- **Frontend:** Next.js (React)
- **Backend:** FastAPI (Python)
- **Database:** MongoDB (provided via Docker Compose)

## Data Model

A deployment record has the following shape:

```json
{
  "deployment_id": "uuid",
  "version": "1.4.12",
  "status": "active | failed | stopped",
  "type": "web_service | worker | cron_job",
  "environment": "production | staging | development",
  "attributes": {
    "name": "checkout-api",
    "team": "payments",
    "region": "us-east-1"
  },
  "created_at": "2025-06-15T10:30:00Z",
  "created_by": "jane@example.com"
}
```

## Requirements

Build a dashboard that solves the following problems:

### 1. The platform has ~5,000 deployments and growing. Users need to browse them efficiently.

### 2. Users need to find specific deployments quickly. They might search by ID, name, creator, or any attribute value. They also need to narrow results by status, type, and environment. All filtering and searching should feel instant — no round-trips to the server for every keystroke.

### 3. Users want to see results ordered by different fields — newest first, alphabetically by name, grouped by status, etc.

### 4. Users frequently leave the dashboard and come back. Reloading all data every time is wasteful and slow.

### 5. Deployment names and descriptions need to be editable directly from the list view — users shouldn't have to open each deployment to make quick label changes.

### 6. Each deployment has custom key-value attributes. Users need to view, add, edit, and remove these from a detail view.

### 7. Deleted deployments need to remain recoverable for 30 days. The dashboard should not show them by default, but the system must support restoring them.

### 8. Multiple team members may view the dashboard simultaneously. The data they see should not be significantly stale.

## Evaluation Criteria

- **API Design** — RESTful conventions, proper status codes, consistent response shapes, error handling
- **Data Layer** — Query efficiency, proper indexing, how you model soft deletes and attributes
- **Frontend Architecture** — State management, data flow, separation of concerns, caching/sync strategy
- **UI/UX** — Functional table, responsive inline editing, sensible loading/error states. We're not judging visual design — no need for custom CSS beyond basic usability
- **Code Quality** — Readable, well-structured, no over-engineering. We value simplicity over cleverness
