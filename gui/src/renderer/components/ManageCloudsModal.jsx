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
    // Test accounts: extra logins for "test login with <alias>". The password is typed here, goes
    // straight to the OS keychain via the main process, and is never read back into this window.
    const [accountsCloud, setAccountsCloud] = useState(null);
    const [accounts, setAccounts] = useState([]);
    const [acctAlias, setAcctAlias] = useState("");
    const [acctUser, setAcctUser] = useState("");
    const [acctPass, setAcctPass] = useState("");

    async function openAccounts(cloud) {
        setError(null);
        const r = await window.palsyncGui.cloud.listTestAccounts(cloud.url);
        if (r.error) { setError(r.error); return; }
        setAccounts(r.accounts || []);
        setAccountsCloud(cloud);
    }

    async function saveAccount() {
        setError(null);
        const r = await window.palsyncGui.cloud.saveTestAccount(accountsCloud.url, acctAlias, acctUser.trim(), acctPass);
        if (r.error) { setError(r.error); return; }
        setAcctAlias(""); setAcctUser(""); setAcctPass("");
        const list = await window.palsyncGui.cloud.listTestAccounts(accountsCloud.url);
        setAccounts(list.accounts || []);
    }

    async function removeAccount(alias) {
        const r = await window.palsyncGui.cloud.deleteTestAccount(accountsCloud.url, alias);
        if (r.error) { setError(r.error); return; }
        const list = await window.palsyncGui.cloud.listTestAccounts(accountsCloud.url);
        setAccounts(list.accounts || []);
    }

    const [testCounts, setTestCounts] = useState({});

    // Counts only (alias + username come back, never a password) so the button can show "(n)".
    async function loadTestCounts(list) {
        const entries = await Promise.all(list.map(async c => {
            const r = await window.palsyncGui.cloud.listTestAccounts(c.url);
            return [c.url, r && r.accounts ? r.accounts.length : 0];
        }));
        setTestCounts(Object.fromEntries(entries));
    }

    function refresh() {
        return window.palsyncGui.cloud.listClouds().then(list => { setClouds(list); loadTestCounts(list); });
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
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !pendingDelete) onClose(); }}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <h3>{accountsCloud ? "Test accounts" : "Manage clouds"}</h3>
                {error && <p className="wizard-error">{error}</p>}

                {!pendingDelete && !showAdd && !accountsCloud && (
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
                                        <button className="btn" onClick={() => openAccounts(c)}>Test accounts{testCounts[c.url] > 0 ? " (" + testCounts[c.url] + ")" : ""}</button>
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

                {accountsCloud && (
                    <>
                        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
                            Test accounts for <b>{accountsCloud.name}</b>. Say "test login with &lt;alias&gt;" and the
                            agent signs in as that account; it only ever sees the alias, never the password.
                        </p>
                        <div className="wizard-list">
                            {accounts.map(a => (
                                <div key={a.alias} className="ws-card" style={{ cursor: "default", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                                    <div style={{ minWidth: 0 }}>
                                        <div className="ws-card-name">{a.alias}</div>
                                        <div className="ws-card-path" style={{ cursor: "default" }}>{a.username}</div>
                                    </div>
                                    <button className="btn" onClick={() => removeAccount(a.alias)}>Delete</button>
                                </div>
                            ))}
                            {!accounts.length && <p className="empty-state">No test accounts yet.</p>}
                        </div>
                        <div className="wizard-field">
                            <label>Alias (e.g. Bob, Bob Admin)</label>
                            <input value={acctAlias} onChange={e => setAcctAlias(e.target.value)} />
                        </div>
                        <div className="wizard-field">
                            <label>Username</label>
                            <input value={acctUser} onChange={e => setAcctUser(e.target.value)} autoComplete="off" />
                        </div>
                        <div className="wizard-field">
                            <label>Password</label>
                            <input type="password" value={acctPass} onChange={e => setAcctPass(e.target.value)} autoComplete="new-password"
                                onKeyDown={e => { if (e.key === "Enter" && acctAlias.trim() && acctUser.trim() && acctPass) saveAccount(); }} />
                        </div>
                        <div className="modal-actions">
                            <button className="btn" onClick={() => { setAccountsCloud(null); setAcctPass(""); loadTestCounts(clouds); }}>Back</button>
                            <button className="btn btn-primary" onClick={saveAccount} disabled={!acctAlias.trim() || !acctUser.trim() || !acctPass}>Save</button>
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
