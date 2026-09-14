import React, { useEffect, useState } from "react";

// pal_stats telemetry, rendered the same way for a single pal (this panel) and for the
// workspace rollup (WorkspaceStatsModal.jsx) — both read the identical structured object from
// palsync's src/core/sessionStats.js (buildSessionStats), the same core behind the pal_stats MCP
// tool and `palsync stats` CLI, so the numbers and quality labels here always match what an
// agent would see.
const QUALITY_COLOR = {
    exact: "var(--success)",
    measured: "var(--success)",
    estimated: "var(--warning, #c08a2e)",
    unavailable: "var(--muted)"
};

export function QualityBadge({ quality }) {
    if (!quality) return null;
    return (
        <span style={{
            fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3,
            color: QUALITY_COLOR[quality] || "var(--muted)", border: "1px solid currentColor",
            borderRadius: 4, padding: "1px 5px", marginLeft: 6
        }}>
            {quality}
        </span>
    );
}

function fmtBytes(n) {
    if (n == null) return "—";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
}

function fmtMoney(n, currency) {
    if (n == null) return "—";
    return "$" + n.toFixed(4) + (currency && currency !== "USD" ? " " + currency : "");
}

function fmtNum(n) {
    return n == null ? "—" : n.toLocaleString();
}

function Row({ label, children }) {
    return (
        <tr>
            <td style={{ padding: "2px 8px 2px 0", color: "var(--muted)", whiteSpace: "nowrap" }}>{label}</td>
            <td style={{ padding: "2px 0" }}>{children}</td>
        </tr>
    );
}

function ModelPhaseRow({ label, phase }) {
    if (!phase) return <Row label={label}>not available</Row>;
    return (
        <Row label={label}>
            in {fmtNum(phase.input)} / out {fmtNum(phase.output)} / cache read {fmtNum(phase.cacheRead)} — {fmtMoney(phase.cost, null)}
        </Row>
    );
}

export function CostSummary({ model }) {
    if (!model) return null;
    return (
        <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
            Cost: {model.available ? fmtMoney(model.cost, model.currency) : "not available"}
            <QualityBadge quality={model.quality} />
            {model.available && model.cost == null && (
                <span style={{ fontWeight: 400, color: "var(--muted)" }}>
                    {" "}— {model.costReason || "no billing reported for this source"}
                </span>
            )}
        </p>
    );
}

export function StatsSections({ stats }) {
    if (!stats) return null;
    const { model, tools, context } = stats;
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <CostSummary model={model} />
            <section>
                <div style={{ fontWeight: 600, fontSize: 12 }}>
                    Model usage <QualityBadge quality={model.quality} />
                </div>
                {!model.available && <p className="empty-state" style={{ margin: "4px 0" }}>{model.reason}</p>}
                {model.available && (
                    <table style={{ fontSize: 12, borderCollapse: "collapse", marginTop: 4 }}>
                        <tbody>
                            <Row label="Session (live)">
                                {fmtNum(model.total)} tokens — {fmtMoney(model.cost, model.currency)}
                            </Row>
                            <ModelPhaseRow label="Build phase" phase={model.phases && model.phases.build} />
                            <ModelPhaseRow label="Review phase" phase={model.phases && model.phases.review} />
                            <Row label="Scope">{model.scope}</Row>
                        </tbody>
                    </table>
                )}
            </section>

            <section>
                <div style={{ fontWeight: 600, fontSize: 12 }}>
                    PalSync tool calls <QualityBadge quality={tools.quality} />
                </div>
                {!tools.available && <p className="empty-state" style={{ margin: "4px 0" }}>{tools.reason}</p>}
                {tools.available && (
                    <table style={{ fontSize: 12, borderCollapse: "collapse", marginTop: 4 }}>
                        <tbody>
                            <Row label="Calls">{fmtNum(tools.calls)} ({fmtNum(tools.errors)} errors)</Row>
                            <Row label="Bytes">{fmtBytes(tools.rawBytes)} raw → {fmtBytes(tools.returnedBytes)} returned</Row>
                            <Row label="Est. tokens">{fmtNum(tools.estimatedTokens)}</Row>
                        </tbody>
                    </table>
                )}
            </section>

            <section>
                <div style={{ fontWeight: 600, fontSize: 12 }}>
                    Context <QualityBadge quality={context.quality} />
                </div>
                {!context.available && <p className="empty-state" style={{ margin: "4px 0" }}>{context.reason}</p>}
                {context.available && (
                    <table style={{ fontSize: 12, borderCollapse: "collapse", marginTop: 4 }}>
                        <tbody>
                            <Row label="Eager bytes">{fmtBytes(context.eagerBytes)} (~{fmtNum(context.estimatedEagerTokens)} tokens)</Row>
                            <Row label="Stable prefix">{context.stablePercent != null ? context.stablePercent.toFixed(0) + "%" : "—"}</Row>
                            <Row label="Generations">{fmtNum(context.generations)}</Row>
                        </tbody>
                    </table>
                )}
            </section>
        </div>
    );
}

export default function StatsPanel({ pal, onHide }) {
    const [stats, setStats] = useState(null);
    const [error, setError] = useState(null);
    const [fetching, setFetching] = useState(false);

    async function fetchNow() {
        setFetching(true);
        setError(null);
        try {
            const res = await window.palsyncGui.fetchPalStats(pal.path);
            if (res.error) { setError(res.error); return; }
            setStats(res.result);
        } finally {
            setFetching(false);
        }
    }

    useEffect(() => { fetchNow(); }, [pal.path]);

    return (
        <div className="debug-panel">
            <div className="debug-panel-header">
                <span className="debug-panel-title">Stats — {pal.name}</span>
                <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn" onClick={fetchNow} disabled={fetching}>
                        {fetching ? "Refreshing…" : "Refresh"}
                    </button>
                    <button className="btn" onClick={onHide} title="Hide this panel">✕</button>
                </div>
            </div>
            {error && <p className="wizard-error" style={{ margin: "0 10px" }}>{error}</p>}
            <div className="debug-panel-body">
                {!stats && !error && <p className="empty-state" style={{ margin: "0 10px" }}>Loading…</p>}
                {stats && <StatsSections stats={stats} />}
            </div>
        </div>
    );
}
