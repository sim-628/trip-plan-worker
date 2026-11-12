import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "browser-tests",
  timeout: 45000,
  use: {
    baseURL: "http://localhost:8787",
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 960 },
  },
  reporter: "list",
  outputDir: ".local-backups/browser-test-results",
});
