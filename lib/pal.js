"use strict";
// Ported from the extension's out/types/palObjects/pal.js.
// Step-2 scope: load (fromPath/fromJson), injectFileContent (disk -> base64), and toXml.
// The workspace-bound methods (fromXml, fromCP, expandPalFiles, clearContent, saveLocal,
// saveRemote, updateDiagnostics, lock) are NOT ported here — they are vscode/UI plumbing.
// vscode.workspace.fs.readFile is replaced with fs/promises readFile; nothing else changes.
//
// Datasets/dataviews/data/datalists are read-only passthrough: the constructor preserves
// them verbatim and they are never touched by injectFileContent, so they round-trip back
// to the server unchanged (never created, never recreated).
const fs = require("fs/promises");
const path = require("path");
const { CloudPistonXMLBuilder } = require("../lib/xmlParser");

// folder name -> entry sub-key, exactly the set injectFileContent() touches in the extension.
const CONTENT_TYPES = [
    { folder: "attachments", key: "Attachment" },
    { folder: "pages", key: "Page" },
    { folder: "styles", key: "Style" },
    { folder: "scripts", key: "Script" },
    { folder: "workflows", key: "Workflow" },
    { folder: "documents", key: "Document" },
    { folder: "fragments", key: "Fragment" },
    { folder: "images", key: "Image" },
    { folder: "emails", key: "Email" },
];

class Pal {
    constructor(init) {
        this.id = init.id;
        this.path = init.path;
        if (init.environment) {
            this.environment = init.environment;
        }
        this.layout = init.layout;
        this.documents = init.documents !== '' ? init.documents : { entry: [] };
        this.emails = init.emails !== '' ? init.emails : { entry: [] };
        this.images = init.images !== '' ? init.images : { entry: [] };
        this.pages = init.pages !== '' ? init.pages : { entry: [] };
        this.fragments = init.fragments !== '' ? init.fragments : { entry: [] };
        this.styles = init.styles !== '' ? init.styles : { entry: [] };
        this.workflows = init.workflows !== '' ? init.workflows : { entry: [] };
        this.scripts = init.scripts !== '' ? init.scripts : { entry: [] };
        this.datasets = init.datasets !== '' ? init.datasets : { entry: [] };
        this.dataviews = init.dataviews !== '' ? init.dataviews : { entry: [] };
        this.data = init.data !== '' ? init.data : { entry: [] };
        this.datalists = init.datalists !== '' ? init.datalists : { entry: [] };
        this.attachments = init.attachments !== '' ? init.attachments : { entry: [] };
        this.folders = init.folders !== '' ? init.folders : { Folder: [] };
    }

    //#region STATIC
    static fromJson(json) {
        const data = JSON.parse(json);
        return new Pal(data);
    }

    static async fromPath(dir) {
        const metadataPath = path.join(dir, 'pal.json');
        const data = await fs.readFile(metadataPath, 'utf-8');
        const pal = Pal.fromJson(data);
        pal.path = dir;
        pal.id = path.basename(dir);
        return pal;
    }

    static toXml(pal) {
        return CloudPistonXMLBuilder(true).build(pal);
    }
    //#endregion STATIC

    //#region GETTERS (own helpers mirroring the extension's allX getters)
    get allDocuments() { return this.documents?.entry ?? []; }
    get allEmails() { return this.emails?.entry ?? []; }
    get allImages() { return this.images?.entry ?? []; }
    get allPages() { return this.pages?.entry ?? []; }
    get allFragments() { return this.fragments?.entry ?? []; }
    get allStyles() { return this.styles?.entry ?? []; }
    get allWorkflows() { return this.workflows?.entry ?? []; }
    get allScripts() { return this.scripts?.entry ?? []; }
    get allDatasets() { return this.datasets?.entry ?? []; }
    get allDataviews() { return this.dataviews?.entry ?? []; }
    get allData() { return this.data?.entry ?? []; }
    get allDatalists() { return this.datalists?.entry ?? []; }
    get allAttachments() { return this.attachments?.entry ?? []; }
    get allFolders() { return this.folders?.Folder ?? []; }
    //#endregion GETTERS

    //#region INSTANCE
    // Read each in-scope file from disk, base64-encode it, and set entry[<Type>].content.
    // Returns the list of injected files so callers (dry-run) can report what would push.
    async injectFileContent() {
        const injected = [];
        const palPath = this.path;

        const inject = async (entries, key, folder) => {
            const lowerKey = key.toLowerCase();
            for (const entry of entries) {
                const filePath = entry.string;
                const obj = entry[key] || entry[lowerKey];
                if (obj && filePath) {
                    try {
                        const fullPath = path.join(palPath, folder, filePath);
                        const fileContent = await fs.readFile(fullPath);
                        obj.content = Buffer.from(fileContent).toString("base64");
                        // Sync: ensure both cases have the content if they both exist (rare but safer)
                        if (entry[key]) entry[key].content = obj.content;
                        if (entry[lowerKey]) entry[lowerKey].content = obj.content;
                        
                        injected.push({ folder, file: filePath, bytes: fileContent.length });
                    }
                    catch (err) {
                        console.warn(`Failed to load content for ${filePath}: ${err}`);
                    }
                }
            }
        };

        await Promise.all([
            inject(this.allAttachments, "Attachment", "attachments"),
            inject(this.allPages, "Page", "pages"),
            inject(this.allStyles, "Style", "styles"),
            inject(this.allScripts, "Script", "scripts"),
            inject(this.allWorkflows, "Workflow", "workflows"),
            inject(this.allDocuments, "Document", "documents"),
            inject(this.allFragments, "Fragment", "fragments"),
            inject(this.allImages, "Image", "images"),
            inject(this.allEmails, "Email", "emails"),
        ]);

        return injected;
    }
    //#endregion INSTANCE
}

module.exports = { Pal, CONTENT_TYPES };
