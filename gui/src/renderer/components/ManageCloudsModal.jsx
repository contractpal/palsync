import React, { useEffect, useState } from "react";

// Lists every cloud — hardcoded defaults (Cloudpiston, Nimblewire) included — since both
// renaming and deleting now work uniformly across defaults and custom clouds.
export default function ManageCloudsModal({ onClose }) {
    const [clouds, setClouds] = useState([]);
    const [pendingDelete, setPendingDelete] = useState(null);
    const [editingUrl, setEditingUrl] = useState(null);
    const [editingName, setEditingName] = useState("");
    const [error, setError] = useState(null);
    const [showAdd, setShowAdd] = useState(false);
    const [newUrl, setNewUrl] = useState("");
    const [newName, setNewName] = useState("");

    function refresh() {
        return window.palsyncGui.cloud.listClouds().then(setClouds);
    }

    useEffect(() => { refresh(); }, []);

    async function confirmDelete() {
        const cloud = pendingDelete;
        setPendingDelete(null);
        const result = await window.palsyncGui.cloud.deleteCloud(cloud.url);
        if (result.error) { setError(result.error); return; }
        await refresh();
    }

    function startEdit(cloud) {
        setEditingUrl(cloud.url);
        setEditingName(cloud.name);
    }

    async function saveEdit() {
        const url = editingUrl;
        setEditingUrl(null);
        if (!editingName.trim()) return;
        const result = await window.palsyncGui.cloud.renameCloud(url, editingName.trim());
        if (result.error) { setError(result.error); return; }
        await refresh();
    }

    async function saveNewCloud() {
        const url = newUrl.trim();
        if (!url) return;
        setError(null);
        const result = await window.palsyncGui.cloud.addCloud(url, newName.trim());
        if (result.error) { setError(result.error); return; }
        setShowAdd(false);
        setNewUrl("");
        setNewName("");
        await refresh();
    }

    return (
        <div className="modal-backdrop" onClick={() => !pendingDelete && onClose()}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <h3>Manage clouds</h3>
                {error && <p className="wizard-error">{error}</p>}

                {!pendingDelete && !showAdd && (
                    <>
                        <div className="wizard-list">
                            {clouds.map(c => (
                                <div key={c.url} className="ws-card" style={{ cursor: "default", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                                    {editingUrl === c.url ? (
                                        <input
                                            autoFocus
                                            value={editingName}
                                            onChange={e => setEditingName(e.target.value)}
                                            onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingUrl(null); }}
                                            style={{ flex: 1, marginRight: 8 }}
                                        />
                                    ) : (
                                        <div style={{ minWidth: 0 }}>
                                            <div className="ws-card-name">{c.name}</div>
                                            <div className="ws-card-path" style={{ cursor: "default" }}>{c.url}</div>
                                        </div>
                                    )}
                                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                                        {editingUrl === c.url ? (
                                            <button className="btn btn-primary" onClick={saveEdit}>Save</button>
                                        ) : (
                                            <button className="btn" onClick={() => startEdit(c)}>Edit</button>
                                        )}
                                        <button className="btn" onClick={() => setPendingDelete(c)}>Delete</button>
                                    </div>
                                </div>
                            ))}
                            {!clouds.length && <p className="empty-state">No clouds yet.</p>}
                        </div>
                        <div className="modal-actions">
                            <button className="btn" onClick={onClose}>Close</button>
                            <button className="btn btn-primary" onClick={() => setShowAdd(true)}>＋ Add Cloud</button>
                        </div>
                    </>
                )}

                {showAdd && (
                    <>
                        <div className="wizard-field">
                            <label>Cloud URL</label>
                            <input
                                autoFocus
                                value={newUrl}
                                onChange={e => setNewUrl(e.target.value)}
                                placeholder="https://secure.example.com"
                                onKeyDown={e => { if (e.key === "Enter") saveNewCloud(); }}
                            />
                        </div>
                        <div className="wizard-field">
                            <label>Display name (optional — defaults to the URL's hostname)</label>
                            <input
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                placeholder="e.g. Test VM 1"
                                onKeyDown={e => { if (e.key === "Enter") saveNewCloud(); }}
                            />
                        </div>
                        <div className="modal-actions">
                            <button className="btn" onClick={() => setShowAdd(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={saveNewCloud} disabled={!newUrl.trim()}>Add</button>
                        </div>
                    </>
                )}

                {pendingDelete && (
                    <>
                        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
                            Remove <b>{pendingDelete.name}</b> ({pendingDelete.url}) and delete
                            every cached credential stored for it? This can't be undone — you'll
                            need to log in again next time you use this cloud.
                        </p>
                        <div className="modal-actions">
                            <button className="btn" onClick={() => setPendingDelete(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={confirmDelete}>Delete</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
