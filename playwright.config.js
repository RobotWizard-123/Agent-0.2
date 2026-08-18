import { defineConfig, devices } from "playwright/test";

const baseURL = "http://127.0.0.1:3100";
const browserChannel = process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" ? "msedge" : null);

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./output/playwright/test-results",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], ...(browserChannel ? { channel: browserChannel } : {}) } }],
});
