var _a, _b;
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
var __dirname = dirname(fileURLToPath(import.meta.url));
var apiPort = (_a = process.env.API_PORT) !== null && _a !== void 0 ? _a : "3001";
var apiProxyTarget = (_b = process.env.VITE_API_PROXY_TARGET) !== null && _b !== void 0 ? _b : "http://localhost:".concat(apiPort);
export default defineConfig({
    plugins: [vue()],
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
