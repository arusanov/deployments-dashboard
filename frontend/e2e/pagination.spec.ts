import { test, expect } from "@playwright/test";
import type { DeploymentPage } from "../src/api/client";

const listPath = "/api/deployments";

test("search, combined filters, both sort directions, clearing and first-page reload", async ({
  page,
}) => {
  const list = (match: (params: URLSearchParams) => boolean) =>
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === listPath && response.ok() && match(url.searchParams)
      );
    });
  await page.goto("/");
  const search = page.getByRole("textbox", { name: "Search deployments" });
  const found = list((params) => params.get("q") === "service");
  await search.fill("service");
  await search.press("Enter");
  const initial = (await (await found).json()) as DeploymentPage;
  expect(initial.items.length).toBeGreaterThan(1);
  const sample = initial.items[0];
  if (!sample) {
    throw new Error("Missing seeded search result");
  }
  const extraStatus = sample.status === "active" ? "failed" : "active";
  const statuses = [sample.status, extraStatus].toSorted();
  for (const [label, field, value] of [
    ["Status", "status", sample.status],
    ["Status", "status", extraStatus],
    ["Type", "type", sample.type],
    ["Environment", "environment", sample.environment],
  ] as const) {
    const filtered = list((params) => params.getAll(field).includes(value));
    await page.getByRole("combobox", { name: label, exact: true }).click();
    await page
      .getByRole("option", { name: value.replaceAll("_", " "), exact: true })
      .click();
    await page.keyboard.press("Escape");
    await filtered;
  }
  for (const order of ["asc", "desc"] as const) {
    const sorted = list(
      (params) =>
        params.get("sort_by") === "name" && params.get("sort_order") === order,
    );
    await page.getByRole("button", { name: "Name", exact: true }).click();
    const response = await sorted;
    const params = new URL(response.url()).searchParams;
    expect(params.get("q")).toBe("service");
    expect(params.getAll("status")).toEqual(statuses);
    expect(params.getAll("type")).toEqual([sample.type]);
    expect(params.getAll("environment")).toEqual([sample.environment]);
    const data = (await response.json()) as DeploymentPage;
    expect(data.items.length).toBeGreaterThan(1);
    expect(
      data.items.every(
        (row) =>
          statuses.includes(row.status) &&
          row.type === sample.type &&
          row.environment === sample.environment,
      ),
    ).toBe(true);
    const names = data.items.map((row) => row.attributes.name ?? "");
    expect(names).toEqual(
      names.toSorted(
        (a, b) => (a < b ? -1 : a > b ? 1 : 0) * (order === "asc" ? 1 : -1),
      ),
    );
    await expect(
      page.getByRole("columnheader", { name: "Name", exact: true }),
    ).toHaveAttribute(
      "aria-sort",
      order === "asc" ? "ascending" : "descending",
    );
    await expect(page.locator("[data-deployment-id]").first()).toHaveAttribute(
      "data-deployment-id",
      data.items[0]?.deployment_id ?? "",
    );
  }
  const cleared = list(
    (params) =>
      !params.get("q") &&
      !params.has("status") &&
      !params.has("type") &&
      !params.has("environment"),
  );
  await page.getByRole("button", { name: "Clear filters" }).click();
  await cleared;
  await expect(search).toHaveValue("");
  for (const label of ["Status", "Type", "Environment"]) {
    await expect(
      page.getByRole("combobox", { name: label, exact: true }),
    ).toHaveText("\u200b");
  }
  await expect(page.locator('[data-retained-rows="50"]')).toBeVisible();
  const scroller = page.locator('[data-virtuoso-scroller="true"]');
  await expect(page.locator("[data-deployment-id]").first()).toBeVisible();
  await expect(scroller).not.toHaveAttribute("aria-busy", "true");
  await expect
    .poll(() =>
      scroller.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    )
    .toBe(true);
  await scroller.focus();
  await expect(scroller).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.locator('[data-retained-rows="100"]')).toBeVisible();
  await expect(page).not.toHaveURL(/cursor=/);
  const first = list((params) => !params.has("cursor"));
  await page.reload();
  const response = await first;
  expect(new URL(response.url()).searchParams.get("sort_order")).toBe("desc");
  await expect(page.locator('[data-retained-rows="50"]')).toBeVisible();
  await expect(scroller).toHaveJSProperty("scrollTop", 0);
});
