import React, { useEffect, useState } from "react";

function Group({ title, question, options, value, onPick }) {
    return (
        <div className="dep-section">
            <h4 className="dep-section-title">{title}</h4>
            <p className="dep-hint">{question}</p>
            <div className="wizard-list">
                {options.map(o => (
                    <button
                        key={o.value}
                        className={"setting-option" + (o.value === value ? " selected" : "")}
                        onClick={() => onPick(o.value)}
                    >
                        <span className="setting-option-label">{o.label}</span>
                        <span className="dep-hint">{o.help}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

export default function SettingsModal({ onClose }) {
    const [settings, setSettings] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        window.palsyncGui.describeSettings().then(setSettings);
    }, []);

    // Each pick is persisted to ~/.palsync/config.json right away, exactly like `palsync settings`,
    // so the next PalSync session picks it up. There is no Save button to forget.
    async function pick(key, value) {
        const result = await window.palsyncGui.updateSetting(key, value);
        setError(result.ok ? null : result.error);
        setSettings(prev => Object.assign({}, prev, { current: result.current }));
    }

    if (!settings) return null;

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                <h3>PalSync Settings</h3>
                <Group
                    title="Verification"
                    question="How much should PalSync check your work?"
                    options={settings.verification}
                    value={settings.current.verification}
                    onPick={v => pick("verification", v)}
                />
                <Group
                    title="Final review"
                    question="Run a final review when the work is done?"
                    options={settings.review}
                    value={settings.current.review}
                    onPick={v => pick("review", v)}
                />
                {error && <p className="wizard-error">{error}</p>}
                <p className="dep-hint">
                    Saved for every pal and shared with the palsync command line.
                </p>
                <div className="modal-actions">
                    <button className="btn btn-primary" onClick={onClose}>Done</button>
                </div>
            </div>
        </div>
    );
}
