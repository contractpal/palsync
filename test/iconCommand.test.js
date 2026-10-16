"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { tmpWorkspace } = require("./helpers");
const { run, pngSize } = require("../src/cli/iconCommand");
const { loadChromium } = require("../src/core/browser");

function crc32(buf) {
    let c, crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c = (crc ^ buf[i]) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}
function makePng(w, h) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    const raw = Buffer.alloc((w * 4 + 1) * h);
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function ws(manifest) { return tmpWorkspace({ "pal.json": JSON.stringify(manifest) }); }
function readManifest(dir) { return JSON.parse(fs.readFileSync(path.join(dir, "pal.json"), "utf8")); }
function quiet(fn) {
    const orig = console.log; console.log = () => {};
    return fn().finally(() => { console.log = orig; });
}

test("icon — copies a 48x48 PNG, registers image + consoleSettings, idempotent", async () => {
    const dir = ws({ images: "" });
    const src = path.join(dir, "src.png");
    fs.writeFileSync(src, makePng(48, 48));
    await quiet(() => run("icon", [src, "--label", "Tracker", "--dir", dir]));
    assert.deepStrictEqual(pngSize(fs.readFileSync(path.join(dir, "images", "48x48.png"))), { width: 48, height: 48 });
    const m = readManifest(dir);
    assert.strictEqual(m.images.entry.length, 1);
    assert.deepStrictEqual(m.images.entry[0].Image, { content: "", contentType: "image/png", filename: "48x48.png", palType: "palTypeConsole" });
    assert.deepStrictEqual(m.consoleSettings, { desktopImage: "48x48.png", desktopLabel: "Tracker" });
    const before = fs.readFileSync(path.join(dir, "pal.json"), "utf8");
    await quiet(() => run("icon", ["--dir", dir]));
    assert.strictEqual(fs.readFileSync(path.join(dir, "pal.json"), "utf8"), before);
    assert.strictEqual(readManifest(dir).images.entry.length, 1);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("icon — a failed run never replaces the existing icon", async () => {
    const dir = ws({});
    const good = makePng(48, 48);
    fs.mkdirSync(path.join(dir, "images"), { recursive: true });
    fs.writeFileSync(path.join(dir, "images", "48x48.png"), good);
    const src = path.join(dir, "other.png");
    fs.writeFileSync(src, makePng(48, 48).fill(1, 40, 41));
    await assert.rejects(() => run("icon", [src, "--dir", dir]), /--label/);
    assert.ok(fs.readFileSync(path.join(dir, "images", "48x48.png")).equals(good));
    await assert.rejects(() => run("icon", ["logo.bmp", "--label", "X", "--dir", dir]), /Unsupported image/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test("icon — preserves other consoleSettings keys, inherits palType, handles single-object entry", async () => {
    const dir = ws({
        images: { entry: { string: "logo.png", Image: { content: "", contentType: "image/png", filename: "logo.png", palType: "palTypeWeb" } } },
        consoleSettings: { desktopLabel: "Old", other: "keep" }
    });
    fs.mkdirSync(path.join(dir, "images"));
    fs.writeFileSync(path.join(dir, "images", "48x48.png"), makePng(48, 48));
    await quiet(() => run("icon", ["--dir", dir]));
    const m = readManifest(dir);
    assert.deepStrictEqual(m.consoleSettings, { desktopLabel: "Old", other: "keep", desktopImage: "48x48.png" });
    assert.strictEqual(m.images.entry.length, 2);
    assert.strictEqual(m.images.entry[1].Image.palType, "palTypeWeb");
    fs.rmSync(dir, { recursive: true, force: true });
});

test("icon — requires a label when none exists; rejects HTML label", async () => {
    const dir = ws({});
    fs.mkdirSync(path.join(dir, "images"));
    fs.writeFileSync(path.join(dir, "images", "48x48.png"), makePng(48, 48));
    await assert.rejects(() => run("icon", ["--dir", dir]), /--label/);
    await assert.rejects(() => run("icon", ["--label", "<b>x</b>", "--dir", dir]), /plain text/);
    assert.strictEqual(readManifest(dir).consoleSettings, undefined);
    fs.rmSync(dir, { recursive: true, force: true });
});

async function chromiumOk() {
    const chromium = loadChromium();
    if (!chromium) return false;
    try { const b = await chromium.launch(); await b.close(); return true; } catch (e) { return false; }
}

test("icon — fits SVG and oversized PNG to 48x48; --preview registers nothing (skipped without Chromium)", async (t) => {
    if (!await chromiumOk()) return t.skip("Chromium unavailable");
    const dir = ws({});
    const svg = path.join(dir, "i.svg");
    fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="red"/></svg>');
    const big = path.join(dir, "logo.png");
    fs.writeFileSync(big, makePng(120, 64));
    const before = fs.readFileSync(path.join(dir, "pal.json"), "utf8");
    await quiet(() => run("icon", ["--preview", svg, big, "--dir", dir]));
    assert.ok(pngSize(fs.readFileSync(path.join(dir, "assets", "console-icon-preview.png"))).width > 48);
    assert.strictEqual(fs.readFileSync(path.join(dir, "pal.json"), "utf8"), before);
    assert.ok(!fs.existsSync(path.join(dir, "images", "48x48.png")));
    for (const src of [svg, big]) {
        await quiet(() => run("icon", [src, "--label", "S", "--dir", dir]));
        assert.deepStrictEqual(pngSize(fs.readFileSync(path.join(dir, "images", "48x48.png"))), { width: 48, height: 48 });
    }
    fs.rmSync(dir, { recursive: true, force: true });
});
