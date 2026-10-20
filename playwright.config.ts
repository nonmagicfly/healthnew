import { defineConfig } from "@playwright/test";

// The e2e run uses its own data directory so it never touches real data in ./data.
const PORT = 3123;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: `rm -rf .e2e-data && npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: { HEALTH_DATA_DIR: ".e2e-data", HEALTH_SAMPLES: "fixtures", HEALTH_LLM_PROVIDER: "none" },
  },
});
