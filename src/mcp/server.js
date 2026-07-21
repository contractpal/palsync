"use strict";
// The palsync MCP server: registers the palsync tools (from TOOLS) and serves them over stdio. Tool handlers
// resolve their ctx lazily via getCtx() so the server can be constructed (and its tools listed)
// without yet logging in / acquiring a lock — keeping tool registration side-effect-free.
//
// LIFETIME CONTRACT: this process lives exactly as long as its client (Claude Code / Codex)
// keeps the stdio pipe open. Nothing internal — idle timers, lock releases, failed tool calls,
// network blips — is allowed to exit the process. Idle releases only the LOCK (lockLife.js);
// the next tool call re-acquires it. The only exits are: client closed the pipe (clean 0),
// exit signals (clean 0 after lock release), and uncaughtException (1 — state may be corrupt).
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { TOOLS } = require("./tools");
const { buildContext } = require("./context");
const usage = require("../core/usage");
const lintCache = require("../core/lintCache");
const { z } = require("zod");
const toolMetadata = require("./pi-tools.json");
const { routeTools } = require("../core/piHelpers");
const pkg = require("../../package.json");
const SERVER_INSTRUCTIONS = "PalSync runtime tools act on the LAST PUSHED server version. Push local changes with pal_push before runtime tests, previews, screenshots, fetches, exercises, tunnels, or SEO audits.";
const LAZY_PROFILES = new Set(["pi-minimal", "pi-standard", "claude"]);
const PROFILE_TOOLS = {
    "pi-minimal": ["pal_validate", "pal_spec_lint", "pal_context"],
    "pi-standard": ["pal_validate", "pal_spec_lint", "pal_context", "pal_status", "pal_test", "pal_push", "pal_pull"],
    "pi-full": TOOLS.map(tool => tool.name),
    claude: ["pal_validate", "pal_spec_lint", "pal_context"],
    codex: TOOLS.map(tool => tool.name),
    opencode: TOOLS.map(tool => tool.name)
};

function normalizeProfile(value) {
    return Object.prototype.hasOwnProperty.call(PROFILE_TOOLS, value) ? value : "codex";
}

function instructionsForProfile(profile) {
    return SERVER_INSTRUCTIONS + (LAZY_PROFILES.has(profile)
        ? " Use pal_tools with task keywords to activate additional PalSync tools."
        : "");
}

// All server diagnostics go to stderr with a consistent prefix. The agent talks over stdio
// (stdin/stdout); stderr is the ONLY safe channel for logs, and it must be LOUD — a silent
// failure is what made the original disconnect undiagnosable. The write itself is guarded:
// if stderr is gone (parent died), logging must not become a second crash.
function logErr(msg) { try { process.stderr.write("[palsync-mcp] " + msg + "\n"); } catch (e) { /* stderr gone */ } }
function stackOf(err) { return err && err.stack ? err.stack : String(err); }

function createServer(getCtx, workspaceDir, options = {}) {
    const profile = normalizeProfile(options.profile || process.env.PALSYNC_TOOL_PROFILE);
    // Keep the same rule in affected tool descriptions: Pi's MCP adapter lists tools but does not
    // surface initialize-result instructions to the model, so server instructions are additive.
    const server = new McpServer(
        { name: "palsync", version: pkg.version },
        { instructions: instructionsForProfile(profile) }
    );
    const registered = new Map();
    for (const t of TOOLS) {
        const handle = server.registerTool(
            t.name,
            { description: t.description, inputSchema: t.inputShape, annotations: t.annotations, title: t.title },
            async (args) => {
                const started = process.hrtime.bigint();
                const cacheBefore = lintCache.readStats(workspaceDir);
                // Belt-and-suspenders: the MCP SDK already wraps handlers, but we catch here too so
                // every tool failure is LOGGED with its tool name + full stack (the SDK swallows the
                // stack into a terse result), and the agent still gets a clean error result.
                try {
                    // needsCtx opt-out: a fully-offline, read-only tool (only an EXPLICIT
                    // needsCtx:false) skips the whole login+lock+idle lifecycle and runs against a
                    // bare { workspaceDir }. DEFAULT IS CTX-REQUIRED — absent or any non-false value
                    // resolves full ctx, so a mis-flagged tool errs toward (safe) login/lock, never
                    // toward silently skipping it.
                    const ctx = t.needsCtx === false ? { workspaceDir } : await getCtx();
                    const res = await t.run(ctx, args || {});
                    if (ctx && ctx.lifecycle) ctx.lifecycle.onActivity(); // reset idle timer; re-lock after an idle release
                    // A tool may return its own MCP content blocks (e.g. pal_screenshot's image);
                    // honor them. Otherwise fall back to the text message.
                    const content = (res && Array.isArray(res.content))
                        ? res.content
                        : [{ type: "text", text: res.message || JSON.stringify(res, null, 2) }];
                    // T3: meter palsync's own context contribution (bytes + est. tokens returned to the agent).
                    if (ctx && ctx.workspaceDir) {
                        const stats = usage.contentStats(content);
                        usage.recordToolCall(ctx.workspaceDir, t.name, stats.bytes, stats.tokens, {
                            rawBytes: res && res._usage && res._usage.rawBytes != null ? res._usage.rawBytes : stats.bytes,
                            returnedBytes: stats.bytes,
                            resultCacheHits: Math.max(0, lintCache.readStats(workspaceDir).hits - cacheBefore.hits),
                            resultCacheMisses: Math.max(0, lintCache.readStats(workspaceDir).misses - cacheBefore.misses),
                            durationMs: Number(process.hrtime.bigint() - started) / 1e6
                        });
                    }
                    if (res && Array.isArray(res.content)) return { content, isError: res.isError };
                    return { content };
                } catch (err) {
                    logErr("tool '" + t.name + "' failed: " + stackOf(err));
                    const content = [{ type: "text", text: "palsync tool '" + t.name + "' failed: " + (err && err.message ? err.message : String(err)) }];
                    const stats = usage.contentStats(content);
                    const cacheAfter = lintCache.readStats(workspaceDir);
                    usage.recordToolCall(workspaceDir, t.name, stats.bytes, stats.tokens, {
                        rawBytes: stats.bytes,
                        returnedBytes: stats.bytes,
                        resultCacheHits: Math.max(0, cacheAfter.hits - cacheBefore.hits),
                        resultCacheMisses: Math.max(0, cacheAfter.misses - cacheBefore.misses),
                        durationMs: Number(process.hrtime.bigint() - started) / 1e6
                    });
                    return { isError: true, content };
                }
            }
        );
        registered.set(t.name, handle);
        if (!PROFILE_TOOLS[profile].includes(t.name)) handle.disable();
    }
    if (LAZY_PROFILES.has(profile)) {
        server.registerTool("pal_tools", {
            title: "Activate PalSync tools",
            description: "Activate additional PalSync tools additively by deterministic keyword or group.",
            inputSchema: { query: z.string().describe("Task keywords or groups: sync, browser, runtime, project, spec.") }
        }, async ({ query }) => {
            const names = routeTools(query, toolMetadata);
            for (const name of names) registered.get(name)?.enable();
            return { content: [{ type: "text", text: names.length ? "Activated: " + names.join(", ") : "No PalSync tools matched that query." }] };
        });
    }
    return server;
}

// Process-level safety net. ASYMMETRIC on purpose:
//   - unhandledRejection: usually a stray background reject (e.g. a failed idle-release) — the
//     server is still healthy, so LOG LOUDLY and KEEP SERVING. Never swallow: a recurring reject
//     must stay visible in stderr so it can be diagnosed, not papered over.
//   - uncaughtException: process state may be corrupt — a logged clean exit(1) beats limping on.
function installProcessGuards() {
    process.on("unhandledRejection", (reason) => {
        logErr("UNHANDLED REJECTION (kept alive — server still serving): " + stackOf(reason));
    });
    process.on("uncaughtException", (err) => {
        logErr("UNCAUGHT EXCEPTION (exiting cleanly — process state may be unsafe): " + stackOf(err));
        process.exit(1);
    });
}

async function main() {
    installProcessGuards();
    const workspaceDir = process.env.PALSYNC_WORKSPACE || process.cwd();

    // Memoize the build as a PROMISE so two concurrent first tool calls share one login +
    // one lock lifecycle (the old `if (!ctx) ctx = await build()` let both pass the null
    // check and build twice). A failed build resets so the next call can retry cleanly.
    let ctxPromise = null;
    const getCtx = () => {
        if (!ctxPromise) {
            ctxPromise = buildContext(workspaceDir, { log: logErr })
                .catch(err => { ctxPromise = null; throw err; });
        }
        return ctxPromise;
    };
    const server = createServer(getCtx, workspaceDir, { profile: process.env.PALSYNC_TOOL_PROFILE });

    const transport = new StdioServerTransport();
    // EPIPE et al.: if the client end hiccups, a stream 'error' with no listener becomes an
    // uncaughtException. Degrade gracefully — log it, don't crash the session over a write blip.
    transport.onerror = (err) => logErr("stdio transport error: " + stackOf(err));
    process.stdout.on("error", (err) => logErr("stdout stream error (" + (err && err.code ? err.code : "?") + "): " + stackOf(err)));
    process.stdin.on("error", (err) => logErr("stdin stream error (" + (err && err.code ? err.code : "?") + "): " + stackOf(err)));

    await server.connect(transport);

    // Client closed the pipe → the session is over. Release the lock explicitly and exit 0
    // (rather than relying on the event loop draining), so no orphan server lingers and the
    // pal isn't left locked. Two triggers feed one idempotent shutdown:
    //   - stdin 'end': the SDK's stdio transport only listens for 'data'/'error' (verified) —
    //     it never notices the client hanging up, so we watch for it ourselves.
    //   - protocol onclose (server.server.onclose, fired after SDK cleanup): covers an
    //     explicit transport close. Set post-connect on purpose — connect() chains it.
    let shuttingDown = false;
    const shutdown = async (why) => {
        if (shuttingDown) return;
        shuttingDown = true;
        logErr(why + " — releasing lock and shutting down");
        // T3: session-end context-contribution summary (palsync's own footprint, not model spend).
        try { logErr("session cost summary —\n" + usage.formatCost(workspaceDir, TOOLS)); } catch (e) { /* never block shutdown */ }
        try {
            if (ctxPromise) {
                const ctx = await ctxPromise.catch(() => null);
                if (ctx && ctx.lifecycle) await ctx.lifecycle.release("client-disconnected");
            }
        } catch (err) {
            logErr("release on disconnect failed (lock auto-reclaims next session): " + stackOf(err));
        }
        process.exit(0);
    };
    process.stdin.on("end", () => shutdown("client disconnected (stdin ended)"));
    process.stdin.on("close", () => shutdown("client disconnected (stdin closed)"));
    server.server.onclose = () => shutdown("transport closed");

    logErr("serving for workspace " + workspaceDir);
}

module.exports = { createServer, main, installProcessGuards, TOOLS, SERVER_INSTRUCTIONS,
    PROFILE_TOOLS, normalizeProfile, instructionsForProfile };
