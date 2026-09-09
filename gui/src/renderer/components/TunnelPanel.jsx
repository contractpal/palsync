import React, { useEffect, useState } from "react";

// A pal's Tunnel workflow is called directly over HTTP with minted short-lived credentials —
// there's no Test*.do/browser-link equivalent (see palsync's src/core/tunnel.js). This is a
// small request/response tester, the same shape as the Java PalBuilder IDE's Tunnel Services
// panel (pick a workflow/action, supply a payload, see the response) but talking plain
// JSON-over-HTTP instead of SOAP.
function describeRefused(res) {
    switch (res.refused) {
        case "mint-failed": return "Couldn't mint tunnel credentials: " + res.reason;
        case "unauthorized": return res.reason;
        default: return res.reason || ("Tunnel call failed (" + res.refused + ").");
    }
}

export default function TunnelPanel({ pal, onClose }) {
    const [workflows, setWorkflows] = useState([]);
    const [error, setError] = useState(null);
    const [workflow, setWorkflow] = useState("");
    const [action, setAction] = useState("");
    const [payload, setPayload] = useState("{}");
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState(null);

    useEffect(() => {
        window.palsyncGui.listTunnelWorkflows(pal.path).then(res => {
            if (res.error) { setError(res.error); return; }
            setWorkflows(res.tunnels || []);
            setWorkflow(res.defaultTunnel || (res.tunnels && res.tunnels[0]) || "");
        });
    }, [pal.path]);

    async function run() {
        setRunning(true);
        setError(null);
        setResult(null);
        try {
            const res = await window.palsyncGui.runTunnel(pal.path, action.trim() || null, workflow || null, payload);
            if (res.error) setError(res.error);
            else setResult(res.result);
        } finally {
            setRunning(false);
        }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <h3>Tunnel — {pal.name}</h3>
                {error && <p className="wizard-error">{error}</p>}
                {!workflows.length && !error && (
                    <p className="empty-state">This pal has no tunnel workflow (or none has been pulled yet).</p>
                )}

                {!!workflows.length && (
                    <>
                        <div className="wizard-field">
                            <label>Tunnel workflow</label>
                            <select value={workflow} onChange={e => setWorkflow(e.target.value)}>
                                {workflows.map(w => <option key={w} value={w}>{w}</option>)}
                            </select>
                        </div>
                        <div className="wizard-field">
                            <label>Action (optional)</label>
                            <input value={action} onChange={e => setAction(e.target.value)} placeholder="e.g. status" />
                        </div>
                        <div className="wizard-field">
                            <label>Payload (JSON)</label>
                            <textarea
                                rows={6}
                                value={payload}
                                onChange={e => setPayload(e.target.value)}
                                style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}
                            />
                        </div>
                        <div className="modal-actions" style={{ justifyContent: "space-between" }}>
                            <button className="btn" onClick={onClose}>Close</button>
                            <button className="btn btn-primary" onClick={run} disabled={running}>
                                {running ? "Running…" : "Run"}
                            </button>
                        </div>
                    </>
                )}

                {result && (
                    <div className="dep-section">
                        {!result.ran && <p className="wizard-error">{describeRefused(result)}</p>}
                        {result.ran && (
                            <>
                                <p className="dep-hint">HTTP {result.status}{result.refreshedCredentials ? " · minted new credentials" : ""}</p>
                                {result.emptyBody && (
                                    <p className="wizard-error">Empty response — the workflow likely threw at runtime (the server swallows the error).</p>
                                )}
                                {!result.emptyBody && (
                                    <pre className="wizard-progress-log" style={{ maxHeight: 220 }}>
                                        {result.parseError ? result.raw : JSON.stringify(result.response, null, 2)}
                                    </pre>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
