"use strict";
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const SIZE = 1024;
app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: SIZE, height: SIZE, show: false, transparent: true, backgroundColor: "#00000000",
        webPreferences: { offscreen: true }
    });
    const srcFile = process.argv[2] || "icon-source.svg";
    const outFile = process.argv[3] || "icon.png";
    const svg = fs.readFileSync(path.join(__dirname, srcFile), "utf8");
    const html = `<!doctype html><html><body style="margin:0;padding:0;width:${SIZE}px;height:${SIZE}px;overflow:hidden;background:transparent;">${svg.replace("<svg ", `<svg style="display:block;width:${SIZE}px;height:${SIZE}px;" `)}</body></html>`;
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    await new Promise(r => setTimeout(r, 200));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, outFile), image.toPNG());
    app.quit();
});
