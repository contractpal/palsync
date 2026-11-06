"use strict";
const { defineConfig } = require("vite");
const react = require("@vitejs/plugin-react");

module.exports = defineConfig({
    root: "src/renderer",
    base: "./",
    plugins: [react()],
    server: {
        // Windows (Hyper-V/WSL/Docker) can reserve ranges that include 5173 (EACCES on listen);
        // override with PALSYNC_DEV_PORT. Keep in sync with the dev URL in src/main/index.js.
        port: Number(process.env.PALSYNC_DEV_PORT) || 5273,
        strictPort: true
    },
    build: {
        outDir: "../../dist-renderer",
        emptyOutDir: true
    }
});
