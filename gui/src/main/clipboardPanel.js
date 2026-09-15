"use strict";
// Backing logic for the workspace titlebar's clipboard button (App.jsx/ClipboardButton.jsx) —
// two independent directions sharing one .clipboard/ folder (new convention, alongside
// ./assets/./images — see contextInject.js's "Creating new files" section) in the ACTIVE pal's
// own directory:
//   "My Clipboard" — read whatever's on the OS clipboard for preview, save into .clipboard/ on
//                    explicit request, never automatically.
//   "Agent's Clipboard" — the agent just writes a file into .clipboard/ directly (it already has
//                          normal file-write access — no special MCP tool or OS clipboard access
//                          needed) and tells the human in the console to look; this reads back
//                          whichever file in there was modified most recently and displays it.
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { clipboard } = require("electron");

const IMAGE_EXT_MIME = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp"
};

function readClipboard() {
    const image = clipboard.readImage();
    if (image && !image.isEmpty()) {
        return { type: "image", dataUri: "data:image/png;base64," + image.toPNG().toString("base64") };
    }
    const text = clipboard.readText();
    if (text) return { type: "text", text };
    return { type: "empty" };
}

async function readLatestAgentFile(palPath) {
    const dir = path.join(palPath, ".clipboard");
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
        return { type: "empty" };
    }

    const files = entries.filter(e => e.isFile());
    if (files.length === 0) return { type: "empty" };

    const withStat = await Promise.all(files.map(async e => {
        const filePath = path.join(dir, e.name);
        const stat = await fs.stat(filePath);
        return { name: e.name, path: filePath, mtimeMs: stat.mtimeMs };
    }));
    withStat.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const latest = withStat[0];

    const mime = IMAGE_EXT_MIME[path.extname(latest.name).toLowerCase()];
    if (mime) {
        const buf = await fs.readFile(latest.path);
        return { type: "image", fileName: latest.name, dataUri: "data:" + mime + ";base64," + buf.toString("base64") };
    }
    const text = await fs.readFile(latest.path, "utf8");
    return { type: "text", fileName: latest.name, text };
}

async function saveClipboard(palPath, item) {
    if (!item || (item.type !== "image" && item.type !== "text")) {
        throw new Error("Nothing on the clipboard to save.");
    }
    const dir = path.join(palPath, ".clipboard");
    await fs.mkdir(dir, { recursive: true });
    const name = crypto.randomBytes(4).toString("hex");

    let fileName;
    if (item.type === "image") {
        fileName = name + ".png";
        const base64 = item.dataUri.slice(item.dataUri.indexOf(",") + 1);
        await fs.writeFile(path.join(dir, fileName), Buffer.from(base64, "base64"));
    } else {
        fileName = name + ".txt";
        await fs.writeFile(path.join(dir, fileName), item.text, "utf8");
    }
    return { fileName, path: path.join(dir, fileName) };
}

module.exports = { readClipboard, readLatestAgentFile, saveClipboard };
