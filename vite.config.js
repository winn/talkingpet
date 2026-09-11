import { defineConfig } from "vite";
import { cpSync } from "node:fs";

export default defineConfig({
  server: {
    allowedHosts: [
      "dramatize-levers-preset.ngrok-free.dev",
      ".ngrok-free.dev",
    ],
  },
  plugins: [
    {
      name: "pet-assets",
      closeBundle() {
        cpSync("assets", "dist/assets", { recursive: true });
      },
    },
  ],
  build: { chunkSizeWarningLimit: 1000 },
});

