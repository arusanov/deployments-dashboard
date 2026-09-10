import {
  ApiError,
  NetworkError,
  ResponseError,
  errorMessage,
} from "@/api/errors";

export interface SyncStatus {
  kind: "online" | "updating" | "offline" | "error";
  message?: string;
}

export function syncFailure(error: unknown): SyncStatus {
  if (error instanceof NetworkError) {
    return {
      kind: "offline",
      message:
        "Connection interrupted. Reconnect to load deployments or save edits.",
    };
  }

  if (error instanceof ApiError) {
    return {
      kind: "error",
      message: `The API could not load deployments: ${error.message}`,
    };
  }

  if (error instanceof ResponseError) {
    return { kind: "error", message: error.message };
  }

  return {
    kind: "error",
    message: errorMessage(
      error,
      "Could not refresh deployments. Retry to continue.",
    ),
  };
}

export function syncStatus(query: {
  error: Error | null;
  fetchStatus: "fetching" | "paused" | "idle";
  isFetching: boolean;
  isPending: boolean;
}): SyncStatus {
  return query.error
    ? syncFailure(query.error)
    : {
        kind:
          query.fetchStatus === "paused"
            ? "offline"
            : query.isFetching || query.isPending
              ? "updating"
              : "online",
      };
}
