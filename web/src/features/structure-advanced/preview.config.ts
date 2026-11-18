import { defineConfig } from "vite";

export default defineConfig({
  root: process.cwd() + "/web",

  server: {
    host: "127.0.0.1",
    port: 5185,
    strictPort: true,
 allowedHosts:["structure.localhost"],
    proxy: { "/api": { target: "http://127.0.0.1:3015", changeOrigin: false } },
  },
});
