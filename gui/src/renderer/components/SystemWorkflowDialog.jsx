import React, { useEffect, useState } from "react";

// A pal can have more than one console-system workflow, and runTest() otherwise silently
// defaults to the first one found — so System gets its own dialog (rather than the plain
// split-button the other three areas use) to pick which one to run, per David's ask 2026-09-09.
// console-system (TestSystem.do) is a backend job workflow with no rendered page at all — found
// live (David, 2026-09-10): there's no browser to open and no page to scan a QR code for, so
// unlike Web/Console/Transaction this dialog just runs the job and shows its id.
export default function SystemWorkflowDialog({ pal, onClose }) {
    const [files, setFiles] = useState([]);
    const [workflowName, setWorkflowName] = useState("");
    const [error, setError] = useState(null);
    const [running, setRunning] = useState(false);
    const [status, setStatus] = useState(null);

    useEffect(() => {
        window.palsyncGui.listWorkflowFiles(pal.path, "console-system").then(res => {
            if (res.error) { setError(res.error); return; }
            setFiles(res.files || []);
            setWorkflowName((res.files && res.files[0]) || "");
        });
    }, [pal.path]);

    async function run() {
        setRunning(true);
        setError(null);
        setStatus(null);
        try {
            const res = await window.palsyncGui.testWorkflow(pal.path, "console-system", null, "open", workflowName || null);
            if (res.error) {
                setStatus({ error: true, text: res.error });
            } else if (!res.result.ran) {
                setStatus({ error: true, text: res.result.blocked || "Couldn't run." });
            } else if (!res.result.validated) {
                setStatus({ error: true, text: "Did not validate on the server — see the messages/validation results." });
            } else if (res.result.jobId) {
                setStatus({ error: false, text: "Job started — id: " + res.result.jobId });
            } else {
                setStatus({ error: true, text: "Validated, but no job id came back." });
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
                        {status && <p className={status.error ? "wizard-error" : "dep-hint"}>{status.text}</p>}
                        <div className="modal-actions" style={{ justifyContent: "space-between" }}>
                            <button className="btn" onClick={onClose}>Close</button>
                            <button className="btn btn-primary" onClick={run} disabled={running}>
                                {running ? "Running…" : "Run"}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
