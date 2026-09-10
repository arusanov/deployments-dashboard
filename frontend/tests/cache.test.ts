import type { DeploymentPage } from "../src/api/client";
import { renderHook } from "@testing-library/react";
import { hashKey } from "@tanstack/react-query";
import { testSession } from "./session";
import { useSessionStores } from "../src/cache/session-stores";
import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { limitWindows, windowRows } from "../src/cache/windows";
import { createSessionStores } from "../src/cache/session-stores";
import { record } from "./fixtures";

const page = (number: number, revision = 1): DeploymentPage => ({
  items: [record({ deployment_id: String(number), revision })],
  limit: 1,
  next_cursor: number < 8 ? String(number + 1) : null,
  previous_cursor: number > 0 ? String(number - 1) : null,
});

describe("bounded result windows", () => {
  it("deduplicates IDs at their backend position with the highest revision", () => {
    expect(windowRows([page(1, 1), page(2), page(1, 3)])).toEqual([
      page(2).items[0],
      page(1, 3).items[0],
    ]);
  });
  it("evicts the oldest inactive windows beyond ten", () => {
    const client = new QueryClient();

    const stores = createSessionStores();

    for (let i = 0; i < 12; i++) {
      const key = ["deployments", String(i)];

      stores.windows.set(JSON.stringify(key), { lastUsed: i });
      client.setQueryData(key, page(i));
    }

    limitWindows(client, '["deployments","11"]', stores.windows);
    expect(stores.windows.size).toBe(10);
    expect(client.getQueryCache().findAll()).toHaveLength(10);
    expect(client.getQueryData(["deployments", "0"])).toBeUndefined();
    client.clear();
  });
});

it("removes viewport metadata with its query while preserving independent drafts", () => {
  const { client, stores, wrapper } = testSession();
  renderHook(() => useSessionStores(), { wrapper });
  const key = ["deployments", "test", {}];
  client.setQueryData(key, page(1));
  stores.windows.set(hashKey(key), {
    lastUsed: 1,
    anchor: { id: "1", offset: -13 },
  });
  stores.inline.set("draft", {
    version: "version",
    state: { phase: "editing" },
    base: record(),
    value: "Keep",
  });
  client.removeQueries({ queryKey: key, exact: true });
  expect(stores.windows.size).toBe(0);
  expect(stores.inline.get("draft")?.value).toBe("Keep");
});
