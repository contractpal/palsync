import React, { useState } from "react";
import CreatePalWizard from "./CreatePalWizard.jsx";
import OpenFromCloudWizard from "./OpenFromCloudWizard.jsx";

export default function AddPalPopover({ onAdded, onClose }) {
    const [error, setError] = useState(null);
    const [showCreateWizard, setShowCreateWizard] = useState(false);
    const [showOpenWizard, setShowOpenWizard] = useState(false);

    async function addExistingFolder() {
        setError(null);
        const folder = await window.palsyncGui.chooseFolder();
        if (!folder) return;
        const result = await window.palsyncGui.addPalFromFolder(folder);
        if (result.error) { setError(result.error); return; }
        onAdded(result);
    }

    function handleCreated(result) {
        setShowCreateWizard(false);
        onAdded(result);
    }

    function handleOpened(result) {
        setShowOpenWizard(false);
        onAdded(result);
    }

    return (
        <div className="add-pal">
            <h3>Add a pal to this workspace</h3>
            <p className="hint">Opens as a new tab with its own agent console.</p>
            {error && <p className="error">{error}</p>}
            <div className="add-options">
                <button className="add-option" onClick={addExistingFolder}>
                    <span className="label">Existing folder</span>
                    <span className="desc">Point at a pal project already on disk.</span>
                </button>
                <button className="add-option" onClick={() => setShowCreateWizard(true)}>
                    <span className="label">Create new pal</span>
                    <span className="desc">Start a fresh pal on CloudPiston, then work it locally.</span>
                </button>
                <button className="add-option" onClick={() => setShowOpenWizard(true)}>
                    <span className="label">Open from cloud</span>
                    <span className="desc">Pull an existing pal down locally.</span>
                </button>
            </div>

            {showCreateWizard && (
                <CreatePalWizard onCreated={handleCreated} onClose={() => setShowCreateWizard(false)} />
            )}
            {showOpenWizard && (
                <OpenFromCloudWizard onOpened={handleOpened} onClose={() => setShowOpenWizard(false)} />
            )}
        </div>
    );
}
