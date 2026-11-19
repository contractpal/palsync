"use strict";
// `palsync hook completion|guard|post-write` -- agent-harness hook adapters. Kept apart from
// syncCommands.js, and dispatched before it in bin/palsync.js, because Claude Code runs these hooks
// on every Edit/Write and every Stop in EVERY project. syncCommands.js loads the MCP tool table and
// other heavy modules at the top (~75 ms); this path loads only the adapter it runs.

function readStdin() {
    return new Promise((resolve, reject) => {
        let input = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", chunk => { input += chunk; });
        process.stdin.on("end", () => resolve(input));
        process.stdin.on("error", reject);
    });
}

async function runHookCommand(argv, inputText) {
    try {
        const adapter = argv[0];
        const ADAPTERS = {
            completion: "../core/completionHook",
            guard: "../core/guardHook",
            "post-write": "../core/postWriteHook",
        };
        if (!Object.hasOwn(ADAPTERS, adapter)) throw new Error("unknown hook adapter");
        let mode = "json", dir, eventArg;
        for (let i = 1; i < argv.length; i++) {
            if (argv[i] === "--mode") mode = argv[++i];
            else if (argv[i].startsWith("--mode=")) mode = argv[i].slice(7);
            else if (argv[i] === "--dir") dir = argv[++i];
            else if (argv[i].startsWith("--dir=")) dir = argv[i].slice(6);
            else if (argv[i] === "--event") eventArg = argv[++i];
            else if (argv[i].startsWith("--event=")) eventArg = argv[i].slice(8);
            else throw new Error("unknown hook flag " + argv[i]);
        }
        if (mode !== "claude" && mode !== "json") throw new Error("unsupported hook mode " + mode);
        // Claude delivers the event on stdin. Pi's `pi.exec` has no stdin channel (ExecOptions is
        // signal/timeout/cwd only), so `--event` carries it as an argument; it wins if both appear.
        let event = null;
        if (eventArg !== undefined) event = JSON.parse(eventArg);
        else if (mode === "claude") event = JSON.parse(inputText === undefined ? await readStdin() : inputText);
        const evaluated = require(ADAPTERS[adapter]).evaluate({ mode, cwd: dir, event });
        if (evaluated.output) console.log(JSON.stringify(evaluated.output));
        return 0;
    } catch (e) {
        // Fail open, as the completion hook does: a hook that errors must never wedge a session. The
        // cost of failing open here is that a malformed event lets a .palsync.json edit through, which
        // is the status quo before this guard existed -- strictly better than blocking all work.
        console.error("palsync " + (argv[0] || "") + " hook skipped (fail open): " +
            (e && e.message ? e.message : e));
        return 0;
    }
}

function run(cmd, argv) {
    return runHookCommand(argv);
}

module.exports = { run, runHookCommand };
