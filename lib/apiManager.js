"use strict";
// Ported from the extension's out/cloudpistonAPIManager.js.
// vscode stripped: the 401 branch no longer calls vscode.window.showErrorMessage; it
// clears the session fields (as before) and logs to stderr. Everything on the wire —
// endpoints, headers, gzip, the task.xml.gz multipart field, lock-header handling — is
// kept identical to the extension so requests match byte-for-byte.
const zlib = require("zlib");
const { CloudPistonXMLBuilder, CloudPistonXMLParser } = require("./xmlParser");
const { PalLockInfo } = require("./lockInfo");

class CloudPistonAPIManager {
    static async fetchAPI(session, endpoint, headers, task) {
        headers.append("Product-ID", "Webstart Pal Builder");
        headers.append("ContractPal-Version", "2024.3.1.2142 - 7115");
        headers.append("Authorization", "Basic " + Buffer.from(session.username + ":" + session.password).toString("base64"));
        headers.append("ContractPal-Ignore-Version", "true"); //TODO change to setting
        let formData = new FormData();
        if (task !== undefined) {
            let taskXML;
            if (endpoint === "SyncDataSet.do") {
                taskXML = CloudPistonXMLBuilder(false, true).build(task);
            }
            else {
                taskXML = CloudPistonXMLBuilder(false).build(task);
            }
            const compressedTask = zlib.gzipSync(taskXML);
            formData.append("task.xml.gz", new Blob([compressedTask], { type: "text/xml" }));
        }
        const path = "/cpbuilder/" + (endpoint === "Ping.do" ? endpoint : session.userId + "/" + endpoint);
        const resp = await fetch(session.environment.url + path, {
            method: "POST",
            headers: headers,
            body: formData
        });
        if (!resp.ok) {
            console.error("Cloudpiston API failed: " + resp.status);
            if (resp.status === 401) {
                session.password = undefined;
                session.userId = undefined;
                console.error("Failed to log in: invalid username or password");
            }
            return undefined;
        }
        const auth = resp.headers.get("cp-auth");
        if (auth !== null && auth !== "") {
            session.sessionAuthToken = auth;
        }
        const lockHeaders = resp.headers.get("Lock-Information");
        if (lockHeaders !== null) {
            const lockInfoArray = Buffer.from(lockHeaders, "base64").toString().split(",");
            // lockGranted is a string "true"/"false"; the extension's Boolean(lockInfoArray[4])
            // is buggy (Boolean("false") === true). Compare the string so the flag is usable.
            session.lockInfo = new PalLockInfo(lockInfoArray[0], lockInfoArray[1], lockInfoArray[2], lockInfoArray[3], lockInfoArray[4] === "true");
        }
        const respBuf = Buffer.from(await resp.arrayBuffer());
        // Defensive: the extension assumes every 200 body is gzipped and calls unzipSync
        // unconditionally, which throws "unexpected end of file" on an empty body. The
        // server returns an empty 200 (no body, no Lock-Information) when it declines a
        // request — e.g. a lock it won't grant. Treat that as "no result" so callers can
        // fail cleanly (LockPal.do -> abort without save) instead of crashing in zlib.
        if (respBuf.length === 0) {
            return undefined;
        }
        const xmlString = zlib.unzipSync(respBuf);
        return CloudPistonXMLParser().parse(xmlString)["com.contractpal.composer.ComposerResult"];
    }

    static async authenticate(session) {
        const headers = new Headers({
            "profileId": "-1",
            "palId": "-1"
        });
        return await this.fetchAPI(session, "Ping.do", headers, undefined);
    }

    static async getProfileList(session) {
        const headers = new Headers({
            "profileId": "-1",
            "palId": "-1"
        });
        return await this.fetchAPI(session, "GetProfileList.do", headers, undefined);
    }

    static async getGroupList(session, profileId) {
        const headers = new Headers({
            "profileId": profileId,
            "palId": "-1"
        });
        return await this.fetchAPI(session, "GetGroupList.do", headers, undefined);
    }

    static async getPalList(session, profileId, groupId, options) {
        const headers = new Headers({
            "profileId": profileId,
            "groupId": groupId,
            "palId": "-1"
        });
        const task = {
            "com.contractpal.pal.PalSearch": {
                exactName: options?.exactName !== undefined ? options.exactName : false,
                exactDescription: options?.exactDescription !== undefined ? options.exactDescription : false,
                exactCategory: options?.exactCategory !== undefined ? options.exactCategory : false,
                exactPublisher: options?.exactPublisher !== undefined ? options.exactPublisher : false,
                startRecord: options?.startRecord !== undefined ? options.startRecord : 0,
                includeTest: options?.includeTest !== undefined ? options.includeTest : false,
                includeInstalled: options?.includeInstalled !== undefined ? options.includeInstalled : false,
                matchAny: options?.matchAny !== undefined ? options.matchAny : false
            }
        };
        return await this.fetchAPI(session, "GetPalList.do", headers, task);
    }

    static async getPal(session, palId) {
        const headers = new Headers({
            "palId": palId,
            "profileId": "-1",
            "repository-Hint": "false"
        });
        return await this.fetchAPI(session, "GetPal.do", headers, undefined);
    }

    // List the activation keys available to a profile (the dropdown the create-pal wizard
    // shows). Same list pattern as profiles/groups/pals; profileId in the header.
    static async getKeysForBuilder(session, profileId) {
        const headers = new Headers({
            "profileId": profileId,
            "palId": "-1"
        });
        return await this.fetchAPI(session, "GetKeysForBuilder.do", headers, undefined);
    }

    // Create a brand-new pal. No lock (the pal does not exist yet); profileId in the header,
    // groupIds inside palInfoEx. Server mints the id + guid and returns them in the result.
    static async createPal(session, profileId, palInfoEx) {
        const headers = new Headers({
            "profileId": profileId,
            "palId": "-1",
            "repository-Hint": "false"
        });
        const task = {
            "PalInfoEx": palInfoEx
        };
        return await this.fetchAPI(session, "CreatePalFromBuilder.do", headers, task);
    }

    static async savePal(session, pal, palId) {
        if (session.lockInfo === undefined) {
            throw Error("Pal lock required");
        }
        const headers = new Headers({
            "palId": palId,
            "profileId": "-1",
            "repository-Hint": "false",
            "lock-information": session.lockInfo.toHeaderString()
        });
        const task = {
            "com.contractpal.palbuilder.PalBuilderRequest": {
                pal: pal,
                operation: "UPDATE",
                includeDependencies: false,
                platformMetaData: { palFirst: false }
            }
        };
        return await this.fetchAPI(session, "ProcessPalBuilder.do", headers, task);
    }

    static async lockPal(session, palId, forceLock) {
        const headers = new Headers({
            "palId": palId,
            "profileId": "-1",
            "repository-Hint": "false",
        });
        if (forceLock) {
            headers.append("Lock-Force", "1");
        }
        return await this.fetchAPI(session, "LockPal.do", headers, undefined);
    }

    static async unlockPal(session, palId) {
        if (session.lockInfo === undefined) {
            throw Error("Pal lock required");
        }
        const headers = new Headers({
            "palId": palId,
            "profileId": "-1",
            "repository-Hint": "false",
            "lock-information": session.lockInfo.toHeaderString()
        });
        return await this.fetchAPI(session, "UnlockPal.do", headers, undefined);
    }

    // Mint tunnel credentials for a pal (verified live against test-vm1, July 2026). No lock, no
    // body. Returns a ComposerResult carrying { tunnelUrl, tunnelUsername, tunnelPassword }:
    // tunnelUsername is "TB-" + the pal's guid, tunnelPassword is a SHORT-LIVED token (~5 min) —
    // mint on demand and re-mint on a 401 from the tunnel endpoint, never persist.
    static async createTunnel(session, palId) {
        const headers = new Headers({
            "palId": palId,
            "profileId": "-1",
            "repository-Hint": "false"
        });
        return await this.fetchAPI(session, "CreateTunnel.do", headers, undefined);
    }

    // Test a workflow (the builder's "Test pal" action). Returns fresh validationResults — the
    // workflow-COMPILE feedback that ProcessPalBuilder.do (save) does not surface — plus, when
    // the workflow validates, a runnable `token` URL. workflowType is "Console" | "Web" | "Pal"
    // ("Pal" is the Transaction engine). Requires a held lock. Ported from the extension's
    // testWorkflow; endpoint is "Test" + workflowType + ".do".
    static async testWorkflow(session, palId, workflowType) {
        if (session.lockInfo === undefined) {
            throw Error("Pal lock required");
        }
        const headers = new Headers({
            "profileId": "-1",
            "Lock-Information": session.lockInfo.toHeaderString(),
            "palId": palId
        });
        return await this.fetchAPI(session, "Test" + workflowType + ".do", headers, undefined);
    }

    // Provision dataset TABLES on the server from the saved pal's dataset definitions. The pal
    // must be saved first (the definitions come from the saved pal, not this call). Ported from
    // the extension's syncDataSets. SyncDataSet.do is serialized with oneListGroup (see fetchAPI).
    //
    // recreateDataSets=true sends the "Recreate-Dataset: true" header, which DROPS AND REBUILDS
    // the tables — DESTROYING ALL ROWS. Callers MUST gate this behind explicit confirmation;
    // never pass true by default.
    static async syncDataSets(session, palId, recreateDataSets, dataSetNames) {
        if (session.lockInfo === undefined) {
            throw Error("Pal lock required");
        }
        const headers = new Headers({
            "profileId": "-1",
            "lock-information": session.lockInfo.toHeaderString(),
            "palId": palId
        });
        if (recreateDataSets) {
            headers.append("Recreate-Dataset", "true");
        }
        const list = [];
        dataSetNames.forEach((name) => { list.push({ string: name }); });
        const task = { list: list };
        return await this.fetchAPI(session, "SyncDataSet.do", headers, task);
    }

    static async getPlatformInfo(session, palId) {
        if (session.lockInfo === undefined) {
            throw Error("Pal lock required");
        }
        const headers = new Headers({
            "profileId": "-1",
            "repository-Hint": "false",
            "lock-information": session.lockInfo.toHeaderString(),
            "palId": palId
        });
        const task = {
            "com.contractpal.palbuilder.PalBuilderRequest": {
                operation: "GET_PLATFORM_INFO",
                includeDependencies: false
            }
        };
        return await this.fetchAPI(session, "ProcessPalBuilder.do", headers, task);
    }
}

module.exports = { CloudPistonAPIManager };
