"use strict";
const { test } = require("node:test");
const assert = require("node:assert");

// In-memory stand-in for the OS keychain so the suite never touches a real one.
function installFakeKeyring() {
    const store = new Map(); // "service\0account" -> secret
    const id = require.resolve("@napi-rs/keyring");
    const fake = {
        Entry: class {
            constructor(service, account) { this.k = service + "\0" + account; this.service = service; this.account = account; }
            setPassword(p) { store.set(this.k, p); }
            getPassword() { return store.has(this.k) ? store.get(this.k) : null; }
            deleteCredential() { store.delete(this.k); }
        },
        findCredentials(service) {
            return [...store.entries()].filter(([k]) => k.startsWith(service + "\0"))
                .map(([k, password]) => ({ account: k.split("\0")[1], password }));
        }
    };
    const prior = require.cache[id];
    require.cache[id] = { id, filename: id, loaded: true, exports: fake };
    delete require.cache[require.resolve("../src/platform/testAccounts")];
    delete require.cache[require.resolve("../src/core/exercise")];
    return { store, restore() {
        if (prior) require.cache[id] = prior; else delete require.cache[id];
        delete require.cache[require.resolve("../src/platform/testAccounts")];
        delete require.cache[require.resolve("../src/core/exercise")];
    } };
}

const URL_A = "https://cloud-a.example/";
const URL_B = "https://cloud-b.example/";

test("test accounts: alias lookup ignores case and spacing, and is scoped to the cloud", () => {
    const fake = installFakeKeyring();
    try {
        const ta = require("../src/platform/testAccounts");
        ta.setTestAccount(URL_A, "Bob  Admin", "bob.user", "s3cret");
        assert.deepStrictEqual(ta.listAliases(URL_A), ["Bob Admin"]);
        const hit = ta.getTestAccount(URL_A, "  bob admin ");
        assert.deepStrictEqual([hit.alias, hit.username, hit.password], ["Bob Admin", "bob.user", "s3cret"]);
        assert.strictEqual(ta.getTestAccount(URL_A, "Bobby"), null);
        assert.strictEqual(ta.getTestAccount(URL_B, "Bob Admin"), null, "another cloud's accounts are not visible");
    } finally { fake.restore(); }
});

test("test accounts: re-saving a case/spacing variant replaces it instead of duplicating", () => {
    const fake = installFakeKeyring();
    try {
        const ta = require("../src/platform/testAccounts");
        ta.setTestAccount(URL_A, "Bob", "u1", "p1");
        ta.setTestAccount(URL_A, "bob", "u2", "p2");
        assert.deepStrictEqual(ta.listAliases(URL_A), ["bob"]);
        assert.strictEqual(ta.getTestAccount(URL_A, "BOB").username, "u2");
        assert.strictEqual(ta.deleteTestAccount(URL_A, "Bob"), true);
        assert.strictEqual(ta.deleteTestAccount(URL_A, "Bob"), false);
        assert.deepStrictEqual(ta.listAliases(URL_A), []);
    } finally { fake.restore(); }
});

test("test accounts: never share the developer's own credential namespace, and listAccounts hides the password", () => {
    const fake = installFakeKeyring();
    try {
        const ta = require("../src/platform/testAccounts");
        ta.setTestAccount(URL_A, "Bob", "bob.user", "s3cret");
        assert.ok(ta.serviceFor(URL_A).startsWith("palsync-test:"));
        assert.ok(![...fake.store.keys()].some(k => k.startsWith("palsync:" + URL_A)), "nothing lands under the developer's service");
        assert.deepStrictEqual(ta.listAccounts(URL_A), [{ alias: "Bob", username: "bob.user" }]);
        assert.throws(() => ta.setTestAccount(URL_A, "  ", "u", "p"), /alias/);
        assert.throws(() => ta.setTestAccount(URL_A, "X", "", "p"), /username and a password/);
    } finally { fake.restore(); }
});

test("login credentials: no alias = developer's own account; alias = that cloud's test account; unknown alias is a plain message", () => {
    const fake = installFakeKeyring();
    try {
        const ta = require("../src/platform/testAccounts");
        const { resolveLoginCredentials } = require("../src/core/exercise");
        const session = { username: "dev", password: "devpw", environment: { url: URL_A } };
        ta.setTestAccount(URL_A, "Bob Admin", "bob", "bobpw");
        assert.deepStrictEqual(resolveLoginCredentials(session, null),
            { username: "dev", password: "devpw", who: "your own account" });
        const bob = resolveLoginCredentials(session, "bob admin");
        assert.deepStrictEqual([bob.username, bob.password], ["bob", "bobpw"]);
        assert.deepStrictEqual(resolveLoginCredentials(session, "Bobby"), { error: "No test account exists for 'Bobby'." });
    } finally { fake.restore(); }
});

test("pal_exercise login step: validation, label and browser requirement", () => {
    const fake = installFakeKeyring();
    try {
        const ex = require("../src/core/exercise");
        assert.deepStrictEqual(ex.validateSteps([{ click: "Login" }, { login: true }, { login: true, as: "Bob" }]), []);
        assert.ok(ex.validateSteps([{ login: "yes" }])[0].includes("login must be true"));
        assert.ok(ex.validateSteps([{ as: "Bob", expect: ["x"] }]).some(e => e.includes("only goes with login")));
        assert.ok(ex.validateSteps([{ login: true, as: " " }]).some(e => e.includes("test-account alias")));
        assert.strictEqual(ex.stepLabel({ login: true }), "login");
        assert.strictEqual(ex.stepLabel({ login: true, as: "Bob" }), 'login as "Bob"');
        assert.strictEqual(ex.needsBrowser([{ login: true }]), true);
    } finally { fake.restore(); }
});

test("pal_exercise login step: unknown alias blocks before any test instance is minted", async () => {
    const fake = installFakeKeyring();
    try {
        const ex = require("../src/core/exercise");
        const session = { username: "dev", password: "devpw", environment: { url: URL_A } };
        const res = await ex.runExercise(session, "PAL-X", { steps: [{ click: "Login" }, { login: true, as: "Bobby" }], workflow: "web" },
            { attemptWithFreshTest() { throw new Error("must not mint a test instance"); } });
        assert.strictEqual(res.status, "blocked");
        assert.strictEqual(res.category, "credentials");
        assert.strictEqual(res.potentialMutationStarted, false);
        assert.strictEqual(res.reason, "No test account exists for 'Bobby'.");
        assert.ok(!JSON.stringify(res).includes("devpw"));
    } finally { fake.restore(); }
});
