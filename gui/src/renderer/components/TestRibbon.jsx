import React, { useEffect, useRef, useState } from "react";
import QrCodeModal from "./QrCodeModal.jsx";
import TunnelPanel from "./TunnelPanel.jsx";
import SystemWorkflowDialog from "./SystemWorkflowDialog.jsx";

// Split-button per area: the main button launches with the default browser immediately, the
// caret opens a dropdown to launch with a different registered browser instead (David's call,
// 2026-09-09). Mirrors the Java PalBuilder IDE's ribbon (Test Transaction / Test Web / Test
// Console), reusing palsync's own src/core/test.js via the pal:testWorkflow IPC — nothing here
// talks to the server directly. System gets its own dialog instead of a split-button (see
// SystemWorkflowDialog) since a pal can have more than one console-system workflow to choose
// from — David's ask 2026-09-09.
const AREAS = [
    { kind: "transaction", label: "Transaction" },
    { kind: "web", label: "Web" },
    { kind: "console", label: "Console" }
];

function describeBlocked(reason) {
    switch (reason) {
        case "no-testable-workflow": return "This pal has no testable workflow.";
        case "unknown-workflow-type": return "This pal has no workflow of this type.";
        case "no-lock": return "Couldn't get the pal lock.";
        case "gui-lock-self": return "This pal is already checked out by you in PalBuilder.";
        case "gui-lock-other": return "This pal is checked out by someone else in PalBuilder.";
        default: return reason ? "Couldn't run: " + reason : "Couldn't run.";
    }
}

export default function TestRibbon({ pal, debugVisible, onToggleDebug }) {
    const [browsers, setBrowsers] = useState([]);
    const [defaultId, setDefaultId] = useState(null);
    const [busyKind, setBusyKind] = useState(null);
    const [menuKind, setMenuKind] = useState(null);
    const [status, setStatus] = useState(null); // { kind, text, error }
    const [qr, setQr] = useState(null); // { label, dataUrl }
    const [showTunnel, setShowTunnel] = useState(false);
    const [showSystem, setShowSystem] = useState(false);
    const rootRef = useRef(null);

    function refreshBrowsers() {
        return window.palsyncGui.browsers.list().then(reg => {
            setBrowsers(reg.browsers || []);
            setDefaultId(reg.defaultId || null);
        });
    }

    useEffect(() => { refreshBrowsers(); }, []);

    // Close an open browser-picker dropdown on an outside click.
    useEffect(() => {
        if (!menuKind) return;
        const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setMenuKind(null); };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [menuKind]);

    async function run(kind, label, browserId, mode) {
        setMenuKind(null);
        setBusyKind(kind);
        setStatus(null);
        try {
            const res = await window.palsyncGui.testWorkflow(pal.path, kind, browserId, mode);
            if (res.error) {
                setStatus({ kind, error: true, text: res.error });
            } else if (!res.result.ran) {
                setStatus({ kind, error: true, text: describeBlocked(res.result.blocked) });
            } else if (!res.result.validated) {
                setStatus({ kind, error: true, text: "Did not validate on the server — see the messages/validation results." });
            } else if (mode === "qr") {
                if (res.qrDataUrl) setQr({ label, dataUrl: res.qrDataUrl });
                else setStatus({ kind, error: true, text: "Validated, but couldn't generate a QR code." });
            } else if (res.opened && !res.opened.opened) {
                setStatus({ kind, error: true, text: "Validated, but couldn't open the browser (" + (res.opened.reason || "unknown error") + ")." });
            } else {
                setStatus({ kind, error: false, text: "Opened in your browser." });
            }
        } catch (e) {
            setStatus({ kind, error: true, text: (e && e.message) || String(e) });
        } finally {
            setBusyKind(null);
        }
    }

    return (
        <div className="ribbon" ref={rootRef}>
            <div className="ribbon-buttons">
                {AREAS.map(({ kind, label }) => (
                    <div className={"ribbon-split" + (busyKind === kind ? " busy" : "")} key={kind}>
                        <button
                            className="ribbon-btn"
                            disabled={busyKind !== null}
                            onClick={() => run(kind, label, null, "open")}
                            title={"Test " + label}
                        >
                            {label}
                        </button>
                        <button
                            className="ribbon-caret"
                            disabled={busyKind !== null}
                            title={"Choose a browser for " + label}
                            onClick={() => setMenuKind(m => (m === kind ? null : kind))}
                        >
                            ▾
                        </button>
                        {menuKind === kind && (
                            <div className="ribbon-menu">
                                {browsers.length === 0 && <div className="ribbon-menu-empty">No browsers configured — see File → Browsers…</div>}
                                {browsers.map(b => (
                                    <button key={b.id} onClick={() => run(kind, label, b.id, "open")}>
                                        {b.description}{b.id === defaultId ? " (default)" : ""}
                                    </button>
                                ))}
                                <div className="ribbon-menu-sep" />
                                <button onClick={() => run(kind, label, null, "qr")}>
                                    📱 Show QR code (scan on phone)
                                </button>
                            </div>
                        )}
                    </div>
                ))}
                <span className="ribbon-sep" />
                <button className="ribbon-btn standalone" onClick={() => setShowSystem(true)} title="Test a console-system workflow">
                    System…
                </button>
                <button className="ribbon-btn standalone" onClick={() => setShowTunnel(true)} title="Test this pal's tunnel workflow">
                    Tunnel…
                </button>
                <button
                    className={"ribbon-btn standalone" + (debugVisible ? " active" : "")}
                    onClick={onToggleDebug}
                    title={debugVisible ? "Hide the debug panel" : "Show the debug panel"}
                >
                    Debug
                </button>
            </div>
            {status && (
                <span className={"ribbon-status" + (status.error ? " error" : "")}>{status.text}</span>
            )}
            {qr && <QrCodeModal label={qr.label} dataUrl={qr.dataUrl} onClose={() => setQr(null)} />}
            {showSystem && <SystemWorkflowDialog pal={pal} browsers={browsers} defaultId={defaultId} onClose={() => setShowSystem(false)} />}
            {showTunnel && <TunnelPanel pal={pal} onClose={() => setShowTunnel(false)} />}
        </div>
    );
}
