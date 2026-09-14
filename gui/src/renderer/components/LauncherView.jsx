import React, { useEffect, useRef, useState } from "react";
import ManageCloudsModal from "./ManageCloudsModal.jsx";
import ManageWorkspaceModal from "./ManageWorkspaceModal.jsx";
import WorkspaceStatsModal from "./WorkspaceStatsModal.jsx";

function basename(path) {
    return path.split(/[\\/]/).pop();
}

export default function LauncherView({ onOpened }) {
    const [recent, setRecent] = useState([]);
    const [showNameModal, setShowNameModal] = useState(false);
    const [nameInput, setNameInput] = useState("New Workspace");
    const [expandedPaths, setExpandedPaths] = useState(new Set());
    const [showManageClouds, setShowManageClouds] = useState(false);
    const [updateInfo, setUpdateInfo] = useState(null);
    const [updateDismissed, setUpdateDismissed] = useState(false);
    const [manageTarget, setManageTarget] = useState(null);
    const [statsTarget, setStatsTarget] = useState(null);
    const [cardMenuOpen, setCardMenuOpen] = useState(null); // filePath of the open "⋯" menu, or null
    const cardMenuRef = useRef(null);

    useEffect(() => {
        if (!cardMenuOpen) return;
        const onDown = (e) => { if (cardMenuRef.current && !cardMenuRef.current.contains(e.target)) setCardMenuOpen(null); };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [cardMenuOpen]);

    function togglePath(e, filePath) {
        e.stopPropagation();
        setExpandedPaths(prev => {
            const next = new Set(prev);
            if (next.has(filePath)) next.delete(filePath); else next.add(filePath);
            return next;
        });
    }

    useEffect(() => {
        window.palsyncGui.listRecentWorkspaces().then(setRecent);
        window.palsyncGui.checkVersion().then(setUpdateInfo);
    }, []);

    async function openRecent(filePath) {
        const result = await window.palsyncGui.openWorkspace(filePath);
        onOpened(result);
    }

    async function openPicked() {
        const result = await window.palsyncGui.openWorkspace(null);
        onOpened(result);
    }

    async function confirmCreateNew() {
        const name = nameInput.trim() || "New Workspace";
        setShowNameModal(false);
        const result = await window.palsyncGui.newWorkspace(name);
        onOpened(result);
    }

    return (
        <div className="panel">
            {updateInfo && !updateDismissed && (
                <div className="update-banner">
                    <span>New version available: <b>{updateInfo.remoteVersion}</b> (you have {updateInfo.localVersion})</span>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn btn-primary" onClick={() => window.palsyncGui.openExternal(updateInfo.downloadUrl)}>
                            Download
                        </button>
                        <button className="btn" onClick={() => setUpdateDismissed(true)}>Dismiss</button>
                    </div>
                </div>
            )}
            <div className="launcher-head">
                <div>
                    <h1>Recent workspaces</h1>
                    <p>Pick up where you left off, or start a new one.</p>
                </div>
                <div className="launcher-actions">
                    <button className="btn" onClick={() => setShowManageClouds(true)}>Manage Clouds…</button>
                    <button className="btn" onClick={openPicked}>Open Workspace…</button>
                    <button className="btn btn-primary" onClick={() => { setNameInput("New Workspace"); setShowNameModal(true); }}>＋ New Workspace</button>
                </div>
            </div>

            {recent.length === 0 && <p className="empty-state">No workspaces yet — create one to get started.</p>}

            <div className="ws-grid">
                {recent.map(w => (
                    <button key={w.filePath} className="ws-card" onClick={() => openRecent(w.filePath)}>
                        <span
                            ref={cardMenuOpen === w.filePath ? cardMenuRef : null}
                            style={{ position: "absolute", top: 6, right: 6 }}
                        >
                            <span
                                className="ws-card-menu"
                                style={{ position: "static" }}
                                title="Workspace options"
                                onClick={e => { e.stopPropagation(); setCardMenuOpen(v => (v === w.filePath ? null : w.filePath)); }}
                            >
                                ⋯
                            </span>
                            {cardMenuOpen === w.filePath && (
                                <div className="ribbon-menu" style={{ right: 0, left: "auto" }} onClick={e => e.stopPropagation()}>
                                    <button onClick={() => { setCardMenuOpen(null); setStatsTarget(w); }}>Workspace Stats</button>
                                    <button onClick={() => { setCardMenuOpen(null); setManageTarget(w); }}>Manage…</button>
                                </div>
                            )}
                        </span>
                        <span className="ws-card-name">{w.name}</span>
                        <span
                            className={"ws-card-path" + (expandedPaths.has(w.filePath) ? " expanded" : "")}
                            title={expandedPaths.has(w.filePath) ? "Click to collapse" : "Click to see full path"}
                            onClick={e => togglePath(e, w.filePath)}
                        >
                            {expandedPaths.has(w.filePath) ? w.filePath : basename(w.filePath)}
                        </span>
                    </button>
                ))}
            </div>

            {showNameModal && (
                <div
                    className="modal-backdrop"
                    onMouseDown={e => { if (e.target === e.currentTarget) setShowNameModal(false); }}
                >
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <h3>Name your workspace</h3>
                        <input
                            autoFocus
                            value={nameInput}
                            onChange={e => setNameInput(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") confirmCreateNew(); if (e.key === "Escape") setShowNameModal(false); }}
                        />
                        <div className="modal-actions">
                            <button className="btn" onClick={() => setShowNameModal(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={confirmCreateNew}>Create</button>
                        </div>
                    </div>
                </div>
            )}

            {showManageClouds && <ManageCloudsModal onClose={() => setShowManageClouds(false)} />}

            {manageTarget && (
                <ManageWorkspaceModal
                    workspace={manageTarget}
                    onClose={() => setManageTarget(null)}
                    onChanged={updatedRecent => { setRecent(updatedRecent); setManageTarget(null); }}
                />
            )}

            {statsTarget && (
                <WorkspaceStatsModal workspace={statsTarget} onClose={() => setStatsTarget(null)} />
            )}
        </div>
    );
}
