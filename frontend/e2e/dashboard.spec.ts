import { apiURL } from "./api";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Deployment, DeploymentPage } from "../src/api/client";

const root = `${apiURL}/api/deployments`;

async function target(request: APIRequestContext) {
  const data = (await (
    await request.get(`${root}?limit=1`)
  ).json()) as DeploymentPage;

  if (!data.items[0]) {
    throw new Error("Seed the isolated test API before E2E.");
  }

  return data.items[0];
}

async function read(request: APIRequestContext, id: string) {
  const data = (await (
    await request.get(`${root}/${id}?include_deleted=true`)
  ).json()) as Deployment;

  return data;
}

async function patch(
  request: APIRequestContext,
  record: Deployment,
  name: string,
) {
  const response = await request.patch(`${root}/${record.deployment_id}`, {
    headers: { "If-Match": `"${record.revision}"` },
    data: { attributes: { name } },
  });

  expect(response.ok()).toBeTruthy();
}

async function select(page: Page, record: Deployment) {
  await page.goto(`/?q=${record.deployment_id}`);
  await expect(page.getByRole("table")).toContainText(
    record.attributes.name ?? "Unnamed",
  );
}

async function editName(page: Page, value: string) {
  const actions = page.locator('[data-virtuoso-scroller="true"]');

  await actions.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await page.getByRole("button", { name: "Edit name", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Edit name", exact: true });

  await input.fill(value);

  return input;
}

test("inline keyboard editing and complete attribute CRUD", async ({
  page,
  request,
}) => {
  const record = await target(request);

  const attributeKey = `e2e_${crypto.randomUUID().slice(0, 8)}`;

  const name = `Inline ${crypto.randomUUID()}`;

  await select(page, record);
  const input = await editName(page, name);

  await input.press("Enter");
  await expect(page.getByRole("table")).toContainText(name);
  expect((await read(request, record.deployment_id)).attributes.name).toBe(
    name,
  );
  const cancel = await editName(page, "discard");

  await cancel.press("Escape");
  expect((await read(request, record.deployment_id)).attributes.name).toBe(
    name,
  );
  const blur = await editName(page, `${name} blur`);

  await blur.press("Tab");
  await expect(
    page.getByRole("button", { name: "Save name", exact: true }),
  ).toBeFocused();
  expect((await read(request, record.deployment_id)).attributes.name).toBe(
    name,
  );
  await page.getByRole("button", { name: "Cancel name", exact: true }).focus();
  await page.getByRole("textbox", { name: "Search deployments" }).focus();
  await expect
    .poll(
      async () => (await read(request, record.deployment_id)).attributes.name,
    )
    .toBe(`${name} blur`);
  await page.getByRole("button", { name: "Open details" }).click();
  await page.getByRole("button", { name: "Edit attributes" }).click();
  await page.getByRole("button", { name: "Add attribute" }).click();
  const keys = page.getByRole("textbox", { name: /Attribute key/ });

  await keys.last().fill(attributeKey);
  await page
    .getByRole("textbox", { name: `Value for ${attributeKey}` })
    .fill("custom value");
  await page.getByRole("button", { name: "Save attributes" }).click();
  await expect(
    page.getByRole("button", { name: "Edit attributes" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit attributes" }).click();
  await page
    .getByRole("textbox", { name: /Attribute key/ })
    .filter({ visible: true })
    .last()
    .fill(`${attributeKey}_renamed`);
  await page.getByRole("button", { name: "Save attributes" }).click();
  await expect
    .poll(
      async () =>
        (await read(request, record.deployment_id)).attributes[
          `${attributeKey}_renamed`
        ],
    )
    .toBe("custom value");
  expect(
    (await read(request, record.deployment_id)).attributes[attributeKey],
  ).toBeUndefined();
  await page.getByRole("button", { name: "Edit attributes" }).click();
  await page
    .getByRole("textbox", {
      name: `Value for ${attributeKey}_renamed`,
      exact: true,
    })
    .fill("edited value");
  await page.getByRole("button", { name: "Save attributes" }).click();
  await expect
    .poll(
      async () =>
        (await read(request, record.deployment_id)).attributes[
          `${attributeKey}_renamed`
        ],
    )
    .toBe("edited value");
  await page.getByRole("button", { name: "Edit attributes" }).click();
  await page
    .getByRole("button", {
      name: `Remove attribute ${attributeKey}_renamed`,
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Save attributes" }).click();
  await expect
    .poll(
      async () =>
        (await read(request, record.deployment_id)).attributes[
          `${attributeKey}_renamed`
        ],
    )
    .toBeUndefined();
  await page.getByRole("button", { name: "Close details" }).click();

  let writes = 0;

  page.on("request", (request) => {
    if (request.method() === "PATCH") {
      writes++;
    }
  });
  await page.getByRole("button", { name: "Edit name", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Edit name", exact: true })
    .press("Enter");
  expect(writes).toBe(0);
  await page
    .getByRole("button", { name: "Edit description", exact: true })
    .click();
  const description = page.getByRole("textbox", {
    name: "Edit description",
    exact: true,
  });

  const firstLine = `First line (revision ${record.revision})`;

  await description.fill(firstLine);
  await description.press("Shift+Enter");
  await description.pressSequentially("Second line");
  await expect(description).toHaveValue(`${firstLine}\nSecond line`);
  await description.press("Enter");
  await expect
    .poll(
      async () =>
        (await read(request, record.deployment_id)).attributes.description,
    )
    .toBe(`${firstLine}\nSecond line`);
  expect(writes).toBe(1);
});
test("independent clients see changes and preserve conflicting drafts", async ({
  page,
  browser,
  request,
}) => {
  const record = await target(request);

  await select(page, record);
  const context = await browser.newContext();

  const other = await context.newPage();

  await select(other, record);
  const input = await editName(page, "My preserved draft");

  await patch(
    request,
    await read(request, record.deployment_id),
    "Another teammate",
  );
  await expect(other.getByRole("table")).toContainText("Another teammate");
  await expect(input).toHaveValue("My preserved draft");
  await input.press("Enter");
  await expect(page.getByText("Current: Another teammate")).toBeVisible();
  await expect(page.locator(".MuiDialog-container")).toHaveCSS("opacity", "1");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /Retry against revision/ }).click();
  await expect(other.getByRole("table")).toContainText("My preserved draft");
  await context.close();
});
test("soft deletes and restores through Trash", async ({ page, request }) => {
  const record = await target(request);

  await select(page, record);
  await page.locator('[data-virtuoso-scroller="true"]').evaluate((element) => {
    element.scrollLeft = 0;
  });
  await page.getByRole("button", { name: "Delete deployment" }).click();
  await page
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await expect(
    page.getByText("No deployments match these filters"),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Trash" }).click();
  await expect(page.getByRole("table")).toContainText(
    record.attributes.name ?? "Unnamed",
  );
  await page.locator('[data-virtuoso-scroller="true"]').evaluate((element) => {
    element.scrollLeft = 0;
  });
  await page
    .getByRole("button", { name: "Restore deployment" })
    .first()
    .click();
  await page.getByRole("tab", { name: "Active" }).click();
  await expect(page.getByRole("table")).toContainText(
    record.attributes.name ?? "Unnamed",
  );
});

test("visible inline actions support pointer and keyboard without internal blur writes", async ({
  page,
  request,
}) => {
  const record = await target(request);
  await select(page, record);
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH") {
      writes++;
    }
  });
  let input = await editName(page, "Cancel with pointer");
  await page.getByRole("button", { name: "Cancel name", exact: true }).click();
  await expect(input).toHaveCount(0);
  expect(writes).toBe(0);
  input = await editName(page, "Cancel with keyboard");
  await input.press("Tab");
  await expect(
    page.getByRole("button", { name: "Save name", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Cancel name", exact: true }),
  ).toBeFocused();
  expect(writes).toBe(0);
  await page.keyboard.press("Enter");
  await expect(input).toHaveCount(0);
  expect(writes).toBe(0);
  const name = `Visible save ${crypto.randomUUID()}`;
  input = await editName(page, name);
  await page.screenshot({ path: test.info().outputPath("inline-actions.png") });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(input).toHaveCount(0);
  expect(writes).toBe(1);
  expect((await read(request, record.deployment_id)).attributes.name).toBe(
    name,
  );
  input = await editName(page, `${name} keyboard`);
  await input.press("Tab");
  expect(writes).toBe(1);
  await page.keyboard.press("Enter");
  await expect(input).toHaveCount(0);
  expect(writes).toBe(2);
  expect((await read(request, record.deployment_id)).attributes.name).toBe(
    `${name} keyboard`,
  );
});
