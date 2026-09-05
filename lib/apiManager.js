"use strict";
// Ported from the extension's out/cloudpistonAPIManager.js.
// vscode stripped: the 401 branch no longer calls vscode.window.showErrorMessage; it
// clears the session fields (as before) and logs to stderr. Everything on the wire —
// endpoints, headers, gzip, the task.xml.gz multipart field, lock-header handling — is
// kept identical to the extension so requests match byte-for-byte.
const zlib = require("zlib");
const { CloudPistonXMLBuilder, CloudPistonXMLParser, fixOrderSensitiveShapes, buildOrderSensitiveShapes } = require("./xmlParser");
const { PalLockInfo } = require("./lockInfo");

class CloudPistonAPIManager {
    static async fetchAPI(session, endpoint, headers, task) {
        headers.append("Product-ID", "Chip Pal Builder");
        headers.append("ContractPal-Version", "0.0.0.0");
        headers.append("Authorization", "Basic " + Buffer.from(session.username + ":" + session.password).toString("base64"));
        headers.append("ContractPal-Ignore-Version", "true"); //TODO change to setting
        let formData = new FormData();
        if (task !== undefined) {
            let taskXML;
            if (endpoint === "SyncDataSet.do") {
                taskXML = buildOrderSensitiveShapes(task, false, true);
            }
            else {
                taskXML = buildOrderSensitiveShapes(task, false);
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
        // Transport outcome for callers that must tell an HTTP failure apart from an empty 200 —
        // fetchAPI maps BOTH to `undefined`, which made a declined request look like a lost
        // connection. Overwritten by every call; only meaningful immediately after one.
        session.lastTransport = { endpoint: endpoint, status: resp.status, ok: resp.ok, bytes: null };
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
        session.lastTransport.bytes = respBuf.length;
        // Defensive: the extension assumes every 200 body is gzipped and calls unzipSync
        // unconditionally, which throws "unexpected end of file" on an empty body. The
        // server returns an empty 200 (no body, no Lock-Information) when it declines a
        // request — e.g. a lock it won't grant. Treat that as "no result" so callers can
        // fail cleanly (LockPal.do -> abort without save) instead of crashing in zlib.
        if (respBuf.length === 0) {
            return undefined;
        }
        const xmlString = zlib.unzipSync(respBuf);
        const result = CloudPistonXMLParser().parse(xmlString)["com.contractpal.composer.ComposerResult"];
        // See xmlParser.js's fixOrderSensitiveShapes: the primary parse groups each DataList
        // row's / Data pair's cells by tag name (string vs null), losing original column order.
        // Reconstruct it from the same raw XML before anything else touches the result.
        return fixOrderSensitiveShapes(xmlString, result);
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

    // opts.sourceControlEnabled mirrors GetPal.do's ComposerResult.sourceControlEnabled — only
    // when true does the server expect/honor the Source-Commit headers. opts.commitMessage is a
    // human-readable summary of the change; leave it unset for exploratory/testing pushes (the
    // server still gets Source-Commit: false so it knows no commit was intended).
    static async savePal(session, pal, palId, { sourceControlEnabled = false, commitMessage = null } = {}) {
        if (session.lockInfo === undefined) {
            throw Error("Pal lock required");
        }
        const headers = new Headers({
            "palId": palId,
            "profileId": "-1",
            "repository-Hint": "false",
            "lock-information": session.lockInfo.toHeaderString()
        });
        if (sourceControlEnabled) {
            headers.append("Source-Commit", commitMessage ? "true" : "false");
            if (commitMessage) {
                headers.append("Source-Commit-Message", Buffer.from(commitMessage, "utf8").toString("base64"));
            }
        }
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

    // Retrieve the pal's server-side c.debug(...) buffer (verified live against test-vm1, July
    // 2026): Ping.do with palId + retrieveDebug headers returns a ComposerResult whose
    // `serverData` is the base64 of the accumulated debug text. CONSUME-ONCE and SHARED —
    // reading clears the buffer for every viewer, including the PalBuilder IDE's debug view.
    static async retrieveDebug(session, palId) {
        const headers = new Headers({
            "profileId": "-1",
            "palId": palId,
            "retrieveDebug": "true"
        });
        return await this.fetchAPI(session, "Ping.do", headers, undefined);
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

    // Read-only dataset query — hard-coded QUERY_DATASET operation, dataset mode.
    // Evidence: com/contractpal/palbuilder/PalBuilderRequest.java Operation.QUERY_DATASET,
    // com/contractpal/palbuilder/DatasetFilter.java view:false (dataset, not DataView),
    // com/contractpal/palbuilder/DatasetQueryResult.java totalRecords/columns/data.
    // This method never acquires a lock and never calls save/sync/recreate paths.
    //
    // Identity contract, verified live against secure.cloudpiston.com (2026-09-02) and matching
    // PalServiceManager.getDatasetData() + PalbuilderTaskConnector.runTask():
    //   * header palId is the SESSION-SCOPED INTERNAL id (what the desktop client keeps in
    //     connector.palId), header profileId is "-1" — as runTask sends for ProcessPalBuilder.do.
    //     Putting the PAL-SE guid in the palId HEADER is what made this call return HTTP 200 with
    //     a ZERO-BYTE body (the server's way of rejecting a malformed PalBuilder request).
    //   * body palId is the STABLE PAL-SE GUID and body profileId is the REAL profile id — both
    //     are required together: the internal id in the body answers "Pal not found", a body
    //     profileId of "-1" answers "Error decrypting Secure ID", and omitting it answers
    //     "Secure ID is null".
    //   * NO lock is required (verified: identical success with and without lock-information),
    //     which is why the two dataset tools stay needsLock:false.
    static async queryDataset(session, resolved, filter) {
        const headers = new Headers({
            "profileId": "-1",
            "palId": resolved.id,
            "repository-Hint": "false"
        });
        const task = {
            "com.contractpal.palbuilder.PalBuilderRequest": {
                operation: "QUERY_DATASET",
                palId: resolved.guid,
                profileId: resolved.profileId,
                datasetFilter: filter
            }
        };
        return await this.fetchAPI(session, "ProcessPalBuilder.do", headers, task);
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
