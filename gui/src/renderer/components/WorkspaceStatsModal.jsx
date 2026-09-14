import React, { useEffect, useState } from "react";
import { StatsSections, QualityBadge } from "./StatsPanel.jsx";

function basename(p) {
    return p.split(/[\\/]/).pop();
}

function fmtMoney(n, currency) {
    if (n == null) return "—";
    return "$" + n.toFixed(4) + (currency && currency !== "USD" ? " " + currency : "");
}

// Dashboard-only ("⋯" menu on a LauncherView workspace card) — works for a workspace that isn't
// currently open, since it reads each pal folder's on-disk telemetry directly rather than
// depending on a live console session (see palStatsWorkflow.js's statsForWorkspace).
export default function WorkspaceStatsModal({ workspace, onClose }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [expanded, setExpanded] = useState(null);

    useEffect(() => {
        window.palsyncGui.fetchWorkspaceStats(workspace.filePath).then(res => {
            if (res.error) { setError(res.error); return; }
            setData(res.result);
        });
    }, [workspace.filePath]);

    return (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <h3>Workspace Stats — {workspace.name}</h3>

                {error && <p className="wizard-error">{error}</p>}
                {!data && !error && <p className="empty-state">Loading…</p>}

                {data && (
                    <>
                        <p style={{ fontSize: 13, margin: "0 0 10px" }}>
                            Total (exact-cost pals only): {fmtMoney(data.totals.cost, data.totals.currency)}
                            {data.totals.excludedFromCost > 0 && (
                                <span style={{ color: "var(--muted)" }}>
                                    {" "}— {data.totals.excludedFromCost} pal(s) excluded (cost not available)
                                </span>
                            )}
                            {data.totals.toolCalls != null && <span> · {data.totals.toolCalls.toLocaleString()} tool calls</span>}
                        </p>

                        {data.pals.length === 0 && <p className="empty-state">No pals in this workspace.</p>}

                        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "55vh", overflowY: "auto" }}>
                            {data.pals.map(({ pal, stats, error: palError }) => (
                                <div key={pal.path} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 8 }}>
                                    <div
                                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: palError ? "default" : "pointer" }}
                                        onClick={() => !palError && setExpanded(v => (v === pal.path ? null : pal.path))}
                                    >
                                        <span style={{ fontSize: 13, fontWeight: 600 }}>{pal.name || basename(pal.path)}</span>
                                        {!palError && stats && (
                                            <span style={{ fontSize: 12 }}>
                                                {fmtMoney(stats.model.available ? stats.model.cost : null, stats.model.currency)}
                                                <QualityBadge quality={stats.model.quality} />
                                            </span>
                                        )}
                                    </div>
                                    {palError && <p className="wizard-error" style={{ margin: "4px 0 0" }}>{palError}</p>}
                                    {!palError && expanded === pal.path && (
                                        <div style={{ marginTop: 8 }}>
                                            <StatsSections stats={stats} />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </>
                )}

                <div className="modal-actions">
                    <button className="btn" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}
