"use strict";
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// Must run before any module below does PATH-dependent work (agent detection, dependency
// checks) - see fixPath.js for why a Finder/Dock-launched app needs this at all.
require("./fixPath").fixPathSync();

const workspaceStore = require("./workspaceStore");
const palFolder = require("./palFolder");
const agentLaunch = require("./agentLaunch");
const ptyManager = require("./ptyManager");
const cloudWizard = require("./cloudWizard");
const versionCheck = require("./versionCheck");
const dependencyCheck = require("./dependencyCheck");
const appState = require("./appState");
const palsyncSettings = require("./palsyncSettings");
const browserConfig = require("./browserConfig");
const browserLaunch = require("./browserLaunch");
const testWorkflow = require("./testWorkflow");
const qrCode = require("./qrCode");
const tunnelWorkflow = require("./tunnelWorkflow");
const debugWorkflow = require("./debugWorkflow");
const workflowList = require("./workflowList");
const palsyncSync = require("./palsyncSync");

const isDev = !app.isPackaged;
let mainWindow = null;
let currentWorkspacePath = null;
let currentWorkspace = null;

function userDataDir() {
    return app.getPath("userData");
}

// This pal tab's persistent identity ("this agent+pal window"), sent as the Chip-Session-ID
// header on every request Chip makes for it — directly (testWorkflow/tunnel/debug/workflowList
// below) and via the agent's own MCP child process (agentLaunch.ensureMcpRegistered). Lazily
// assigns + persists one for any pal added before this existed (palFolder.tabFromRecord assigns
// it up front for anything added from here on). Returns null if the pal isn't in the open
// workspace at all.
async function ensurePalSessionId(palPath) {
    if (!currentWorkspace) return null;
    const pal = currentWorkspace.pals.find(p => p.path === palPath);
    if (!pal) return null;
    if (!pal.sessionId) {
        pal.sessionId = crypto.randomUUID();
        await workspaceStore.saveWorkspace(currentWorkspacePath, currentWorkspace);
    }
    return pal.sessionId;
}

ipcMain.handle("app:checkVersion", () => versionCheck.checkForUpdate());
ipcMain.handle("app:openExternal", (event, url) => shell.openExternal(url));
ipcMain.handle("app:getInfo", () => {
    const buildInfo = versionCheck.readLocalBuildInfo();
    return {
        version: (buildInfo && buildInfo.version) || app.getVersion(),
        commit: buildInfo && buildInfo.commit || null,
        buildDate: buildInfo && buildInfo.date || null
    };
});

ipcMain.handle("settings:describe", () => palsyncSettings.describe());
ipcMain.handle("settings:update", (event, { key, value }) => palsyncSettings.update(key, value));

ipcMain.handle("deps:check", () => dependencyCheck.checkAll());
ipcMain.handle("deps:installChromium", async () => {
    return dependencyCheck.installChromium(chunk => {
        if (mainWindow) mainWindow.webContents.send("deps:installChromiumOutput", chunk);
    });
});

// Shared picker for the two File-menu "default location" settings — a plain native directory
// dialog (no custom renderer UI needed for this), seeded with the current setting if one's
// already set. Canceling leaves the existing setting untouched.
async function chooseDefaultDir({ title, current, onPick }) {
    if (!mainWindow) return;
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
        title,
        defaultPath: current || undefined,
        properties: ["openDirectory", "createDirectory"]
    });
    if (canceled || !filePaths.length) return;
    await onPick(filePaths[0]);
}

function buildMenu() {
    const template = [
        ...(process.platform === "darwin" ? [{ label: app.name, role: "appMenu" }] : []),
        {
            label: "File",
            submenu: [
                {
                    label: "PalSync Settings…",
                    click: () => { if (mainWindow) mainWindow.webContents.send("settings:open"); }
                },
                {
                    label: "Browsers…",
                    click: () => { if (mainWindow) mainWindow.webContents.send("browsers:open"); }
                },
                { type: "separator" },
                {
                    label: "Default Workspace File Location…",
                    click: () => chooseDefaultDir({
                        title: "Choose default location for new workspace files",
                        current: appState.getDefaultWorkspaceSaveDir(userDataDir()),
                        onPick: dir => appState.setDefaultWorkspaceSaveDir(userDataDir(), dir)
                    })
                },
                {
                    label: "Default Pal Folder Location…",
                    click: () => chooseDefaultDir({
                        title: "Choose default location for pal project folders",
                        current: appState.getDefaultPalFolderDir(userDataDir()),
                        onPick: dir => appState.setDefaultPalFolderDir(userDataDir(), dir)
                    })
                },
                { type: "separator" },
                { role: "quit" }
            ]
        },
        {
            label: "Edit",
            submenu: [
                { role: "undo" }, { role: "redo" }, { type: "separator" },
                { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }
            ]
        },
        {
            label: "View",
            submenu: [
                { role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" },
                { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" },
                { role: "togglefullscreen" }
            ]
        },
        { label: "Window", role: "windowMenu" },
        {
            label: "Help",
            submenu: [
                {
                    label: "Check Dependencies…",
                    click: () => { if (mainWindow) mainWindow.webContents.send("deps:open"); }
                },
                {
                    label: "Help Video",
                    click: () => shell.openExternal("https://downloads.cloudpiston.com/chip-1.mp4")
                },
                { type: "separator" },
                {
                    label: "API Documentation",
                    // Static docs links, not a live per-cloud Get*APIUrl call (which would need
                    // its own session/credentials) - Chip is built primarily for the agent, not
                    // for a human interactively exploring the API, so this is scoped down to
                    // static links rather than the full Java-IDE-style viewer.
                    submenu: [
                        { label: "Transaction API", click: () => shell.openExternal("https://secure.cloudpiston.com/cpal/cp-api/transaction/index.html") },
                        { label: "Web API", click: () => shell.openExternal("https://secure.cloudpiston.com/cpal/cp-api/web/index.html") },
                        { label: "Console API", click: () => shell.openExternal("https://secure.cloudpiston.com/cpal/cp-api/console/index.html") }
                    ]
                },
                { type: "separator" },
                {
                    label: "About Chip Pal Builder",
                    click: () => { if (mainWindow) mainWindow.webContents.send("about:open"); }
                }
            ]
        }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1180,
        height: 780,
        title: "Chip Pal Builder",
        icon: path.join(__dirname, "assets", "icon.png"),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    if (isDev) {
        mainWindow.loadURL("http://localhost:5173");
        mainWindow.webContents.openDevTools({ mode: "detach" });
    } else {
        mainWindow.loadFile(path.join(__dirname, "..", "..", "dist-renderer", "index.html"));
    }

    mainWindow.webContents.on("did-finish-load", () => {
        if (!appState.hasShownDependencyCheck(userDataDir())) {
            mainWindow.webContents.send("deps:open");
            appState.markDependencyCheckShown(userDataDir());
        }
    });

    mainWindow.on("closed", () => {
        ptyManager.killAll();
        mainWindow = null;
    });
}

// ---- IPC: launcher / workspace ----

ipcMain.handle("workspace:listRecent", async () => {
    return workspaceStore.listRecent(userDataDir());
});

ipcMain.handle("workspace:new", async (event, name) => {
    const saveDir = appState.getDefaultWorkspaceSaveDir(userDataDir());
    const fileName = (name || "workspace") + ".json";
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
        title: "Save New Workspace",
        defaultPath: saveDir ? path.join(saveDir, fileName) : fileName,
        filters: [{ name: "Palsync Workspace", extensions: ["json"] }]
    });
    if (canceled || !filePath) return null;

    currentWorkspace = workspaceStore.emptyWorkspace(name || path.basename(filePath, ".json"));
    currentWorkspacePath = filePath;
    await workspaceStore.saveWorkspace(currentWorkspacePath, currentWorkspace);
    await workspaceStore.rememberWorkspace(userDataDir(), { name: currentWorkspace.name, filePath });
    return { filePath, workspace: currentWorkspace };
});

ipcMain.handle("workspace:open", async (event, filePath) => {
    let targetPath = filePath;
    if (!targetPath) {
        const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
            title: "Open Workspace",
            filters: [{ name: "Palsync Workspace", extensions: ["json"] }],
            properties: ["openFile"]
        });
        if (canceled || !filePaths.length) return null;
        targetPath = filePaths[0];
    }
    const workspace = await workspaceStore.loadWorkspace(targetPath);
    if (!workspace) return { error: "Could not read workspace file: " + targetPath };
    currentWorkspace = workspace;
    currentWorkspacePath = targetPath;
    await workspaceStore.rememberWorkspace(userDataDir(), { name: workspace.name, filePath: targetPath });
    return { filePath: targetPath, workspace };
});

ipcMain.handle("workspace:save", async () => {
    if (!currentWorkspacePath || !currentWorkspace) return { error: "No workspace open." };
    await workspaceStore.saveWorkspace(currentWorkspacePath, currentWorkspace);
    return { ok: true };
});

// ---- IPC: add pal (existing folder only, MVP) ----

ipcMain.handle("pal:chooseFolder", async () => {
    const defaultPath = appState.getDefaultPalFolderDir(userDataDir()) || undefined;
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
        title: "Add Pal — Choose its folder",
        properties: ["openDirectory"],
        defaultPath
    });
    if (canceled || !filePaths.length) return null;
    return filePaths[0];
});

ipcMain.handle("pal:addFromFolder", async (event, folderPath) => {
    if (!currentWorkspace) return { error: "No workspace open." };
    const validation = await palFolder.validatePalFolder(folderPath);
    if (!validation.ok) return { error: validation.reason };

    const alreadyAdded = currentWorkspace.pals.some(p => p.path === folderPath);
    if (alreadyAdded) return { error: "That folder is already open in this workspace." };

    const tab = palFolder.tabFromRecord(folderPath, validation.record);
    currentWorkspace.pals.push(tab);
    currentWorkspace.activeTabIndex = currentWorkspace.pals.length - 1;
    await workspaceStore.saveWorkspace(currentWorkspacePath, currentWorkspace);
    return { tab, workspace: currentWorkspace };
});

ipcMain.handle("pal:checkPalsyncVersion", async (event, palPath) => {
    try { return await palsyncSync.checkPalFolderVersion(palPath); }
    catch (e) { return null; } // never blocks anything else — see palsyncSync.js
});

ipcMain.handle("pal:syncPalsync", async (event, { palPath, check }) => {
    return palsyncSync.runSync(palPath, check, chunk => {
        if (mainWindow) mainWindow.webContents.send("pal:syncOutput", chunk);
    });
});

ipcMain.handle("pal:setAgent", async (event, { palPath, agentId }) => {
    if (!currentWorkspace) return { error: "No workspace open." };
    const pal = currentWorkspace.pals.find(p => p.path === palPath);
    if (!pal) return { error: "That pal isn't in this workspace." };
    pal.agentId = agentId;
    await workspaceStore.saveWorkspace(currentWorkspacePath, currentWorkspace);
    return { workspace: currentWorkspace };
});

ipcMain.handle("pal:removeFromWorkspace", async (event, palPath) => {
    if (!currentWorkspace) return { error: "No workspace open." };
    const pal = currentWorkspace.pals.find(p => p.path === palPath);
    if (!pal) return { error: "That pal isn't in this workspace." };

    // Only removes the tab/reference from this workspace — never touches the actual folder or
    // its files on disk. Kill its console first if it's running, same as leaving the workspace.
    const composeId = pal.cloudPalId + ":" + pal.path;
    ptyManager.kill(composeId);

    const index = currentWorkspace.pals.indexOf(pal);
    currentWorkspace.pals.splice(index, 1);
    if (currentWorkspace.activeTabIndex > index) {
        currentWorkspace.activeTabIndex -= 1;
    } else if (currentWorkspace.activeTabIndex >= currentWorkspace.pals.length) {
        currentWorkspace.activeTabIndex = Math.max(0, currentWorkspace.pals.length - 1);
    }
    await workspaceStore.saveWorkspace(currentWorkspacePath, currentWorkspace);
    return { workspace: currentWorkspace };
});

// ---- IPC: create-pal wizard (cloud / login / profile / group / create) ----

function sendProgress(line) {
    if (mainWindow) mainWindow.webContents.send("cloud:progress", line);
}

function sendStep(stepEvent) {
    if (mainWindow) mainWindow.webContents.send("cloud:step", stepEvent);
}

// Ordered, human-labeled version of palsync/src/launcher/workspace.js's STEPS — the checklist
// the checkout wizards render. Kept here (not in core) since the label wording is GUI-only
// presentation, not something the CLI/launcher care about.
const CHECKOUT_STEPS = [
    { step: "pull", label: "Pull the pal's files" },
    { step: "lock", label: "Lock the pal" },
    { step: "resources", label: "Fetch dependent resources" },
    { step: "inject", label: "Set up agent context" },
    { step: "register", label: "Register the MCP server" }
];
// create-new-pal has one extra step before the shared checkout steps: creating the pal itself
// on CloudPiston (open-from-cloud skips this — the pal already exists).
const CREATE_STEPS = [{ step: "create", label: "Create the pal on CloudPiston" }, ...CHECKOUT_STEPS];

function addTabToWorkspace(tab) {
    if (!currentWorkspace) return { error: "No workspace open." };
    const alreadyAdded = currentWorkspace.pals.some(p => p.path === tab.path);
    if (alreadyAdded) return { error: "That folder is already open in this workspace." };
    currentWorkspace.pals.push(tab);
    currentWorkspace.activeTabIndex = currentWorkspace.pals.length - 1;
    return workspaceStore.saveWorkspace(currentWorkspacePath, currentWorkspace)
        .then(() => ({ tab, workspace: currentWorkspace }));
}

// Detect whether the default local folder for `name` is already spoken for — either already
// an open tab in this workspace, or already present on disk (from an earlier checkout) — before
// silently landing there. `folderName`, if given, overrides the auto-suggested folder name.
function resolveWorkspaceDir(name, folderName) {
    const baseDir = cloudWizard.defaultWorkspaceDir(name, appState.getDefaultPalFolderDir(userDataDir()));
    if (folderName && folderName.trim()) {
        return path.join(path.dirname(baseDir), folderName.trim());
    }
    return baseDir;
}

function checkFolderConflict(name) {
    const baseDir = cloudWizard.defaultWorkspaceDir(name, appState.getDefaultPalFolderDir(userDataDir()));
    const inWorkspace = !!(currentWorkspace && currentWorkspace.pals.some(p => p.path === baseDir));
    const onDisk = fs.existsSync(baseDir);
    if (!inWorkspace && !onDisk) return { conflict: null, baseDir };
    const suggested = cloudWizard.resolveAvailableDir(baseDir);
    return { conflict: inWorkspace ? "workspace" : "disk", baseDir, suggestedName: path.basename(suggested) };
}

ipcMain.handle("cloud:list", () => cloudWizard.listClouds());

ipcMain.handle("cloud:knownAccounts", (event, cloudUrl) => cloudWizard.knownAccountsForCloud(cloudUrl));

ipcMain.handle("cloud:listCustom", () => cloudWizard.listCustomClouds());

ipcMain.handle("cloud:add", (event, { url, name }) => {
    try { cloudWizard.addCloud(url, name); return { ok: true }; }
    catch (e) { return { error: e && e.message ? e.message : String(e) }; }
});

ipcMain.handle("cloud:delete", (event, url) => {
    try { cloudWizard.deleteCloud(url); return { ok: true }; }
    catch (e) { return { error: e && e.message ? e.message : String(e) }; }
});

ipcMain.handle("cloud:rename", (event, { url, name }) => {
    try { cloudWizard.renameCloud(url, name); return { ok: true }; }
    catch (e) { return { error: e && e.message ? e.message : String(e) }; }
});

ipcMain.handle("cloud:tryAutoLogin", async (event, cloudUrl) => {
    const result = await cloudWizard.tryAutoLogin(cloudUrl);
    return result ? { ok: true, ...result } : { ok: false };
});

ipcMain.handle("cloud:authenticate", async (event, { cloudUrl, username, password, cloudName }) => {
    try {
        const result = await cloudWizard.authenticate(cloudUrl, username, password, cloudName);
        return { ok: true, ...result };
    } catch (e) {
        return { error: e && e.message ? e.message : String(e) };
    }
});

ipcMain.handle("cloud:listProfiles", async () => {
    try { return { profiles: await cloudWizard.listProfiles() }; }
    catch (e) { return { error: e.message }; }
});

ipcMain.handle("cloud:listGroups", async (event, profileId) => {
    try { return { groups: await cloudWizard.listGroups(profileId) }; }
    catch (e) { return { error: e.message }; }
});

ipcMain.handle("cloud:checkFolder", (event, name) => checkFolderConflict(name));

ipcMain.handle("cloud:checkoutSteps", () => CHECKOUT_STEPS);
ipcMain.handle("cloud:createSteps", () => CREATE_STEPS);

ipcMain.handle("cloud:createAndMaterialize", async (event, { profile, groupIds, name, description, category, agentKey, folderName }) => {
    if (!currentWorkspace) return { error: "No workspace open." };
    try {
        sendStep({ step: "create", status: "start" });
        const created = await cloudWizard.createPal({ profileId: profile.profileId, groupIds, name, description, category });
        sendStep({ step: "create", status: "done" });
        const workspaceDir = resolveWorkspaceDir(created.name, folderName);
        const tab = await cloudWizard.materialize({ profile, palGuid: created.guid, palName: created.name, workspaceDir, agentKey, onLog: sendProgress, onStep: sendStep });
        return addTabToWorkspace(tab);
    } catch (e) {
        return { error: e && e.message ? e.message : String(e) };
    }
});

ipcMain.handle("cloud:listPals", async (event, { profileId, groupId }) => {
    try { return { pals: await cloudWizard.listPals(profileId, groupId) }; }
    catch (e) { return { error: e.message }; }
});

ipcMain.handle("cloud:openAndMaterialize", async (event, { profile, pal, agentKey, folderName, forceLock }) => {
    if (!currentWorkspace) return { error: "No workspace open." };
    try {
        const workspaceDir = resolveWorkspaceDir(pal.name, folderName);
        const tab = await cloudWizard.materialize({ profile, palGuid: pal.guid, palName: pal.name, workspaceDir, agentKey, onLog: sendProgress, onStep: sendStep, forceLock });
        return addTabToWorkspace(tab);
    } catch (e) {
        return { error: e && e.message ? e.message : String(e), lockBlocked: e && e.lockBlocked || null };
    }
});

// ---- IPC: agents ----

ipcMain.handle("agents:list", async () => {
    return agentLaunch.detectAgents();
});

// ---- IPC: browser registry (global — not per-workspace) ----

ipcMain.handle("browsers:list", () => browserConfig.load(userDataDir()));

ipcMain.handle("browsers:add", async (event, browser) => {
    try { return { ok: true, registry: await browserConfig.add(userDataDir(), browser) }; }
    catch (e) { return { error: e && e.message ? e.message : String(e) }; }
});

ipcMain.handle("browsers:update", async (event, { id, fields }) => {
    try { return { ok: true, registry: await browserConfig.update(userDataDir(), id, fields) }; }
    catch (e) { return { error: e && e.message ? e.message : String(e) }; }
});

ipcMain.handle("browsers:remove", async (event, id) => {
    try { return { ok: true, registry: await browserConfig.remove(userDataDir(), id) }; }
    catch (e) { return { error: e && e.message ? e.message : String(e) }; }
});

ipcMain.handle("browsers:setDefault", async (event, id) => {
    try { return { ok: true, registry: await browserConfig.setDefault(userDataDir(), id) }; }
    catch (e) { return { error: e && e.message ? e.message : String(e) }; }
});

ipcMain.handle("browsers:chooseExecutable", async () => {
    const filters = process.platform === "win32"
        ? [{ name: "Programs", extensions: ["exe"] }]
        : process.platform === "darwin"
            ? [{ name: "Applications", extensions: ["app"] }]
            : [];
    const defaultPath = process.platform === "win32" ? "C:\\Program Files"
        : process.platform === "darwin" ? "/Applications" : undefined;
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
        title: "Choose browser executable",
        defaultPath,
        filters,
        properties: process.platform === "darwin" ? ["openFile", "openDirectory"] : ["openFile"]
    });
    if (canceled || !filePaths.length) return null;
    return filePaths[0];
});

// ---- IPC: pal test-workflow ribbon (Web / Console / Transaction) ----

ipcMain.handle("pal:listWorkflowFiles", async (event, { palPath, kind }) => {
    try { return await workflowList.listWorkflowFiles(palPath, kind, await ensurePalSessionId(palPath)); }
    catch (e) { return { error: e && e.message ? e.message : String(e), files: [] }; }
});

ipcMain.handle("pal:testWorkflow", async (event, { palPath, kind, browserId, mode, workflowName }) => {
    try {
        const res = await testWorkflow.testWorkflow(palPath, kind, workflowName, await ensurePalSessionId(palPath));
        let opened = null;
        let qrDataUrl = null;
        if (res.ran && res._previewUrl) {
            if (mode === "qr") {
                // The raw URL is rendered into an image right here and never leaves the main
                // process as text — only the PNG data URL crosses into the renderer.
                qrDataUrl = await qrCode.qrDataUrlFor(res._previewUrl);
            } else {
                const registry = await browserConfig.load(userDataDir());
                const browser = registry.browsers.find(b => b.id === (browserId || registry.defaultId));
                opened = await browserLaunch.launchInBrowser(res._previewUrl, browser);
            }
        }
        // _previewUrl is credential-bearing — never send it to the renderer (same rule the
        // CLI/MCP side already follows for it).
        const safe = Object.assign({}, res);
        delete safe._previewUrl;
        delete safe.rawToken;
        return { result: safe, opened, qrDataUrl };
    } catch (e) {
        return { error: e && e.message ? e.message : String(e) };
    }
});

// ---- IPC: pal tunnel workflow panel ----

ipcMain.handle("pal:listTunnelWorkflows", async (event, palPath) => {
    try { return tunnelWorkflow.listWorkflows(palPath); }
    catch (e) { return { error: e && e.message ? e.message : String(e) }; }
});

ipcMain.handle("pal:runTunnel", async (event, { palPath, action, workflow, payload }) => {
    try {
        const chipSessionId = await ensurePalSessionId(palPath);
        const res = await tunnelWorkflow.runTunnel(palPath, { action, workflow, payload, chipSessionId });
        // creds carry a short-lived password — never let it leave the main process.
        const safe = Object.assign({}, res);
        delete safe.creds;
        return { result: safe };
    } catch (e) {
        return { error: e && e.message ? e.message : String(e) };
    }
});

// ---- IPC: pal server-side debug window ----

ipcMain.handle("pal:fetchDebug", async (event, palPath) => {
    // No chipSessionId here on purpose — see debugWorkflow.js's header comment: this is the
    // human opening the Debug panel, not the agent, and the two need to stay distinguishable.
    try { return { result: await debugWorkflow.fetchDebug(palPath) }; }
    catch (e) { return { error: e && e.message ? e.message : String(e) }; }
});

// ---- IPC: console (pty) ----

ipcMain.handle("console:start", async (event, { palId, agentId, cwd }) => {
    const agent = agentLaunch.resolveAgent(agentId);
    if (!agent) return { error: "Unknown agent: " + agentId };
    if (ptyManager.isRunning(palId)) return { ok: true, alreadyRunning: true };

    try {
        await agentLaunch.ensureMcpRegistered(agentId, cwd, await ensurePalSessionId(cwd));
    } catch (e) {
        return { error: "Could not register MCP for " + agent.label + ": " + e.message };
    }

    try {
        ptyManager.start(
            palId,
            { command: agent.command, args: agent.args, cwd },
            data => { if (mainWindow) mainWindow.webContents.send("console:data:" + palId, data); },
            exitCode => { if (mainWindow) mainWindow.webContents.send("console:exit:" + palId, exitCode); }
        );
    } catch (e) {
        // A spawn failure here (agent.command not actually resolvable at exec time, even if the
        // picker's own PATH check found it a moment ago) used to throw straight out of this IPC
        // handler with nothing on the renderer side ever looking at the result — silent blank
        // terminal, no explanation. Surface it instead.
        return { error: "Could not launch " + agent.label + ": " + (e && e.message ? e.message : String(e)) };
    }
    return { ok: true };
});

ipcMain.on("console:write", (event, { palId, data }) => ptyManager.write(palId, data));
ipcMain.on("console:resize", (event, { palId, cols, rows }) => ptyManager.resize(palId, cols, rows));
ipcMain.handle("console:kill", (event, palId) => { ptyManager.kill(palId); return { ok: true }; });
// Only one workspace is ever open at a time, so leaving it (back to the launcher) should stop
// every running agent/MCP process, not just leave them orphaned in the background.
ipcMain.handle("console:killAll", () => { ptyManager.killAll(); return { ok: true }; });
ipcMain.handle("console:anyRunning", () => ptyManager.anyRunning());

// ---- app lifecycle ----

app.whenReady().then(() => { buildMenu(); createWindow(); });

app.on("window-all-closed", () => {
    ptyManager.killAll();
    if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
