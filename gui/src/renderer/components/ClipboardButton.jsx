import React, { useState } from "react";

// Two views sharing one popover, both backed by the active pal's own .clipboard/ folder:
//   "Your Clipboard" — reads the live OS clipboard for preview, Save writes it to .clipboard/.
//   "Agent's Clipboard" — the agent already writes files into .clipboard/ directly (normal file
//                          access, no special tool needed) and tells the human in the console to
//                          look; this just finds and displays whatever landed there most recently.
export default function ClipboardButton({ pal }) {
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState("mine");
    const [item, setItem] = useState(null);
    const [error, setError] = useState(null);
    const [saved, setSaved] = useState(null);

    async function loadMine() {
        setTab("mine");
        setError(null);
        setSaved(null);
        const res = await window.palsyncGui.readClipboard();
        if (res.error) setError(res.error); else setItem(res.result);
    }

    async function loadAgent() {
        setTab("agent");
        setError(null);
        setSaved(null);
        const res = await window.palsyncGui.readLatestAgentClipboardFile(pal.path);
        if (res.error) setError(res.error); else setItem(res.result);
    }

    async function openPopover() {
        setOpen(true);
        await loadMine();
    }

    async function save() {
        const res = await window.palsyncGui.saveClipboard(pal.path, item);
        if (res.error) setError(res.error); else setSaved(res.result);
    }

    function close() {
        setOpen(false);
        setItem(null);
        setSaved(null);
        setError(null);
    }

    return (
        <>
            <button
                className="btn"
                onClick={openPopover}
                disabled={!pal}
                title={pal ? "View or save clipboard content" : "Open a pal to use the clipboard bridge"}
            >
                Clipboard
            </button>
            {open && (
                <div className="modal-backdrop" onClick={close}>
                    <div className="modal wide" onClick={e => e.stopPropagation()}>
                        <h3>Clipboard</h3>
                        <div className="tabstrip" style={{ marginBottom: 12 }}>
                            <button className={"tab" + (tab === "mine" ? " active" : "")} onClick={loadMine}>Your Clipboard</button>
                            <button className={"tab" + (tab === "agent" ? " active" : "")} onClick={loadAgent}>Agent's Clipboard</button>
                        </div>

                        {error && <p className="error">{error}</p>}

                        {!error && item && item.type === "text" && (
                            <pre className="clipboard-preview-text">{item.text}</pre>
                        )}
                        {!error && item && item.type === "image" && (
                            <img className="clipboard-preview-image" src={item.dataUri} alt="Clipboard content" />
                        )}
                        {!error && item && item.type === "empty" && (
                            <p className="hint">
                                {tab === "mine" ? "Clipboard is empty." : "No files in this pal's .clipboard/ folder yet."}
                            </p>
                        )}
                        {item && item.fileName && <p className="hint">From .clipboard/{item.fileName}</p>}
                        {saved && <p className="hint">Saved as .clipboard/{saved.fileName}</p>}

                        <div className="modal-actions">
                            <button className="btn" onClick={close}>Close</button>
                            {tab === "mine" && item && item.type !== "empty" && !saved && (
                                <button className="btn btn-primary" onClick={save}>Save to Project</button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
