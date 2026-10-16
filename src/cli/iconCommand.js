"use strict";
// `palsync icon` — offline: create/register a Pal's 48x48 console icon.
// Server: ConsoleSettings.desktopImage (48x48 image name) + desktopLabel (text only), top-level
// `consoleSettings` in pal.json; the image itself is an `images.entry` Image resolved from images/.
const fs = require("fs");
const path = require("path");

const ICON = "48x48.png";
const SIZE = 48;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function parseArgs(args) {
    const o = { source: null, label: undefined, dir: process.cwd() };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--label") o.label = args[++i];
        else if (a === "--dir") o.dir = path.resolve(args[++i] || "");
        else if (a.startsWith("--")) throw new Error("Unknown flag for icon: " + a);
        else if (o.source === null) o.source = a;
        else throw new Error("icon takes at most one source file");
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

async function rasterize(svgPath, outPath) {
    const chromium = require("../core/browser").loadChromium();
    if (!chromium) throw new Error("Playwright is not installed; cannot rasterize SVG. Provide a 48x48 PNG instead, or run `palsync doctor`.");
    const svg = fs.readFileSync(svgPath);
    let browser;
    try { browser = await chromium.launch(); }
    catch (e) { throw new Error("Chromium is unavailable (" + String(e.message).split("\n")[0] + "). Install it via `palsync doctor` or provide a 48x48 PNG."); }
    try {
        const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
        const src = "data:image/svg+xml;base64," + svg.toString("base64");
        await page.setContent('<!doctype html><html><body style="margin:0;background:transparent">' +
            '<img src="' + src + '" width="' + SIZE + '" height="' + SIZE + '" style="display:block"></body></html>');
        await page.waitForFunction(() => document.images[0].complete);
        fs.writeFileSync(outPath, await page.screenshot({ omitBackground: true, type: "png", clip: { x: 0, y: 0, width: SIZE, height: SIZE } }));
    } finally { await browser.close(); }
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
    const manifestPath = path.join(o.dir, "pal.json");
    if (!fs.existsSync(manifestPath)) throw new Error("No pal.json in " + o.dir + " (use --dir <workspace>)");
    // Validate everything before touching images/ so a failed run never replaces a good icon.
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const changes = register(manifest, o.label);
    const target = path.join(o.dir, "images", ICON);
    const checkSize = (file, name) => {
        const { width, height } = pngSize(fs.readFileSync(file));
        if (width !== SIZE || height !== SIZE) {
            throw new Error(name + " is " + width + "x" + height + "; the console icon must be exactly " + SIZE + "x" + SIZE);
        }
    };
    if (o.source) {
        const src = path.resolve(o.source);
        if (!fs.existsSync(src)) throw new Error("Source not found: " + o.source);
        const ext = path.extname(src).toLowerCase();
        if (ext !== ".svg" && ext !== ".png") throw new Error("Source must be .svg or .png");
        if (ext === ".png") checkSize(src, o.source);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (ext === ".svg") await rasterize(src, target);
        else if (src !== target) fs.copyFileSync(src, target);
    } else if (!fs.existsSync(target)) {
        throw new Error("images/" + ICON + " not found; pass an .svg or .png source");
    }
    checkSize(target, "images/" + ICON);
    if (changes.length) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log("images/" + ICON + " ok (" + SIZE + "x" + SIZE + " PNG)");
    console.log(changes.length ? "pal.json updated: " + changes.join(", ") : "pal.json unchanged (already registered)");
    return 0;
}

module.exports = { run, register, pngSize };
