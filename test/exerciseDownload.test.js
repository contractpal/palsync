"use strict";
// A pal action can return a file instead of a screen (c:createDownloadResponse). pal_exercise's
// browser path must save that file and prove it, without reporting the aborted navigation as a
// targeting failure or replaying the action.

const { test, describe } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { Readable } = require("node:stream");
const {
    runExercise, exerciseByBrowser, validateSteps, validateInitial, stepLabel, needsBrowser,
    formatExercise, createDownloadCollector
} = require("../src/core/exercise");
const { openAuthenticatedScreen, normalizeTarget } = require("../src/core/browserTarget");
const { loadChromium } = require("../src/core/browser");

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type /Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

function fakeDownload(name, body, { fail = null } = {}) {
    return {
        suggestedFilename: () => name,
        createReadStream: async () => Readable.from([body]),
        failure: async () => fail
    };
}

function fakePage({ text = "Report screen", emitOnClick = null } = {}) {
    const listeners = {};
    const clickTarget = {
        async count() { return 1; },
        first() { return this; },
        async click() { if (emitOnClick) emitOnClick(); }
    };
    return {
        on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); },
        emit(event, arg) { for (const fn of (listeners[event] || [])) fn(arg); },
        url: () => "https://secure.test/console?cp-auth=SECRET",
        locator() { return { async count() { return 1; }, first() { return clickTarget; }, async ariaSnapshot() { return "body"; } }; },
        getByText() { return clickTarget; },
        getByLabel() { return { async count() { return 0; }, first() { return this; } }; },
        async innerText() { return text; },
        async content() { return "<body>" + text + "</body>"; },
        async evaluate() { return {}; },
        async screenshot() { return Buffer.from("jpeg"); },
        async goto() {}, async waitForLoadState() {}, async waitForFunction() {}, async waitForTimeout() {},
        async fill() {}
    };
}

function fakeDeps(pg, extra = {}) {
    return Object.assign({
        loadChromium: () => ({}),
        getBrowser: async () => ({ newContext: async () => ({ newPage: async () => pg, close: async () => {} }) }),
        releaseBrowser: () => {},
        waitForRenderablePage: async () => {},
        wait: async () => {}
    }, extra);
}

describe("download steps in the request contract", () => {
    test("download alone is a complete step; true and a filename are the only values", () => {
        assert.deepStrictEqual(validateSteps([{ download: true }]), []);
        assert.deepStrictEqual(validateSteps([{ download: "report.pdf" }]), []);
        assert.deepStrictEqual(validateSteps([{ click: "Download", download: true }]), []);
        assert.ok(validateSteps([{}]).some(p => /does nothing/.test(p)));
        assert.ok(validateSteps([{ download: 5 }]).some(p => /download must be true/.test(p)));
        assert.ok(validateSteps([{ download: "  " }]).some(p => /download must be true/.test(p)));
    });

    test("a download step forces the browser path and appears in the step label", () => {
        assert.equal(needsBrowser([{ download: true }]), true);
        assert.equal(stepLabel({ download: "report.pdf" }), 'download "report.pdf"');
        assert.equal(stepLabel({ download: true, click: "Download" }), 'download click "Download"');
        assert.equal(stepLabel({ download: "../../etc/passwd" }), 'download "passwd"');
    });

    test("an initial action may omit expect only when a later step saves the download", () => {
        const action = { action: "previewReportPdf?id=6" };
        assert.ok(validateInitial(action).some(p => /initial\.expect/.test(p)));
        assert.deepStrictEqual(validateInitial(action, [{ download: "report.pdf" }]), []);
    });

    test("formatExercise reports the saved path, size, and PDF magic", () => {
        const out = formatExercise({
            ran: true, kind: "console", mode: "browser", pass: true, status: "passed",
            steps: [{ step: 1, label: 'download "report.pdf"', pass: true,
                      download: { file: "report.pdf", path: "/ws/.agent-work-history/x/report.pdf", bytes: 1234, pdf: true } }]
        });
        assert.match(out, /download saved: \/ws\/\.agent-work-history\/x\/report\.pdf \(1234 bytes, PDF\)/);
        assert.match(out, /Read the PDF with the Read tool: \/ws\/\.agent-work-history\/x\/report\.pdf/);
    });
});

describe("download collector", () => {
    test("queues in order, is bounded, and waitForAny does not consume", async () => {
        const pg = fakePage();
        const downloads = createDownloadCollector();
        downloads.attach(pg);
        const a = fakeDownload("a.pdf", PDF);
        const b = fakeDownload("b.pdf", PDF);
        const c = fakeDownload("c.pdf", PDF);
        const d = fakeDownload("d.pdf", PDF);
        const e = fakeDownload("e.pdf", PDF);
        assert.equal(downloads.hasPending(), false);
        assert.equal(await downloads.waitForAny(5), false);
        pg.emit("download", a);
        assert.equal(await downloads.waitForAny(50), true);
        assert.equal(downloads.hasPending(), true, "waitForAny must leave the file queued for the step");
        assert.equal(await downloads.next(), a);
        pg.emit("download", b);
        pg.emit("download", c);
        pg.emit("download", d);
        pg.emit("download", e); // over the cap of 3: the oldest queued items stay, e is dropped
        assert.equal(await downloads.next(), b);
        assert.equal(await downloads.next(), c);
        assert.equal(await downloads.next(), d);
        assert.equal(await downloads.next({ timeoutMs: 5 }), null);
    });

    test("next resolves null after the bounded wait when nothing arrives", async () => {
        const downloads = createDownloadCollector();
        assert.equal(await downloads.next({ timeoutMs: 10 }), null);
    });
});

describe("download steps in the browser runner", () => {
    test("a click that downloads saves the file and passes the step", async () => {
        const pg = fakePage({ emitOnClick: () => pg.emit("download", fakeDownload("served.pdf", PDF)) });
        const saved = [];
        const res = await exerciseByBrowser(
            { kind: "console", _previewUrl: "https://secure.test/console" },
            [{ click: "Download PDF", download: "report.pdf" }],
            undefined,
            fakeDeps(pg, {
                downloadTimeoutMs: 50,
                saveDownload: ({ file, buffer }) => { saved.push({ file, buffer }); return { path: "/ws/run/" + file }; }
            })
        );
        assert.equal(res.pass, true, JSON.stringify(res.steps));
        assert.deepStrictEqual(res.steps[0].download,
            { file: "report.pdf", path: "/ws/run/report.pdf", bytes: PDF.length, pdf: true });
        assert.equal(saved.length, 1);
        assert.equal(saved[0].file, "report.pdf");
        assert.equal(saved[0].buffer.subarray(0, 4).toString(), "%PDF");
    });

    test("a download step with no file fails with a clear error", async () => {
        const pg = fakePage();
        const res = await exerciseByBrowser(
            { kind: "console", _previewUrl: "https://secure.test/console" },
            [{ download: "report.pdf" }],
            undefined,
            fakeDeps(pg, { downloadTimeoutMs: 10 })
        );
        assert.equal(res.pass, false);
        assert.match(res.steps[0].error, /no file was downloaded/);
    });

    test("true keeps the served filename; a non-PDF is reported as not PDF", async () => {
        const pg = fakePage({ emitOnClick: () => pg.emit("download", fakeDownload("export.csv", Buffer.from("a,b\n1,2\n"))) });
        const res = await exerciseByBrowser(
            { kind: "console", _previewUrl: "https://secure.test/console" },
            [{ click: "Export", download: true }],
            undefined,
            fakeDeps(pg, { downloadTimeoutMs: 50, saveDownload: ({ file }) => ({ path: "/ws/run/" + file }) })
        );
        assert.equal(res.pass, true, JSON.stringify(res.steps));
        assert.equal(res.steps[0].download.file, "export.csv");
        assert.equal(res.steps[0].download.pdf, false);
    });

    test("an initial download is not a targeting failure and is never replayed", async () => {
        const pg = fakePage();
        let tests = 0;
        const res = await runExercise(null, "g", {
            steps: [{ download: "report.pdf" }],
            initial: { action: "previewReportPdf?id=6" },
            workflow: "console"
        }, fakeDeps(pg, {
            downloadTimeoutMs: 50,
            saveDownload: ({ file }) => ({ path: "/ws/run/" + file }),
            waitForRenderablePage: async () => {
                pg.emit("download", fakeDownload("served.pdf", PDF));
                throw new Error("page.goto: Download is starting at https://secure.test/console");
            },
            runTest: async () => {
                tests++;
                return { ran: true, validated: true, kind: "console", _previewUrl: "https://secure.test/console" };
            }
        }));
        assert.equal(res.pass, true, JSON.stringify(res));
        assert.equal(tests, 1, "a download abort must not trigger attemptWithFreshTest");
    });
});

// ---- real Chromium: a Content-Disposition attachment is a download, not an error --------------

function startServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            if (String(req.url).startsWith("/download")) {
                res.writeHead(200, {
                    "Content-Type": "application/pdf",
                    "Content-Disposition": 'attachment; filename="report.pdf"'
                });
                res.end(PDF);
                return;
            }
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end('<!doctype html><html><body><h1>Report screen</h1>' +
                '<a id="dl" href="/download">Download PDF</a></body></html>');
        });
        server.listen(0, "127.0.0.1", () => resolve({ server, base: "http://127.0.0.1:" + server.address().port }));
    });
}

async function chromiumOk() {
    const chromium = loadChromium();
    if (!chromium) return null;
    try { const b = await chromium.launch(); await b.close(); return chromium; } catch (e) { return null; }
}

describe("real Chromium download handling (skipped without Chromium)", () => {
    test("openAuthenticatedScreen treats an attachment goto as a download, not a navigation failure", async (t) => {
        const chromium = await chromiumOk();
        if (!chromium) return t.skip("Chromium unavailable");
        const { server, base } = await startServer();
        const browser = await chromium.launch();
        try {
            const downloads = createDownloadCollector();
            const open = await openAuthenticatedScreen(
                { kind: "console", validated: true, _previewUrl: base + "/download" },
                { onPage: (pg) => downloads.attach(pg), downloads },
                { loadChromium: () => chromium, getBrowser: async () => browser, releaseBrowser: () => {} }
            );
            assert.equal(open.ok, true, open.reason);
            assert.equal(open.downloadStarted, true);
            assert.equal(downloads.hasPending(), true);
            await open.bctx.close();
        } finally {
            await browser.close();
            server.close();
        }
    });

    test("an initial action that downloads passes via a download step", async (t) => {
        const chromium = await chromiumOk();
        if (!chromium) return t.skip("Chromium unavailable");
        const { server, base } = await startServer();
        const browser = await chromium.launch();
        try {
            const deps = {
                loadChromium: () => chromium,
                getBrowser: async () => browser,
                releaseBrowser: () => {},
                saveDownload: ({ file }) => ({ path: "/ws/run/" + file })
            };
            const res = await exerciseByBrowser(
                { kind: "console", validated: true, _previewUrl: base + "/download" },
                [{ download: "report.pdf" }],
                undefined,
                deps,
                { target: normalizeTarget({ action: "previewReportPdf?id=6" }).target, page: null, expect: [] }
            );
            assert.equal(res.pass, true, JSON.stringify(res.steps));
            assert.deepStrictEqual(res.steps[0].download,
                { file: "report.pdf", path: "/ws/run/report.pdf", bytes: PDF.length, pdf: true });
        } finally {
            await browser.close();
            server.close();
        }
    });

    test("a real click on an attachment link saves the served PDF", async (t) => {
        const chromium = await chromiumOk();
        if (!chromium) return t.skip("Chromium unavailable");
        const { server, base } = await startServer();
        const browser = await chromium.launch();
        try {
            const saved = [];
            const deps = {
                loadChromium: () => chromium,
                getBrowser: async () => browser,
                releaseBrowser: () => {},
                saveDownload: ({ file, buffer }) => { saved.push({ file, buffer }); return { path: "/ws/run/" + file }; }
            };
            const res = await exerciseByBrowser(
                { kind: "console", validated: true, _previewUrl: base + "/" },
                [{ click: "Download PDF", download: "report.pdf" }],
                undefined,
                deps
            );
            assert.equal(res.pass, true, JSON.stringify(res.steps));
            assert.equal(res.steps[0].download.pdf, true);
            assert.equal(res.steps[0].download.bytes, PDF.length);
            assert.equal(saved[0].buffer.subarray(0, 4).toString(), "%PDF");
        } finally {
            await browser.close();
            server.close();
        }
    });
});
