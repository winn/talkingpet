import { defineConfig } from "vite";
import { cpSync } from "node:fs";
import { devApi } from "./tools/dev-api.js";

export default defineConfig({
  server: {
    allowedHosts: [
      "dramatize-levers-preset.ngrok-free.dev",
      ".ngrok-free.dev",
    ],
  },
  plugins: [
    devApi(),
    {
      name: "pet-assets",
      closeBundle() {
        cpSync("assets", "dist/assets", { recursive: true });
      },
    },
  ],
  build: { chunkSizeWarningLimit: 1000 },
});
