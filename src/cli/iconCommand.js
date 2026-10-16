"use strict";
// `palsync icon` — offline: create/register a Pal's 48x48 console icon.
// Server: ConsoleSettings.desktopImage (48x48 image name) + desktopLabel (text only), top-level
// `consoleSettings` in pal.json; the image itself is an `images.entry` Image resolved from images/.
const fs = require("fs");
const path = require("path");

const ICON = "48x48.png";
const SIZE = 48;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const MIME = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const PREVIEW = path.join("assets", "console-icon-preview.png");

function parseArgs(args) {
    const o = { sources: [], label: undefined, dir: process.cwd(), preview: false, out: null };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--label") o.label = args[++i];
        else if (a === "--dir") o.dir = path.resolve(args[++i] || "");
        else if (a === "--preview") o.preview = true;
        else if (a === "--out") o.out = args[++i];
        else if (a.startsWith("--")) throw new Error("Unknown flag for icon: " + a);
        else o.sources.push(a);
    }
    if (!o.preview && o.sources.length > 1) throw new Error("icon takes one source file (several only with --preview)");
    if (o.preview && !o.sources.length) throw new Error("--preview needs one or more candidate images");
    for (const src of o.sources) {
        if (!MIME[path.extname(src).toLowerCase()]) throw new Error("Unsupported image " + src + " (use " + Object.keys(MIME).join(", ") + ")");
    }
    if (o.label !== undefined && (typeof o.label !== "string" || !o.label.trim())) throw new Error("--label needs text");
    if (o.label !== undefined && /[<>]/.test(o.label)) throw new Error("--label must be plain text (no HTML): the server shows desktopLabel as text only");
    return o;
}

function pngSize(buf) {
    if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG) || buf.toString("ascii", 12, 16) !== "IHDR") {
        throw new Error("not a valid PNG file");
    }
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const dataUrl = (file, buf) => "data:" + MIME[path.extname(file).toLowerCase()] + ";base64," + (buf || fs.readFileSync(file)).toString("base64");

async function withBrowser(fn) {
    const chromium = require("../core/browser").loadChromium();
    if (!chromium) throw new Error("Playwright is not installed; cannot render images. Provide a 48x48 PNG instead, or run `palsync doctor`.");
    let browser;
    try { browser = await chromium.launch(); }
    catch (e) { throw new Error("Chromium is unavailable (" + String(e.message).split("\n")[0] + "). Install it via `palsync doctor` or provide a 48x48 PNG."); }
    try { return await fn(browser); } finally { await browser.close(); }
}

// Any supported image -> exactly 48x48 PNG: scaled to fit (aspect kept), centered, transparent.
async function render48(browser, file) {
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
    try {
        await page.setContent('<!doctype html><html><body style="margin:0;background:transparent">' +
            '<img src="' + dataUrl(file) + '" style="display:block;width:' + SIZE + 'px;height:' + SIZE + 'px;object-fit:contain"></body></html>');
        await page.evaluate(() => document.images[0].decode());
        return await page.screenshot({ omitBackground: true, type: "png", clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
    } finally { await page.close(); }
}

// One contact sheet: each candidate's real 48x48 render, enlarged 4x and at actual size.
async function preview(browser, sources, out) {
    const cells = [];
    for (const src of sources) {
        const png = await render48(browser, src);
        const url = "data:image/png;base64," + png.toString("base64");
        cells.push('<div style="text-align:center"><div style="display:flex;gap:16px;align-items:center">' +
            '<img src="' + url + '" style="width:192px;height:192px;image-rendering:pixelated">' +
            '<img src="' + url + '"></div><div>' + String.fromCharCode(65 + cells.length) + ": " +
            path.basename(src).replace(/[<>&]/g, "") + '</div></div>');
    }
    const page = await browser.newPage({ viewport: { width: 300 * cells.length, height: 250 } });
    await page.setContent('<!doctype html><html><body style="margin:0;padding:16px;display:flex;gap:32px;' +
        'background:#f4f4f5;font:14px sans-serif">' + cells.join("") + '</body></html>');
    await page.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, await page.screenshot({ fullPage: true }));
}

const asArray = v => v == null ? [] : (Array.isArray(v) ? v : [v]);

// Mutates manifest; returns list of human-readable changes (empty when already registered).
function register(manifest, label) {
    const changes = [];
    const images = manifest.images && typeof manifest.images === "object" ? manifest.images : { entry: [] };
    const entries = asArray(images.entry);
    let entry = entries.find(e => e && e.string === ICON);
    if (!entry) {
        const first = entries.find(e => e && e.Image && e.Image.palType);
        entry = { string: ICON, Image: { content: "", contentType: "image/png", filename: ICON, palType: first ? first.Image.palType : "palTypeConsole" } };
        entries.push(entry);
        changes.push("images." + ICON + " added");
    } else {
        entry.Image = entry.Image && typeof entry.Image === "object" ? entry.Image : {};
        if (entry.Image.contentType !== "image/png" || entry.Image.filename !== ICON) {
            entry.Image.contentType = "image/png";
            entry.Image.filename = ICON;
            changes.push("images." + ICON + " fixed");
        }
    }
    if (changes.length || !Array.isArray(images.entry)) images.entry = entries;
    manifest.images = images;
    const cs = manifest.consoleSettings && typeof manifest.consoleSettings === "object" ? manifest.consoleSettings : {};
    if (cs.desktopImage !== ICON) { cs.desktopImage = ICON; changes.push("consoleSettings.desktopImage"); }
    if (label !== undefined && cs.desktopLabel !== label) { cs.desktopLabel = label; changes.push("consoleSettings.desktopLabel"); }
    if (!cs.desktopLabel) throw new Error("No console label yet: pass --label \"<text>\"");
    manifest.consoleSettings = cs;
    return changes;
}

async function run(_subcmd, args) {
    const o = parseArgs(args);
    for (const src of o.sources) if (!fs.existsSync(path.resolve(src))) throw new Error("Source not found: " + src);
    if (o.preview) {
        const out = path.resolve(o.dir, o.out || PREVIEW);
        await withBrowser(b => preview(b, o.sources.map(s => path.resolve(s)), out));
        console.log("Preview of " + o.sources.length + " candidate(s): " + out + " (nothing registered)");
        return 0;
    }
    const manifestPath = path.join(o.dir, "pal.json");
    if (!fs.existsSync(manifestPath)) throw new Error("No pal.json in " + o.dir + " (use --dir <workspace>)");
    // Validate the manifest before touching images/ so a failed run never replaces a good icon.
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const changes = register(manifest, o.label);
    const target = path.join(o.dir, "images", ICON);
    if (o.sources.length) {
        const src = path.resolve(o.sources[0]);
        const buf = fs.readFileSync(src);
        let exact = false;
        try { const d = pngSize(buf); exact = d.width === SIZE && d.height === SIZE; } catch (e) { /* not a PNG: render it */ }
        const png = exact ? buf : await withBrowser(b => render48(b, src));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (src !== target) fs.writeFileSync(target, png);
    } else if (!fs.existsSync(target)) {
        throw new Error("images/" + ICON + " not found; pass an image source");
    }
    const { width, height } = pngSize(fs.readFileSync(target));
    if (width !== SIZE || height !== SIZE) {
        throw new Error("images/" + ICON + " is " + width + "x" + height + "; pass it as a source to fit it to " + SIZE + "x" + SIZE);
    }
    if (changes.length) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log("images/" + ICON + " ok (" + SIZE + "x" + SIZE + " PNG)");
    console.log(changes.length ? "pal.json updated: " + changes.join(", ") : "pal.json unchanged (already registered)");
    return 0;
}

module.exports = { run, register, pngSize };
