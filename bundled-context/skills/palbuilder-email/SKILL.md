---
name: palbuilder-email
description: Use this skill whenever a Palbuilder (CloudPiston) pal needs to send email from workflow code — OTP/login codes, notifications, reminders, transactional mail. Covers the Email/TextEmail API (c.createEmail, template variable substitution, sendToAddress), the emails/ file + pal.json entry shape, and a confirmed platform restriction that blocks sending from a Web pal without Enterprise SMTP. Trigger when writing any workflow that calls c.createEmail, sendToAddress, or creates/edits files under emails/.
---

# Email Sending — Palbuilder Skill

Companion to `palbuilder-backend`. Covers the `Email`/`TextEmail` API and a real platform
restriction discovered building an email-based flow on a live pal — read this before assuming
email sending "just works" from a Web pal.

---

## ⚠️ Web pal email requires Enterprise SMTP — confirmed by live test

Calling `sendToAddress()` from a **Web** workflow (`workflowType: 9`) throws, even though the
code is otherwise correct and reaches the call:

```
Error processing your request:
Message:    Enterprise level SMTP is required for web email.
Method Called:    WebControllerImpl.createEmail
```

This is an **account/platform-tier limitation, not a code bug** — `pal_validate`,
`pal_push`, and `pal_test` all pass clean; the failure only surfaces when the action actually
runs (e.g. via the live preview). There is no client-side or offline way to catch this ahead of
time — you only find out by exercising the real action.

**Implications for design:**
- Don't assume a public/open-internet (Web) workflow can send email at all until this is
  confirmed enabled on the account. If you're designing an email-code login flow, a contact-form
  notification, or anything else that emails from the web side, flag this risk to the human
  early — it's an account setting, not something to code around blindly.
- **Unverified, not yet tested:** whether **Console** (`workflowType: 7`) or **Job**
  (`workflowType: 11`, console-system) contexts share this restriction. `WebController` and
  `ConsoleController` are different classes; it's plausible only the Web-pal path is
  restricted. If you hit this blocker, a live test from a console action or a job is the next
  empirical step — don't assume either way without testing.
- `createEmail(String emailName, String emailSettingsId)` (the two-arg overload) exists
  specifically to pass an *enterprise email settings* ID — this is the documented hook for
  whatever "Enterprise SMTP" configuration unlocks this. Where that's configured (account
  settings, enterprise admin, billing tier) is not visible from workflow code or docs; ask the
  human to check PalBuilder/CloudPiston account-level settings.
- If Enterprise SMTP isn't available, the fallback is sending over `ServiceRequest` (see
  `palbuilder-jobs-http`) to a third-party email API (SendGrid, Mailgun, etc.) instead of the
  platform's own Email API — more moving parts, but not gated by this restriction.

---

## The Email / TextEmail API (confirmed via API docs)

```js
var email = c.createEmail("templateName");    // "templateName" = the emails/ file name, no extension
email.setSubject("Your subject line");        // overrides whatever the template's own subject is
email.setString("someVar", value);             // populates ${someVar} in the template body
var jobId = email.sendToAddress(toEmail);      // sends AND sets the recipient; returns a job id, or "BLOCKED"
```

- **No separate "set recipient" call** — `sendToAddress(email)` / `sendToAddresses(String[])` both
  send immediately AND specify who to. There is no `send()` with a previously-set recipient.
- **Template variables**, not object construction: `set(name, Object)`, `setString`, `setInt`,
  `setDouble`, `setBoolean`, `setDate`, `setData(id, Data)` — one call per variable, matching the
  workflow engine's ban on object literals (see `palbuilder-backend`).
- `setFrom(name, address)`, `setReplyTo(email)`, `addFile(File)`, `enableReply(workflow)`,
  `schedule(Date)` (delay delivery instead of sending now) also exist.
- `createTextEmail(name)` — same idea, plain-text body instead of XHTML.
- Check the return value: `sendToAddress` returns `"BLOCKED"` (string) if the address is on a
  blocklist — this is a real failure mode to handle, not just a hypothetical.

---

## Email template files — confirmed shape

An email template lives at `emails/<name>.html` and needs a matching `pal.json` entry, same
family as pages/fragments/scripts/workflows (content is base64-loaded from disk at push time —
leave `"content": ""`):

```json
{ "string": "templateName.html", "Email": { "content": "", "contentType": "text/html",
  "filename": "templateName.html" } }
```

After a push+pull round trip, the server adds its own fields (`"text": false`, and — same as
every other content type — it may reformat/reindent the file). Confirmed **not to work**: adding
a `"subject"` key to the `Email` entry in `pal.json`, and adding a `<title>` tag inside the email
HTML — neither cleared the server's `Email does not have a subject.` validation note, and neither
survived a push+pull round trip unchanged. **Set the subject in code with `setSubject()`** — the
validation note about a missing template-level subject persists regardless (confirmed harmless:
push still returns `save OK`, and the email sends with the correct runtime subject once Enterprise
SMTP is available) — treat it like the other cosmetic, non-fatal validation notes this platform
emits (see `palbuilder-frontend`'s CSS-linter note), not a real error.

The body uses the same `${var}` EL substitution as pages/fragments:

```html
<html>
    <head><title>Your subject line</title></head>
    <body>
        <p>Your value is: <strong>${someVar}</strong></p>
    </body>
</html>
```

(The server may inject `xmlns:c="contractpal"` and wrap the body in `<div id="cp-root">` on
save/pull, mirroring how it treats page files — cosmetic, don't fight it.)
