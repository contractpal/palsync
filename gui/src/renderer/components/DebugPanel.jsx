import React, { useEffect, useRef, useState } from "react";

const AUTO_OPTIONS = [
    { ms: 5000, label: "Auto — 5s" },
    { ms: 10000, label: "Auto — 10s" },
    { ms: 15000, label: "Auto — 15s" }
];

// Server-side c.debug(...) log for this pal (see palsync's src/core/debug.js), shown as a
// persistent, resizable panel beside the console — David's ask 2026-09-09 — instead of a modal,
// so debug output stays visible (with its own scrollback) while working in the terminal.
// CONSUME-ONCE and SHARED with the PalBuilder IDE's own debug view (reading clears the buffer for
// everyone), so a fetch only ever happens on an explicit trigger — manual click, or one of the
// auto-refresh intervals below — never a speculative background poll outside those.
export default function DebugPanel({ pal, log, onFetched, onClear, onHide }) {
    const [error, setError] = useState(null);
    const [fetching, setFetching] = useState(false);
    const [autoMs, setAutoMs] = useState(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const fetchingRef = useRef(false);
    const rootRef = useRef(null);

    async function fetchNow() {
        if (fetchingRef.current) return; // an auto-tick landing mid-fetch just skips, not queues
        fetchingRef.current = true;
        setFetching(true);
        setError(null);
        try {
            const res = await window.palsyncGui.fetchDebug(pal.path);
            if (res.error) { setError(res.error); return; }
            if (!res.result.retrieved) { setError(res.result.reason || "Couldn't retrieve debug output."); return; }
            if (!res.result.empty) onFetched(res.result.text);
        } finally {
            fetchingRef.current = false;
            setFetching(false);
        }
    }

    useEffect(() => {
        if (!autoMs) return;
        const id = setInterval(fetchNow, autoMs);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoMs, pal.path]);

    useEffect(() => {
        if (!menuOpen) return;
        const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setMenuOpen(false); };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [menuOpen]);

    function pickAuto(ms) {
        setAutoMs(ms);
        setMenuOpen(false);
    }

    return (
        <div className="debug-panel">
            <div className="debug-panel-header">
                <span className="debug-panel-title">
                    Debug — {pal.name}
                    {autoMs && <span className="debug-auto-badge">● every {autoMs / 1000}s</span>}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn" onClick={() => onClear()} disabled={!log.length} title="Clear this log">
                        Clear
                    </button>
                    <div className="ribbon-split" ref={rootRef}>
                        <button className="ribbon-btn standalone" style={{ borderRight: "none", borderRadius: "6px 0 0 6px" }} onClick={fetchNow} disabled={fetching}>
                            {fetching ? "Fetching…" : "Fetch"}
                        </button>
                        <button className="ribbon-caret" onClick={() => setMenuOpen(v => !v)} title="Auto-refresh options">▾</button>
                        {menuOpen && (
                            <div className="ribbon-menu" style={{ right: 0, left: "auto" }}>
                                {AUTO_OPTIONS.map(o => (
                                    <button key={o.ms} onClick={() => pickAuto(o.ms)}>
                                        {autoMs === o.ms ? "✓ " : ""}{o.label}
                                    </button>
                                ))}
                                {autoMs && (
                                    <>
                                        <div className="ribbon-menu-sep" />
                                        <button onClick={() => pickAuto(null)}>Stop auto-refresh</button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                    <button className="btn" onClick={onHide} title="Hide this panel">✕</button>
                </div>
            </div>
            {error && <p className="wizard-error" style={{ margin: "0 10px" }}>{error}</p>}
            <div className="debug-panel-body">
                {!log.length && !error && <p className="empty-state" style={{ margin: "0 10px" }}>Nothing fetched yet.</p>}
                {!!log.length && log.join("\n")}
            </div>
        </div>
    );
}
