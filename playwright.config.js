import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test/e2e",
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://localhost:8090",
    channel: "chrome",
    launchOptions: { args: ["--enable-unsafe-swiftshader"] },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 8090",
    url: "http://localhost:8090",
    reuseExistingServer: true,
  },
});
