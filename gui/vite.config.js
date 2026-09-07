"use strict";
const { defineConfig } = require("vite");
const react = require("@vitejs/plugin-react");

module.exports = defineConfig({
    root: "src/renderer",
    base: "./",
    plugins: [react()],
    server: {
        port: 5173,
        strictPort: true
    },
    build: {
        outDir: "../../dist-renderer",
        emptyOutDir: true
    }
});
