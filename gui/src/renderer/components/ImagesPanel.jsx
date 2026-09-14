import React, { useEffect, useState } from "react";

function fmtBytes(n) {
    if (n == null) return "—";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
}

const TABS = [
    { id: "images", label: "Pal Images" },
    { id: "assets", label: "Assets" }
];

// Two independent listings for one pal (see imagesPanel.js's own header for why these are
// separate folders, not one): the pal's own shipped /images (alphabetical — these are the real
// pushed assets, there's no "recently generated" framing for them) and staged /assets
// (most-recent-first, per David's ask 2026-09-14 — where a generated/downloaded image not yet
// turned into a real pal Image entry belongs, per the shared contract doc's "Creating new files"
// convention).
export default function ImagesPanel({ pal, onHide }) {
    const [tab, setTab] = useState("images");
    const [byTab, setByTab] = useState({ images: null, assets: null });
    const [error, setError] = useState(null);
    const [fetching, setFetching] = useState(false);
    const [lightbox, setLightbox] = useState(null); // the clicked image's entry, or null

    async function fetchTab(kind) {
        setFetching(true);
        setError(null);
        try {
            const res = await window.palsyncGui.listImages(pal.path, kind);
            if (res.error) { setError(res.error); return; }
            setByTab(prev => Object.assign({}, prev, { [kind]: res.result }));
        } finally {
            setFetching(false);
        }
    }

    // Load each tab lazily, once, the first time it's actually viewed — not both up front.
    useEffect(() => {
        if (byTab[tab] == null) fetchTab(tab);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, pal.path]);

    const list = byTab[tab];

    return (
        <div className="debug-panel">
            <div className="debug-panel-header">
                <span className="debug-panel-title">Images — {pal.name}</span>
                <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn" onClick={() => fetchTab(tab)} disabled={fetching}>
                        {fetching ? "Refreshing…" : "Refresh"}
                    </button>
                    <button className="btn" onClick={onHide} title="Hide this panel">✕</button>
                </div>
            </div>
            <div style={{ display: "flex", gap: 6, padding: "8px 10px 0" }}>
                {TABS.map(t => (
                    <button
                        key={t.id}
                        className={"btn" + (tab === t.id ? " btn-primary" : "")}
                        onClick={() => setTab(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            {error && <p className="wizard-error" style={{ margin: "8px 10px 0" }}>{error}</p>}
            <div className="debug-panel-body">
                {list == null && !error && <p className="empty-state" style={{ margin: "0 10px" }}>Loading…</p>}
                {list && list.length === 0 && (
                    <p className="empty-state" style={{ margin: "0 10px" }}>
                        {tab === "images" ? "No images in this pal's /images folder yet." : "No staged assets in /assets yet."}
                    </p>
                )}
                {list && list.length > 0 && (
                    <div style={{
                        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
                        gap: 10, padding: "10px"
                    }}>
                        {list.map(img => (
                            <button
                                key={img.name}
                                onClick={() => setLightbox(img)}
                                title={img.name + " — " + fmtBytes(img.size)}
                                style={{
                                    display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                                    background: "var(--surface)", border: "1px solid var(--border)",
                                    borderRadius: 6, padding: 6, cursor: "pointer"
                                }}
                            >
                                <img
                                    src={img.dataUri}
                                    alt={img.name}
                                    style={{ width: "100%", height: 72, objectFit: "contain", background: "var(--bg, #0b0c0e)" }}
                                />
                                <span style={{
                                    fontSize: 10, color: "var(--text)", width: "100%",
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                                }}>
                                    {img.name}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>
            {lightbox && (
                <div className="modal-backdrop" onClick={() => setLightbox(null)}>
                    <div className="modal wide" onClick={e => e.stopPropagation()} style={{ textAlign: "center" }}>
                        <h3 style={{ marginTop: 0 }}>{lightbox.name}</h3>
                        <img src={lightbox.dataUri} alt={lightbox.name} style={{ maxWidth: "100%", maxHeight: "70vh" }} />
                        <p className="dep-hint">{fmtBytes(lightbox.size)} — {new Date(lightbox.mtimeMs).toLocaleString()}</p>
                        <div className="modal-actions">
                            <button className="btn" onClick={() => window.palsyncGui.openExternal("file://" + lightbox.path.replace(/\\/g, "/"))}>
                                Open in default viewer
                            </button>
                            <button className="btn btn-primary" onClick={() => setLightbox(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
