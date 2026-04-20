import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiPort = process.env.API_PORT ?? "3001";
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? `http://localhost:${apiPort}`;
const ALLOWED_ANALYTICS_API_PATHS = new Set([
  "/api/project-dashboard",
  "/api/analytics-collected-days",
  "/api/project-analytics",
  "/api/project-analytics-daily",
  "/api/project-conversation-geo",
]);

function analyticsApiGuardPlugin() {
  const guard = (req: { url?: string }, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void }, next: () => void) => {
    const rawUrl = req.url ?? "/";
    const pathname = new URL(rawUrl, "http://client-frontend.local").pathname;
    if (!pathname.startsWith("/api")) {
      next();
      return;
    }
    if (ALLOWED_ANALYTICS_API_PATHS.has(pathname)) {
      next();
      return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Not found" }));
  };

  return {
    name: "analytics-api-guard",
    configureServer(server: { middlewares: { use: (fn: typeof guard) => void } }) {
      server.middlewares.use(guard);
    },
    configurePreviewServer(server: { middlewares: { use: (fn: typeof guard) => void } }) {
      server.middlewares.use(guard);
    },
  };
}

export default defineConfig({
  plugins: [vue(), analyticsApiGuardPlugin()],
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
