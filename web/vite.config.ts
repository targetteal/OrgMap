import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [
    {
      name: "orgmap-public-landing",
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          if (request.url?.split("?")[0] === "/")
            request.url = "/landing/index.html" + (request.url.slice(1) || "");
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((request, _response, next) => {
          if (request.url?.split("?")[0] === "/")
            request.url = "/landing/index.html" + (request.url.slice(1) || "");
          next();
        });
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "^/public(?:/|$)": {
        target: "http://127.0.0.1:3001",
        changeOrigin: false,
      },
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: false,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    license: { fileName: "dependency-licenses.md" },
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL("./index.html", import.meta.url)),
        landing: fileURLToPath(
          new URL("./landing/index.html", import.meta.url),
        ),
      },
    },
  },
});
