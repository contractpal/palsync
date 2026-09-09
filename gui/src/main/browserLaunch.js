"use strict";
// Launches a URL in a specific configured browser executable, instead of the OS default —
// ports the Java PalBuilder IDE's BrowserConfiguration.launch() to Node's child_process.
const { spawn } = require("child_process");
const path = require("path");
const { openUrl } = require("palsync/src/platform/openUrl");

// Splits an args template into argv, substituting the ${URL} placeholder token (same convention
// as the Java IDE — e.g. "--incognito ${URL}" for a flagged launch). No shell involved, so a
// URL with query params (incl. a credential-bearing cp-auth token) can't be shell-injected.
function buildArgs(argsTemplate, url) {
    const template = (argsTemplate && argsTemplate.trim()) || "${URL}";
    return template.split(/\s+/).filter(Boolean).map(part => part === "${URL}" ? url : part);
}

// browser: { execPath, argsTemplate } | null|undefined (falls back to the OS default opener,
// matching the Java client's own "no browser configured" fallback). Never throws.
async function launchInBrowser(url, browser) {
    if (!browser || !browser.execPath) return openUrl(url);
    const execPath = browser.execPath;

    try {
        if (process.platform === "darwin" && execPath.toLowerCase().endsWith(".app")) {
            // .app bundles can't be exec'd directly — `open -a` is the correct launch path,
            // same as the Java client's macOS branch (minus its shell-script workaround, which
            // Node's spawn doesn't need).
            const appName = path.basename(execPath, path.extname(execPath));
            const child = spawn("open", ["-a", appName, url], { stdio: "ignore" });
            child.unref();
            return { opened: true };
        }
        if (process.platform === "win32" && /^microsoft-edge:?$/i.test(execPath)) {
            // Edge's OS URI scheme, same as the Java client's special case for it.
            const child = spawn("cmd", ["/c", "start", "", "microsoft-edge:" + url], { stdio: "ignore", windowsVerbatimArguments: true });
            child.unref();
            return { opened: true };
        }
        const child = spawn(execPath, buildArgs(browser.argsTemplate, url), { stdio: "ignore" });
        let settled = false;
        return await new Promise(resolve => {
            child.on("error", (err) => { if (!settled) { settled = true; resolve({ opened: false, reason: (err && err.code) || "spawn-error" }); } });
            child.unref();
            setTimeout(() => { if (!settled) { settled = true; resolve({ opened: true }); } }, 150);
        });
    } catch (e) {
        return { opened: false, reason: (e && e.message) || "spawn-throw" };
    }
}

module.exports = { launchInBrowser, buildArgs };
