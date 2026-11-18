import { defineConfig } from "vite";
export default defineConfig({
  root: "web",
  server: {
    host: "127.0.0.1",
    port: 5177,
    strictPort: true,
    allowedHosts: ["platform.localhost"],
    proxy: { "/api": { target: "http://127.0.0.1:3017" } },
  },
});
