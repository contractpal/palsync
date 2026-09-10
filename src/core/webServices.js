"use strict";
// Minimal REST clients for CloudPiston's Console/Transaction Web Services — a genuinely separate,
// already-live REST API distinct from the pal/composer session palsync normally uses. Requires
// its own username/password (plain HTTP Basic Auth) and is always resolved against the SAME
// cloud the pal itself came from — never a hardcoded domain. Confirmed against the real
// server-side implementation, not just the Java IDE's client stubs:
//   - Endpoints: {environmentUrl}/cpservice/rest/console/*, {environmentUrl}/cpservice/rest/transactions/*
//     (com.nxlight.framework.services.webservices.rest.{Console,Transaction}ResourceImpl)
//   - Auth: HTTP Basic (ServiceFactory.authorize() does a GET with Basic Auth, checks a
//     wsdl-version response header) — no session token, no WS-Security handshake.
//   - Bodies: flat XML matching com.contractpal.console.ConsoleContent / .transaction.
//     TransactionContent (both: optional <postData> of <NameValue> pairs; documents/images/
//     styles/payload omitted here — out of scope for this first pass, see BACKLOG.md).
//   - Responses: com.contractpal.console.ConsoleResult / .transaction.TransactionResult, both
//     extending com.contractpal.Result (success/messages/data/payload) — messages and data are
//     JAXB @XmlElementWrapper-wrapped arrays of <Message>/<NameValue>, confirmed against the
//     actual bean source, not guessed.
// No SOAP, no WSDL, no new dependency — plain fetch + hand-built/parsed XML, since the wire
// shape is small and fixed.

function xmlEscape(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function xmlUnescape(s) {
    return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
        .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

// <ConsoleContent>/<TransactionContent> — same shape for both.
function buildContentXml(rootName, postData) {
    const pairs = Object.entries(postData || {});
    const body = pairs.length
        ? "<postData>" + pairs.map(([k, v]) =>
            "<NameValue><name>" + xmlEscape(k) + "</name><value>" + xmlEscape(v) + "</value></NameValue>"
          ).join("") + "</postData>"
        : "";
    return "<" + rootName + ">" + body + "</" + rootName + ">";
}

// Pulls what a "run a workflow and see what came back" caller needs from a
// ConsoleResult/TransactionResult body — success, messages (message/type pairs), and data
// (name/value pairs) — without a full XML parser (the shape is small and fixed, confirmed
// against the real bean classes rather than guessed).
function parseResult(xml) {
    const text = String(xml || "");
    const success = /<success>\s*true\s*<\/success>/i.test(text);
    const messages = [];
    const msgRe = /<Message>([\s\S]*?)<\/Message>/g;
    let m;
    while ((m = msgRe.exec(text))) {
        const message = (/<message>([\s\S]*?)<\/message>/.exec(m[1]) || [])[1];
        const type = (/<type>([\s\S]*?)<\/type>/.exec(m[1]) || [])[1];
        messages.push({ message: message ? xmlUnescape(message) : null, type: type ? xmlUnescape(type) : null });
    }
    const data = [];
    const dataRe = /<NameValue>([\s\S]*?)<\/NameValue>/g;
    while ((m = dataRe.exec(text))) {
        const name = (/<name>([\s\S]*?)<\/name>/.exec(m[1]) || [])[1];
        const value = (/<value>([\s\S]*?)<\/value>/.exec(m[1]) || [])[1];
        data.push({ name: name ? xmlUnescape(name) : null, value: value ? xmlUnescape(value) : null });
    }
    return { success, messages, data, raw: text };
}

function basicAuthHeader(username, password) {
    return "Basic " + Buffer.from(username + ":" + password).toString("base64");
}

function baseUrl(environmentUrl) {
    return String(environmentUrl).replace(/\/+$/, "");
}

// Exported so callers (the GUI's Web Services panel) can show the exact target endpoint before
// running anything — same construction the actual calls below use, not a separate guess.
function consoleWorkflowUrl(environmentUrl, palId) {
    return baseUrl(environmentUrl) + "/cpservice/rest/console/" + encodeURIComponent(palId) + "/runWorkflow";
}
function transactionCreateUrl(environmentUrl) {
    return baseUrl(environmentUrl) + "/cpservice/rest/transactions";
}
function transactionWorkflowUrl(environmentUrl, transactionId) {
    return baseUrl(environmentUrl) + "/cpservice/rest/transactions/" + encodeURIComponent(transactionId) + "/runWorkflow";
}

async function postXml(url, xmlBody, { username, password }) {
    let res;
    try {
        res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/xml",
                "Accept": "application/xml",
                "Authorization": basicAuthHeader(username, password)
            },
            body: xmlBody
        });
    } catch (e) {
        return { ok: false, reason: "Request failed: " + (e && e.message ? e.message : String(e)) };
    }
    const text = await res.text();
    if (res.status === 401) return { ok: false, status: 401, reason: "Unauthorized — check the Web Services username/password.", raw: text };
    if (!res.ok) return { ok: false, status: res.status, reason: "HTTP " + res.status, raw: text };
    return { ok: true, status: res.status, text };
}

// Console: one step — run the workflow directly against the pal.
async function runConsoleWorkflow({ environmentUrl, username, password }, palId, postData) {
    const url = consoleWorkflowUrl(environmentUrl, palId);
    const xml = buildContentXml("ConsoleContent", postData);
    const res = await postXml(url, xml, { username, password });
    if (!res.ok) return { ran: false, reason: res.reason, status: res.status, raw: res.raw };
    return Object.assign({ ran: true }, parseResult(res.text));
}

// Transaction: two steps — create a transaction against the pal, then run its workflow.
async function createTransaction({ environmentUrl, username, password }, palId) {
    const url = transactionCreateUrl(environmentUrl);
    let res;
    try {
        res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/xml",
                "Authorization": basicAuthHeader(username, password)
            },
            body: "palId=" + encodeURIComponent(palId)
        });
    } catch (e) {
        return { ok: false, reason: "Request failed: " + (e && e.message ? e.message : String(e)) };
    }
    const text = await res.text();
    if (res.status === 401) return { ok: false, reason: "Unauthorized — check the Web Services username/password." };
    if (!res.ok) return { ok: false, reason: "HTTP " + res.status, raw: text };
    const m = /<string>([\s\S]*?)<\/string>/.exec(text);
    if (!m) return { ok: false, reason: "Unexpected response creating the transaction.", raw: text };
    return { ok: true, transactionId: xmlUnescape(m[1]) };
}

async function runTransactionWorkflow(creds, palId, postData) {
    const created = await createTransaction(creds, palId);
    if (!created.ok) return { ran: false, reason: created.reason, raw: created.raw };
    const url = transactionWorkflowUrl(creds.environmentUrl, created.transactionId);
    const xml = buildContentXml("TransactionContent", postData);
    const res = await postXml(url, xml, creds);
    if (!res.ok) return { ran: false, reason: res.reason, status: res.status, raw: res.raw };
    return Object.assign({ ran: true, transactionId: created.transactionId }, parseResult(res.text));
}

module.exports = {
    runConsoleWorkflow, runTransactionWorkflow, createTransaction,
    buildContentXml, parseResult, xmlEscape, xmlUnescape,
    consoleWorkflowUrl, transactionCreateUrl, transactionWorkflowUrl
};
