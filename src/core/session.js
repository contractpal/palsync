"use strict";
// Build + authenticate a CloudPiston session, headless. Reuses the unchanged palpush
// apiManager. Credentials are supplied by the caller (env for now; keychain in M3) —
// never read from or written to disk here.
const { CloudPistonAPIManager } = require("../../lib/apiManager");

// Returns a live session ({ username, password, userId, environment:{url}, lockInfo })
// with userId populated from Ping.do, or throws on auth failure.
async function authenticate(url, username, password) {
    if (!url || !username || !password) {
        throw new Error("authenticate requires url, username and password");
    }
    const session = {
        username,
        password,
        userId: undefined,
        environment: { url },
        lockInfo: undefined,
        sessionAuthToken: undefined
    };
    const ping = await CloudPistonAPIManager.authenticate(session);
    if (!ping || !ping.success) {
        throw new Error("Authentication failed (Ping.do) for " + username + " @ " + url);
    }
    session.userId = ping.userPath;
    session.sessionAuthToken=ping.sessionAuthToken;
    return session;
}

module.exports = { authenticate };
