import React, { useEffect, useRef, useState } from "react";
import CheckoutChecklist from "./CheckoutChecklist.jsx";

// Multi-panel wizard: cloud -> login (only if no cached credential auto-resolves) -> profile
// -> groups (1+) -> details -> submit. Shares its step shape with what "open from cloud" will
// need later (cloud/profile/group), just diverging at the last step.
//
// fromTemplate: swaps the "details" step for a template picker (search + radio list on the left,
// preview image and details on the right). Choosing a radio fetches that template's full record
// (GetTemplate.do — the only call that returns the preview image); Create stays disabled until one
// is chosen and sends its token as templateId on CreatePalFromBuilder.do.
export default function CreatePalWizard({ onCreated, onClose, fromTemplate = false }) {
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
    const [selectedGroupIds, setSelectedGroupIds] = useState([]);

    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState("");

    const [templateQuery, setTemplateQuery] = useState("");
    const [templates, setTemplates] = useState([]);
    const [templatesLoading, setTemplatesLoading] = useState(false);
    const [selectedToken, setSelectedToken] = useState(null);
    const [templateDetail, setTemplateDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [nameTouched, setNameTouched] = useState(false);
    const latestToken = useRef(null); // ignore a slow GetTemplate answer once another radio is chosen

    const [folderConflict, setFolderConflict] = useState(null);
    const [folderNameInput, setFolderNameInput] = useState("");

    const [checklistSteps, setChecklistSteps] = useState([]);
    const [stepStates, setStepStates] = useState({});

    useEffect(() => {
        window.palsyncGui.cloud.listClouds().then(setClouds);
        window.palsyncGui.cloud.createSteps().then(setChecklistSteps);
    }, []);

    useEffect(() => {
        if (step !== "creating") return;
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
            setSelectedGroupIds([]);
            setStep("groups");
        } catch (e) {
            setError(e && e.message ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    // Where "Back" lands after the final-details step: the template picker replaces details.
    const detailsStep = fromTemplate ? "templates" : "details";

    async function goToTemplates() {
        setStep("templates");
        await searchTemplates("");
    }

    async function searchTemplates(query) {
        setError(null);
        setTemplatesLoading(true);
        try {
            const result = await window.palsyncGui.cloud.searchTemplates(query.trim());
            if (result.error) { setError(result.error); return; }
            setTemplates(result.templates);
            // A search that no longer lists the chosen template must not leave Create enabled for it.
            if (selectedToken && !result.templates.some(t => t.token === selectedToken)) clearSelection();
        } catch (e) {
            setError(e && e.message ? e.message : String(e));
        } finally {
            setTemplatesLoading(false);
        }
    }

    function clearSelection() {
        latestToken.current = null;
        setSelectedToken(null);
        setTemplateDetail(null);
        setDetailLoading(false);
    }

    async function selectTemplate(t) {
        setError(null);
        latestToken.current = t.token;
        setSelectedToken(t.token);
        setTemplateDetail(null);
        setDescription(t.description || "");
        setCategory(t.categories[0] || "");
        if (!nameTouched) setName(t.name);
        setDetailLoading(true);
        try {
            const result = await window.palsyncGui.cloud.getTemplate(t.token);
            if (latestToken.current !== t.token) return;
            if (result.error) { setError(result.error); return; }
            setTemplateDetail(result.template);
        } catch (e) {
            if (latestToken.current === t.token) setError(e && e.message ? e.message : String(e));
        } finally {
            if (latestToken.current === t.token) setDetailLoading(false);
        }
    }

    function toggleGroup(groupId) {
        setSelectedGroupIds(prev =>
            prev.includes(groupId) ? prev.filter(g => g !== groupId) : [...prev, groupId]
        );
    }

    async function submitDetails() {
        if (!name.trim()) { setError("Name is required."); return; }
        if (!selectedGroupIds.length) { setError("Pick at least one group."); return; }
        if (fromTemplate && !selectedToken) { setError("Choose a template."); return; }
        setError(null);
        setBusy(true);
        try {
            const check = await window.palsyncGui.cloud.checkFolder(name.trim());
            if (check.conflict) {
                setFolderConflict(check);
                setFolderNameInput(check.suggestedName);
                setStep("folderConflict");
                return;
            }
            await doCreate(null);
        } catch (e) {
            setError(e && e.message ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    async function confirmFolderName() {
        setError(null);
        await doCreate(folderNameInput.trim());
    }

    async function doCreate(folderName) {
        setBusy(true);
        setStepStates({});
        setStep("creating");
        try {
            const result = await window.palsyncGui.cloud.createAndMaterialize({
                profile, groupIds: selectedGroupIds,
                name: name.trim(), description: description.trim(), category: category.trim(),
                templateId: fromTemplate ? selectedToken : undefined,
                agentKey: "claude", folderName
            });
            if (result.error) { setError(result.error); return; }
            onCreated(result);
        } catch (e) {
            setError(e && e.message ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <div className={"modal wide" + (step === "templates" ? " template-picker" : "")} onClick={e => e.stopPropagation()}>
                {error && <p className="wizard-error">{error}</p>}

                {step === "cloud" && (
                    <>
                        <h3>{fromTemplate ? "Create a pal from a template" : "Create a new pal"}</h3>
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
                        <h3>Choose one or more groups</h3>
                        <div className="wizard-list">
                            {groups.map(g => (
                                <label key={g.groupId} className="wizard-checkbox-row">
                                    <input
                                        type="checkbox"
                                        checked={selectedGroupIds.includes(g.groupId)}
                                        onChange={() => toggleGroup(g.groupId)}
                                    />
                                    {g.name}
                                </label>
                            ))}
                            {!groups.length && <p className="empty-state">No groups available for this profile.</p>}
                        </div>
                        <div className="modal-actions">
                            <button className="btn" onClick={onClose}>Cancel</button>
                            <button className="btn btn-primary" disabled={!selectedGroupIds.length} onClick={() => (fromTemplate ? goToTemplates() : setStep("details"))}>
                                Continue
                            </button>
                        </div>
                    </>
                )}

                {step === "details" && (
                    <>
                        <button className="wizard-back" onClick={() => setStep("groups")}>← Choose different groups</button>
                        <h3>Name your pal</h3>
                        <div className="wizard-field">
                            <label>Name</label>
                            <input value={name} onChange={e => setName(e.target.value)} autoFocus />
                        </div>
                        <div className="wizard-field">
                            <label>Description (optional)</label>
                            <input value={description} onChange={e => setDescription(e.target.value)} />
                        </div>
                        <div className="wizard-field">
                            <label>Category (optional)</label>
                            <input value={category} onChange={e => setCategory(e.target.value)} />
                        </div>
                        <div className="modal-actions">
                            <button className="btn" onClick={onClose}>Cancel</button>
                            <button className="btn btn-primary" onClick={submitDetails}>Create Pal</button>
                        </div>
                    </>
                )}

                {step === "templates" && (
                    <>
                        <button className="wizard-back" onClick={() => setStep("groups")}>← Choose different groups</button>
                        <h3>Choose a template</h3>
                        <div className="template-body">
                            <div className="template-left">
                                <div className="template-search">
                                    <input
                                        value={templateQuery}
                                        onChange={e => setTemplateQuery(e.target.value)}
                                        placeholder="Search templates"
                                        onKeyDown={e => { if (e.key === "Enter") searchTemplates(templateQuery); }}
                                        autoFocus
                                    />
                                    <button className="btn" onClick={() => searchTemplates(templateQuery)} disabled={templatesLoading}>Go</button>
                                </div>
                                <div className="template-list" role="radiogroup" aria-label="Templates">
                                    {templates.map(t => (
                                        <label key={t.token} className={"template-row" + (t.token === selectedToken ? " selected" : "")}>
                                            <input
                                                type="radio"
                                                name="template"
                                                checked={t.token === selectedToken}
                                                onChange={() => selectTemplate(t)}
                                            />
                                            {t.name}
                                        </label>
                                    ))}
                                    {!templates.length && !templatesLoading && <p className="empty-state">No templates found.</p>}
                                    {templatesLoading && <p className="empty-state">Searching…</p>}
                                </div>
                            </div>
                            <div className="template-right">
                                <div className="template-image">
                                    {templateDetail && templateDetail.icon
                                        ? <img alt={templateDetail.name} src={"data:" + templateDetail.icon.contentType + ";base64," + templateDetail.icon.base64} />
                                        : <span className="empty-state">{detailLoading ? "Loading…" : selectedToken ? "No image" : ""}</span>}
                                </div>
                                <div className="template-details">
                                    <h4>Template Details</h4>
                                    {!selectedToken && <p className="empty-state">Select a template to see its details.</p>}
                                    {selectedToken && detailLoading && <p className="empty-state">Loading…</p>}
                                    {templateDetail && (
                                        <dl>
                                            <dt>Name</dt><dd>{templateDetail.name}</dd>
                                            {templateDetail.description && <><dt>Description</dt><dd>{templateDetail.description}</dd></>}
                                            {templateDetail.publisher && <><dt>Publisher</dt><dd>{templateDetail.publisher}</dd></>}
                                            {templateDetail.version && <><dt>Version</dt><dd>{templateDetail.version}</dd></>}
                                            {templateDetail.source && <><dt>Source</dt><dd>{templateDetail.source}</dd></>}
                                            {templateDetail.categories.length > 0 && <><dt>Categories</dt><dd>{templateDetail.categories.join(", ")}</dd></>}
                                            {templateDetail.industries.length > 0 && <><dt>Industries</dt><dd>{templateDetail.industries.join(", ")}</dd></>}
                                        </dl>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="wizard-field">
                            <label>Name for the new pal</label>
                            <input value={name} onChange={e => { setName(e.target.value); setNameTouched(true); }} disabled={!selectedToken} />
                        </div>
                        <div className="modal-actions">
                            <button className="btn" onClick={onClose}>Cancel</button>
                            <button className="btn btn-primary" onClick={submitDetails} disabled={busy || !selectedToken || !name.trim()}>Create Pal</button>
                        </div>
                    </>
                )}

                {step === "folderConflict" && folderConflict && (
                    <>
                        <button className="wizard-back" onClick={() => setStep(detailsStep)}>← Back</button>
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

                {step === "creating" && (
                    <>
                        <h3>{error ? "Something went wrong" : "Creating your pal…"}</h3>
                        {checklistSteps.length > 0 && (
                            <CheckoutChecklist steps={checklistSteps} stepStates={stepStates} />
                        )}
                        {error && (
                            <div className="modal-actions">
                                <button className="btn" onClick={onClose}>Cancel</button>
                                <button className="btn btn-primary" onClick={() => { setError(null); setStep(detailsStep); }}>Back</button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
