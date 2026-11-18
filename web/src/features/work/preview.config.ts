import { defineConfig } from "vite";
export default defineConfig({
  root: "web",
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    // Freeze this QA candidate while independent frontends are edited concurrently.
    watch:null,
    allowedHosts: ["work.localhost"],
    proxy: { "/api": "http://127.0.0.1:3004" },
  },
});
