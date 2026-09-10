import type { Deployment } from "../src/api/client";

export const record = (overrides: Partial<Deployment> = {}): Deployment => ({
  deployment_id: "12345678-1234-4234-8234-123456789012",
  version: "1.0.0",
  status: "active",
  type: "web_service",
  environment: "production",
  attributes: { name: "Checkout", description: "Payments API" },
  created_by: "jane@example.com",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
  revision: 1,
  ...overrides,
});
