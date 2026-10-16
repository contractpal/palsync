import React, { useEffect, useState } from "react";

// Per-pal switch for Chip's local pre-push validation. On (default) = the push gate behaves as
// always. Off = pal_push sends the pal anyway and the server alone validates, like PalBuilder.
// The setting is stored by palsync (~/.palsync/config.json, keyed by pal GUID) and read by the
// agent's pal_push on every push, so it takes effect immediately without restarting the agent.
export default function ValidationToggle({ pal }) {
    const palGuid = pal && pal.cloudPalId;
    const [enabled, setEnabled] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let live = true;
        setError(null);
        if (!palGuid) { setEnabled(true); return undefined; }
        window.palsyncGui.getValidationEnabled(palGuid).then(res => { if (live) setEnabled(res.enabled); });
        return () => { live = false; };
    }, [palGuid]);

    async function onChange(e) {
        const next = e.target.checked;
        setEnabled(next);
        const res = await window.palsyncGui.setValidationEnabled(palGuid, next);
        setEnabled(res.enabled);
        setError(res.ok ? null : "Could not save this setting");
    }

    const title = !palGuid
        ? "Open a pal to change its validation"
        : enabled
            ? "Validation is on: pushes are checked locally and blocked on errors. Turn off to push anyway and let the server validate."
            : "Validation is off: pushes skip the local check. The server still validates.";

    return (
        <label className={"switch-label" + (palGuid ? "" : " disabled")} title={error || title}>
            <span className="switch">
                <input type="checkbox" checked={enabled} disabled={!palGuid} onChange={onChange} />
                <span className="switch-track" />
            </span>
            <span>Validation{!enabled && <span className="switch-off-note"> off</span>}</span>
        </label>
    );
}
