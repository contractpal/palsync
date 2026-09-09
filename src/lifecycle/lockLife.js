"use strict";
// Lock lifecycle for a long-lived session: acquire on start, release on idle and on exit
// signals, RE-ACQUIRE when activity resumes — and NEVER kill the host process by default.
//
// History: this class originally did `process.exit(0)` after the idle release (exitOnIdle
// defaulted true). For the MCP server that meant the server deliberately shut itself down
// 15 minutes after the last tool call — which Claude Code reports as the server
// "disconnecting", and which left users unable to push (the production "MCP server keeps
// crashing" bug). An MCP server's lifetime belongs to its client, not to a lock timer:
// idle now releases only the LOCK; the server keeps serving and the next tool call
// re-acquires the lock transparently. `exitOnIdle` remains as an explicit opt-in for
// callers that genuinely want process exit, but it now defaults to FALSE.
//
// Ground truth for "do we hold the lock" is session.lockInfo — every acquire/release path
// (ours here, push()'s internal acquire, pal_lock/pal_unlock) mutates it on the shared
// session object, so the lifecycle never goes stale tracking its own copy.
//
// Cross-platform exit handling: 'exit'/'beforeExit' + SIGINT (+ SIGBREAK on Windows,
// SIGTERM/SIGHUP on POSIX). A hard kill (kill -9 / TerminateProcess) bypasses ALL handlers
// on every OS — that case is covered not here but by own-stale-lock auto-reclaim in
// core/lock (the server re-grants the same user their lock next session).
const lock = require("../core/lock");

const DEFAULT_IDLE_MS = 15 * 60 * 1000; // 15 min, configurable

class LockLifecycle {
    constructor(session, guid, { idleMs = DEFAULT_IDLE_MS, log = () => {}, exitOnIdle = false, onRelease = null } = {}) {
        this.session = session;
        this.guid = guid;
        this.idleMs = idleMs;
        this.log = log;
        this.exitOnIdle = exitOnIdle;
        this.onRelease = onRelease;
        this.idleTimer = null;
        this.userReleased = false;   // an explicit pal_unlock — activity must NOT re-acquire past it
        this.lockState = null;
        this._signalsInstalled = false;
        this._reacquiring = null;    // in-flight re-acquire promise (dedupes concurrent activity)
    }

    // Do we currently hold the Webstart lock? (session.lockInfo is set by every grant and
    // cleared by every release/denial — see core/lock and lib/apiManager.)
    held() {
        return !!(this.session.lockInfo && this.session.lockInfo.lockGranted === true);
    }

    async acquire({ force = false } = {}) {
        // Reuse the identity from our own last acquire/release — no GetGroupList/GetPalList call
        // at all, let alone the full GetProfileList->GetGroupList->GetPalList account walk.
        // David: those are only actually needed when OPENING a pal or CREATING one — once this
        // lifecycle has resolved it once, that's the whole session's pal, resolved for good.
        // This matters because onActivity() below re-acquires on every idle-then-reacquire, so
        // "resolve fresh every time" meant paying for it repeatedly during a single long agent
        // session working on a single pal.
        const resolved = (this.lockState && this.lockState.resolved) || null;
        this.lockState = await lock.acquireByGuid(this.session, this.guid, { force, resolved });
        if (this.lockState.acquired) {
            this.userReleased = false;
            this.touch();
        }
        return this.lockState;
    }

    // Reset the idle timer (every MCP tool call routes through onActivity → touch).
    touch() {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        if (this.idleMs > 0) {
            this.idleTimer = setTimeout(() => this._onIdle(), this.idleMs);
            if (this.idleTimer.unref) this.idleTimer.unref(); // don't keep the event loop alive by itself
        }
    }

    // Called on every tool call. Resets the idle timer; if the lock was released by an idle
    // timeout (NOT by an explicit unlock), re-acquires it in the background so the session
    // shows as locked again while the user is active. Failures are logged loudly, never
    // thrown — correctness never depends on this courtesy lock (push acquires its own).
    onActivity() {
        if (this.userReleased) {
            // Respect an explicit unlock — unless something legitimately re-took the lock
            // since (pal_push acquires internally to save). If we factually hold it, re-arm.
            if (!this.held()) return;
            this.userReleased = false;
        }
        this.touch();
        if (this.held() || this._reacquiring) return;
        this._reacquiring = this.acquire({ force: false })
            .then(st => {
                if (st.acquired) this.log("lock re-acquired after idle release" + (st.reclaimed ? " (reclaimed)" : ""));
                else this.log("lock NOT re-acquired after idle release (" + (st.blocked || "unknown") + (st.holder ? ", held by " + st.holder : "") + ")");
            })
            .catch(err => this.log("lock re-acquire failed (continuing unlocked): " + (err && err.stack ? err.stack : err)))
            .finally(() => { this._reacquiring = null; });
    }

    async _onIdle() {
        // This runs from a setTimeout callback that nothing awaits, so any rejection here
        // would be an UNHANDLED rejection (process-fatal on Node >= 15 without the guard).
        // Release is best-effort: catch, log, and KEEP SERVING. The next tool call
        // re-acquires via onActivity. exitOnIdle (explicit opt-in only) preserves the old
        // exit-on-idle behavior for callers that want a bounded process lifetime.
        this.log("idle " + this.idleMs + "ms — releasing lock (server stays alive; next tool call re-locks)");
        try {
            await this.release("idle-timeout");
        } catch (err) {
            this.log("idle-release FAILED (lock auto-reclaims next acquire): " +
                (err && err.stack ? err.stack : err));
        }
        if (this.exitOnIdle) process.exit(0);
    }

    // Release the lock if held. Idempotent (releaseByGuid no-ops without session.lockInfo)
    // and re-armable: a later acquire()/onActivity() can take the lock again. Pass
    // userRequested=true for an explicit unlock so activity won't silently undo it.
    async release(reason, { userRequested = false } = {}) {
        if (userRequested) this.userReleased = true;
        if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
        // Same predicate as releaseByGuid (lockInfo presence, not lockGranted) so we never
        // skip a server unlock in an odd header state; releaseByGuid itself is idempotent.
        if (!this.session.lockInfo) return { released: false, reason: "no lock held" };
        // Same cache reuse as acquire() above — no re-resolve, just the identity we already have.
        const resolved = (this.lockState && this.lockState.resolved) || null;
        const result = await lock.releaseByGuid(this.session, this.guid, { resolved });
        this.log("lock released (" + (reason || "explicit") + "): " + JSON.stringify(result));
        if (typeof this.onRelease === "function") this.onRelease(reason, result);
        return result;
    }

    // Register OS-appropriate exit handlers (used by the long-lived MCP server).
    installSignalHandlers() {
        if (this._signalsInstalled) return;
        this._signalsInstalled = true;
        const signals = process.platform === "win32"
            ? ["SIGINT", "SIGBREAK"]
            : ["SIGINT", "SIGTERM", "SIGHUP"];
        for (const sig of signals) {
            process.once(sig, async () => {
                try { await this.release(sig); } catch (e) { /* best-effort */ }
                process.exit(0);
            });
        }
        // Last-chance synchronous hook; async unlock can't be awaited here, so it's best-effort.
        process.once("beforeExit", async () => { try { await this.release("beforeExit"); } catch (e) {} });
    }
}

module.exports = { LockLifecycle, DEFAULT_IDLE_MS };
