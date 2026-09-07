import React, { useEffect, useState } from "react";
import AddPalPopover from "./AddPalPopover.jsx";
import ConsoleTab from "./ConsoleTab.jsx";

// The folder name (not the server-side pal name) disambiguates multi-checkout tabs — two tabs
// for the same pal ("Fred", "Fred (2)") share pal.name but never share a folder.
function tabLabel(pal) {
    return pal.path.split(/[\\/]/).pop();
}

export default function WorkspaceView({ workspace, onWorkspaceChange }) {
    const [activeIndex, setActiveIndex] = useState(workspace.activeTabIndex || 0);
    const [addOpen, setAddOpen] = useState(false);
    const [agents, setAgents] = useState([]);
    const [pendingRemove, setPendingRemove] = useState(null);

    useEffect(() => {
        window.palsyncGui.listAgents().then(setAgents);
    }, []);

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
        setActiveIndex(result.workspace.activeTabIndex || 0);
    }

    const pals = workspace.pals || [];

    return (
        <>
            <div className="tabstrip">
                {pals.map((pal, i) => (
                    <button
                        key={pal.path}
                        className={"tab" + (i === activeIndex ? " active" : "")}
                        onClick={() => setActiveIndex(i)}
                    >
                        <span className="dot" /> {tabLabel(pal)}
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

                <div className="term-frame">
                    {pals.length === 0 && (
                        <div className="term-placeholder">Add a pal to get started.</div>
                    )}
                    {pals.map((pal, i) => (
                        <div key={pal.path} style={{ display: i === activeIndex ? "flex" : "none", flex: 1, minHeight: 0 }}>
                            <ConsoleTab pal={pal} agents={agents} active={i === activeIndex} onAgentChosen={agentId => persistAgent(pal, agentId)} />
                        </div>
                    ))}
                </div>
            </div>

            {pendingRemove && (
                <div className="modal-backdrop" onClick={() => setPendingRemove(null)}>
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
