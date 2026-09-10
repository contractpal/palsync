import React, { useEffect, useState } from "react";
import CheckoutChecklist from "./CheckoutChecklist.jsx";

// Mirrors CreatePalWizard's cloud -> login -> profile steps, then diverges: a single group
// (matches the CLI's "open existing" flow, unlike create's multi-select), then a pal list to
// pick from, then pull it down via the same materialize() plumbing create-new-pal uses.
export default function OpenFromCloudWizard({ onOpened, onClose }) {
    const [step, setStep] = useState("cloud");
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);

    const [clouds, setClouds] = useState([]);
    const [newCloudUrl, setNewCloudUrl] = useState("");
    const [newCloudName, setNewCloudName] = useState("");
    const [cloudUrl, setCloudUrl] = useState(null);
    const [pendingCloudName, setPendingCloudName] = useState("");

    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");

    const [profiles, setProfiles] = useState([]);
    const [profile, setProfile] = useState(null);

    const [groups, setGroups] = useState([]);

    const [pals, setPals] = useState([]);
    const [selectedPal, setSelectedPal] = useState(null);

    const [folderConflict, setFolderConflict] = useState(null);
    const [folderNameInput, setFolderNameInput] = useState("");

    const [checklistSteps, setChecklistSteps] = useState([]);
    const [stepStates, setStepStates] = useState({});
    const [lockBlocked, setLockBlocked] = useState(null); // { blocked, holder, holderEmail, since } | null
    const [forceLockChecked, setForceLockChecked] = useState(false);
    const [lastFolderName, setLastFolderName] = useState(null);

    useEffect(() => {
        window.palsyncGui.cloud.listClouds().then(setClouds);
        window.palsyncGui.cloud.checkoutSteps().then(setChecklistSteps);
    }, []);

    useEffect(() => {
        if (step !== "opening") return;
        return window.palsyncGui.cloud.onStep(({ step: s, status }) => {
            setStepStates(prev => ({ ...prev, [s]: status === "start" ? "running" : status }));
        });
    }, [step]);

    async function pickCloud(url, cloudName) {
        setError(null);
        setCloudUrl(url);
        setPendingCloudName(cloudName || "");
        setBusy(true);
        try {
            const auto = await window.palsyncGui.cloud.tryAutoLogin(url);
            if (auto.ok) {
                setUsername(auto.username);
                await goToProfiles();
            } else {
                const cached = await window.palsyncGui.cloud.knownAccounts(url);
                if (cached.length === 1) setUsername(cached[0]);
                setStep("login");
            }
        } catch (e) {
            setError(e && e.message ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    async function addCloudAndPick() {
        const url = newCloudUrl.trim();
        if (!url) return;
        const cloudName = newCloudName.trim();
        setNewCloudUrl("");
        setNewCloudName("");
        await pickCloud(url, cloudName);
    }

    async function submitLogin() {
        setError(null);
        setBusy(true);
        try {
            const result = await window.palsyncGui.cloud.authenticate(cloudUrl, username, password, pendingCloudName);
            if (result.error) { setError(result.error); return; }
            setClouds(await window.palsyncGui.cloud.listClouds());
            await goToProfiles();
        } catch (e) {
            setError(e && e.message ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    async function goToProfiles() {
        setError(null);
        setBusy(true);
        try {
            const result = await window.palsyncGui.cloud.listProfiles();
            if (result.error) { setError(result.error); return; }
            setProfiles(result.profiles);
            setStep("profile");
        } catch (e) {
            setError(e && e.message ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    async function pickProfile(p) {
        setProfile(p);
        setError(null);
        setBusy(true);
        try {
            const result = await window.palsyncGui.cloud.listGroups(p.profileId);
            if (result.error) { setError(result.error); return; }
            setGroups(result.groups);
            setStep("groups");
        } catch (e) {
            setError(e && e.message ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    async function pickGroup(g) {
        setError(null);
        setBusy(true);
        try {
            const result = await window.palsyncGui.cloud.listPals(profile.profileId, g.groupId);
            if (result.error) { setError(result.error); return; }
            setPals(result.pals);
            setStep("pals");
        } catch (e) {
            setError(e && e.message ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    async function pickPal(p) {
        setError(null);
        setBusy(true);
        setSelectedPal(p);
        try {
            const check = await window.palsyncGui.cloud.checkFolder(p.name);
            if (check.conflict) {
                setFolderConflict(check);
                setFolderNameInput(check.suggestedName);
                setStep("folderConflict");
                return;
            }
            setLastFolderName(null);
            await doOpen(p, null);
        } catch (e) {
            setError(e && e.message ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    async function confirmFolderName() {
        setError(null);
        setLastFolderName(folderNameInput.trim());
        await doOpen(selectedPal, folderNameInput.trim());
    }

    async function retryWithForceLock() {
        setError(null);
        await doOpen(selectedPal, lastFolderName, true);
    }

    async function doOpen(pal, folderName, forceLock) {
        setBusy(true);
        setStepStates({});
        setLockBlocked(null);
        setForceLockChecked(false);
        setStep("opening");
        try {
            const result = await window.palsyncGui.cloud.openAndMaterialize({ profile, pal, agentKey: "claude", folderName, forceLock: !!forceLock });
            if (result.error) {
                setError(result.error);
                if (result.lockBlocked) setLockBlocked(result.lockBlocked);
                return;
            }
            onOpened(result);
        } catch (e) {
            setError(e && e.message ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="modal-backdrop" onClick={() => !busy && onClose()}>
            <div className="modal wide" onClick={e => e.stopPropagation()}>
                {error && <p className="wizard-error">{error}</p>}

                {step === "cloud" && (
                    <>
                        <h3>Open a pal from the cloud</h3>
                        <p className="wizard-title">Choose a cloud</p>
                        <div className="wizard-list">
                            {clouds.map(c => (
                                <button key={c.url} onClick={() => pickCloud(c.url)} disabled={busy}>
                                    {c.name} <span style={{ color: "var(--text-faint)" }}>— {c.url}</span>
                                </button>
                            ))}
                        </div>
                        <div className="wizard-field">
                            <label>Or add a custom cloud URL</label>
                            <input
                                value={newCloudUrl}
                                onChange={e => setNewCloudUrl(e.target.value)}
                                placeholder="https://secure.example.com"
                                onKeyDown={e => { if (e.key === "Enter") addCloudAndPick(); }}
                            />
                        </div>
                        <div className="wizard-field">
                            <label>Display name (optional — defaults to the URL's hostname)</label>
                            <input
                                value={newCloudName}
                                onChange={e => setNewCloudName(e.target.value)}
                                placeholder="e.g. Test VM 1"
                                onKeyDown={e => { if (e.key === "Enter") addCloudAndPick(); }}
                            />
                        </div>
                        <div className="modal-actions">
                            <button className="btn" onClick={onClose}>Cancel</button>
                            <button className="btn btn-primary" onClick={addCloudAndPick} disabled={busy || !newCloudUrl.trim()}>Continue</button>
                        </div>
                    </>
                )}

                {step === "login" && (
                    <>
                        <button className="wizard-back" onClick={() => setStep("cloud")}>← Choose a different cloud</button>
                        <h3>Log in to {cloudUrl}</h3>
                        <div className="wizard-field">
                            <label>Username</label>
                            <input value={username} onChange={e => setUsername(e.target.value)} autoFocus />
                        </div>
                        <div className="wizard-field">
                            <label>Password</label>
                            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") submitLogin(); }} />
                        </div>
                        <div className="modal-actions">
                            <button className="btn" onClick={onClose}>Cancel</button>
                            <button className="btn btn-primary" onClick={submitLogin} disabled={busy || !username || !password}>
                                {busy ? "Logging in…" : "Log In"}
                            </button>
                        </div>
                    </>
                )}

                {step === "profile" && (
                    <>
                        <button className="wizard-back" onClick={() => setStep("cloud")}>← Choose a different cloud</button>
                        <h3>Choose a profile</h3>
                        <div className="wizard-list">
                            {profiles.map(p => (
                                <button key={p.profileId} onClick={() => pickProfile(p)} disabled={busy}>{p.profileName}</button>
                            ))}
                            {!profiles.length && !busy && <p className="empty-state">No profiles available for this account.</p>}
                        </div>
                        <div className="modal-actions">
                            <button className="btn" onClick={onClose}>Cancel</button>
                        </div>
                    </>
                )}

                {step === "groups" && (
                    <>
                        <button className="wizard-back" onClick={() => setStep("profile")}>← Choose a different profile</button>
                        <h3>Choose a group</h3>
                        <div className="wizard-list">
                            {groups.map(g => (
                                <button key={g.groupId} onClick={() => pickGroup(g)} disabled={busy}>{g.name}</button>
                            ))}
                            {!groups.length && !busy && <p className="empty-state">No groups available for this profile.</p>}
                        </div>
                        <div className="modal-actions">
                            <button className="btn" onClick={onClose}>Cancel</button>
                        </div>
                    </>
                )}

                {step === "pals" && (
                    <>
                        <button className="wizard-back" onClick={() => setStep("groups")}>← Choose a different group</button>
                        <h3>Choose a pal</h3>
                        <div className="wizard-list">
                            {pals.map(p => (
                                <button key={p.guid} onClick={() => pickPal(p)} disabled={busy}>{p.name}</button>
                            ))}
                            {!pals.length && !busy && <p className="empty-state">No pals in this group.</p>}
                        </div>
                        <div className="modal-actions">
                            <button className="btn" onClick={onClose}>Cancel</button>
                        </div>
                    </>
                )}

                {step === "folderConflict" && folderConflict && (
                    <>
                        <button className="wizard-back" onClick={() => setStep("pals")}>← Back</button>
                        <h3>{folderConflict.conflict === "workspace"
                            ? "This project is already in the workspace"
                            : "This project is already on disk"}</h3>
                        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
                            {folderConflict.baseDir} {folderConflict.conflict === "workspace" ? "is already an open tab." : "already exists."} Create a new folder instead:
                        </p>
                        <div className="wizard-field">
                            <label>Folder name</label>
                            <input value={folderNameInput} onChange={e => setFolderNameInput(e.target.value)} autoFocus />
                        </div>
                        <div className="modal-actions">
                            <button className="btn" onClick={onClose}>Cancel</button>
                            <button className="btn btn-primary" onClick={confirmFolderName} disabled={busy || !folderNameInput.trim()}>
                                Continue
                            </button>
                        </div>
                    </>
                )}

                {step === "opening" && (
                    <>
                        <h3>{error ? "Something went wrong" : "Pulling the pal down…"}</h3>
                        {checklistSteps.length > 0 && (
                            <CheckoutChecklist steps={checklistSteps} stepStates={stepStates} />
                        )}
                        {error && lockBlocked && (
                            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 4 }}>
                                <input
                                    type="checkbox"
                                    checked={forceLockChecked}
                                    onChange={e => setForceLockChecked(e.target.checked)}
                                />
                                Force Lock — break {lockBlocked.holder}'s lock (held since {lockBlocked.since}) and
                                continue anyway. Use this only if you're sure that session is gone for good
                                (e.g. PalBuilder crashed) — anything unsaved there will be lost.
                            </label>
                        )}
                        {error && (
                            <div className="modal-actions">
                                <button className="btn" onClick={onClose}>Cancel</button>
                                {lockBlocked && forceLockChecked ? (
                                    <button className="btn btn-primary" onClick={retryWithForceLock}>Continue</button>
                                ) : (
                                    <button className="btn btn-primary" onClick={() => { setError(null); setStep("pals"); }}>Back</button>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
