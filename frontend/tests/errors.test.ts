import { describe, expect, it } from "vitest";
import { ApiError, NetworkError, ResponseError } from "../src/api/errors";
import { syncFailure } from "../src/cache/sync-status";

describe("synchronization error classification", () => {
  it("distinguishes unreachable API from API and schema failures", () => {
    expect(
      syncFailure(new NetworkError(new TypeError("fetch failed"))).kind,
    ).toBe("offline");
    expect(
      syncFailure(new ApiError(503, "unavailable", "Database unavailable")),
    ).toEqual({
      kind: "error",
      message: "The API could not load deployments: Database unavailable",
    });
    expect(syncFailure(new ResponseError("Invalid schema")).kind).toBe("error");
  });
});
