import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiPort = process.env.API_PORT ?? "3001";
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? `http://localhost:${apiPort}`;

export default defineConfig({
  plugins: [vue()],
  resolve: {
    dedupe: ["vue", "pinia", "naive-ui", "@vueuse/core", "vue-router", "vue-echarts", "echarts"],
    alias: {
      "@": resolve(__dirname, "src"),
      "@shared": resolve(__dirname, "../frontend/src"),
    },
  },
  build: {
    outDir: resolve(__dirname, "../client-public"),
    emptyOutDir: true,
    rollupOptions: {
        input: resolve(__dirname, "index.html"),
    },
  },
  server: {
    fs: {
      allow: [resolve(__dirname, "..")],
    },
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    allowedHosts: ["voitech-client-portal.up.railway.app"],
  },
});
