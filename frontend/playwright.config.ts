import { defineConfig, devices } from "@playwright/test";

const port = process.env.TEST_FRONTEND_PORT ?? "3001";
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
      },
    },
  ],
  webServer: {
    command: `PORT=${port} HOSTNAME=127.0.0.1 npm run start`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
