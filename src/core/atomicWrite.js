"use strict";
const fs = require("fs/promises");
const { constants } = require("fs");
const path = require("path");

async function symlinkTarget(filePath, visited = new Set()) {
    filePath = path.resolve(filePath);
    if (visited.has(filePath)) {
        const error = new Error("Too many levels of symbolic links: " + filePath);
        error.code = "ELOOP";
        throw error;
    }
    visited.add(filePath);
    try {
        const stat = await fs.lstat(filePath);
        if (!stat.isSymbolicLink()) return filePath;
        const link = await fs.readlink(filePath);
        return symlinkTarget(path.resolve(path.dirname(filePath), link), visited);
    } catch (e) {
        if (e.code === "ENOENT") return filePath;
        throw e;
    }
}

async function writeIfChanged(filePath, content) {
    const dest = await symlinkTarget(filePath);
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    let existingMode = null;
    try {
        const existing = await fs.readFile(dest);
        if (existing.equals(data)) return false;
        await fs.access(dest, constants.W_OK);
        existingMode = (await fs.stat(dest)).mode;
    } catch (e) { if (e.code !== "ENOENT") throw e; }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const tmp = dest + ".palsync-tmp-" + process.pid + "-" + Math.random().toString(16).slice(2);
    try {
        await fs.writeFile(tmp, data);
        if (existingMode != null) await fs.chmod(tmp, existingMode);
        await fs.rename(tmp, dest);
    } catch (e) {
        await fs.rm(tmp, { force: true });
        throw e;
    }
    return true;
}

module.exports = { writeIfChanged };
