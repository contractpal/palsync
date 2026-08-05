"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const childProcess = require("node:child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
    buildSnapshot,
    buildImpactSnapshot,
    isUnsafeTarget,
} = require("../src/core/validate/snapshot");

function workspace() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "palsync-snapshot-"));
}

function put(root, rel, content) {
    const abs = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return abs;
}

function injectedFs(overrides) {
    return new Proxy(fs, {
        get(target, property) {
            if (Object.prototype.hasOwnProperty.call(overrides, property)) {
                return overrides[property];
            }
            const value = target[property];
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}

function changedIdentity(stat) {
    return new Proxy(stat, {
        get(target, property) {
            if (property === "ino") return Number(target.ino) + 1;
            const value = target[property];
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}

test("legacy snapshot keeps its shape and reads normal markup", () => {
    const dir = workspace();
    try {
        put(dir, "pages/home.html", "<main>home</main>");
        const snapshot = buildSnapshot(dir);
        assert.deepStrictEqual(Object.keys(snapshot), [
            "workspaceDir", "markup", "workflows", "stylesheets", "datasets",
            "palJson", "contentHashByRel", "allFiles",
        ]);
        assert.deepStrictEqual(snapshot.markup, [
            { rel: "pages/home.html", content: "<main>home</main>" },
        ]);
        assert.strictEqual(Object.hasOwn(snapshot, "skippedInputs"), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("impact snapshot reads normal UTF-8 markup exactly once", () => {
    const dir = workspace();
    try {
        put(dir, "pages/home.html", "<main>héllo</main>");
        let descriptorReads = 0;
        const ops = injectedFs({
            readFileSync(file, ...args) {
                if (typeof file === "number") descriptorReads++;
                return fs.readFileSync(file, ...args);
            },
        });
        const snapshot = buildImpactSnapshot(dir, ops);
        assert.strictEqual(descriptorReads, 1);
        assert.deepStrictEqual(snapshot.markup, [
            { rel: "pages/home.html", content: "<main>héllo</main>" },
        ]);
        assert.deepStrictEqual(snapshot.allFiles, ["pages/home.html"]);
        assert.deepStrictEqual(snapshot.skippedInputs, []);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("impact snapshot skips a symlink file without exposing external bytes", (t) => {
    const dir = workspace();
    const outside = workspace();
    try {
        const secret = "outside-secret-that-must-not-be-read";
        const external = put(outside, "secret.html", secret);
        fs.mkdirSync(path.join(dir, "fragments"), { recursive: true });
        try {
            fs.symlinkSync(external, path.join(dir, "fragments", "link.html"));
        } catch (error) {
            if (error.code === "EPERM" || error.code === "EACCES") return t.skip("symlinks unavailable");
            throw error;
        }
        const snapshot = buildImpactSnapshot(dir);
        assert.deepStrictEqual(snapshot.skippedInputs, [
            { rel: "fragments/link.html", reason: "symlink" },
        ]);
        assert.deepStrictEqual(snapshot.markup, []);
        assert.deepStrictEqual(snapshot.allFiles, []);
        assert.strictEqual(JSON.stringify(snapshot).includes(secret), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

test("a skipped symlink directory makes every descendant target unsafe", (t) => {
    const dir = workspace();
    const outside = workspace();
    try {
        put(outside, "nested/nav.html", "external");
        try {
            fs.symlinkSync(path.join(outside, "nested"), path.join(dir, "fragments"), "dir");
        } catch (error) {
            if (error.code === "EPERM" || error.code === "EACCES") return t.skip("symlinks unavailable");
            throw error;
        }
        const snapshot = buildImpactSnapshot(dir);
        assert.deepStrictEqual(snapshot.skippedInputs, [
            { rel: "fragments", reason: "symlink" },
        ]);
        assert.strictEqual(isUnsafeTarget(snapshot.skippedInputs, "fragments/nav.html"), true);
        assert.strictEqual(isUnsafeTarget(snapshot.skippedInputs, "pages/nav.html"), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

test("file and directory identity changes are skipped without race timing", async (t) => {
    await t.test("file changed before descriptor verification", () => {
        const dir = workspace();
        try {
            put(dir, "pages/home.html", "home");
            const ops = injectedFs({
                fstatSync(fd) { return changedIdentity(fs.fstatSync(fd)); },
            });
            const snapshot = buildImpactSnapshot(dir, ops);
            assert.deepStrictEqual(snapshot.skippedInputs, [
                { rel: "pages/home.html", reason: "identityChanged" },
            ]);
            assert.deepStrictEqual(snapshot.allFiles, []);
            assert.strictEqual(isUnsafeTarget(snapshot.skippedInputs, "pages/home.html"), true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    await t.test("file replaced by a link before open", () => {
        const dir = workspace();
        try {
            put(dir, "pages/home.html", "home");
            const ops = injectedFs({
                openSync() {
                    const error = new Error("refused symbolic link");
                    error.code = "ELOOP";
                    throw error;
                },
            });
            const snapshot = buildImpactSnapshot(dir, ops);
            assert.deepStrictEqual(snapshot.skippedInputs, [
                { rel: "pages/home.html", reason: "symlink" },
            ]);
            assert.deepStrictEqual(snapshot.allFiles, []);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    await t.test("directory changed after enumeration", () => {
        const dir = workspace();
        try {
            put(dir, "fragments/nested/nav.html", "nav");
            const changedDir = fs.realpathSync(path.join(dir, "fragments"));
            let checks = 0;
            const ops = injectedFs({
                lstatSync(abs) {
                    const stat = fs.lstatSync(abs);
                    if (abs === changedDir && ++checks === 2) return changedIdentity(stat);
                    return stat;
                },
            });
            const snapshot = buildImpactSnapshot(dir, ops);
            assert.deepStrictEqual(snapshot.skippedInputs, [
                { rel: "fragments", reason: "identityChanged" },
            ]);
            assert.deepStrictEqual(snapshot.allFiles, []);
            assert.strictEqual(isUnsafeTarget(snapshot.skippedInputs, "fragments/nested/nav.html"), true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

test("ancestor replacement after traversal cannot expose external bytes", () => {
    const dir = workspace();
    const outside = workspace();
    try {
        put(dir, "pages/home.html", "internal");
        const secret = "external-secret-that-must-not-be-read";
        put(outside, "pages/home.html", secret);
        const pages = fs.realpathSync(path.join(dir, "pages"));
        const original = path.join(fs.realpathSync(dir), "pages-original");
        let descriptorReads = 0;
        let swapped = false;
        const ops = injectedFs({
            openSync(abs, flags) {
                if (!swapped && abs === path.join(pages, "home.html")) {
                    fs.renameSync(pages, original);
                    fs.symlinkSync(path.join(outside, "pages"), pages, "dir");
                    swapped = true;
                }
                return fs.openSync(abs, flags);
            },
            readFileSync(file, ...args) {
                if (typeof file === "number") descriptorReads++;
                return fs.readFileSync(file, ...args);
            },
        });
        const snapshot = buildImpactSnapshot(dir, ops);
        assert.strictEqual(swapped, true);
        assert.strictEqual(descriptorReads, 0);
        assert.deepStrictEqual(snapshot.skippedInputs, [
            { rel: "pages", reason: "identityChanged" },
        ]);
        assert.deepStrictEqual(snapshot.allFiles, []);
        assert.strictEqual(isUnsafeTarget(snapshot.skippedInputs, "pages/home.html"), true);
        assert.strictEqual(JSON.stringify(snapshot).includes(secret), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

test("failed open after an ancestor swap still marks the prefix unsafe", () => {
    const dir = workspace();
    const outside = workspace();
    try {
        put(dir, "pages/home.html", "internal");
        fs.mkdirSync(path.join(outside, "pages"));
        const pages = fs.realpathSync(path.join(dir, "pages"));
        const original = path.join(fs.realpathSync(dir), "pages-original");
        let swapped = false;
        const ops = injectedFs({
            openSync(abs, flags) {
                if (!swapped && abs === path.join(pages, "home.html")) {
                    fs.renameSync(pages, original);
                    fs.symlinkSync(path.join(outside, "pages"), pages, "dir");
                    swapped = true;
                }
                return fs.openSync(abs, flags);
            },
        });
        const snapshot = buildImpactSnapshot(dir, ops);
        assert.strictEqual(swapped, true);
        assert.deepStrictEqual(snapshot.skippedInputs, [
            { rel: "pages", reason: "identityChanged" },
        ]);
        assert.strictEqual(isUnsafeTarget(snapshot.skippedInputs, "pages/home.html"), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

test("early file and child-directory failures preserve the changed ancestor prefix", async (t) => {
    await t.test("file lstat failure after ancestor swap", () => {
        const dir = workspace();
        const outside = workspace();
        try {
            put(dir, "pages/home.html", "internal");
            fs.mkdirSync(path.join(outside, "pages"));
            const pages = fs.realpathSync(path.join(dir, "pages"));
            const home = path.join(pages, "home.html");
            const original = path.join(fs.realpathSync(dir), "pages-original");
            let swapped = false;
            const ops = injectedFs({
                lstatSync(abs) {
                    if (!swapped && abs === home) {
                        fs.renameSync(pages, original);
                        fs.symlinkSync(path.join(outside, "pages"), pages, "dir");
                        swapped = true;
                    }
                    return fs.lstatSync(abs);
                },
            });
            const snapshot = buildImpactSnapshot(dir, ops);
            assert.strictEqual(swapped, true);
            assert.deepStrictEqual(snapshot.skippedInputs, [
                { rel: "pages", reason: "identityChanged" },
            ]);
            assert.strictEqual(isUnsafeTarget(snapshot.skippedInputs, "pages/home.html"), true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    await t.test("child-directory lstat failure after ancestor swap", () => {
        const dir = workspace();
        const outside = workspace();
        try {
            put(dir, "pages/nested/home.html", "internal");
            put(dir, "pages/sibling.html", "sibling");
            fs.mkdirSync(path.join(outside, "pages"));
            const pages = fs.realpathSync(path.join(dir, "pages"));
            const nested = path.join(pages, "nested");
            const original = path.join(fs.realpathSync(dir), "pages-original");
            let swapped = false;
            let descriptorReads = 0;
            const ops = injectedFs({
                lstatSync(abs) {
                    if (!swapped && abs === nested) {
                        fs.renameSync(pages, original);
                        fs.symlinkSync(path.join(outside, "pages"), pages, "dir");
                        swapped = true;
                    }
                    return fs.lstatSync(abs);
                },
                readFileSync(file, ...args) {
                    if (typeof file === "number") descriptorReads++;
                    return fs.readFileSync(file, ...args);
                },
            });
            const snapshot = buildImpactSnapshot(dir, ops);
            assert.strictEqual(swapped, true);
            assert.strictEqual(descriptorReads, 0);
            assert.deepStrictEqual(snapshot.skippedInputs, [
                { rel: "pages", reason: "identityChanged" },
            ]);
            assert.strictEqual(isUnsafeTarget(snapshot.skippedInputs, "pages/sibling.html"), true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });
});

test("one transient ancestor mismatch permanently poisons the whole prefix", () => {
    const dir = workspace();
    try {
        put(dir, "pages/nested/home.html", "home");
        put(dir, "pages/sibling.html", "sibling");
        const pages = fs.realpathSync(path.join(dir, "pages"));
        let poisonNextParentCheck = false;
        let poisoned = false;
        let descriptorReads = 0;
        const ops = injectedFs({
            lstatSync(abs) {
                const stat = fs.lstatSync(abs);
                if (!poisoned && path.dirname(abs) === pages) poisonNextParentCheck = true;
                if (abs === pages && poisonNextParentCheck) {
                    poisonNextParentCheck = false;
                    poisoned = true;
                    return changedIdentity(stat);
                }
                return stat;
            },
            readFileSync(file, ...args) {
                if (typeof file === "number") descriptorReads++;
                return fs.readFileSync(file, ...args);
            },
        });
        const snapshot = buildImpactSnapshot(dir, ops);
        assert.strictEqual(poisoned, true);
        assert.strictEqual(descriptorReads, 0);
        assert.deepStrictEqual(snapshot.skippedInputs, [
            { rel: "pages", reason: "identityChanged" },
        ]);
        assert.deepStrictEqual(snapshot.allFiles, []);
        assert.strictEqual(isUnsafeTarget(snapshot.skippedInputs, "pages/sibling.html"), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("entry types are verified with lstat when dirent types are unknown", (t) => {
    const dir = workspace();
    const outside = workspace();
    try {
        put(dir, "pages/home.html", "home");
        const external = put(outside, "secret.html", "secret");
        fs.mkdirSync(path.join(dir, "fragments"), { recursive: true });
        try {
            fs.symlinkSync(external, path.join(dir, "fragments", "link.html"));
        } catch (error) {
            if (error.code === "EPERM" || error.code === "EACCES") return t.skip("symlinks unavailable");
            throw error;
        }
        const ops = injectedFs({
            readdirSync(abs, options) {
                return fs.readdirSync(abs, options).map(entry => ({
                    name: entry.name,
                    isDirectory: () => false,
                    isFile: () => false,
                    isSymbolicLink: () => false,
                }));
            },
        });
        const snapshot = buildImpactSnapshot(dir, ops);
        assert.deepStrictEqual(snapshot.markup, [
            { rel: "pages/home.html", content: "home" },
        ]);
        assert.deepStrictEqual(snapshot.allFiles, ["pages/home.html"]);
        assert.deepStrictEqual(snapshot.skippedInputs, [
            { rel: "fragments/link.html", reason: "symlink" },
        ]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

test("a workspace-root symlink is rejected without exposing its target", (t) => {
    const holder = workspace();
    const outside = workspace();
    try {
        const secret = "root-link-secret-that-must-not-be-read";
        put(outside, "pages/home.html", secret);
        const linkedRoot = path.join(holder, "linked-workspace");
        try {
            fs.symlinkSync(outside, linkedRoot, "dir");
        } catch (error) {
            if (error.code === "EPERM" || error.code === "EACCES") return t.skip("symlinks unavailable");
            throw error;
        }
        for (const spelling of [linkedRoot, linkedRoot + path.sep, linkedRoot + path.sep + "."]) {
            const snapshot = buildImpactSnapshot(spelling);
            assert.deepStrictEqual(snapshot.skippedInputs, [
                { rel: "", reason: "symlink" },
            ]);
            assert.deepStrictEqual(snapshot.allFiles, []);
            assert.strictEqual(isUnsafeTarget(snapshot.skippedInputs, "pages/home.html"), true);
            assert.strictEqual(JSON.stringify(snapshot).includes(secret), false);
        }
    } finally {
        fs.rmSync(holder, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

test("a root identity change marks every target unsafe", () => {
    const dir = workspace();
    try {
        put(dir, "pages/home.html", "home");
        const root = fs.realpathSync(dir);
        let rootChecks = 0;
        const ops = injectedFs({
            lstatSync(abs) {
                const stat = fs.lstatSync(abs);
                if (abs === root && ++rootChecks === 2) return changedIdentity(stat);
                return stat;
            },
        });
        const snapshot = buildImpactSnapshot(dir, ops);
        assert.deepStrictEqual(snapshot.skippedInputs, [
            { rel: "", reason: "identityChanged" },
        ]);
        assert.strictEqual(isUnsafeTarget(snapshot.skippedInputs, "pages/home.html"), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("impact snapshot records a non-regular input", (t) => {
    const dir = workspace();
    try {
        fs.mkdirSync(path.join(dir, "fragments"), { recursive: true });
        const fifo = path.join(dir, "fragments", "pipe.html");
        const made = childProcess.spawnSync("mkfifo", [fifo]);
        if (made.error && made.error.code === "ENOENT") return t.skip("mkfifo unavailable");
        assert.strictEqual(made.status, 0, made.stderr && made.stderr.toString());
        const snapshot = buildImpactSnapshot(dir);
        assert.deepStrictEqual(snapshot.skippedInputs, [
            { rel: "fragments/pipe.html", reason: "notRegular" },
        ]);
        assert.deepStrictEqual(snapshot.allFiles, []);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("impact snapshot records invalid UTF-8 without decoding it", () => {
    const dir = workspace();
    try {
        put(dir, "fragments/bad.html", Buffer.from([0xc3, 0x28]));
        const snapshot = buildImpactSnapshot(dir);
        assert.deepStrictEqual(snapshot.skippedInputs, [
            { rel: "fragments/bad.html", reason: "invalidUtf8" },
        ]);
        assert.deepStrictEqual(snapshot.markup, []);
        assert.deepStrictEqual(snapshot.allFiles, ["fragments/bad.html"]);
        assert.strictEqual(snapshot.contentHashByRel["fragments/bad.html"], undefined);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("a file disappearing after lstat is unreadable rather than fatal", () => {
    const dir = workspace();
    try {
        put(dir, "pages/gone.html", "gone");
        const ops = injectedFs({
            openSync() {
                const error = new Error("gone");
                error.code = "ENOENT";
                throw error;
            },
        });
        const snapshot = buildImpactSnapshot(dir, ops);
        assert.deepStrictEqual(snapshot.skippedInputs, [
            { rel: "pages/gone.html", reason: "unreadable" },
        ]);
        assert.deepStrictEqual(snapshot.markup, []);
        assert.deepStrictEqual(snapshot.allFiles, ["pages/gone.html"]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("impact snapshot output and skips are deterministic", (t) => {
    const dir = workspace();
    const outside = workspace();
    try {
        put(dir, "pages/z.html", "z");
        put(dir, "pages/a.html", "a");
        put(dir, "notes/readme.txt", "ignored but verified");
        const external = put(outside, "secret.html", "secret");
        fs.mkdirSync(path.join(dir, "fragments"), { recursive: true });
        try {
            fs.symlinkSync(external, path.join(dir, "fragments", "link.html"));
        } catch (error) {
            if (error.code === "EPERM" || error.code === "EACCES") return t.skip("symlinks unavailable");
            throw error;
        }
        const first = buildImpactSnapshot(dir);
        const second = buildImpactSnapshot(dir);
        assert.deepStrictEqual(second, first);
        assert.deepStrictEqual(first.allFiles, [
            "notes/readme.txt", "pages/a.html", "pages/z.html",
        ]);
        assert.deepStrictEqual(first.skippedInputs, [
            { rel: "fragments/link.html", reason: "symlink" },
        ]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});
