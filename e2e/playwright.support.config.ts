import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests", testMatch: "support-map.spec.ts", workers: 1, fullyParallel: false, retries: 0,
  reporter: "list", timeout: 45_000,
  use: { baseURL: "http://localhost:5274", viewport: { width: 1600, height: 1100 },
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : { channel: process.env.PW_BROWSER_CHANNEL },
  },
  webServer: [
    { command: "node e2e/support-server.mjs", cwd: "..", url: "http://localhost:3102/api/health", timeout: 60_000, reuseExistingServer: false },
    { command: "npm run dev -w web -- --port 5274 --strictPort", cwd: "..", url: "http://localhost:5274", timeout: 60_000, reuseExistingServer: false, env: { API_URL: "http://localhost:3102" } },
  ],
});
