# PalBuilder Agent Rules

You are editing source for a **PalBuilder (CloudPiston)** pal — a server-side
Java/JavaScript platform. This file is your always-on contract. Read it before
every task. For deep detail, read the injected skill files in `.claude/skills/`
(`palbuilder-frontend/SKILL.md` for pages/fragments/c: tags,
`palbuilder-backend/SKILL.md` for workflow JS) and the official docs at
https://secure.cloudpiston.com/cpal/cp-api/index.html. Specialized work has its
own skills too: `palbuilder-jobs-http` (background jobs / server-side HTTP),
`palbuilder-websockets` (real-time), `design-build` (visual system), `seo-core` (SEO).

PalBuilder is proprietary. **You do not know this dialect from training.** When
unsure about a tag, an attribute, or an API method, look it up in the skill
files or the docs — never guess. A guessed attribute is a hard build error, not
a warning.

---

## Workspace layout

```
~/PalBuilder/<pal-name>/        # stable path; relaunching the same pal lands here
    pal.json                    # the pal manifest (pull-managed)
    pages/                      # XHTML fragments — the c:-tag markup
    fragments/                  # reusable fragments (modals, partials)
    workflows/                  # server-side JS — run(controller) entry points
    scripts/                    # client-side JS
    styles/                     # CSS
    images/  emails/  attachments/  documents/
    datasets/   # schema JSON — create/update tables via pal_sync_datasets
    dataviews/  data/  datalists/    # JSON passthrough (managed in PalBuilder)
    .palsync.json               # palsync sync state (lock holder, drift marker, etc.)
    .claude/skills/             # palsync-injected skills (palbuilder-frontend/backend, …)
    CLAUDE.md  CLAUDE.palsync.md
    .mcp.json                   # MCP server config (palsync-managed)
```

**Pull is SYNC, not WIPE — what survives a `pal_pull`:**

- **Pull-managed (server-tracked)** — `pal.json` + everything inside the **13 manifest folders**
  above (`pages/`, `fragments/`, `scripts/`, `styles/`, `images/`, `emails/`, `attachments/`,
  `documents/`, `workflows/`, `datasets/`, `dataviews/`, `data/`, `datalists/`). Pull overwrites
  these from the server, and removes a local file only when the **server deleted it** (it was
  server-tracked at your last pull and is gone now).
- **NEW un-pushed files inside the manifest folders are PRESERVED.** A file you created (plus
  its `pal.json` entry) that hasn't been pushed yet survives a pull — the entry is carried
  forward into the refreshed `pal.json` so the next push still ships it. Still, don't park
  notes or scratch files in these folders; they belong at the workspace root.
- **Pull refuses rather than overwrites.** If server-tracked files have un-pushed local edits,
  `pal_pull` refuses and names the files (push first, or `force:true` to discard the edits —
  new local files are preserved even under force).
- **Untouched by pull** — anything at the workspace root that isn't `pal.json`, and any
  user-created subdir that isn't one of the 13 above. Project notes, specs, reference images,
  design assets, etc. go HERE:
  ```
  ~/PalBuilder/<pal-name>/spec.md             # ← safe; pull never touches this
  ~/PalBuilder/<pal-name>/references/*.png    # ← safe; pull never touches this
  ~/PalBuilder/<pal-name>/notes/              # ← safe; pull never touches this
  ```
  palsync-managed files (`.palsync.json`, `.mcp.json`, `.claude/`, `CLAUDE.md`,
  `CLAUDE.palsync.md`) are also untouched by pull — they are refreshed only when the launcher
  re-runs setup.

**Bottom line:** the workspace is a stable project directory. Edit pal code in place inside
the 13 folders, and keep project notes / references / assets at the root or in your own
subfolders. Pull refreshes the former; the latter survive forever.

---

## GOLDEN RULES — these cause hard failures

1. **XHTML is strict — for element structure.** Every void tag must be explicitly
   self-closed: `<input ... />`, `<img ... />`, `<br />`, `<hr />`, `<col />`. An
   unclosed tag is a parse error, not a lint warning. This strictness covers
   **tags and attributes only** — it does NOT apply to the **text content of
   `<script>` and `<style>`**, which is raw text. Write CSS and JS naturally
   there: raw `<`, `>`, `&` round-trip byte-for-byte (verified live). Do **not**
   CDATA-wrap script/style (the XML layer mangles it and corrupts CSS) and do
   **not** entity-escape `<`/`>`/`&` inside them (stored literally, breaks JS).
   One caveat: avoid `${...}` template literals in inline page `<script>` — `${}`
   collides with server-side EL at render time; use string concat or an external
   `.js` file. (Native CSS nesting `&` and JS `&&` emit cosmetic, non-fatal CSS-linter
   notes — the save still succeeds and content is unchanged.)
2. **Never use an undocumented `c:` attribute.** Each `c:` tag has a fixed
   attribute set. Using any attribute not in the reference throws a validation
   error. Check before using an attribute you haven't used before.
3. **AJAX fragments do not fire `DOMContentLoaded`.** Fragments loaded via
   `ajax-target` run with the DOM already present — run init JS directly at the
   bottom of the fragment, never inside a `DOMContentLoaded` wrapper. (Full-page
   reloads are the exception; there it fires normally.)
4. **Never use `fetch` or ClientPal to call the server** unless there is
   genuinely no other way. `c:` tags are server-rendered and encrypt the action
   and query string before HTML reaches the browser; `fetch`/ClientPal expose
   everything in devtools. Use `c:a`, `c:upload`, `c:download`, etc.
5. **`onclick` is not valid on `c:a`.** For a server action use `c:a action=...`.
   For JS-only behavior use a plain `<button onclick="fn()">` or
   `<a href="#" onclick="fn(); return false;">`.
6. **Workflow JS runs a restricted ES3-style engine.** Modern syntax throws at
   compile time:
   - **No object literals** — `{}` throws; this is the #1 breaker. Build maps with
     `c.createData()` (key→value) and row sets with `c.createDataList(name, [cols])`,
     never `{ a: 1 }`.
   - **No `let`/`const`** — use `var`; signal immutability with `UPPER_SNAKE_CASE`.
   - **No arrow functions** — use `function`.
   - Strings use double quotes, always.

---

## Front-end (pages/)

- Pages are composed of **fragments** swapped into named target divs via AJAX, or
  delivered via full-page reload. Both are valid.
- Fragment files hold the namespace on a `c:ignore` wrapper:
  `<c:ignore xmlns:c="contractpal"> ... </c:ignore>`.
- Server values bind with EL syntax: `${user.firstName}`, `${settings.logoUrl}`.
- Modal fragments contain **only inner content** (header/body/footer) — the outer
  shell already provides the Bootstrap modal wrapper. The `feedback` span
  receives server response messages. `hideModal()` is a global JS function.
- Organize fragment JS with the **module pattern** (named object, return the
  public functions), called from HTML via `onclick="MyModule.fn()"`. No flat
  globals, no anonymous listeners.
- Bootstrap dropdowns loaded via AJAX must be manually initialized.

Common `c:` tags: `c:a` (action/nav link), `c:upload` (`allow` is required; use
keywords like `image`/`pdf`, never MIME strings; one per page), `c:list`
(needs `name` + `id`), `c:set`, `c:if`, `c:choose/when/otherwise`, `c:fragment`,
`c:download`, `c:field`, `c:ignore`. Full attribute lists:
`.claude/skills/palbuilder-frontend/SKILL.md` and
https://secure.cloudpiston.com/cpal/cp-api/console-tags/summary.html

---

## Back-end (workflows/)

Every workflow has one `run(controller)` entry point. Structure:
**(1)** define globals, **(2)** common setup, **(3)** action switch where each
`case` calls exactly one function, **(4)** prepare and return the response.

Unknown-action fallback is `c.createAjaxResponse("ignore", false)` — never an
error message.

**Reserved global names** — use only for their defined value, nothing else:

| Var | Value | Var | Value |
|---|---|---|---|
| `c` | controller | `payload` | `c.createPayload()` |
| `pal` | `c.getPal()` | `action` | `c.getAction()` |
| `tx` | transaction | `formatter` | `c.getFormatter()` |
| `request` | `c.getRequest()` | `validator` | `c.getValidator()` |
| `data` | `request.getData()` | `cm` | `pal.getCacheManager()` |
| `page` | `c.getPage("")` | `dateUtil` | `c.getDateUtil()` |
| `ajax` | `c.createAjaxResponse()` | `resp` | any other response |

Declare only the globals you actually use.

**Three-layer architecture** as a pal grows: presentation (the `run()` file,
routing + responses) → service (`lib/*.js`, business logic) → data (`data.js`
or `data/*.js`, all dataset reads/writes). Each layer calls only the layer below.
Library functions shared across workflows must take everything as arguments — no
hidden dependence on globals.

**Datasets:** camelCase, plural. Primary key = singular name + `Id` (dataset
`users` → key `userId`). Access via `pal.getDataSet("name")`, `createFilter()`,
`addEqual(...)`, `selectColumns([...])`, `findRecord()` / `getRecords()`.

**Payload** carries data to the template (`${var}`): `payload.set/setBoolean/
setInt(...)`, then `ajax.addPayload(payload)` or `page.addPayload(payload)`.

**Debug** freely with `c.debug()`, `c.debugData()`, `c.debugList()` — then
**remove every debug call before finishing.** Same for commented-out code and
unused files: delete them.

Full `ConsoleController` method list and request/payload APIs:
`.claude/skills/palbuilder-backend/SKILL.md` and
https://secure.cloudpiston.com/cpal/cp-api/console/index.html

---

## Anti-patterns to refuse

- Re-architecting around the platform (custom abstractions over what PalBuilder
  already does cleanly). Use the native API directly. If the API is genuinely
  lacking, say so rather than working around it.
- Leaving `console.log` / `c.debug` in finished code.
- Inventing tag attributes or API methods instead of looking them up.

---

## Before you finish a task

- [ ] All void tags self-closed; markup is valid XHTML.
- [ ] No undocumented `c:` attributes (verified against the reference).
- [ ] No `fetch`/ClientPal for server calls.
- [ ] AJAX-loaded JS not wrapped in `DOMContentLoaded`.
- [ ] Reserved globals used only for their defined meaning.
- [ ] Debug calls, dead code, and unused files removed.
