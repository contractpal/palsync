"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("palsyncGui", {
    checkVersion: () => ipcRenderer.invoke("app:checkVersion"),
    openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
    getAppInfo: () => ipcRenderer.invoke("app:getInfo"),
    onOpenAbout: (callback) => {
        const listener = () => callback();
        ipcRenderer.on("about:open", listener);
        return () => ipcRenderer.removeListener("about:open", listener);
    },

    checkDependencies: () => ipcRenderer.invoke("deps:check"),
    installChromium: () => ipcRenderer.invoke("deps:installChromium"),
    onInstallChromiumOutput: (callback) => {
        const listener = (event, chunk) => callback(chunk);
        ipcRenderer.on("deps:installChromiumOutput", listener);
        return () => ipcRenderer.removeListener("deps:installChromiumOutput", listener);
    },
    onOpenDependencyCheck: (callback) => {
        const listener = () => callback();
        ipcRenderer.on("deps:open", listener);
        return () => ipcRenderer.removeListener("deps:open", listener);
    },

    listRecentWorkspaces: () => ipcRenderer.invoke("workspace:listRecent"),
    newWorkspace: (name) => ipcRenderer.invoke("workspace:new", name),
    openWorkspace: (filePath) => ipcRenderer.invoke("workspace:open", filePath),
    saveWorkspace: () => ipcRenderer.invoke("workspace:save"),

    chooseFolder: () => ipcRenderer.invoke("pal:chooseFolder"),
    addPalFromFolder: (folderPath) => ipcRenderer.invoke("pal:addFromFolder", folderPath),
    removePalFromWorkspace: (palPath) => ipcRenderer.invoke("pal:removeFromWorkspace", palPath),
    setPalAgent: (palPath, agentId) => ipcRenderer.invoke("pal:setAgent", { palPath, agentId }),

    listAgents: () => ipcRenderer.invoke("agents:list"),

    cloud: {
        listClouds: () => ipcRenderer.invoke("cloud:list"),
        knownAccounts: (cloudUrl) => ipcRenderer.invoke("cloud:knownAccounts", cloudUrl),
        listCustomClouds: () => ipcRenderer.invoke("cloud:listCustom"),
        addCloud: (url, name) => ipcRenderer.invoke("cloud:add", { url, name }),
        deleteCloud: (url) => ipcRenderer.invoke("cloud:delete", url),
        renameCloud: (url, name) => ipcRenderer.invoke("cloud:rename", { url, name }),
        tryAutoLogin: (cloudUrl) => ipcRenderer.invoke("cloud:tryAutoLogin", cloudUrl),
        authenticate: (cloudUrl, username, password, cloudName) => ipcRenderer.invoke("cloud:authenticate", { cloudUrl, username, password, cloudName }),
        listProfiles: () => ipcRenderer.invoke("cloud:listProfiles"),
        listGroups: (profileId) => ipcRenderer.invoke("cloud:listGroups", profileId),
        checkFolder: (name) => ipcRenderer.invoke("cloud:checkFolder", name),
        createAndMaterialize: (opts) => ipcRenderer.invoke("cloud:createAndMaterialize", opts),
        listPals: (profileId, groupId) => ipcRenderer.invoke("cloud:listPals", { profileId, groupId }),
        openAndMaterialize: (opts) => ipcRenderer.invoke("cloud:openAndMaterialize", opts),
        onProgress: (callback) => {
            const listener = (event, line) => callback(line);
            ipcRenderer.on("cloud:progress", listener);
            return () => ipcRenderer.removeListener("cloud:progress", listener);
        }
    },

    startConsole: (palId, agentId, cwd) => ipcRenderer.invoke("console:start", { palId, agentId, cwd }),
    writeToConsole: (palId, data) => ipcRenderer.send("console:write", { palId, data }),
    resizeConsole: (palId, cols, rows) => ipcRenderer.send("console:resize", { palId, cols, rows }),
    killConsole: (palId) => ipcRenderer.invoke("console:kill", palId),
    killAllConsoles: () => ipcRenderer.invoke("console:killAll"),
    anyConsolesRunning: () => ipcRenderer.invoke("console:anyRunning"),
    onConsoleData: (palId, callback) => {
        const channel = "console:data:" + palId;
        const listener = (event, data) => callback(data);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
    },
    onConsoleExit: (palId, callback) => {
        const channel = "console:exit:" + palId;
        const listener = (event, code) => callback(code);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
    }
});
