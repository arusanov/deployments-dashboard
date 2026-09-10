import {
  InfiniteQueryObserver,
  type InfiniteData,
} from "@tanstack/react-query";
import type { DeploymentPage } from "../src/api/client";
import type { Notify } from "../src/components/toast-host";
import { afterEach, expect, it, vi } from "vitest";
import { api, apiUrl } from "../src/api/client";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ApiError } from "../src/api/errors";
import { createWriteStore } from "../src/deployments/mutations/write-store";
import { queryKeys } from "../src/cache/keys";
import { testSession } from "./session";
import { record } from "./fixtures";
import type { Write } from "../src/deployments/mutations/types";

afterEach(() => {
  vi.restoreAllMocks();
});

function submission() {
  const session = testSession();
  const notify = vi.fn<Notify>();
  const writes = createWriteStore(session.client, session.stores, notify);
  const base = record();
  const key = `${base.deployment_id}:name`;
  session.stores.inline.set(key, {
    base,
    value: "Draft",
    version: "version",
    state: { phase: "editing" },
  });
  const claimed = session.stores.inline.claim(key, "version");
  if (!claimed) {
    throw new Error("Missing claim");
  }
  const write: Write = {
    record: base,
    action: "patch",
    attributes: { name: "Draft" },
    draft: { kind: "inline", key, version: "version", submission: claimed },
  };
  return { ...session, writes, write, key, notify };
}

it("keeps known validation failures editable without a reconciliation read", async () => {
  const { writes, write, stores, key } = submission();
  vi.spyOn(api, "patch").mockRejectedValue(
    new ApiError(422, "invalid_input", "Too long"),
  );
  const detail = vi.spyOn(api, "detail");
  expect((await writes.execute(write))?.kind).toBe("validation");
  writes.dismissReview();
  expect(stores.inline.get(key)?.state.phase).toBe("rejected");
  expect(detail).not.toHaveBeenCalled();
});

it("keeps acknowledged values and newer drafts when the real query refresh fails", async () => {
  const { writes, write, stores, key, client, notify } = submission();
  const unrelated = record({ deployment_id: crypto.randomUUID() });
  const page: DeploymentPage = {
    items: [write.record, unrelated],
    limit: 50,
    next_cursor: "next",
    previous_cursor: "previous",
  };
  const queryKey = queryKeys.window({ q: "active" });
  const inactiveKey = queryKeys.window({ q: "inactive" });
  const newerKey = queryKeys.window({ q: "newer" });
  const cached = { pages: [page], pageParams: ["boundary"] };
  client.setQueryData(inactiveKey, cached);
  client.setQueryData(newerKey, {
    ...cached,
    pages: [{ ...page, items: [record({ revision: 3 })] }],
  });
  const observer = new InfiniteQueryObserver(client, {
    queryKey,
    queryFn: () =>
      Promise.reject(new ApiError(503, "unavailable", "Read failed")),
    initialPageParam: "boundary",
    getNextPageParam: (page: DeploymentPage) => page.next_cursor,
    initialData: cached,
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(vi.fn());
  try {
    const request = Promise.withResolvers<ReturnType<typeof record>>();
    vi.spyOn(api, "patch").mockReturnValue(request.promise);
    const pending = writes.execute(write);
    const draft = stores.inline.get(key);
    if (!draft) {
      throw new Error("Missing draft");
    }
    stores.inline.set(key, {
      ...draft,
      value: "Newer",
      version: "newer",
      state: { phase: "unresolved" },
    });
    const saved = record({ revision: 2, attributes: { name: "Draft" } });
    request.resolve(saved);
    expect((await pending)?.kind).toBe("saved");
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().isRefetchError).toBe(true),
    );
    expect(stores.inline.get(key)?.value).toBe("Newer");
    for (const key of [queryKey, inactiveKey]) {
      const data = client.getQueryData<InfiniteData<DeploymentPage>>(key);
      expect(data?.pages[0]?.items).toEqual([saved, unrelated]);
      expect(data?.pages[0]?.items[1]).toBe(unrelated);
      expect(data?.pageParams).toEqual(["boundary"]);
      expect(data?.pages[0]?.next_cursor).toBe("next");
      expect(data?.pages[0]?.previous_cursor).toBe("previous");
    }
    expect(
      client.getQueryData<InfiniteData<DeploymentPage>>(newerKey)?.pages[0]
        ?.items[0]?.revision,
    ).toBe(3);
    expect(client.getQueryState(inactiveKey)?.fetchStatus).toBe("idle");
    expect(
      client.getQueryData(queryKeys.detail(write.record.deployment_id)),
    ).toEqual(saved);
    expect(writes.getState().review).toBeUndefined();
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: "Changes saved.",
        severity: "success",
      }),
    );
  } finally {
    unsubscribe();
    client.clear();
  }
});

it("allows only one pending reconciliation and ignores a dismissed late response", async () => {
  const { writes, write } = submission();
  vi.spyOn(api, "patch").mockRejectedValue(
    new ApiError(503, "unavailable", "Unknown"),
  );
  const request = Promise.withResolvers<ReturnType<typeof record>>();
  const detail = vi.spyOn(api, "detail").mockReturnValue(request.promise);
  const pending = writes.execute(write);
  await vi.waitFor(() => {
    expect(writes.getState().phase).toBe("reconciling");
  });
  const review = writes.getState().review;
  if (!review) {
    throw new Error("Missing review");
  }
  await writes.reconcile(review.write, "Again");
  expect(detail).toHaveBeenCalledTimes(1);
  writes.dismissReview();
  request.resolve(record({ revision: 2 }));
  await pending;
  expect(writes.getState().review).toBeUndefined();
  expect(writes.getState().phase).toBe("idle");
});

it("accepts an already-applied unknown write without writing twice", async () => {
  const { writes, write, stores, key, client, notify } = submission();
  const patch = vi
    .spyOn(api, "patch")
    .mockRejectedValue(new ApiError(503, "unavailable", "Unknown"));
  vi.spyOn(api, "detail").mockResolvedValue(
    record({ revision: 2, attributes: { name: "Draft" } }),
  );
  await writes.execute(write);
  expect(
    client.getQueryData(queryKeys.detail(write.record.deployment_id)),
  ).toMatchObject({ revision: 2 });
  await writes.acceptReview();
  expect(stores.inline.get(key)).toBeUndefined();
  expect(patch).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Changes saved." }),
  );
});

it.each(["delete", "restore"] as const)(
  "remembers uncertain %s after dismissal and requires a fresh read before retry",
  async (action) => {
    const { writes, write } = submission();
    const mutation = vi
      .spyOn(api, action)
      .mockRejectedValue(new ApiError(503, "unavailable", "Unknown"));
    const detail = vi
      .spyOn(api, "detail")
      .mockRejectedValue(new ApiError(503, "unavailable", "Read failed"));
    const input: Write = { record: write.record, action };
    await writes.execute(input);
    writes.dismissReview();
    await writes.execute(input);
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(detail).toHaveBeenCalledTimes(2);
    expect(writes.getState().review?.current).toBeUndefined();
    writes.dismissReview();
    detail.mockResolvedValue(
      record({
        revision: 2,
        deleted_at: action === "restore" ? "2026-09-01T00:00:00Z" : null,
      }),
    );
    await writes.execute(input);
    expect(mutation).toHaveBeenCalledTimes(1);
    await writes.retryReview();
    expect(mutation).toHaveBeenCalledTimes(2);
  },
);

it.each(["added", "__proto__", "constructor", "toString"])(
  "reconciles reverted uncertain %s additions without overwriting unrelated values",
  async (key) => {
    const { writes, write } = submission();
    const patch = vi
      .spyOn(api, "patch")
      .mockRejectedValue(new ApiError(503, "unavailable", "Unknown"));
    const current = record({
      revision: 2,
      attributes: { name: "Uncertain", [key]: "Maybe", remote: "Keep" },
    });
    vi.spyOn(api, "detail").mockResolvedValue(current);
    await writes.execute({
      ...write,
      draft: undefined,
      attributes: { name: "Uncertain", [key]: "Maybe" },
    });
    writes.dismissReview();
    await writes.execute({
      record: write.record,
      action: "patch",
      attributes: {},
      desiredAttributes: write.record.attributes,
      reconcileFirst: true,
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(writes.getState().review?.write.attributes).toEqual({
      name: write.record.attributes.name,
      [key]: null,
    });
    expect(JSON.stringify(writes.getState().review?.write.attributes)).toBe(
      JSON.stringify({ name: write.record.attributes.name, [key]: null }),
    );
    patch.mockRestore();
    let body: string | undefined;
    let revision: string | null = null;
    const server = setupServer(
      http.patch(`${apiUrl}/api/deployments/:id`, async ({ request }) => {
        body = await request.text();
        revision = request.headers.get("If-Match");
        return HttpResponse.json({
          ...current,
          revision: 3,
          attributes: { ...write.record.attributes, remote: "Keep" },
        });
      }),
    );
    server.listen({ onUnhandledRequest: "error" });
    try {
      await writes.retryReview();
      expect(body).toBe(
        JSON.stringify({
          attributes: { name: write.record.attributes.name, [key]: null },
        }),
      );
      expect(revision).toBe('"2"');
      expect(writes.getState().review).toBeUndefined();
    } finally {
      server.close();
    }
  },
);

it.each(["added", "__proto__", "constructor", "toString"])(
  "preserves an own %s value when reverting an uncertain removal",
  async (key) => {
    const { writes, write } = submission();
    const original = {
      ...write.record,
      attributes: { ...write.record.attributes, [key]: "Original" },
    };
    const patch = vi
      .spyOn(api, "patch")
      .mockRejectedValue(new ApiError(503, "unavailable", "Unknown"));
    vi.spyOn(api, "detail").mockResolvedValue(
      record({
        revision: 2,
        attributes: { ...write.record.attributes, remote: "Keep" },
      }),
    );
    await writes.execute({
      record: original,
      action: "patch",
      attributes: { [key]: null },
    });
    writes.dismissReview();
    await writes.execute({
      record: original,
      action: "patch",
      attributes: {},
      desiredAttributes: original.attributes,
      reconcileFirst: true,
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(writes.getState().review?.write.attributes).toEqual({
      [key]: "Original",
    });
    patch.mockResolvedValue({ ...original, revision: 3 });
    await writes.retryReview();
    expect(patch).toHaveBeenLastCalledWith(original.deployment_id, 2, {
      [key]: "Original",
    });
  },
);
