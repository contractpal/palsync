"use strict";
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

const workspaceStore = require("./workspaceStore");
const palFolder = require("./palFolder");
const agentLaunch = require("./agentLaunch");
const ptyManager = require("./ptyManager");
const cloudWizard = require("./cloudWizard");
const versionCheck = require("./versionCheck");
const dependencyCheck = require("./dependencyCheck");
const appState = require("./appState");
const palsyncSettings = require("./palsyncSettings");

const isDev = !app.isPackaged;
let mainWindow = null;
let currentWorkspacePath = null;
let currentWorkspace = null;

function userDataDir() {
    return app.getPath("userData");
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
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
        title: "Save New Workspace",
        defaultPath: (name || "workspace") + ".json",
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
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
        title: "Add Pal — Choose its folder",
        properties: ["openDirectory"]
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
    const baseDir = cloudWizard.defaultWorkspaceDir(name);
    if (folderName && folderName.trim()) {
        return path.join(path.dirname(baseDir), folderName.trim());
    }
    return baseDir;
}

function checkFolderConflict(name) {
    const baseDir = cloudWizard.defaultWorkspaceDir(name);
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

ipcMain.handle("cloud:createAndMaterialize", async (event, { profile, groupIds, name, description, category, agentKey, folderName }) => {
    if (!currentWorkspace) return { error: "No workspace open." };
    try {
        sendProgress("Creating \"" + name + "\" on CloudPiston…");
        const created = await cloudWizard.createPal({ profileId: profile.profileId, groupIds, name, description, category });
        const workspaceDir = resolveWorkspaceDir(created.name, folderName);
        const tab = await cloudWizard.materialize({ profile, palGuid: created.guid, palName: created.name, workspaceDir, agentKey, onLog: sendProgress });
        return addTabToWorkspace(tab);
    } catch (e) {
        return { error: e && e.message ? e.message : String(e) };
    }
});

ipcMain.handle("cloud:listPals", async (event, { profileId, groupId }) => {
    try { return { pals: await cloudWizard.listPals(profileId, groupId) }; }
    catch (e) { return { error: e.message }; }
});

ipcMain.handle("cloud:openAndMaterialize", async (event, { profile, pal, agentKey, folderName }) => {
    if (!currentWorkspace) return { error: "No workspace open." };
    try {
        const workspaceDir = resolveWorkspaceDir(pal.name, folderName);
        const tab = await cloudWizard.materialize({ profile, palGuid: pal.guid, palName: pal.name, workspaceDir, agentKey, onLog: sendProgress });
        return addTabToWorkspace(tab);
    } catch (e) {
        return { error: e && e.message ? e.message : String(e) };
    }
});

// ---- IPC: agents ----

ipcMain.handle("agents:list", async () => {
    return agentLaunch.detectAgents();
});

// ---- IPC: console (pty) ----

ipcMain.handle("console:start", async (event, { palId, agentId, cwd }) => {
    const agent = agentLaunch.resolveAgent(agentId);
    if (!agent) return { error: "Unknown agent: " + agentId };
    if (ptyManager.isRunning(palId)) return { ok: true, alreadyRunning: true };

    try {
        await agentLaunch.ensureMcpRegistered(agentId, cwd);
    } catch (e) {
        return { error: "Could not register MCP for " + agent.label + ": " + e.message };
    }

    ptyManager.start(
        palId,
        { command: agent.command, args: agent.args, cwd },
        data => { if (mainWindow) mainWindow.webContents.send("console:data:" + palId, data); },
        exitCode => { if (mainWindow) mainWindow.webContents.send("console:exit:" + palId, exitCode); }
    );
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
