import React, { useEffect, useState } from "react";

function formatModified(value) {
    if (value == null || value === "") return "—";
    const d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function cloudLabel(summary) {
    if (!summary) return "…";
    if (summary.cloudName) return summary.cloudName;
    if (!summary.cloudUrl) return "—";
    try { return new URL(summary.cloudUrl).host; } catch (e) { return summary.cloudUrl; }
}

// Landing view for multi-pal workspaces: lets you pick a pal without launching any agent/MCP
// process (a pal's agent only starts the first time its own tab becomes active).
export default function PalDashboard({ pals, runningByPath, tabLabel, onOpen }) {
    const [summaries, setSummaries] = useState({});

    useEffect(() => {
        let cancelled = false;
        window.palsyncGui.palSummaries().then(list => {
            if (cancelled) return;
            const byPath = {};
            for (const s of list) byPath[s.path] = s;
            setSummaries(byPath);
        });
        return () => { cancelled = true; };
    }, [pals]);

    return (
        <div className="dashboard">
            <p className="dashboard-hint">Pick a pal to open it. Nothing starts until you do.</p>
            <table className="dashboard-table">
                <thead>
                    <tr><th>Pal</th><th>Cloud</th><th>Last modified</th><th>Agent</th></tr>
                </thead>
                <tbody>
                    {pals.map((pal, i) => {
                        const s = summaries[pal.path];
                        return (
                            <tr key={pal.path}>
                                <td>
                                    <button className="dashboard-link" onClick={() => onOpen(i)}>
                                        <span className={"dot" + (runningByPath[pal.path] ? " running" : "")} /> {tabLabel(pal)}
                                    </button>
                                </td>
                                <td>{cloudLabel(s)}</td>
                                <td>{s ? formatModified(s.lastModifiedDate) : "…"}</td>
                                <td>{pal.agentId || "—"}{runningByPath[pal.path] ? " (running)" : ""}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
