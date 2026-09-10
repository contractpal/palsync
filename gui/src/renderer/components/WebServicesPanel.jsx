import React, { useEffect, useState } from "react";

// Runs a Console or Transaction Web Services REST workflow for the CURRENT pal, always against
// the cloud that pal actually came from (never a hardcoded domain — see
// src/core/webServices.js). This is a genuinely separate login from the pal-cloud session Chip
// already has, so the first use on a given cloud prompts for it.
function parsePostData(text) {
    const out = {};
    for (const line of String(text || "").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const i = trimmed.indexOf("=");
        if (i === -1) continue;
        out[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
    }
    return out;
}

export default function WebServicesPanel({ pal, onClose }) {
    const [checking, setChecking] = useState(true);
    const [error, setError] = useState(null);
    const [environmentUrl, setEnvironmentUrl] = useState(null);
    const [needsLogin, setNeedsLogin] = useState(false);
    const [loggedInAs, setLoggedInAs] = useState(null);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [engine, setEngine] = useState("console");
    const [postDataText, setPostDataText] = useState("");
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState(null);
    const [endpointLines, setEndpointLines] = useState([]);

    function refreshLogin() {
        setChecking(true);
        window.palsyncGui.webServicesCheckLogin(pal.path).then(res => {
            setChecking(false);
            if (res.error) { setError(res.error); return; }
            setEnvironmentUrl(res.environmentUrl);
            setNeedsLogin(res.needsLogin);
            setLoggedInAs(res.needsLogin ? null : res.username);
        });
    }

    useEffect(refreshLogin, [pal.path]);

    useEffect(() => {
        window.palsyncGui.webServicesEndpoint(pal.path, engine).then(res => {
            setEndpointLines((res && res.lines) || []);
        });
    }, [pal.path, engine]);

    async function submitLogin() {
        setError(null);
        const res = await window.palsyncGui.webServicesLogin(environmentUrl, username.trim(), password);
        if (res.error) { setError(res.error); return; }
        setPassword("");
        refreshLogin();
    }

    async function logout() {
        await window.palsyncGui.webServicesLogout(environmentUrl, loggedInAs);
        refreshLogin();
    }

    async function run() {
        setRunning(true);
        setError(null);
        setResult(null);
        try {
            const res = await window.palsyncGui.runWebServicesWorkflow(pal.path, engine, parsePostData(postDataText));
            if (res.error) setError(res.error);
            else setResult(res.result);
        } finally {
            setRunning(false);
        }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <h3>Web Services — {pal.name}</h3>
                {error && <p className="wizard-error">{error}</p>}

                {checking && <p className="empty-state">Checking login…</p>}

                {!checking && needsLogin && (
                    <>
                        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
                            Log in to Web Services for <strong>{environmentUrl}</strong>. This is a separate
                            login from your pal-cloud session — credentials are stored locally, only for this cloud.
                        </p>
                        <div className="wizard-field">
                            <label>Username</label>
                            <input value={username} onChange={e => setUsername(e.target.value)} autoFocus />
                        </div>
                        <div className="wizard-field">
                            <label>Password</label>
                            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") submitLogin(); }} />
                        </div>
                        <div className="modal-actions">
                            <button className="btn" onClick={onClose}>Cancel</button>
                            <button className="btn btn-primary" onClick={submitLogin} disabled={!username.trim() || !password}>Log In</button>
                        </div>
                    </>
                )}

                {!checking && !needsLogin && (
                    <>
                        <p style={{ margin: 0, fontSize: 12, color: "var(--text-faint)" }}>
                            Logged in as {loggedInAs} on {environmentUrl} — <a href="#" onClick={e => { e.preventDefault(); logout(); }}>log out</a>
                        </p>
                        <div className="wizard-field">
                            <label>Engine</label>
                            <select value={engine} onChange={e => setEngine(e.target.value)}>
                                <option value="console">Console</option>
                                <option value="transaction">Transaction</option>
                            </select>
                        </div>
                        {endpointLines.length > 0 && (
                            <div className="wizard-field">
                                <label>Target endpoint</label>
                                <pre style={{ margin: 0, padding: 8, background: "var(--bg-inset, #0002)", borderRadius: 4, fontSize: 12, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                    {endpointLines.join("\n")}
                                </pre>
                            </div>
                        )}
                        <div className="wizard-field">
                            <label>Post data (optional — one name=value per line)</label>
                            <textarea
                                rows={5}
                                value={postDataText}
                                onChange={e => setPostDataText(e.target.value)}
                                placeholder={"param1=value1\nparam2=value2"}
                                style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}
                            />
                        </div>
                        <div className="modal-actions" style={{ justifyContent: "space-between" }}>
                            <button className="btn" onClick={onClose}>Close</button>
                            <button className="btn btn-primary" onClick={run} disabled={running}>
                                {running ? "Running…" : "Run Workflow"}
                            </button>
                        </div>

                        {result && (
                            <div className="dep-section">
                                {!result.ran && (
                                    <>
                                        <p className="wizard-error">{result.reason || "Could not run the workflow."}</p>
                                        {result.raw && (
                                            <pre className="wizard-progress-log" style={{ maxHeight: 220, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                                {result.raw}
                                            </pre>
                                        )}
                                    </>
                                )}
                                {result.ran && (
                                    <>
                                        <p className="dep-hint">{result.success ? "Success" : "Completed, but reported failure"}</p>
                                        {result.messages && result.messages.length > 0 && (
                                            <ul style={{ margin: "4px 0", paddingLeft: 18, fontSize: 12.5 }}>
                                                {result.messages.map((m, i) => (
                                                    <li key={i}>{m.type ? "[" + m.type + "] " : ""}{m.message}</li>
                                                ))}
                                            </ul>
                                        )}
                                        {result.data && result.data.length > 0 && (
                                            <pre className="wizard-progress-log" style={{ maxHeight: 220 }}>
                                                {result.data.map(d => d.name + " = " + d.value).join("\n")}
                                            </pre>
                                        )}
                                        {(!result.data || !result.data.length) && (!result.messages || !result.messages.length) && (
                                            <p className="empty-state">No data or messages returned.</p>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
