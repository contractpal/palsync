import React, { useState } from "react";

// Dashboard-only ("⋯" menu on a LauncherView workspace card) — acts on a workspace that is NOT
// currently open, so unlike App.jsx's leaveWorkspace/showLeaveWarning flow there is no
// running-agent check needed before deleting.
export default function ManageWorkspaceModal({ workspace, onClose, onChanged }) {
    const [nameInput, setNameInput] = useState(workspace.name);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);

    async function save() {
        const name = nameInput.trim();
        if (!name || name === workspace.name) return onClose();
        setBusy(true);
        const result = await window.palsyncGui.renameWorkspace(workspace.filePath, name);
        setBusy(false);
        if (result.error) { setError(result.error); return; }
        onChanged(result.recent);
    }

    async function confirmDelete() {
        setBusy(true);
        const result = await window.palsyncGui.deleteWorkspace(workspace.filePath);
        setBusy(false);
        if (result.error) { setError(result.error); return; }
        onChanged(result.recent);
    }

    return (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <h3>Manage Workspace</h3>

                {!confirmingDelete && (
                    <>
                        <label className="dep-hint" htmlFor="ws-rename-input">Name</label>
                        <input
                            id="ws-rename-input"
                            autoFocus
                            value={nameInput}
                            onChange={e => setNameInput(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") onClose(); }}
                        />
                        {error && <p className="wizard-error">{error}</p>}
                        <div className="modal-actions" style={{ justifyContent: "space-between" }}>
                            <button className="btn" style={{ color: "var(--danger)" }} onClick={() => setConfirmingDelete(true)}>
                                Delete…
                            </button>
                            <div style={{ display: "flex", gap: 8 }}>
                                <button className="btn" onClick={onClose}>Cancel</button>
                                <button className="btn btn-primary" disabled={busy || !nameInput.trim()} onClick={save}>
                                    Save
                                </button>
                            </div>
                        </div>
                    </>
                )}

                {confirmingDelete && (
                    <>
                        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
                            Delete "{workspace.name}"? This removes the workspace file
                            ({workspace.filePath}) — it does not touch the local pal folders or
                            anything on the server.
                        </p>
                        {error && <p className="wizard-error">{error}</p>}
                        <div className="modal-actions">
                            <button className="btn" onClick={() => setConfirmingDelete(false)}>Back</button>
                            <button className="btn btn-primary" style={{ background: "var(--danger)", borderColor: "var(--danger)" }} disabled={busy} onClick={confirmDelete}>
                                Delete Workspace
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
