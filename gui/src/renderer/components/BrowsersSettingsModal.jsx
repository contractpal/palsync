import React, { useEffect, useState } from "react";

const EMPTY_FORM = { description: "", execPath: "", argsTemplate: "${URL}" };

// Global "Browsers" registry (File → Browsers…) — mirrors the Java PalBuilder IDE's
// BrowserDialog/LocalConfigurationDialog "Browsers" tab: a list of executables, one marked
// default, add/edit/delete, "${URL}" placeholder convention for extra launch args/flags.
export default function BrowsersSettingsModal({ onClose }) {
    const [browsers, setBrowsers] = useState([]);
    const [defaultId, setDefaultId] = useState(null);
    const [error, setError] = useState(null);
    const [editingId, setEditingId] = useState(null); // null = list view, "new" = add form, else editing that id
    const [form, setForm] = useState(EMPTY_FORM);
    const [pendingDelete, setPendingDelete] = useState(null);

    function refresh() {
        return window.palsyncGui.browsers.list().then(reg => {
            setBrowsers(reg.browsers || []);
            setDefaultId(reg.defaultId || null);
        });
    }

    useEffect(() => { refresh(); }, []);

    function startAdd() {
        setForm(EMPTY_FORM);
        setError(null);
        setEditingId("new");
    }

    function startEdit(b) {
        setForm({ description: b.description, execPath: b.execPath, argsTemplate: b.argsTemplate || "${URL}" });
        setError(null);
        setEditingId(b.id);
    }

    async function browse() {
        const chosen = await window.palsyncGui.browsers.chooseExecutable();
        if (chosen) setForm(f => Object.assign({}, f, { execPath: chosen }));
    }

    async function save() {
        if (!form.description.trim() || !form.execPath.trim()) return;
        setError(null);
        const payload = { description: form.description.trim(), execPath: form.execPath.trim(), argsTemplate: form.argsTemplate.trim() || "${URL}" };
        const result = editingId === "new"
            ? await window.palsyncGui.browsers.add(payload)
            : await window.palsyncGui.browsers.update(editingId, payload);
        if (result.error) { setError(result.error); return; }
        setEditingId(null);
        await refresh();
    }

    async function confirmDelete() {
        const b = pendingDelete;
        setPendingDelete(null);
        const result = await window.palsyncGui.browsers.remove(b.id);
        if (result.error) { setError(result.error); return; }
        await refresh();
    }

    async function makeDefault(b) {
        const result = await window.palsyncGui.browsers.setDefault(b.id);
        if (result.error) { setError(result.error); return; }
        await refresh();
    }

    return (
        <div className="modal-backdrop" onClick={() => !pendingDelete && onClose()}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <h3>Browsers</h3>
                {error && <p className="wizard-error">{error}</p>}

                {editingId === null && !pendingDelete && (
                    <>
                        <p className="dep-hint">
                            Used by each pal's ribbon (Test Web / Console / Transaction) to launch a
                            real browser executable, rather than always using the OS default.
                        </p>
                        <div className="wizard-list">
                            {browsers.map(b => (
                                <div key={b.id} className="ws-card" style={{ cursor: "default", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                                    <div style={{ minWidth: 0 }}>
                                        <div className="ws-card-name">
                                            {b.description}{b.id === defaultId && <span className="dep-recommended"> · default</span>}
                                        </div>
                                        <div className="ws-card-path" style={{ cursor: "default" }}>{b.execPath}</div>
                                    </div>
                                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                                        {b.id !== defaultId && <button className="btn" onClick={() => makeDefault(b)}>Set Default</button>}
                                        <button className="btn" onClick={() => startEdit(b)}>Edit</button>
                                        <button className="btn" onClick={() => setPendingDelete(b)}>Delete</button>
                                    </div>
                                </div>
                            ))}
                            {!browsers.length && <p className="empty-state">No browsers configured yet.</p>}
                        </div>
                        <div className="modal-actions">
                            <button className="btn" onClick={onClose}>Close</button>
                            <button className="btn btn-primary" onClick={startAdd}>＋ Add Browser</button>
                        </div>
                    </>
                )}

                {editingId !== null && !pendingDelete && (
                    <>
                        <div className="wizard-field">
                            <label>Display name</label>
                            <input
                                autoFocus
                                value={form.description}
                                onChange={e => setForm(f => Object.assign({}, f, { description: e.target.value }))}
                                placeholder="e.g. Chrome (Incognito)"
                            />
                        </div>
                        <div className="wizard-field">
                            <label>Browser executable</label>
                            <div style={{ display: "flex", gap: 6 }}>
                                <input
                                    style={{ flex: 1 }}
                                    value={form.execPath}
                                    onChange={e => setForm(f => Object.assign({}, f, { execPath: e.target.value }))}
                                    placeholder="C:\Program Files\Google\Chrome\Application\chrome.exe"
                                />
                                <button className="btn" onClick={browse}>Browse…</button>
                            </div>
                        </div>
                        <div className="wizard-field">
                            <label>Extra arguments (optional — use ${"${URL}"} as a placeholder for the URL)</label>
                            <input
                                value={form.argsTemplate}
                                onChange={e => setForm(f => Object.assign({}, f, { argsTemplate: e.target.value }))}
                                placeholder="${URL}"
                            />
                        </div>
                        <div className="modal-actions">
                            <button className="btn" onClick={() => setEditingId(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={save} disabled={!form.description.trim() || !form.execPath.trim()}>Save</button>
                        </div>
                    </>
                )}

                {pendingDelete && (
                    <>
                        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
                            Remove <b>{pendingDelete.description}</b> from the browser list?
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
