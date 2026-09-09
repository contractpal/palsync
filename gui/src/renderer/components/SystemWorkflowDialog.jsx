import React, { useEffect, useState } from "react";
import QrCodeModal from "./QrCodeModal.jsx";

// A pal can have more than one console-system workflow, and runTest() otherwise silently
// defaults to the first one found — so System gets its own dialog (rather than the plain
// split-button the other three areas use) to pick which one to run, per David's ask 2026-09-09.
export default function SystemWorkflowDialog({ pal, browsers, defaultId, onClose }) {
    const [files, setFiles] = useState([]);
    const [workflowName, setWorkflowName] = useState("");
    const [browserId, setBrowserId] = useState("");
    const [error, setError] = useState(null);
    const [running, setRunning] = useState(false);
    const [status, setStatus] = useState(null);
    const [qrDataUrl, setQrDataUrl] = useState(null);

    useEffect(() => {
        window.palsyncGui.listWorkflowFiles(pal.path, "console-system").then(res => {
            if (res.error) { setError(res.error); return; }
            setFiles(res.files || []);
            setWorkflowName((res.files && res.files[0]) || "");
        });
    }, [pal.path]);

    async function run(mode) {
        setRunning(true);
        setError(null);
        setStatus(null);
        try {
            const res = await window.palsyncGui.testWorkflow(pal.path, "console-system", browserId || null, mode, workflowName || null);
            if (res.error) {
                setStatus({ error: true, text: res.error });
            } else if (!res.result.ran) {
                setStatus({ error: true, text: res.result.blocked || "Couldn't run." });
            } else if (!res.result.validated) {
                setStatus({ error: true, text: "Did not validate on the server — see the messages/validation results." });
            } else if (mode === "qr") {
                if (res.qrDataUrl) setQrDataUrl(res.qrDataUrl);
                else setStatus({ error: true, text: "Validated, but couldn't generate a QR code." });
            } else if (res.opened && !res.opened.opened) {
                setStatus({ error: true, text: "Validated, but couldn't open the browser (" + (res.opened.reason || "unknown error") + ")." });
            } else {
                setStatus({ error: false, text: "Opened in your browser." });
            }
        } finally {
            setRunning(false);
        }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <h3>Test System — {pal.name}</h3>
                {error && <p className="wizard-error">{error}</p>}
                {!files.length && !error && <p className="empty-state">This pal has no console-system workflow.</p>}

                {!!files.length && (
                    <>
                        <div className="wizard-field">
                            <label>Workflow</label>
                            <select value={workflowName} onChange={e => setWorkflowName(e.target.value)}>
                                {files.map(f => <option key={f} value={f}>{f}</option>)}
                            </select>
                        </div>
                        <div className="wizard-field">
                            <label>Browser</label>
                            <select value={browserId} onChange={e => setBrowserId(e.target.value)}>
                                <option value="">Default</option>
                                {browsers.map(b => (
                                    <option key={b.id} value={b.id}>
                                        {b.description}{b.id === defaultId ? " (default)" : ""}
                                    </option>
                                ))}
                            </select>
                        </div>
                        {status && <p className={status.error ? "wizard-error" : "dep-hint"}>{status.text}</p>}
                        <div className="modal-actions" style={{ justifyContent: "space-between" }}>
                            <button className="btn" onClick={onClose}>Close</button>
                            <div style={{ display: "flex", gap: 6 }}>
                                <button className="btn" onClick={() => run("qr")} disabled={running}>QR code</button>
                                <button className="btn btn-primary" onClick={() => run("open")} disabled={running}>
                                    {running ? "Running…" : "Run"}
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
            {qrDataUrl && (
                <QrCodeModal label={"System: " + workflowName} dataUrl={qrDataUrl} onClose={() => setQrDataUrl(null)} />
            )}
        </div>
    );
}
