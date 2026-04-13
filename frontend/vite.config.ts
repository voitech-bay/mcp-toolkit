import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiPort = process.env.API_PORT ?? "3001";
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? `http://localhost:${apiPort}`;

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === "emoji-picker",
        },
      },
    }),
  ],
  root: ".",
  base: "/",
  resolve: {
    alias: {
      "@mcp/prompt-resolver": resolve(__dirname, "../src/services/prompt-resolver.ts"),
    },
  },
  build: {
    outDir: resolve(__dirname, "../public"),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "index.html"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
