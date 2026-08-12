import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const input: Record<string, string> = {
  index: resolve(projectRoot, "index.html"),
};

// The service worker is owned by the background slice. Including it when the
// slice exists keeps the scaffold buildable before that slice is added while
// ensuring production builds emit the manifest's expected background.js.
const backgroundEntry = resolve(projectRoot, "src/background/index.ts");
if (existsSync(backgroundEntry)) {
  input.background = backgroundEntry;
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input,
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "background") return "background.js";
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
