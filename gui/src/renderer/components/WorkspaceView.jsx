import React, { useEffect, useState } from "react";
import AddPalPopover from "./AddPalPopover.jsx";
import ConsoleTab from "./ConsoleTab.jsx";
import PalDashboard from "./PalDashboard.jsx";

// The folder name (not the server-side pal name) disambiguates multi-checkout tabs — two tabs
// for the same pal ("Fred", "Fred (2)") share pal.name but never share a folder.
function tabLabel(pal) {
    return pal.path.split(/[\\/]/).pop();
}

// activeIndex === DASHBOARD means the Dashboard tab (only exists when the workspace has 2+ pals).
const DASHBOARD = -1;

export default function WorkspaceView({ workspace, onWorkspaceChange, onActivePalChange }) {
    // Multi-pal workspaces open on the Dashboard so no pal's agent/MCP starts until it's chosen.
    const [activeIndex, setActiveIndex] = useState(
        (workspace.pals || []).length > 1 ? DASHBOARD : (workspace.activeTabIndex || 0));
    const [addOpen, setAddOpen] = useState(false);
    const [agents, setAgents] = useState([]);
    const [pendingRemove, setPendingRemove] = useState(null);
    // Keyed by pal.path (stable across a pal's lifetime, unlike its index in `pals`). Each
    // ConsoleTab reports its own pty running state here so the tab strip can color its dot
    // without WorkspaceView polling the main process itself.
    const [runningByPath, setRunningByPath] = useState({});

    useEffect(() => {
        window.palsyncGui.listAgents().then(setAgents);
    }, []);

    const pals = workspace.pals || [];
    const hasDashboard = pals.length > 1;
    // Removing pals down to one drops the Dashboard tab; fall back to the remaining pal.
    const current = activeIndex === DASHBOARD && !hasDashboard ? 0 : activeIndex;

    useEffect(() => {
        if (onActivePalChange) onActivePalChange(pals[current] || null);
    }, [current, pals]);

    function handleAdded(result) {
        onWorkspaceChange(result.workspace);
        setActiveIndex(result.workspace.pals.length - 1);
        setAddOpen(false);
    }

    async function persistAgent(pal, agentId) {
        const result = await window.palsyncGui.setPalAgent(pal.path, agentId);
        if (!result.error) onWorkspaceChange(result.workspace);
    }

    async function confirmRemove() {
        const pal = pendingRemove;
        setPendingRemove(null);
        const result = await window.palsyncGui.removePalFromWorkspace(pal.path);
        if (result.error) return;
        onWorkspaceChange(result.workspace);
        // Stay on the Dashboard if that's where the removal was triggered from.
        if (current !== DASHBOARD) setActiveIndex(result.workspace.activeTabIndex || 0);
    }

    return (
        <>
            <div className="tabstrip">
                {hasDashboard && (
                    <button className={"tab" + (current === DASHBOARD ? " active" : "")} onClick={() => setActiveIndex(DASHBOARD)}>
                        Dashboard
                    </button>
                )}
                {pals.map((pal, i) => (
                    <button
                        key={pal.path}
                        className={"tab" + (i === current ? " active" : "")}
                        onClick={() => setActiveIndex(i)}
                    >
                        <span className={"dot" + (runningByPath[pal.path] ? " running" : "")} /> {tabLabel(pal)}
                        {pal.agentId && <span className="agent"> · {pal.agentId}</span>}
                        <span
                            className="close"
                            title="Remove from workspace"
                            onClick={e => { e.stopPropagation(); setPendingRemove(pal); }}
                        >
                            ×
                        </span>
                    </button>
                ))}
                <button className="tab-add" title="Add pal" onClick={() => setAddOpen(v => !v)}>＋</button>
            </div>

            <div className="workspace-body">
                {addOpen && <AddPalPopover onAdded={handleAdded} onClose={() => setAddOpen(false)} />}

                {hasDashboard && current === DASHBOARD && (
                    <PalDashboard pals={pals} runningByPath={runningByPath} tabLabel={tabLabel} onOpen={setActiveIndex} />
                )}

                {/* Stays mounted (just hidden) on the Dashboard so running agents keep their terminals. */}
                <div className="term-frame" style={current === DASHBOARD ? { display: "none" } : undefined}>
                    {pals.length === 0 && (
                        <div className="term-placeholder">Add a pal to get started.</div>
                    )}
                    {pals.map((pal, i) => (
                        <div key={pal.path} style={{ display: i === current ? "flex" : "none", flex: 1, minHeight: 0 }}>
                            <ConsoleTab pal={pal} agents={agents} active={i === current} onAgentChosen={agentId => persistAgent(pal, agentId)}
                                onRunningChange={running => setRunningByPath(prev => (prev[pal.path] === running ? prev : { ...prev, [pal.path]: running }))} />
                        </div>
                    ))}
                </div>
            </div>

            {pendingRemove && (
                <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setPendingRemove(null); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <h3>Remove "{tabLabel(pendingRemove)}" from this workspace?</h3>
                        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
                            This only removes the tab — it does not delete the local folder
                            ({pendingRemove.path}) or anything on the server. Any running agent
                            for it will be stopped.
                        </p>
                        <div className="modal-actions">
                            <button className="btn" onClick={() => setPendingRemove(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={confirmRemove}>Remove</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
