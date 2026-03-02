import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";
export default defineConfig({
    plugins: [vue()],
    root: ".",
    base: "/",
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
                // For local API: run npm run dev:api and use target "http://localhost:3001"
                target: "http://localhost:3001",
                changeOrigin: true,
            },
        },
    },
});
