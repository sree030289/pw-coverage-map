import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
  use: { baseURL: "http://localhost:4321" },
  webServer: { command: "node server.mjs", url: "http://localhost:4321/api/users", reuseExistingServer: true },
  projects: [
    { name: "api", testDir: "./tests/api" },
    { name: "ui", testDir: "./tests/ui", use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL } },
  ],
});
