import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  server: {
    host: "127.0.0.1",
    port: 5192,
    strictPort: true,
    allowedHosts: ["editor.localhost"],
  },
  build: {
    outDir: "src/editor/evidence/build",
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL("./preview.html", import.meta.url)),
    },
  },
});
