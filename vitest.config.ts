import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          APP_API_TOKEN: "test-gateway",
          OPENAI_API_KEY: "test-openai",
          TRAVEL_OPENAI_API_KEY: "test-travel-key",
        },
      },
    }),
  ],
  test: { testTimeout: 30000 },
});
