import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { http, HttpResponse, delay } from "msw";
import { setupServer } from "msw/node";
import {
  type InfiniteData,
  hashKey,
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { useLayoutEffect, useState, type ComponentProps } from "react";
import type { BrowseQuery } from "../src/api/client";
import { windowRows } from "../src/cache/windows";
import type { DeploymentPage } from "../src/api/client";
import { apiUrl } from "../src/api/client";
import { useDeploymentPages } from "../src/deployments/hooks/use-deployment-pages";
import Dashboard from "../src/deployments/dashboard";
import { useBrowseState } from "../src/deployments/url-state";
import { browseParameters, queryKeys } from "../src/cache/keys";
import type { DeploymentTable } from "../src/deployments/table";
import {
  createSessionStores,
  SessionStoresProvider,
  useSessionStores,
} from "../src/cache/session-stores";
import { record } from "./fixtures";

// Window tests exercise reset ownership; measured eligibility is tested with the real table.
vi.mock("../src/deployments/table", () => ({
  DeploymentTable: ({
    restart,
    fetching,
  }: ComponentProps<typeof DeploymentTable>) => (
    <button disabled={fetching} onClick={restart}>
      Restart browsing
    </button>
  ),
}));
vi.mock("../src/deployments/detail", () => ({ default: () => null }));

const root = `${apiUrl}/api/deployments`;

let calls: URL[] = [];

const clients: QueryClient[] = [];

const server = setupServer(
  http.get(root, ({ request }) => {
    const url = new URL(request.url);

    calls.push(url);
    const start = Number(url.searchParams.get("cursor") ?? 0);

    const limit = Number(url.searchParams.get("limit"));

    return HttpResponse.json({
      items: Array.from({ length: limit }, (_, i) =>
        record({
          deployment_id: `00000000-0000-4000-8000-${String(start + i + 1).padStart(12, "0")}`,
        }),
      ),
      limit,
      next_cursor: String(start + limit),
      previous_cursor: start > 0 ? String(Math.max(0, start - limit)) : null,
    });
  }),
);

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
beforeEach(() => {
  calls = [];
});
afterEach(() => {
  server.resetHandlers();

  for (const client of clients.splice(0)) {
    client.clear();
  }

  vi.useRealTimers();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});
afterAll(() => {
  server.close();
});

function browse(searchParams = "") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  let navigation: ReturnType<typeof useBrowseState>;
  let reader: ReturnType<typeof useDeploymentPages>;
  function Reader({ params }: { params: BrowseQuery }) {
    const [initial] = useState(params);
    const result = useDeploymentPages(initial, false);
    useLayoutEffect(() => {
      reader = result;
    });
    return null;
  }
  function Window() {
    const value = useBrowseState();
    const params = browseParameters(value[0]);
    const key = JSON.stringify(queryKeys.window(params));
    useLayoutEffect(() => {
      navigation = value;
    });
    return <Reader key={key} params={params} />;
  }
  const view = render(
    <QueryClientProvider client={client}>
      <SessionStoresProvider>
        <NuqsTestingAdapter hasMemory searchParams={searchParams}>
          <Window />
        </NuqsTestingAdapter>
      </SessionStoresProvider>
    </QueryClientProvider>,
  );
  return {
    ...view,
    client,
    load: async (direction: "next" | "previous") => {
      const queryKey = queryKeys.window(browseParameters(navigation[0]));
      await waitFor(() =>
        expect(client.getQueryState(queryKey)?.fetchStatus).toBe("idle"),
      );
      await act(async () => {
        await reader.load(direction);
      });
      await waitFor(() =>
        expect(reader.query.data).toBe(client.getQueryData(queryKey)),
      );
    },
    result: {
      get current() {
        const [state, update] = navigation;
        return {
          ...reader,
          state,
          update,
          queryKey: queryKeys.window(browseParameters(state)),
        };
      },
    },
  };
}
function dashboard(searchParams = "") {
  const stores = createSessionStores();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  let writes: ReturnType<typeof useSessionStores>["writes"];
  let navigation: ReturnType<typeof useBrowseState>;
  function Navigation() {
    const session = useSessionStores();
    const value = useBrowseState();
    useLayoutEffect(() => {
      navigation = value;
      writes = session.writes;
    });
    return null;
  }
  const view = render(
    <QueryClientProvider client={client}>
      <SessionStoresProvider stores={stores}>
        <NuqsTestingAdapter hasMemory searchParams={searchParams}>
          <Navigation />
          <Dashboard />
        </NuqsTestingAdapter>
      </SessionStoresProvider>
    </QueryClientProvider>,
  );
  return {
    ...view,
    client,
    stores,
    get writes() {
      return writes;
    },
    result: {
      get current() {
        const [state, update] = navigation;
        const queryKey = queryKeys.window(browseParameters(state));
        const data =
          client.getQueryData<InfiniteData<DeploymentPage>>(queryKey);
        const status = client.getQueryState(queryKey)?.status;
        return {
          state,
          update,
          rows: windowRows(data?.pages ?? []),
          query: {
            isError: status === "error",
            refetch: () => client.refetchQueries({ queryKey, exact: true }),
          },
        };
      },
    },
  };
}

async function retry() {
  fireEvent.click(screen.getByRole("button", { name: "Connection details" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry sync" }));
}

it("caps retained pages, refreshes the chain, and loads backward", async () => {
  const view = browse();

  await waitFor(() => {
    expect(view.result.current.rows).toHaveLength(50);
  });
  expect(calls).toHaveLength(1);

  for (let i = 0; i < 3; i++) {
    await view.load("next");
  }

  expect(view.result.current.query.data?.pages).toHaveLength(3);
  expect(view.result.current.rows).toHaveLength(150);
  calls = [];
  await act(async () => {
    await view.result.current.query.refetch();
  });
  expect(calls.map((url) => url.searchParams.get("cursor"))).toEqual([
    "50",
    "100",
    "150",
  ]);
  await view.load("previous");
  await waitFor(() => {
    expect(view.result.current.query.data?.pageParams).toEqual([
      "0",
      "50",
      "100",
    ]);
  });
});

it("cancels obsolete HTTP requests when filters change", async () => {
  let aborted = false;

  let started = false;

  server.use(
    http.get(root, async ({ request }) => {
      if (new URL(request.url).searchParams.get("q") === "slow") {
        started = true;
        request.signal.addEventListener("abort", () => {
          aborted = true;
        });
        await delay(500);
      }

      return HttpResponse.json({
        items: [record()],
        limit: 2,
        next_cursor: null,
        previous_cursor: null,
      });
    }),
  );
  const view = browse("?q=slow");

  await waitFor(() => {
    expect(started).toBe(true);
  });
  await act(async () => {
    await view.result.current.update({ q: "new" });
  });
  await waitFor(() => {
    expect(view.result.current.query.isSuccess).toBe(true);
  });
  expect(aborted).toBe(true);
});

it("pauses hidden polling and offline reads, resumes on focus/reconnect, and never polls inactive windows", async () => {
  const view = browse();

  await waitFor(() => {
    expect(view.result.current.rows).toHaveLength(50);
  });
  focusManager.setFocused(false);
  calls = [];
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 3200));
  });
  expect(calls).toHaveLength(0);
  act(() => {
    focusManager.setFocused(true);
  });
  await waitFor(() => {
    expect(calls).toHaveLength(1);
  });
  await act(async () => {
    await view.result.current.update({ q: "active window", view: "trash" });
  });
  calls = [];
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 3200));
  });
  expect(calls.length).toBeGreaterThan(0);
  expect(
    calls.every(
      (url) =>
        url.searchParams.get("q") === "active window" &&
        url.searchParams.get("deleted") === "only",
    ),
  ).toBe(true);
  onlineManager.setOnline(false);
  calls = [];
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 3200));
  });
  expect(calls).toHaveLength(0);
  act(() => {
    onlineManager.setOnline(true);
  });
  await waitFor(() => {
    expect(calls).toHaveLength(1);
  });
}, 15000);

it("starts at the beginning after changing filters and returning to an evicted window", async () => {
  const view = browse();

  await waitFor(() => {
    expect(view.result.current.rows).toHaveLength(50);
  });
  for (let index = 0; index < 3; index++) {
    await view.load("next");
  }
  expect(view.result.current.query.data?.pageParams[0]).toBe("50");
  const originalKey = view.result.current.queryKey;

  await act(async () => {
    await view.result.current.update({ q: "another" });
  });
  await waitFor(() => {
    expect(view.result.current.query.isSuccess).toBe(true);
  });
  view.client.removeQueries({
    queryKey: originalKey,
    exact: true,
  });
  calls = [];
  await act(async () => {
    await view.result.current.update({ q: "" });
  });
  await waitFor(() => {
    expect(view.result.current.query.isSuccess).toBe(true);
  });
  expect(calls[0]?.searchParams.get("cursor")).toBeNull();
});

it("refreshes retained batches from fresh continuation cursors, never saved boundaries", async () => {
  const view = browse();
  await waitFor(() => {
    expect(view.result.current.rows).toHaveLength(50);
  });
  await view.load("next");
  await view.load("next");
  const requests: (string | null)[] = [];
  let active = 0;
  let maximum = 0;
  server.use(
    http.get(root, async ({ request }) => {
      const cursor = new URL(request.url).searchParams.get("cursor");
      requests.push(cursor);
      maximum = Math.max(maximum, ++active);
      await delay(10);
      active--;
      return HttpResponse.json({
        items: [record()],
        limit: 50,
        next_cursor: String(Number(cursor ?? 0) + 100),
        previous_cursor: null,
      });
    }),
  );
  await act(async () => {
    await view.result.current.query.refetch();
  });
  expect(requests).toEqual([null, "100", "200"]);
  expect(maximum).toBe(1);
});

it("restores cached rows and ignores an old adjacent action after navigation", async () => {
  const view = browse();
  await waitFor(() => expect(view.result.current.rows).toHaveLength(50));
  for (let index = 0; index < 3; index++) {
    await view.load("next");
  }
  expect(view.result.current.query.data?.pageParams).toEqual([
    "50",
    "100",
    "150",
  ]);
  const rows = view.result.current.rows;
  const oldLoad = view.result.current.load;
  await act(async () => {
    await view.result.current.update({ q: "other" });
  });
  await waitFor(() => expect(view.result.current.query.isSuccess).toBe(true));
  calls = [];
  await act(async () => {
    await oldLoad("next");
  });
  expect(calls).toHaveLength(0);
  await act(async () => {
    await view.result.current.update({ q: "" });
  });
  expect(view.result.current.rows).toEqual(rows);
  expect(view.result.current.rows[0]).toBe(rows[0]);
  expect(calls).toHaveLength(0);
  expect(view.result.current.query.data?.pageParams).toEqual([
    "50",
    "100",
    "150",
  ]);
});

it("discards an invalid cursor once per activation and stops resetting on a second failure", async () => {
  const requests: (string | null)[] = [];

  server.use(
    http.get(root, ({ request }) => {
      requests.push(new URL(request.url).searchParams.get("cursor"));

      return HttpResponse.json(
        { code: "invalid_cursor", message: "Invalid cursor" },
        { status: 422 },
      );
    }),
  );
  const view = dashboard();

  await waitFor(() => {
    expect(requests).toEqual([null, null]);
  });
  await waitFor(() => {
    expect(view.result.current.query.isError).toBe(true);
  });
  expect(screen.getByText(/Invalid cursor/)).toBeVisible();
});

it("resumes polling after explicit retry of a failed cursor reset", async () => {
  server.use(
    http.get(root, () =>
      HttpResponse.json(
        { code: "invalid_cursor", message: "Invalid" },
        { status: 422 },
      ),
    ),
  );
  const view = dashboard();
  await waitFor(() => {
    expect(view.result.current.query.isError).toBe(true);
  });
  await screen.findByRole("status", { name: "Synchronization error" });
  server.resetHandlers();
  await retry();
  await waitFor(() => {
    expect(view.result.current.rows).toHaveLength(50);
  });
  calls = [];
  await waitFor(
    () => {
      expect(calls).toHaveLength(1);
    },
    { timeout: 4000 },
  );
});

it("keeps selection and equivalent normalized changes in the same activation", async () => {
  const view = dashboard("?status=failed,active&q=HELLO");
  await waitFor(() => expect(view.result.current.rows).toHaveLength(50));
  const rows = view.result.current.rows;
  const search = screen.getByRole("textbox", { name: "Search deployments" });
  search.focus();
  await act(async () => {
    await view.result.current.update({
      selected: rows[0]?.deployment_id ?? null,
      status: ["active", "failed", "active"],
      q: " hello ",
    });
  });
  expect(view.result.current.rows[0]).toBe(rows[0]);
  expect(screen.getByRole("textbox", { name: "Search deployments" })).toBe(
    search,
  );
  expect(search).toHaveFocus();
  expect(calls).toHaveLength(1);
  await act(async () => {
    await view.result.current.query.refetch();
  });
  expect(calls.at(-1)?.searchParams.get("cursor")).toBeNull();
  expect(view.result.current.rows[0]).toBe(rows[0]);
});

it("abandons delayed recovery when leaving and returning to the same window", async () => {
  const view = dashboard();
  await waitFor(() => expect(view.result.current.rows).toHaveLength(50));
  const release = Promise.withResolvers<undefined>();
  const cancel = view.client.cancelQueries.bind(view.client);
  const cancellation = vi
    .spyOn(view.client, "cancelQueries")
    .mockImplementation(async (filters, options) => {
      await cancel(filters, options);
      await release.promise;
    });
  const remove = vi.spyOn(view.client, "removeQueries");
  server.use(
    http.get(root, () =>
      HttpResponse.json(
        { code: "invalid_cursor", message: "Invalid" },
        { status: 422 },
      ),
    ),
  );
  await act(async () => {
    await view.result.current.query.refetch();
  });
  await screen.findByRole("status", { name: "Updating" });
  cancellation.mockRestore();
  server.resetHandlers();
  await act(async () => {
    await view.result.current.update({ q: "other" });
  });
  await screen.findByRole("status", { name: "Online" });
  await act(async () => {
    await view.result.current.update({ q: "" });
  });
  await screen.findByRole("status", { name: "Online" });
  // Returning to cached invalid data gets its own reset, independently of the old one.
  const removals = remove.mock.calls.length;
  await act(async () => {
    await view.result.current.update({
      selected: "00000000-0000-4000-8000-000000000001",
    });
    release.resolve(undefined);
    await release.promise;
  });
  expect(remove).toHaveBeenCalledTimes(removals);
  expect(view.result.current.state.selected).toBe(
    "00000000-0000-4000-8000-000000000001",
  );
  expect(view.result.current.rows).toHaveLength(50);
});

it("requires explicit retry for every error after recovery without granting another reset", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  const view = dashboard();
  await waitFor(() => expect(view.result.current.rows).toHaveLength(50));
  let requests = 0;
  server.use(
    http.get(root, () => {
      requests++;
      return requests === 1
        ? HttpResponse.json(
            { code: "invalid_cursor", message: "Invalid" },
            { status: 422 },
          )
        : HttpResponse.json(
            { code: "unavailable", message: "Unavailable" },
            { status: 503 },
          );
    }),
  );
  await act(async () => {
    await view.result.current.query.refetch();
  });
  await screen.findByText(/Restarted at the beginning/);
  await screen.findByRole("status", { name: "Synchronization error" });
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await vi.advanceTimersByTimeAsync(3200);
  });
  expect(requests).toBe(2);
  await screen.findByRole("status", { name: "Synchronization error" });
  server.resetHandlers();
  await retry();
  await screen.findByRole("status", { name: "Online" });
  const remove = vi.spyOn(view.client, "removeQueries");
  let invalidRequests = 0;
  server.use(
    http.get(root, () => {
      invalidRequests++;
      return HttpResponse.json(
        { code: "invalid_cursor", message: "Invalid again" },
        { status: 422 },
      );
    }),
  );
  await act(async () => {
    await view.result.current.query.refetch();
  });
  await screen.findByRole("status", { name: "Synchronization error" });
  expect(invalidRequests).toBe(1);
  expect(remove).not.toHaveBeenCalled();
  expect(view.result.current.rows).toHaveLength(50);
});

it("notifies once per error episode and retains retry details after dismissal", async () => {
  const view = dashboard();
  await waitFor(() => expect(view.result.current.rows).toHaveLength(50));
  const fail = () =>
    server.use(
      http.get(root, () =>
        HttpResponse.json(
          { code: "unavailable", message: "Episode failure" },
          { status: 503 },
        ),
      ),
    );
  fail();
  await act(async () => {
    await view.result.current.query.refetch();
  });
  await screen.findByText(/Episode failure/);
  act(() => screen.getByRole("button", { name: "Close" }).click());
  await act(async () => {
    await view.result.current.query.refetch();
  });
  expect(screen.queryByText(/Episode failure/)).not.toBeInTheDocument();
  act(() => screen.getByRole("button", { name: "Connection details" }).click());
  expect(await screen.findByText(/Episode failure/)).toBeVisible();
  server.resetHandlers();
  act(() => {
    screen.getByRole("button", { name: "Retry sync" }).click();
  });
  await screen.findByRole("status", { name: "Online" });
  fail();
  await act(async () => {
    await view.result.current.query.refetch();
  });
  expect(await screen.findAllByText(/Episode failure/)).toHaveLength(1);
  act(() => screen.getByRole("button", { name: "Close" }).click());
  await act(async () => {
    await view.result.current.update({ q: "another window" });
  });
  expect(await screen.findAllByText(/Episode failure/)).toHaveLength(1);
});

it("restarts only the active window, clears its anchor and preserves selection, drafts and unresolved writes", async () => {
  const view = dashboard("?q=checkout&status=active&sort=name&order=asc");
  await waitFor(() => expect(view.result.current.rows).toHaveLength(50));
  const row = view.result.current.rows[0];
  if (!row) {
    throw new Error("Missing row");
  }
  let deletes = 0;
  let details = 0;
  server.use(
    http.delete(`${root}/:id`, () => {
      deletes++;
      return HttpResponse.json(
        { code: "unavailable", message: "Unknown deletion" },
        { status: 503 },
      );
    }),
    http.get(`${root}/:id`, () => {
      details++;
      return HttpResponse.json(row);
    }),
  );
  await act(async () => {
    await view.writes.execute({ record: row, action: "delete" });
    view.writes.dismissReview();
  });
  expect(deletes).toBe(1);
  expect(details).toBe(1);
  await screen.findByRole("button", { name: "Restart browsing" });
  const draft = {
    base: row,
    value: "Keep draft",
    version: "newer",
    state: { phase: "unresolved" as const },
  };
  const key = queryKeys.window(browseParameters(view.result.current.state));
  const otherKey = queryKeys.window({ q: "other" });
  const cached = view.client.getQueryData(key);
  view.client.setQueryData(otherKey, cached);
  view.stores.windows.set(hashKey(key), {
    lastUsed: Date.now(),
    anchor: { id: row.deployment_id, offset: -17 },
  });
  const otherAnchor = {
    lastUsed: Date.now(),
    anchor: { id: row.deployment_id, offset: -8 },
  };
  view.stores.windows.set(hashKey(otherKey), otherAnchor);
  view.stores.inline.set(`${row.deployment_id}:name`, draft);
  await act(async () => {
    await view.result.current.update({ selected: row.deployment_id });
  });
  const release = Promise.withResolvers<undefined>();
  server.use(
    http.get(root, async ({ request }) => {
      calls.push(new URL(request.url));
      await release.promise;
      return HttpResponse.json({
        items: [row],
        limit: 50,
        next_cursor: null,
        previous_cursor: null,
      });
    }),
  );
  calls = [];
  fireEvent.click(screen.getByRole("button", { name: "Restart browsing" }));
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]?.searchParams.get("cursor")).toBeNull();
  expect(calls[0]?.searchParams.get("q")).toBe("checkout");
  expect(calls[0]?.searchParams.get("status")).toBe("active");
  expect(calls[0]?.searchParams.get("sort_by")).toBe("name");
  expect(view.stores.windows.get(hashKey(key))?.anchor).toBeUndefined();
  expect(view.client.getQueryData(otherKey)).toBe(cached);
  expect(view.stores.windows.get(hashKey(otherKey))).toBe(otherAnchor);
  expect(view.stores.inline.get(`${row.deployment_id}:name`)).toBe(draft);
  expect(view.result.current.state.selected).toBe(row.deployment_id);
  expect(
    screen.getByRole("button", { name: "Restart browsing" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Restart browsing" }));
  expect(calls).toHaveLength(1);
  await act(async () => {
    release.resolve(undefined);
    await release.promise;
  });
  await screen.findByRole("status", { name: "Online" });
  expect(view.result.current.rows).toEqual([row]);
  await act(async () => {
    await view.writes.execute({ record: row, action: "delete" });
  });
  expect(deletes).toBe(1);
  expect(details).toBe(2);
  expect(view.writes.getState().review?.current).toEqual(row);
});

it("abandons manual restart cleanup after navigation back to the same window", async () => {
  const view = dashboard();
  await waitFor(() => expect(view.result.current.rows).toHaveLength(50));
  const release = Promise.withResolvers<undefined>();
  const cancel = view.client.cancelQueries.bind(view.client);
  const cancellation = vi
    .spyOn(view.client, "cancelQueries")
    .mockImplementation(async (filters, options) => {
      await cancel(filters, options);
      await release.promise;
    });
  const remove = vi.spyOn(view.client, "removeQueries");
  fireEvent.click(screen.getByRole("button", { name: "Restart browsing" }));
  await screen.findByRole("status", { name: "Updating" });
  cancellation.mockRestore();
  await act(async () => {
    await view.result.current.update({ q: "other" });
  });
  await screen.findByRole("status", { name: "Online" });
  await act(async () => {
    await view.result.current.update({ q: "" });
  });
  await screen.findByRole("status", { name: "Online" });
  await act(async () => {
    release.resolve(undefined);
    await release.promise;
  });
  expect(remove).not.toHaveBeenCalled();
  expect(view.result.current.rows).toHaveLength(50);
});

it("requires explicit retry after a manual restart fails and never grants another automatic cursor reset", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  const view = dashboard();
  await waitFor(() => expect(view.result.current.rows).toHaveLength(50));
  let requests = 0;
  server.use(
    http.get(root, () => {
      requests++;
      return HttpResponse.json(
        { code: "unavailable", message: "Restart failed" },
        { status: 503 },
      );
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Restart browsing" }));
  await screen.findByRole("status", { name: "Synchronization error" });
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await vi.advanceTimersByTimeAsync(6200);
  });
  expect(requests).toBe(1);
  server.resetHandlers();
  await retry();
  await screen.findByRole("status", { name: "Online" });
  const remove = vi.spyOn(view.client, "removeQueries");
  server.use(
    http.get(root, () => {
      requests++;
      return HttpResponse.json(
        { code: "invalid_cursor", message: "Invalid after restart" },
        { status: 422 },
      );
    }),
  );
  await act(async () => {
    await view.result.current.query.refetch();
  });
  await screen.findByRole("status", { name: "Synchronization error" });
  expect(requests).toBe(2);
  expect(remove).not.toHaveBeenCalled();
});
