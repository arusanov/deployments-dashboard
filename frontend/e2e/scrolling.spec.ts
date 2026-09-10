import { apiURL } from "./api";
import { test, expect, type Page } from "@playwright/test";
import type { Deployment, DeploymentPage } from "../src/api/client";

const scroller = (page: Page) =>
  page.locator('[data-virtuoso-scroller="true"]');

const root = "/api/deployments";

test("never shows a stranded banner during load, search, or cached return", async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("stranded-frames", "0");
    sessionStorage.setItem("observed-frames", "0");
    const inspect = () => {
      sessionStorage.setItem(
        "observed-frames",
        String(Number(sessionStorage.getItem("observed-frames")) + 1),
      );
      const stranded = [...document.querySelectorAll('[role="alert"]')].some(
        (element) =>
          element.textContent.includes(
            "This batch cannot scroll to adjacent deployments",
          ) && element.getBoundingClientRect().height > 0,
      );
      if (stranded) {
        sessionStorage.setItem(
          "stranded-frames",
          String(Number(sessionStorage.getItem("stranded-frames")) + 1),
        );
      }
      requestAnimationFrame(inspect);
    };
    requestAnimationFrame(inspect);
  });
  await page.goto("/");
  const search = page.getByRole("textbox", { name: /search/i });
  for (const term of ["", "api", ""]) {
    await search.fill(term);
    await search.press("Enter");
    await expect(page.locator('[data-retained-rows="50"]')).toBeVisible();
    await expect(page).toHaveURL(term ? /q=api/ : /\/$/);
    await expect
      .poll(() =>
        scroller(page).evaluate(
          (element) => element.scrollHeight > element.clientHeight,
        ),
      )
      .toBe(true);
    await measureLayout(page);
    expect(
      await page.evaluate(() => sessionStorage.getItem("stranded-frames")),
    ).toBe("0");
  }
  expect(
    await page.evaluate(() =>
      Number(sessionStorage.getItem("observed-frames")),
    ),
  ).toBeGreaterThan(0);
});

async function measureLayout(page: Page) {
  // Let ResizeObserver and Virtuoso process the next painted layout.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function visibleAnchor(page: Page) {
  let anchor: { id: string; offset: number } | undefined;
  await expect
    .poll(async () => {
      anchor = await scroller(page).evaluate((element) => {
        const box = element.getBoundingClientRect();
        const top =
          box.top +
          (element.querySelector("thead")?.getBoundingClientRect().height ?? 0);

        const row = [
          ...element.querySelectorAll<HTMLElement>("[data-deployment-id]"),
        ].find((item) => {
          const rowBox = item.getBoundingClientRect();
          return rowBox.bottom > top && rowBox.top < box.bottom;
        });

        if (row?.dataset.deploymentId) {
          return {
            id: row.dataset.deploymentId,
            offset: row.getBoundingClientRect().top - top,
          };
        }
        return undefined;
      });
      return anchor;
    })
    .toBeDefined();

  if (!anchor) {
    throw new Error("Missing measured anchor");
  }
  return anchor;
}

async function assertAnchor(
  page: Page,
  anchor: { id: string; offset: number },
) {
  const row = page.locator(`[data-deployment-id="${anchor.id}"]`);

  await expect(row).toBeVisible();
  await expect
    .poll(async () => {
      const offset = await row.evaluate((element) => {
        const container = element.closest('[data-virtuoso-scroller="true"]');

        if (!container) {
          throw new Error("Missing scroller");
        }

        return (
          element.getBoundingClientRect().top -
          container.getBoundingClientRect().top -
          (container.querySelector("thead")?.getBoundingClientRect().height ??
            0)
        );
      });

      return Math.abs(offset - anchor.offset);
    })
    .toBeLessThan(3);
}

test("measured variable-height anchor survives eviction, refresh and cached navigation", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.locator('[data-retained-rows="50"]')).toBeVisible();
  await expect(page.locator("[data-deployment-id]").first()).toBeVisible();
  const editing = page.locator("[data-deployment-id]").first();
  await editing.getByRole("button", { name: "Edit name", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Edit name", exact: true })
    .fill("Virtual draft");
  // Editing can change row measurements; wait for anchor restoration before movement.
  await measureLayout(page);
  await expect(scroller(page)).not.toHaveAttribute("aria-busy", "true");
  await scroller(page).evaluate((element) => {
    element.scrollTop = element.scrollHeight * 0.65 + 11;
  });
  await expect(
    page.getByRole("textbox", { name: "Edit name", exact: true }),
  ).toHaveCount(0);
  await expect(scroller(page)).not.toHaveAttribute("aria-busy", "true");
  await scroller(page).evaluate((element) => {
    element.scrollTop = 0;
  });
  const draft = page.getByRole("textbox", { name: "Edit name", exact: true });
  await expect(draft).toHaveValue("Virtual draft");
  await draft.press("Escape");
  await page.addStyleTag({
    content: "[data-deployment-id]:nth-child(3n) td { height: 112px; }",
  });

  for (const count of [100, 150]) {
    await expect(scroller(page)).not.toHaveAttribute("aria-busy", "true");
    await scroller(page).evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(page.locator(`[data-retained-rows="${count}"]`)).toBeVisible();
  }

  const release = Promise.withResolvers<undefined>();
  let loading = false;
  await page.route(
    (url) => url.pathname === root,
    async (route) => {
      loading = true;
      await release.promise;
      await route.continue();
    },
  );
  await scroller(page).evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => loading).toBe(true);
  await measureLayout(page);
  const anchor = await visibleAnchor(page);
  release.resolve(undefined);
  await expect(
    page.getByRole("status", { name: "Online", exact: true }),
  ).toBeVisible();
  await assertAnchor(page, anchor);
  await page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === root && response.ok();
  });
  await expect(
    page.getByRole("status", { name: "Online", exact: true }),
  ).toBeVisible();
  await assertAnchor(page, anchor);
  await page.getByRole("tab", { name: "Trash" }).click();
  await page.getByRole("tab", { name: "Active" }).click();
  await assertAnchor(page, anchor);
  await scroller(page).evaluate((element) => {
    element.scrollTop = element.scrollHeight * 0.4 + 13;
  });
  await measureLayout(page);
  const measured = await visibleAnchor(page);
  const preceding = await page
    .locator(`[data-deployment-id="${measured.id}"]`)
    .evaluate((element) =>
      element.previousElementSibling?.getAttribute("data-deployment-id"),
    );
  expect(preceding).toBeTruthy();
  await page.addStyleTag({
    // Override the earlier nth-child height regardless of the measured neighbor.
    content: `[data-deployment-id="${preceding}"] td { height: 190px !important; }`,
  });
  await expect(
    page.locator(`[data-deployment-id="${preceding}"] td`).first(),
  ).toHaveCSS("height", "190px");
  await measureLayout(page);
  await assertAnchor(page, measured);
  const row = page.locator(`[data-deployment-id="${measured.id}"]`);
  const next = await row.evaluate((element) =>
    element.nextElementSibling?.getAttribute("data-deployment-id"),
  );
  if (!next) {
    throw new Error("Missing next neighbor");
  }
  const url = `${apiURL}${root}/${measured.id}`;
  const record = (await (await request.get(url)).json()) as Deployment;
  const name = `Live measured ${crypto.randomUUID()}`;
  const changed = await request.patch(url, {
    headers: { "If-Match": `"${record.revision}"` },
    data: { attributes: { name } },
  });
  expect(changed.ok()).toBe(true);
  await expect(row).toContainText(name);
  await assertAnchor(page, measured);
  const current = (await changed.json()) as Deployment;
  const deleted = await request.delete(url, {
    headers: { "If-Match": `"${current.revision}"` },
  });
  expect(deleted.ok()).toBe(true);
  try {
    await expect(row).toHaveCount(0);
    await assertAnchor(page, { id: next, offset: measured.offset });
  } finally {
    const trashed = (await (
      await request.get(`${url}?include_deleted=true`)
    ).json()) as Deployment;
    const restored = await request.post(`${url}/restore`, {
      headers: { "If-Match": `"${trashed.revision}"` },
    });
    expect(restored.ok()).toBe(true);
  }
});

test("wheel, keyboard and scrollbar navigate both ways after eviction without draining", async ({
  page,
}) => {
  const pages: DeploymentPage[] = [];
  const batch = (cursor: string | null) =>
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === root && url.searchParams.get("cursor") === cursor;
    });
  const first = batch(null);
  await page.goto("/");
  pages.push((await (await first).json()) as DeploymentPage);
  for (let index = 0; index < 3; index++) {
    await expect(scroller(page)).not.toHaveAttribute("aria-busy", "true");
    await expect(
      page.locator(`[data-retained-rows="${Math.min(index + 1, 3) * 50}"]`),
    ).toBeVisible();
    const next = batch(pages.at(-1)?.next_cursor ?? null);
    await scroller(page).evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    pages.push((await (await next).json()) as DeploymentPage);
    if (pages.length > 3) {
      pages.shift();
    }
  }
  await page.addStyleTag({
    content:
      "[data-virtuoso-scroller] { scrollbar-gutter: stable; } [data-virtuoso-scroller]::-webkit-scrollbar { width: 16px; } [data-virtuoso-scroller]::-webkit-scrollbar-thumb { background: #888; min-height: 18px; }",
  });
  for (const mode of ["wheel", "keyboard", "scrollbar"] as const) {
    for (const direction of ["next", "previous"] as const) {
      await expect(
        page.getByRole("status", { name: "Online", exact: true }),
      ).toBeVisible();
      await expect(scroller(page)).not.toHaveAttribute("aria-busy", "true");
      const response = batch(
        (direction === "next"
          ? pages.at(-1)?.next_cursor
          : pages[0]?.previous_cursor) ?? null,
      );
      if (mode === "wheel") {
        await scroller(page).hover();
        await page.mouse.wheel(0, direction === "next" ? 10000 : -10000);
      } else if (mode === "keyboard") {
        await scroller(page).focus();
        await page.keyboard.press(direction === "next" ? "End" : "Home");
      } else {
        const track = await scroller(page).evaluate((element) => {
          const box = element.getBoundingClientRect();
          const thumb = Math.max(
            18,
            (box.height * element.clientHeight) / element.scrollHeight,
          );
          return {
            x: box.right - 8,
            top: box.top,
            bottom: box.bottom,
            thumb:
              box.top +
              ((box.height - thumb) * element.scrollTop) /
                (element.scrollHeight - element.clientHeight) +
              thumb / 2,
          };
        });
        await page.mouse.move(track.x, track.thumb);
        await page.mouse.down();
        await page.mouse.move(
          track.x,
          direction === "next" ? track.bottom - 1 : track.top + 1,
          { steps: 12 },
        );
        await page.mouse.up();
      }

      const data = (await (await response).json()) as DeploymentPage;
      if (direction === "next") {
        pages.push(data);
        pages.shift();
      } else {
        pages.unshift(data);
        pages.pop();
      }
      await expect(page.locator('[data-retained-rows="150"]')).toBeVisible();
      await expect(page).not.toHaveURL(/cursor=/);
    }
  }
  expect(await page.locator("[data-deployment-id]").count()).toBeLessThan(25);
});

test("unchanged polls preserve geometry, DOM identity and the active editor on every frame", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('[data-retained-rows="50"]')).toBeVisible();
  await scroller(page).evaluate((element) => {
    element.scrollTop = 900;
  });
  await measureLayout(page);
  const anchor = await visibleAnchor(page);
  const editingRow = page
    .locator(`[data-deployment-id="${anchor.id}"]`)
    .locator("xpath=following-sibling::tr[1]");
  await editingRow
    .getByRole("button", { name: "Edit name", exact: true })
    .click();
  const input = editingRow.getByRole("textbox", {
    name: "Edit name",
    exact: true,
  });
  await input.fill("Unsaved polling draft");
  await input.evaluate((element: HTMLInputElement) => {
    element.setSelectionRange(2, 9, "forward");
  });
  await measureLayout(page);
  await expect(scroller(page)).not.toHaveAttribute("aria-busy", "true");

  let completed = 0;
  await page.route(
    (url) => url.pathname === root,
    async (route) => {
      const response = await route.fetch();
      if (completed === 1) {
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      await route.fulfill({ response });
      completed++;
    },
  );
  const monitor = await scroller(page).evaluateHandle((element) => {
    const table = element.querySelector("table");
    const editor = element.querySelector<HTMLInputElement>(
      'input[aria-label="Edit name"]',
    );
    if (!table || !editor) {
      throw new Error("Missing table/editor");
    }
    const headerHeight = () =>
      element.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    const top = () => element.getBoundingClientRect().top + headerHeight();
    const visibleRows = () =>
      [...element.querySelectorAll<HTMLElement>("[data-deployment-id]")].filter(
        (row) =>
          row.getBoundingClientRect().bottom > top() &&
          row.getBoundingClientRect().top <
            element.getBoundingClientRect().bottom,
      );
    const rows = visibleRows();
    const anchor = rows[0];
    if (!anchor) {
      throw new Error("Missing anchor");
    }
    const geometry = () => {
      const box = element.getBoundingClientRect();
      const tableBox = table.getBoundingClientRect();
      return [
        box.x,
        box.y,
        box.width,
        box.height,
        tableBox.x,
        tableBox.y,
        tableBox.width,
        tableBox.height,
        element.scrollTop,
        element.scrollLeft,
        window.scrollY,
        anchor.getBoundingClientRect().top - top(),
      ];
    };
    const baseline = geometry();
    const statuses = new Set<string>();
    let maximumDelta = 0;
    let stableIdentity = true;
    let stableEditor = true;
    let positioning = false;
    let frames = 0;
    let frame = 0;
    const observer = new MutationObserver((mutations) => {
      if (
        mutations.some((mutation) => mutation.attributeName === "aria-busy")
      ) {
        positioning = true;
      }
    });
    observer.observe(element, { attributes: true });
    const sample = () => {
      frames++;
      maximumDelta = Math.max(
        maximumDelta,
        ...geometry().map((value, index) =>
          Math.abs(value - (baseline[index] ?? value)),
        ),
      );
      stableIdentity &&=
        element === document.querySelector('[data-virtuoso-scroller="true"]') &&
        table === element.querySelector("table") &&
        rows.every((row, index) => row === visibleRows()[index]);
      stableEditor &&=
        document.activeElement === editor &&
        editor.isConnected &&
        editor.value === "Unsaved polling draft" &&
        editor.selectionStart === 2 &&
        editor.selectionEnd === 9 &&
        editor.selectionDirection === "forward";
      statuses.add(
        document
          .querySelector('header [role="status"]')
          ?.getAttribute("aria-label") ?? "missing",
      );
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    return {
      stop: () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        return {
          frames,
          maximumDelta,
          stableIdentity,
          stableEditor,
          positioning,
          statuses: [...statuses],
        };
      },
    };
  });
  await expect
    .poll(() => completed, { timeout: 14_000 })
    .toBeGreaterThanOrEqual(3);
  await expect(
    page.getByRole("status", { name: "Online", exact: true }),
  ).toBeVisible();
  const measurements = await monitor.evaluate((monitor) => monitor.stop());
  expect(measurements.frames).toBeGreaterThan(100);
  expect(measurements.maximumDelta).toBeLessThanOrEqual(1);
  expect(measurements.stableIdentity).toBe(true);
  expect(measurements.stableEditor).toBe(true);
  expect(measurements.positioning).toBe(false);
  expect(measurements.statuses).toEqual(
    expect.arrayContaining(["Updating", "Online"]),
  );
  await input.press("Escape");
});

for (const remaining of [0, 1]) {
  test(`restarts a stranded ${remaining}-row window after eviction without draining`, async ({
    page,
    request,
  }) => {
    const sample = (await (
      await request.get(`${apiURL}${root}?limit=1`)
    ).json()) as DeploymentPage;
    const base = sample.items[0];
    if (!base) {
      throw new Error("Missing seeded deployment");
    }
    const records = Array.from({ length: 200 }, (_, index) => ({
      ...base,
      deployment_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      attributes: {
        name: `Restart record ${index}`,
        description: "Shrinkage fixture",
      },
    }));
    let shrink = false;
    const cursors: (string | null)[] = [];
    await page.route(
      (url) => url.pathname === root,
      async (route) => {
        const cursor = new URL(route.request().url()).searchParams.get(
          "cursor",
        );
        cursors.push(cursor);
        const start = Number(cursor ?? 0);
        await route.fulfill({
          json: {
            items:
              shrink && start > 0
                ? records.slice(start, start + remaining)
                : records.slice(start, start + 50),
            limit: 50,
            previous_cursor: start > 0 ? String(start - 50) : null,
            next_cursor:
              shrink && start > 0
                ? null
                : start + 50 < records.length
                  ? String(start + 50)
                  : null,
          },
        });
      },
    );
    await page.goto("/");
    for (const count of [50, 100, 150]) {
      await expect(
        page.locator(`[data-retained-rows="${count}"]`),
      ).toBeVisible();
      await expect(scroller(page)).not.toHaveAttribute("aria-busy", "true");
      await scroller(page).evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
    }
    await expect.poll(() => cursors.includes("150")).toBe(true);
    await expect(page.locator('[data-retained-rows="150"]')).toBeVisible();
    await expect(scroller(page)).not.toHaveAttribute("aria-busy", "true");
    shrink = true;
    await expect(
      page.locator(`[data-retained-rows="${remaining}"]`),
    ).toBeVisible();
    await expect
      .poll(() =>
        scroller(page).evaluate(
          (element) => element.scrollHeight <= element.clientHeight,
        ),
      )
      .toBe(true);
    const restart = page.getByRole("button", {
      name: "Restart browsing",
      exact: true,
    });
    await expect(restart).toBeVisible();
    const before = cursors.length;
    await scroller(page).hover();
    await page.mouse.wheel(0, -1000);
    await measureLayout(page);
    expect(cursors.slice(before)).not.toContain("0");
    expect(cursors.filter((cursor) => cursor === null)).toHaveLength(1);
    await page.screenshot({
      path: test.info().outputPath("restart-browsing.png"),
    });
    await restart.click();
    await expect(page.locator('[data-retained-rows="50"]')).toBeVisible();
    await expect(restart).toHaveCount(0);
    expect(cursors.filter((cursor) => cursor === null)).toHaveLength(2);
    await expect
      .poll(() => scroller(page).evaluate((element) => element.scrollTop))
      .toBe(0);
    await expect(page.locator("[data-deployment-id]").first()).toContainText(
      "Restart record 0",
    );
    await expect(page).not.toHaveURL(/cursor=/);
  });
}
