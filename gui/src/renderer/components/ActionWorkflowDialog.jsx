import React, { useEffect, useState } from "react";

// Intermediate screen for Console / Transaction, mirroring the Java PalBuilder IDE's Test dialog:
// pick which workflow to run and (optionally) an action to start at, rather than launching
// immediately with the first workflow found and nothing on the querystring. The action rides to
// the server as cp-ws-doaction (see src/core/test.js buildPreviewUrl).
export default function ActionWorkflowDialog({ pal, kind, label, browsers, defaultId, onClose }) {
    const [files, setFiles] = useState([]);
    const [workflowName, setWorkflowName] = useState("");
    const [defaultFile, setDefaultFile] = useState(null);
    const [action, setAction] = useState("");
    const [txMode, setTxMode] = useState("new");
    const [profiles, setProfiles] = useState([]);
    const [profileId, setProfileId] = useState("");
    const [browserId, setBrowserId] = useState(defaultId || "");
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState(false);
    const [status, setStatus] = useState(null);
    const [qr, setQr] = useState(null);

    useEffect(() => {
        window.palsyncGui.listWorkflowFiles(pal.path, kind).then(res => {
            if (res.error) setError(res.error);
            setFiles(res.files || []);
            const files = res.files || [];
            setDefaultFile(res.defaultFile || null);
            setWorkflowName(files.includes(res.defaultFile) ? res.defaultFile : (files[0] || ""));
            setProfiles(res.profiles || []);
            setProfileId((res.profiles && res.profiles[0] && res.profiles[0].id) || "");
        }).finally(() => setLoading(false));
    }, [pal.path, kind]);

    async function run(mode) {
        setRunning(true);
        setStatus(null);
        setQr(null);
        try {
            const res = await window.palsyncGui.testWorkflow(pal.path, kind, browserId || null, mode, workflowName || null, action.trim() || null, profileId || null, kind === "transaction" ? txMode : null);
            if (res.error) {
                setStatus({ error: true, text: res.error });
            } else if (!res.result.ran) {
                setStatus({ error: true, text: res.result.blocked || "Couldn't run." });
            } else if (res.result.transactionBlocked === "no-last-transaction") {
                setStatus({ error: true, text: "There is no previous transaction to continue — choose New transaction." });
            } else if (!res.result.validated) {
                setStatus({ error: true, text: "Did not validate on the server — see the messages/validation results." });
            } else if (mode === "qr") {
                if (res.qrDataUrl) setQr(res.qrDataUrl);
                else setStatus({ error: true, text: "Validated, but couldn't generate a QR code." });
            } else if (res.opened && !res.opened.opened) {
                setStatus({ error: true, text: "Validated, but couldn't open the browser (" + (res.opened.reason || "unknown error") + ")." });
            } else {
                setStatus({ error: false, text: "Opened in your browser." });
            }
        } catch (e) {
            setStatus({ error: true, text: (e && e.message) || String(e) });
        } finally {
            setRunning(false);
        }
    }

    return (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <h3>Test {label} — {pal.name}</h3>
                {error && <p className="wizard-error">{error}</p>}
                {loading && <p className="empty-state">Loading workflows…</p>}
                {!loading && !files.length && !error && <p className="empty-state">This pal has no {label.toLowerCase()} workflow.</p>}

                {!!files.length && (
                    <>
                        <div className="wizard-field">
                            <label>Workflow</label>
                            <select value={workflowName} onChange={e => setWorkflowName(e.target.value)}>
                                {files.map(f => <option key={f} value={f}>{f}{f === defaultFile ? " (default)" : ""}</option>)}
                            </select>
                        </div>
                        {profiles.length > 0 && (
                            <div className="wizard-field">
                                <label>Profile</label>
                                <select value={profileId} onChange={e => setProfileId(e.target.value)}>
                                    {profiles.map(p => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
                                </select>
                            </div>
                        )}
                        {kind === "transaction" && (
                            <div className="wizard-field">
                                <label>Transaction</label>
                                <select value={txMode} onChange={e => setTxMode(e.target.value)}>
                                    <option value="new">New transaction</option>
                                    <option value="last">Continue last transaction</option>
                                </select>
                            </div>
                        )}
                        <div className="wizard-field">
                            <label>Action (optional)</label>
                            <input
                                type="text"
                                value={action}
                                placeholder="e.g. openClientSetup?id=9"
                                onChange={e => setAction(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter" && !running) run("open"); }}
                                autoFocus
                            />
                        </div>
                        {browsers && browsers.length > 0 && (
                            <div className="wizard-field">
                                <label>Browser</label>
                                <select value={browserId} onChange={e => setBrowserId(e.target.value)}>
                                    {browsers.map(b => <option key={b.id} value={b.id}>{b.description}{b.id === defaultId ? " (default)" : ""}</option>)}
                                </select>
                            </div>
                        )}
                        {status && <p className={status.error ? "wizard-error" : "dep-hint"}>{status.text}</p>}
                        {qr && <img src={qr} alt="QR code" style={{ alignSelf: "center", maxWidth: 220 }} />}
                        <div className="modal-actions" style={{ justifyContent: "space-between" }}>
                            <button className="btn" onClick={onClose}>Close</button>
                            <span style={{ display: "flex", gap: 8 }}>
                                <button className="btn" onClick={() => run("qr")} disabled={running}>QR code</button>
                                <button className="btn btn-primary" onClick={() => run("open")} disabled={running}>
                                    {running ? "Running…" : "Open"}
                                </button>
                            </span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
