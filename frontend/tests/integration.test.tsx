import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { apiUrl } from "../src/api/client";
import { queryKeys } from "../src/cache/keys";
import type { Deployment } from "../src/api/client";
import { VirtuosoMockContext } from "react-virtuoso";
import Dashboard from "../src/deployments/dashboard";
import { SessionStoresProvider } from "../src/cache/session-stores";
import { record } from "./fixtures";

const root = `${apiUrl}/api/deployments`;

let current: Deployment;

let reads = 0;

let patches = 0;

const server = setupServer(
  http.get(root, ({ request }) => {
    reads++;
    const params = new URL(request.url).searchParams;

    const trash = params.get("deleted") === "only";

    const matches =
      !params.get("q") ||
      JSON.stringify(current)
        .toLowerCase()
        .includes(params.get("q") ?? "");

    return HttpResponse.json({
      items: Boolean(current.deleted_at) === trash && matches ? [current] : [],
      limit: 50,
      next_cursor: null,
      previous_cursor: null,
    });
  }),
  http.get(`${root}/:id`, () => HttpResponse.json(current)),
  http.patch(`${root}/:id`, async ({ request }) => {
    patches++;

    if (request.headers.get("if-match") !== `"${current.revision}"`) {
      return HttpResponse.json(
        { code: "revision_conflict", message: "Changed" },
        { status: 412 },
      );
    }

    const body = (await request.json()) as {
      attributes: Record<string, string | null>;
    };

    current = {
      ...current,
      revision: current.revision + 1,
      attributes: Object.fromEntries(
        Object.entries({ ...current.attributes, ...body.attributes }).filter(
          (entry): entry is [string, string] => entry[1] !== null,
        ),
      ),
    };

    return HttpResponse.json(current);
  }),
);

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
beforeEach(() => {
  current = record({ deployment_id: crypto.randomUUID() });
  reads = 0;
  patches = 0;
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

function dashboard(searchParams = "") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const tree = (visible = true) => (
    <QueryClientProvider client={client}>
      <SessionStoresProvider>
        <NuqsTestingAdapter hasMemory searchParams={searchParams}>
          <VirtuosoMockContext.Provider
            value={{ viewportHeight: 720, itemHeight: 72 }}
          >
            {visible && <Dashboard />}
          </VirtuosoMockContext.Provider>
        </NuqsTestingAdapter>
      </SessionStoresProvider>
    </QueryClientProvider>
  );
  const view = render(tree());
  return {
    ...view,
    client,
    show: (visible: boolean) => view.rerender(tree(visible)),
  };
}

describe("dashboard integration", () => {
  it("debounces search instead of requesting every keystroke", async () => {
    dashboard();
    await screen.findByText("Checkout", { exact: true });
    const before = reads;

    await userEvent.type(
      screen.getByRole("textbox", { name: "Search deployments" }),
      "absent",
    );
    expect(reads).toBe(before);
    await screen.findByText("No deployments match these filters");
    expect(reads).toBe(before + 1);
  });
  it("saves inline on Enter, cancels Escape, and preserves a conflicting draft", async () => {
    dashboard();
    await screen.findByText("Checkout", { exact: true });
    await userEvent.click(
      await screen.findByRole("button", { name: "Edit name" }),
    );
    const input = screen.getByRole("textbox", { name: "Edit name" });

    await userEvent.clear(input);
    await userEvent.type(input, "Draft");
    current = record({
      deployment_id: current.deployment_id,
      revision: 2,
      attributes: { name: "Remote", description: "Payments API" },
    });
    await userEvent.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", {
      name: "Review unsaved changes",
    });

    expect(within(dialog).getByText("Your draft: Draft")).toBeVisible();
    expect(within(dialog).getByText("Current: Remote")).toBeVisible();
    expect(patches).toBe(1);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Retry against revision 2" }),
    );
    await screen.findByText("Draft", { exact: true });
    expect(current.attributes.name).toBe("Draft");
    await userEvent.click(
      await screen.findByRole("button", { name: "Edit name" }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Edit name" }),
      "discard",
    );
    await userEvent.keyboard("{Escape}");
    expect(patches).toBe(2);
  });
});

it("preserves rows when background reads fail and offers retry", async () => {
  dashboard();
  await screen.findByText("Checkout", { exact: true });
  const scroller = document.querySelector('[data-virtuoso-scroller="true"]');
  const row = screen.getByText("Checkout", { exact: true }).closest("tr");
  server.use(
    http.get(root, () =>
      HttpResponse.json(
        { code: "unavailable", message: "Database unavailable" },
        { status: 503 },
      ),
    ),
  );
  await screen.findByRole(
    "status",
    { name: "Synchronization error" },
    { timeout: 4500 },
  );
  expect(screen.getByText("Checkout", { exact: true })).toBeVisible();
  expect(document.querySelector('[data-virtuoso-scroller="true"]')).toBe(
    scroller,
  );
  expect(screen.getByText("Checkout", { exact: true }).closest("tr")).toBe(row);
  server.resetHandlers();
  await userEvent.click(
    screen.getByRole("button", { name: "Connection details" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Retry sync" }));
  await screen.findByRole("status", { name: "Online" });
});

it("uses the active cache for details without a duplicate detail request", async () => {
  let detailReads = 0;

  server.use(
    http.get(`${root}/${current.deployment_id}`, () => {
      detailReads++;

      return HttpResponse.json(current);
    }),
  );
  dashboard();
  await screen.findByText("Checkout", { exact: true });
  await userEvent.click(screen.getByRole("button", { name: "Open details" }));
  const drawer = await screen.findByRole("dialog", { name: "Checkout" });

  expect(within(drawer).getByText("Payments API")).toBeVisible();
  expect(detailReads).toBe(0);
});

it("turns a non-JSON gateway failure into an actionable API error", async () => {
  server.use(
    http.get(
      root,
      () => new HttpResponse("Gateway unavailable", { status: 502 }),
    ),
  );
  dashboard();
  await screen.findByRole("status", { name: "Synchronization error" });
  expect(screen.getByText(/HTTP 502/)).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Connection details" }),
  );
  expect(screen.getByRole("button", { name: "Retry sync" })).toBeEnabled();
});

it("dismissing an ambiguous review leaves an editable draft and reconciles before another write", async () => {
  server.use(
    http.patch(`${root}/:id`, () => {
      patches++;

      return HttpResponse.json(
        { code: "unavailable", message: "Unknown outcome" },
        { status: 503 },
      );
    }),
  );
  dashboard();
  await userEvent.click(
    await screen.findByRole("button", { name: "Edit name" }),
  );
  const input = screen.getByRole("textbox", { name: "Edit name" });

  await userEvent.clear(input);
  await userEvent.type(input, "First draft{Enter}");
  await screen.findByRole("dialog", { name: "Review unsaved changes" });
  await userEvent.click(
    screen.getByRole("button", { name: "Continue editing" }),
  );
  await screen.findByRole("textbox", { name: "Edit name" });
  await userEvent.clear(input);
  await userEvent.type(input, "New draft");
  await userEvent.click(screen.getByRole("button", { name: "Save name" }));
  await screen.findByText("Your draft: New draft");
  expect(patches).toBe(1);
  expect(
    screen.getByRole("button", { name: "Retry against revision 1" }),
  ).toBeEnabled();
});

it("preserves an editable draft after validation rejection without reconciliation or duplicate writes", async () => {
  let details = 0;
  server.use(
    http.patch(`${root}/:id`, () => {
      patches++;
      return HttpResponse.json(
        { code: "invalid_input", message: "Validation rejected" },
        { status: 422 },
      );
    }),
    http.get(`${root}/:id`, () => {
      details++;
      return HttpResponse.json(current);
    }),
  );
  dashboard();
  await userEvent.click(
    await screen.findByRole("button", { name: "Edit name" }),
  );
  const input = screen.getByRole("textbox", { name: "Edit name" });
  await userEvent.clear(input);
  await userEvent.type(input, "Rejected{Enter}");
  await screen.findByText("Validation rejected");
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveValue("Rejected");
  expect(input).toBeEnabled();
  expect(details).toBe(0);
  expect(patches).toBe(1);
  await userEvent.click(screen.getByRole("button", { name: "Save name" }));
  expect(patches).toBe(2);
  expect(details).toBe(0);
  server.resetHandlers();
  await userEvent.click(screen.getByRole("button", { name: "Save name" }));
  await screen.findByText("Rejected", { exact: true });
  expect(patches).toBe(3);
});

it("reconciles unusable successful write responses without clearing the draft", async () => {
  server.use(
    http.patch(`${root}/:id`, () => {
      patches++;
      return HttpResponse.json({});
    }),
  );
  dashboard();
  await userEvent.click(
    await screen.findByRole("button", { name: "Edit name" }),
  );
  const input = screen.getByRole("textbox", { name: "Edit name" });
  await userEvent.clear(input);
  await userEvent.type(input, "Keep draft{Enter}");
  await screen.findByText("Your draft: Keep draft");
  await screen.findByText("Current: Checkout");
  expect(patches).toBe(1);
  expect(
    screen.getByRole("button", { name: "Retry against revision 1" }),
  ).toBeEnabled();
});

it("sends invalid attribute keys to the server and keeps the rejected rows editable", async () => {
  let received: unknown;
  server.use(
    http.patch(`${root}/:id`, async ({ request }) => {
      patches++;
      received = await request.json();
      return HttpResponse.json(
        {
          code: "invalid_input",
          message: "Invalid request",
          details: [
            {
              location: ["body", "attributes", "$invalid.key", "[key]"],
              message: "Server rejected the attribute key",
              type: "string_pattern_mismatch",
            },
          ],
        },
        { status: 422 },
      );
    }),
  );
  dashboard();
  await userEvent.click(
    await screen.findByRole("button", { name: "Open details" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Edit attributes" }),
  );
  const key = screen.getByRole("textbox", { name: "Attribute key 1" });
  await userEvent.clear(key);
  await userEvent.type(key, "$invalid.key");
  await userEvent.click(
    screen.getByRole("button", { name: "Save attributes" }),
  );
  await screen.findByText("Server rejected the attribute key");
  expect(received).toMatchObject({
    attributes: { name: null, "$invalid.key": "Checkout" },
  });
  expect(patches).toBe(1);
  expect(key).toHaveAttribute("aria-invalid", "true");
  expect(key).toHaveValue("$invalid.key");
  expect(key).toBeEnabled();
});

it("shows sorted custom tags in Trash and opens retained details", async () => {
  let details = 0;
  const long = "x".repeat(300);
  current = record({
    deleted_at: "2026-09-01T00:00:00Z",
    attributes: {
      name: "Checkout",
      description: "Payments API",
      zebra: "last",
      beta: "second",
      alpha: long,
    },
  });
  server.use(
    http.get(`${root}/:id`, () => {
      details++;
      return HttpResponse.json(current);
    }),
  );
  dashboard();
  await userEvent.click(screen.getByRole("tab", { name: "Trash" }));
  await screen.findByText("Checkout", { exact: true });
  const tags = screen.getByRole("columnheader", { name: "Tags" });
  expect(within(tags).queryByRole("button")).not.toBeInTheDocument();
  const row = screen.getByText("Checkout", { exact: true }).closest("tr");
  if (!row) {
    throw new Error("Missing row");
  }
  const labels = within(row).getAllByLabelText(/^(alpha|beta):/);
  expect(labels.map((node) => node.getAttribute("aria-label"))).toEqual([
    `alpha: ${long}`,
    "beta: second",
  ]);
  expect(within(row).queryByText("zebra: last")).not.toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.queryByText(/loaded deployments/)).not.toBeInTheDocument();
  await userEvent.click(
    within(row).getByRole("button", { name: "Show 1 more attributes" }),
  );
  await screen.findByRole("dialog", { name: "Checkout" });
  expect(details).toBe(0);
});

it("ignores URL cursors before the first API request", async () => {
  const cursors: (string | null)[] = [];
  server.use(
    http.get(root, ({ request }) => {
      cursors.push(new URL(request.url).searchParams.get("cursor"));
      return HttpResponse.json({
        items: [current],
        limit: 50,
        next_cursor: null,
        previous_cursor: null,
      });
    }),
  );
  dashboard("?cursor=ignored");
  await screen.findByText("Checkout", { exact: true });
  expect(cursors).toEqual([null]);
  expect(
    screen.queryByText(/Restarted at the beginning/),
  ).not.toBeInTheDocument();
});

it.each([
  null,
  {},
  {
    items: [
      record({ attributes: null as unknown as Deployment["attributes"] }),
    ],
    next_cursor: null,
    previous_cursor: null,
  },
])(
  "keeps unusable successful reads out of the cache and recovers through header retry: %j",
  async (body) => {
    server.use(http.get(root, () => HttpResponse.json(body)));
    const view = dashboard();
    await screen.findByRole("status", { name: "Synchronization error" });
    expect(
      view.client
        .getQueriesData({ queryKey: queryKeys.windows })
        .every(([, data]) => data === undefined),
    ).toBe(true);
    expect(
      screen.queryByText("No deployments", { exact: true }),
    ).not.toBeInTheDocument();
    server.resetHandlers();
    await userEvent.click(
      screen.getByRole("button", { name: "Connection details" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry sync" }));
    expect(await screen.findByText("Checkout", { exact: true })).toBeVisible();
  },
);

it("shows acknowledged values after refresh failure and never replays replaced save notices on remount", async () => {
  const view = dashboard();
  await userEvent.click(
    await screen.findByRole("button", { name: "Edit name" }),
  );
  const input = screen.getByRole("textbox", { name: "Edit name" });
  await userEvent.clear(input);
  await userEvent.type(input, "Acknowledged name");
  server.use(
    http.get(root, () =>
      HttpResponse.json(
        { code: "unavailable", message: "Refresh failed" },
        { status: 503 },
      ),
    ),
  );
  await userEvent.keyboard("{Enter}");
  expect(
    await screen.findByText("Acknowledged name", { exact: true }),
  ).toBeVisible();
  await screen.findByRole("status", { name: "Synchronization error" });
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  act(() => view.show(false));
  act(() => view.show(true));
  await screen.findByRole("status", { name: "Synchronization error" });
  expect(screen.queryByText("Changes saved.")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Edit name" }));
  const next = screen.getByRole("textbox", { name: "Edit name" });
  expect(next).toHaveValue("Acknowledged name");
  await userEvent.clear(next);
  await userEvent.type(next, "Next revision{Enter}");
  expect(
    await screen.findByText("Next revision", { exact: true }),
  ).toBeVisible();
  expect(current.revision).toBe(3);
  expect(patches).toBe(2);
  expect(
    screen.queryByRole("dialog", { name: "Review unsaved changes" }),
  ).not.toBeInTheDocument();
});

it("offers pointer and keyboard Save/Cancel without saving on internal focus changes", async () => {
  dashboard();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit name" }));
  let input = screen.getByRole("textbox", { name: "Edit name" });
  await user.clear(input);
  await user.type(input, "Discard pointer");
  await user.click(screen.getByRole("button", { name: "Cancel name" }));
  expect(patches).toBe(0);
  expect(screen.queryByRole("textbox", { name: "Edit name" })).toBeNull();

  await user.click(screen.getByRole("button", { name: "Edit name" }));
  input = screen.getByRole("textbox", { name: "Edit name" });
  await user.clear(input);
  await user.type(input, "Save pointer");
  await user.click(screen.getByRole("button", { name: "Save name" }));
  await screen.findByText("Save pointer", { exact: true });
  expect(patches).toBe(1);

  await user.click(screen.getByRole("button", { name: "Edit name" }));
  input = screen.getByRole("textbox", { name: "Edit name" });
  await user.clear(input);
  await user.type(input, "Discard keyboard");
  await user.tab();
  expect(screen.getByRole("button", { name: "Save name" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Cancel name" })).toHaveFocus();
  expect(patches).toBe(1);
  await user.keyboard("{Enter}");
  expect(screen.queryByRole("textbox", { name: "Edit name" })).toBeNull();
  expect(patches).toBe(1);

  await user.click(screen.getByRole("button", { name: "Edit name" }));
  input = screen.getByRole("textbox", { name: "Edit name" });
  await user.clear(input);
  await user.type(input, "Save keyboard");
  await user.tab();
  expect(patches).toBe(1);
  await user.keyboard("{Enter}");
  await screen.findByText("Save keyboard", { exact: true });
  expect(patches).toBe(2);
});

it("saves once when focus leaves the inline editor actions", async () => {
  dashboard();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Edit description" }),
  );
  const input = screen.getByRole("textbox", { name: "Edit description" });
  await user.clear(input);
  await user.type(input, "External blur");
  await user.tab();
  await user.tab();
  expect(
    screen.getByRole("button", { name: "Cancel description" }),
  ).toHaveFocus();
  expect(patches).toBe(0);
  await user.click(screen.getByRole("textbox", { name: "Search deployments" }));
  await screen.findByText("External blur", { exact: true });
  expect(patches).toBe(1);
});
