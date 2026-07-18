#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { cachedLint, readStats } = require("../src/core/lintCache");

function run() {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "palsync-lint-bench-"));
    const contents = Array.from({ length: 20 }, (_, index) => "file-" + index);
    try {
        const lintAll = () => contents.forEach((content, index) => cachedLint(workspaceDir, {
            rel: "workflows/" + index + ".js", content, mode: "incremental-bench"
        }, () => []));
        lintAll();
        const cold = readStats(workspaceDir);
        for (let round = 0; round < 10; round++) {
            contents[round] += "-edit";
            lintAll();
        }
        const final = readStats(workspaceDir);
        const hits = final.hits - cold.hits;
        const misses = final.misses - cold.misses;
        return {
            schema: "palsync/lint-cache-benchmark/1",
            files: contents.length,
            incrementalRounds: 10,
            hits,
            misses,
            hitRate: Number(((hits / (hits + misses)) * 100).toFixed(1))
        };
    } finally {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
}

if (require.main === module) process.stdout.write(JSON.stringify(run(), null, 2) + "\n");
module.exports = { run };
