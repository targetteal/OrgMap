import { defineConfig } from "vite";
export default defineConfig({
  build: {
    outDir: "/tmp/orgmap-goals-feature-build",
    rollupOptions: {
      input: new URL("./preview.html", import.meta.url).pathname,
    },
  },
  root: new URL("../../../", import.meta.url).pathname,
  server: {
    hmr: false,
    host: "127.0.0.1",
    allowedHosts: ["goals.localhost", "goals-guest.localhost"],
    port: Number(process.env.GOALS_PREVIEW_PORT ?? 5178),
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:" + (process.env.GOALS_API_PORT ?? "3008"), changeOrigin: false } },
  },
});
