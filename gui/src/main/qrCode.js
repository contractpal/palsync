"use strict";
// Renders a QR code image for a preview URL, entirely in the main process, so the raw
// (credential-bearing) URL never has to cross into the renderer — only the rendered PNG does.
// Mirrors the Java PalBuilder IDE's "scan to test on your phone" option (its GetQRCode server
// call), but generated locally instead of round-tripping to CloudPiston for it.
const QRCode = require("qrcode");

// Returns a data: URL (PNG) an <img> tag can use directly.
async function qrDataUrlFor(url) {
    return QRCode.toDataURL(url, { margin: 1, width: 320 });
}

module.exports = { qrDataUrlFor };
