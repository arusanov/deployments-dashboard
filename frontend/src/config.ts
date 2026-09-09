export const browsePolicy = {
  debounceMs: 300,
  pollIntervalMs: 3000,
  inactiveMs: 300_000,
  maxPages: 3,
  maxWindows: 10,
} as const;

// UI affordances and initial navigation; the server remains authoritative.
export const deploymentRules = {
  searchMaxLength: 200,
  maxAttributes: 100,
  recoveryDays: 30,
  defaultSort: "created_at",
  defaultOrder: "desc",
  defaultPageSize: 50,
} as const;
