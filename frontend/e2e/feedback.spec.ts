import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { DeploymentPage } from "../src/api/client";

const listPath = "/api/deployments";

test("loading indicator, outage retry and centered empty state stay accessible", async ({
  page,
}) => {
  let response: "outage" | "malformed" | "empty" = "outage";
  const release = Promise.withResolvers<undefined>();
  await page.route(
    (url) => url.pathname === listPath,
    async (route) => {
      await release.promise;
      await route.fulfill(
        response === "outage"
          ? {
              status: 503,
              json: { code: "unavailable", message: "Initial outage" },
            }
          : response === "malformed"
            ? { json: {} }
            : {
                json: {
                  items: [],
                  limit: 50,
                  next_cursor: null,
                  previous_cursor: null,
                },
              },
      );
    },
  );
  await page.goto("/");
  const indicator = page
    .locator("header")
    .getByRole("button", { name: "Connection details" });
  await expect(
    indicator.getByRole("status", { name: "Updating" }),
  ).toBeVisible();
  const before = await indicator.boundingBox();
  expect(before?.width).toBe(28);
  expect(before?.height).toBe(28);
  const dot = indicator.locator('[aria-hidden="true"]').first();
  await expect(dot).toHaveCSS("animation-name", "connection-pulse");
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByText(/loaded deployments/)).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(dot).toHaveCSS("animation-name", "none");
  release.resolve(undefined);
  await expect(page).not.toHaveURL(/cursor=/);
  await expect(
    page.getByText(
      "Deployments unavailable. Use the connection indicator to retry.",
    ),
  ).toBeVisible();
  await expect(page.getByText("No deployments", { exact: true })).toHaveCount(
    0,
  );
  await page
    .locator(".MuiSnackbar-root")
    .getByRole("button", { name: "Close" })
    .click();
  await page.getByRole("button", { name: "Connection details" }).click();
  response = "malformed";
  await page.getByRole("button", { name: "Retry sync" }).click();
  await expect(
    page.getByRole("status", { name: "Synchronization error" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Connection details" }).click();
  await expect(page.getByText(/unusable deployment list/)).toBeVisible();
  response = "empty";
  await page.getByRole("button", { name: "Retry sync" }).click();
  await expect(page.locator(".MuiPopover-root")).toHaveCount(0);
  const after = await indicator.boundingBox();
  expect(after).toEqual({
    ...before,
    y: (before?.y ?? 0) - (await page.evaluate(() => window.scrollY)),
  });
  const empty = page.getByText("No deployments", { exact: true });
  await expect(empty).toBeVisible();
  const viewport = await page
    .locator('[data-retained-rows="0"] > div')
    .boundingBox();
  const message = await empty.boundingBox();
  expect(viewport).not.toBeNull();
  expect(message).not.toBeNull();
  if (viewport && message) {
    expect(
      Math.abs(message.x + message.width / 2 - viewport.x - viewport.width / 2),
    ).toBeLessThan(1);
    expect(
      Math.abs(
        message.y +
          message.height / 2 -
          viewport.y -
          56 -
          (viewport.height - 56) / 2,
      ),
    ).toBeLessThan(1);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("tag labels truncate visually, expose full tooltips and reuse retained details", async ({
  page,
}) => {
  const long = "A long attribute value ".repeat(20);
  let details = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith(`${listPath}/`)) {
      details++;
    }
  });
  await page.route(
    (url) => url.pathname === listPath,
    async (route) => {
      const response = await route.fetch();
      const data = (await response.json()) as DeploymentPage;
      data.items = data.items.slice(0, 1).map((record) => ({
        ...record,
        attributes: {
          name: "Tagged deployment",
          description: "Description",
          zebra: "last",
          alpha: long,
          beta: "second",
        },
      }));
      await route.fulfill({ response, json: data });
    },
  );
  await page.goto("/");
  const row = page.locator("[data-deployment-id]").first();
  const chip = row.getByLabel(`alpha: ${long}`, { exact: true });
  await expect(chip).toBeVisible();
  const label = chip.locator(".MuiChip-label");
  expect(
    await label.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);
  await chip.hover();
  await expect(page.getByRole("tooltip")).toHaveText(`alpha: ${long}`);
  await expect(
    page.getByRole("columnheader", { name: "Tags" }).getByRole("button"),
  ).toHaveCount(0);
  await row.getByRole("button", { name: "Show 1 more attributes" }).click();
  await expect(
    page.getByRole("dialog", { name: "Tagged deployment" }),
  ).toBeVisible();
  expect(details).toBe(0);
});

test("real server validation labels the rejected attribute key and keeps it editable", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open details" }).first().click();
  await page.getByRole("button", { name: "Edit attributes" }).click();
  const key = page.getByRole("textbox", {
    name: "Attribute key 1",
    exact: true,
  });
  await key.fill("$bad");
  const response = page.waitForResponse(
    (response) => response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save attributes" }).click();
  expect((await response).status()).toBe(422);
  await expect(key).toHaveAttribute("aria-invalid", "true");
  await expect(key).toHaveValue("$bad");
  await expect(key).toBeEnabled();
  await expect(
    page.getByRole("dialog", { name: "Review unsaved changes" }),
  ).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("reverting an uncertain applied inline save reconciles before an explicit corrective write", async ({
  page,
}) => {
  let patches = 0;
  await page.route(
    (url) => url.pathname.startsWith(`${listPath}/`),
    async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      patches++;
      if (patches === 1) {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.fulfill({
          status: 503,
          json: { code: "unavailable", message: "Lost acknowledgement" },
        });
      } else {
        await route.continue();
      }
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Edit name" }).first().click();
  const input = page.getByRole("textbox", { name: "Edit name" });
  const original = await input.inputValue();
  await input.fill("Uncertain review save");
  await input.press("Enter");
  await expect(
    page.getByRole("button", { name: "Accept current result" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue editing" }).click();
  await input.fill(original);
  await input.press("Enter");
  const retry = page.getByRole("button", { name: /Retry against revision/ });
  await expect(retry).toBeVisible();
  expect(patches).toBe(1);
  await retry.click();
  await expect(input).toHaveCount(0);
  await expect(page.locator(".MuiSnackbar-root")).toContainText(
    "Changes saved.",
  );
  expect(patches).toBe(2);
});
