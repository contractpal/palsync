"use strict";
// Storage for the Web Services REST credentials — a genuinely separate username/password from
// the pal-cloud login (see src/core/webServices.js's header comment), keyed per cloud
// environment (not per pal — the same cloud's Web Services login works for every pal on it).
// Reuses the same OS-keychain mechanism already used for pal-cloud login passwords
// (src/platform/keychain.js), under a distinct service-key prefix so the two credential sets
// never collide even for the same person on the same cloud.
const keychain = require("palsync/src/platform/keychain");

function keyFor(environmentUrl) {
    return "webservices:" + environmentUrl;
}

function setCredential(environmentUrl, username, password) {
    keychain.setCredential(keyFor(environmentUrl), username, password);
}

function getPassword(environmentUrl, username) {
    return keychain.getPassword(keyFor(environmentUrl), username);
}

function listUsernames(environmentUrl) {
    return keychain.listUsernames(keyFor(environmentUrl));
}

function deleteCredential(environmentUrl, username) {
    keychain.deleteCredential(keyFor(environmentUrl), username);
}

module.exports = { setCredential, getPassword, listUsernames, deleteCredential };
