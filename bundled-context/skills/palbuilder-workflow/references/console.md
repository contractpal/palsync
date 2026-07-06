# Console Workflows (`workflowType: 7`)

The console workflow serves the pal's authenticated in-platform UI. Users are logged-in
CloudPiston users accessing the pal via a **profile**; the pal appears as an application in
the platform's left-side menu at the CloudPiston domain (e.g.,
`secure.nimblewire.com/cpal/GetConsole.do`).

**Access mode summary** — see `palbuilder-core/references/pal-structure.md` for the console
vs web distinction.

**Official APIs:**
- Console controller: https://secure.cloudpiston.com/cpal/cp-api/console/index.html
- User: https://secure.cloudpiston.com/cpal/cp-api/console/User.html
- Profile: https://secure.cloudpiston.com/cpal/cp-api/console/Profile.html
- Formatter: https://secure.cloudpiston.com/cpal/cp-api/console/Formatter.html
- Validator: https://secure.cloudpiston.com/cpal/cp-api/console/Validator.html

Companion:
- `../SKILL.md` — the `run()` pattern, reserved globals, action switch (universal to all types)
- `responses.md` — page, ajax, download, redirect
- `transaction.md` — console pals commonly manage transactions

---

## What's specific to console workflows

Console workflows are the most common type. Everything in the base `run()` pattern applies.
The console-specific concerns are:

1. **Authenticated user + active profile.**
2. **Console menu integration** — the pal has a registered name and icon in the platform's
   app menu.
3. **The `palTypeConsole` palType** — pages, fragments, scripts, and styles marked for the
   console context.
4. **Console pals commonly orchestrate transactions** — see `transaction.md`.

---

## Users and Profiles

Every user in a console app accesses the pal through a **profile**. Two kinds exist:

- **Personal profile** — the user's individual identity.
- **Enterprise profile** — the user acting on behalf of an enterprise.

A single user can have multiple profiles and switch between them; the workflow sees whichever
profile is currently active.

### Accessing the user and active profile

```js
var user = c.getUser();
if (user == null) {
    // Should not happen in a console workflow, but guard anyway
    return c.redirect(pal.getSecureWebUrl("login.do"));
}

var profile = user.getProfile();             // the ACTIVE profile — personal or enterprise
```

**There is no `user.getUserId()`.** Identity for per-user data isolation comes from the
profile object — see below.

Refer to the linked User and Profile API docs for the full accessor set (getName, getEmail,
`isPersonalProfile`/`isEnterpriseProfile`, etc.).

### Where user data lives

**User data is stored in a CloudPiston-managed dataset, not pal datasets.** The pal cannot
directly read from or write to the platform's user tables; use the User and Profile API
accessors instead. Anything you store *about* users in a pal-owned dataset (preferences,
per-user records, etc.) is separate — that data lives in the pal's own datasets and needs
its own identifier column.

### Per-user data isolation

For pal-owned datasets that hold per-user records, key rows to the active profile:

```js
var listsDS = pal.getDataSet("lists");
var filter  = listsDS.createFilter();
filter.selectColumns(["listId", "name"]);
filter.addEqual("profileId", c.getUser().getProfile().getId());     // verify getter name in API docs
var myLists = listsDS.getRecords(filter);
```

The exact profile-id accessor varies (`getId`, `getProfileId`, `getUUID`, etc.) — check the
Profile API docs for the canonical getter.

---

## Console menu registration

The pal's appearance in the CloudPiston app menu (icon, label) is configured in `pal.json`.
See `palbuilder-core/references/pal-json.md` for the manifest structure.

**Hiding the console menu on a specific page** — pages carry a `hideConsoleMenu` boolean:

```json
{
  "string": "fullscreen.html",
  "Page": {
    "palType": "palTypeConsole",
    "hideConsoleMenu": true
  }
}
```

`true` renders the page without the platform's left-side menu — useful for wizard flows or
immersive views.

---

## Console default workflow

Every console pal registers a default console workflow in the `layout` block of `pal.json`:

```json
{
  "layout": {
    "consoleWorkflow": "defaults/default_console.js"
  }
}
```

Any request that doesn't specify a different workflow enters through this one. Additional
console workflows can be registered and reached via delegation.

---

## Delegation — switchToWorkflow, switchToConsolePal, switchToNavigator

Console workflows can hand off to other workflows in three ways:

### Same-pal delegation — `switchToWorkflow`

Delegate to another workflow within the same pal (e.g., a hub-and-spoke pattern):

```js
default:
    return c.switchToWorkflow("console", action);
```

Covered in the SKILL.md.

### Cross-pal delegation — `switchToConsolePal`

Hand off to a different console pal in the same enterprise:

```js
return c.switchToConsolePal(palId, action);
```

- **`palId`** — the target pal's identifier
- **`action`** — the action string to invoke in the target pal

Full API: https://secure.cloudpiston.com/cpal/cp-api/console/index.html#F562EB1E16BF46CFAAB88E0395D4A014

### Transaction delegation — `switchToNavigator`

Hand off to a transaction workflow to operate on a specific transaction packet:

```js
return c.switchToNavigator(txId, action, anon);
```

- **`txId`** — the transaction (packet) id to enter
- **`action`** — the action to invoke in the transaction workflow
- **`anon`** — boolean; whether to enter anonymously

("Navigator" and "packet" are older terms for what's now called a transaction — the method
name has been kept for backward compatibility.)

Full API: https://secure.cloudpiston.com/cpal/cp-api/console/index.html#49D45115F741D3C011585529F44F4A8C

---

## Enterprise-level settings

`c.getEnterprise().getGlobalSetting(key)` reads enterprise-level configuration values shared
across every pal in the enterprise:

```js
var exitUrl = c.getEnterprise().getGlobalSetting("exitUrl");
```

Note: **`getGlobalSetting` is available in web workflows too** — not restricted to console.
See `web.md`.

---

## Console pals and transactions

**Console pals commonly manage transactions.** A transaction workflow (type 2) rarely runs in
isolation — the typical pattern is:

- A console workflow lists / filters / creates transaction packets
- The user picks or creates a packet
- The console workflow delegates to the transaction workflow via `switchToNavigator(txId,
  action, anon)`

Reading transaction packets *without* switching workflows (e.g., to list them or extract
summary data) is also common from console workflows. The exact accessor for listing
transactions is on the console controller — see the API docs.

See `transaction.md` for what happens on the transaction side of that handoff.

---

## Common gotchas

- **No `user.getUserId()` method.** Identity comes from `user.getProfile()` and its
  accessors. Legacy code that references `getUserId` needs correction.
- **`c.getUser()` may still be null** in edge cases (session expiry mid-request). Guard
  defensively.
- **Console workflows should NOT be used for anonymous public content.** Use a `web` workflow
  (type 9) for anything a signed-out user needs to reach.
- **User data is in CloudPiston-managed storage, not pal datasets.** Don't try to write to
  user records via `pal.getDataSet("users")` — the pal doesn't own that table. For per-user
  data owned by the pal, use a pal-owned dataset keyed by profile id.
- **The console URL is fixed by the platform.** If the pal needs custom URLs for user-facing
  navigation, that's a web workflow concern.
