import { defineConfig } from "vite";
export default defineConfig({
  root: new URL("../../..", import.meta.url).pathname,
  server: {
    host: "127.0.0.1",
    port: 5183,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3083",
        changeOrigin: false,
        ws: true,
      },
    },
  },
});
