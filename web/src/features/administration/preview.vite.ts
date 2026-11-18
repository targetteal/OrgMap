import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: {
    alias: [
      { find: "./features/registry", replacement: fileURLToPath(new URL("./preview-registry.ts", import.meta.url)) },
      { find: "../registry", replacement: fileURLToPath(new URL("./preview-registry.ts", import.meta.url)) },
    ],
  },
  optimizeDeps: { entries: [fileURLToPath(new URL("./preview.html", import.meta.url))] },
  plugins: [
    {
      name: "administration-local-harness",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (
            !req.url?.includes("/preview-mobile.html") &&
            req.headers.accept?.includes("text/html") &&
            !req.url?.startsWith("/api") &&
            !req.url?.startsWith("/public")
          )
            req.url = "/src/features/administration/preview.html";
          next();
        });
      },
    },
  ],
  root: fileURLToPath(new URL("../../../", import.meta.url)),
  server: {
    hmr: false,
    host: "127.0.0.1",
    port: 5187,
    strictPort: true,
    watch: {
      ignored: [
        "**/src/App.tsx",
        "**/src/api.ts",
        "**/src/styles.css",
        "**/src/features/registry.ts",
        "**/src/feature-contract.ts",
      ],
    },
    proxy: {
      "/api": { target: "http://127.0.0.1:31787", changeOrigin: false },
      "/public": { target: "http://127.0.0.1:31787", changeOrigin: false },
    },
  },
});
