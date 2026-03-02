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
                target: "http://localhost:3000",
                changeOrigin: true,
            },
        },
    },
});
