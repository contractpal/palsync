import React, { useEffect, useState } from "react";

function Badge({ ok }) {
    return <span className={"dep-badge " + (ok ? "ok" : "missing")}>{ok ? "✓" : ""}</span>;
}

export default function DependencyCheckModal({ onClose }) {
    const [status, setStatus] = useState(null);
    const [installing, setInstalling] = useState(false);
    const [installError, setInstallError] = useState(null);

    function refresh() {
        return window.palsyncGui.checkDependencies().then(setStatus);
    }

    useEffect(() => { refresh(); }, []);

    async function installChromium() {
        setInstalling(true);
        setInstallError(null);
        const result = await window.palsyncGui.installChromium();
        setInstalling(false);
        if (!result.ok) { setInstallError(result.error || "Install failed."); return; }
        await refresh();
    }

    if (!status) return null;

    return (
        <div className="modal-backdrop" onClick={() => !installing && onClose()}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <h3>Check Dependencies</h3>

                <div className="dep-section">
                    <h4 className="dep-section-title">
                        <Badge ok={status.agentDetected} /> Agent Detected
                    </h4>
                    {status.agents.map(a => (
                        <div key={a.id} className="dep-item">
                            <span className="dep-item-label">
                                <Badge ok={a.found} />
                                {a.label}{a.comingSoon && "*"}
                                {a.recommended && <span className="dep-recommended">recommended</span>}
                                {a.comingSoon && <span className="dep-coming-soon">Coming Soon</span>}
                            </span>
                            {!a.found && (
                                <button className="btn" onClick={() => window.palsyncGui.openExternal(a.docsUrl)}>
                                    Install docs →
                                </button>
                            )}
                        </div>
                    ))}
                    {status.agents.some(a => a.comingSoon) && (
                        <p className="dep-hint">* Not yet supported in Chip — wiring in progress.</p>
                    )}
                </div>

                <div className="dep-section">
                    <h4 className="dep-section-title">
                        <Badge ok={status.chromiumInstalled} /> Preview Browser (Chromium)
                    </h4>
                    <p className="dep-hint">Used for previewing/testing a pal's web pages.</p>
                    <div className="dep-item">
                        <span className="dep-item-label">
                            {status.chromiumInstalled ? "Installed" : installing ? "Downloading (~150MB, one-time)…" : "Not installed"}
                        </span>
                        {!status.chromiumInstalled && !installing && (
                            <button className="btn btn-primary" onClick={installChromium}>Install</button>
                        )}
                    </div>
                    {installError && <p className="wizard-error">{installError}</p>}
                </div>

                <div className="modal-actions">
                    <button className="btn btn-primary" onClick={onClose} disabled={installing}>Close</button>
                </div>
            </div>
        </div>
    );
}
