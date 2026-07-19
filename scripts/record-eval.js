#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { parseTasks } = require("../src/core/taskState");

const SCENARIOS = {
    "01": "01_crud_equipment_checkout",
    "02": "02_data_structures_company_directory",
    "03": "03_console_tx_service_requests",
    "04": "04_interpal_tunnels_partner_bridge",
    "05": "05_marketing_website",
};

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { return null; }
}

function parseArgs(argv) {
    const flags = { dir: process.cwd(), output: path.join(__dirname, "..", "eval", "scores.jsonl") };
    for (let i = 0; i < argv.length; i++) {
        const name = argv[i];
        if (!["--dir", "--output", "--model", "--harness", "--scenario"].includes(name)) {
            throw new Error("Unknown argument: " + name);
        }
        if (argv[i + 1] === undefined) throw new Error(name + " requires a value");
        flags[name.slice(2)] = argv[++i];
    }
    return flags;
}

function toolSuccessfulCalls(usage, name) {
    const value = usage && usage.tools && usage.tools[name] && usage.tools[name].successfulCalls;
    return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function inferScenario(workspaceDir) {
    const match = path.basename(workspaceDir).match(/^(0[1-5])_/);
    return match && SCENARIOS[match[1]];
}

function reviewFields(review) {
    const text = String(review || "");
    const verdict = text.match(/^\s*(?:#{1,6}\s*)?verdict\s*:\s*(PASS|CHANGES-NEEDED|BROKEN)\b/im);
    const score = text.match(/(?:\*\*)?Total(?:\*\*)?\s*:\s*(\d+)\s*\/\s*(\d+)/i) ||
        text.match(/§\s*12[^\n]*?\b(\d+)\s*\/\s*(\d+)/i);
    return {
        verdict: verdict ? verdict[1].toUpperCase() : "BROKEN",
        score12: score ? score[1] + "/" + score[2] : null,
    };
}

function buildRow({ workspaceDir, model, harness, scenario, now = new Date(), repoDir = path.join(__dirname, "..") }) {
    workspaceDir = path.resolve(workspaceDir);
    const usage = readJson(path.join(workspaceDir, ".palsync.usage.json")) || {};
    const sessionCost = readJson(path.join(workspaceDir, ".palsync", "session-cost.json"));
    const costModel = sessionCost && Array.isArray(sessionCost.entries) && sessionCost.entries[0] && sessionCost.entries[0].model;
    const execution = fs.readFileSync(path.join(workspaceDir, "EXECUTION.md"), "utf8");
    const tasks = parseTasks(execution);
    if (!tasks.ok) throw new Error("Cannot parse EXECUTION.md: " + tasks.error);
    let review = "";
    try { review = fs.readFileSync(path.join(workspaceDir, "REVIEW.md"), "utf8"); } catch (error) {}
    const reviewResult = reviewFields(review);
    const started = usage.startedAt && new Date(usage.startedAt);
    const date = started && !Number.isNaN(started.valueOf()) ? started : now;
    const resolvedScenario = scenario || inferScenario(workspaceDir);
    const resolvedModel = model || costModel;
    if (!resolvedScenario) throw new Error("Cannot infer scenario; pass --scenario");
    if (!resolvedModel) throw new Error("Cannot infer model; pass --model");
    if (!harness) throw new Error("Pass --harness (for example claude-code, pi, or opencode)");
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoDir, encoding: "utf8" }).trim();
    return {
        date: date.toISOString().slice(0, 10),
        sha,
        scenario: resolvedScenario,
        model: resolvedModel,
        harness,
        verdict: reviewResult.verdict,
        tasksDone: tasks.rows.filter(row => row.status === "done").length,
        tasksTotal: tasks.rows.length,
        pushOk: toolSuccessfulCalls(usage, "pal_push") > 0,
        exerciseCount: toolSuccessfulCalls(usage, "pal_exercise"),
        score12: reviewResult.score12,
    };
}

function main(argv) {
    const flags = parseArgs(argv);
    const row = buildRow({
        workspaceDir: flags.dir,
        model: flags.model,
        harness: flags.harness,
        scenario: flags.scenario,
    });
    const output = path.resolve(flags.output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.appendFileSync(output, JSON.stringify(row) + "\n");
    process.stdout.write(JSON.stringify(row) + "\n");
}

if (require.main === module) {
    try { main(process.argv.slice(2)); }
    catch (error) {
        process.stderr.write("record-eval: " + error.message + "\n");
        process.exitCode = 1;
    }
}

module.exports = { buildRow, inferScenario, reviewFields };
