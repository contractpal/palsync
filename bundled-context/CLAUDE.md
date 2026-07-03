# PalBuilder Agent Rules

You are editing source for a **PalBuilder (CloudPiston)** pal — a server-side Java/JavaScript
platform. This is your always-on contract; read it before every task. Deep detail lives in the
injected `.claude/skills/` and the docs at https://secure.cloudpiston.com/cpal/cp-api/index.html.
PalBuilder is proprietary — **you don't know this dialect from training**; look up any tag,
attribute, or API method, never guess. A guessed attribute is a hard build error, not a warning.

## Which skill to load
- Brand-new pal from scratch → pal-spec
- Feature/change in an EXISTING pal → pal-init (map first, then pal-spec)
- Bug fix / small correction → pal-fix
- Executing an approved SPEC/EXECUTION → pal-loop
- Build finished, needs a verdict → pal-review (fresh context)
- Platform question only → the relevant palbuilder-* skill

---

## Workspace layout

```
~/PalBuilder/<pal-name>/        # stable path; relaunching the same pal lands here
    pal.json                    # the pal manifest (pull-managed)
    pages/ fragments/ scripts/ styles/ workflows/   # code you edit
    images/ emails/ attachments/ documents/         # assets
    datasets/ dataviews/ data/ datalists/           # schema + JSON passthrough
    .palsync.json .mcp.json .claude/skills/ CLAUDE.md CLAUDE.palsync.md  # palsync-managed
```

Pull is SYNC, not WIPE. The tools enforce safety; you only need the mental model:
- **Pull-managed** = `pal.json` + the 13 manifest folders; pull overwrites these from the server,
  deleting a local file only when the server deleted it.
- **New un-pushed files inside those folders survive** a pull (their `pal.json` entry carries forward).
- **Pull refuses rather than overwrites** un-pushed local edits (push first, or `force:true` to
  discard — new files survive even under force).
- **Root and your own subdirs are never touched** — keep notes/specs/reference images there, not in
  the 13 folders.

---

## GOLDEN RULES — these cause hard failures

1. **XHTML is strict for element structure** — self-close every void tag (`<input ... />`,
   `<img ... />`, `<br />`, `<hr />`, `<col />`); an unclosed tag is a parse error. Exception:
   `<script>`/`<style>` text is raw — write CSS/JS naturally (raw `<`/`>`/`&` round-trip), never
   CDATA-wrap (corrupts CSS) or entity-escape (breaks JS). Avoid `${...}` in inline page `<script>`
   — it collides with server-side EL at render; use string concat or an external `.js`.
2. **Never use an undocumented `c:` attribute** — each tag has a fixed attribute set and an unknown
   attribute throws a validation error; check the reference before using one you haven't.
3. **AJAX fragments do not fire `DOMContentLoaded`** — they load with the DOM already present, so run
   init JS at the bottom of the fragment, never in a `DOMContentLoaded` wrapper (full-page reloads
   are the exception; there it fires).
4. **Never use `fetch`/ClientPal to call the server** — `c:` tags encrypt the action + query before
   HTML reaches the browser; `fetch`/ClientPal expose everything in devtools. Use `c:a`, `c:upload`,
   `c:download`.
5. **`onclick` is not valid on `c:a`** — for a server action use `c:a action=...`; for JS-only
   behavior use a plain `<button onclick="fn()">` or `<a href="#" onclick="fn(); return false;">`.
6. **Workflow JS runs a restricted ES3-style engine** — modern syntax throws at compile time: no
   object literals (`{}` throws — use `c.createData()` for maps, `c.createDataList(name, [cols])` for
   rows); no `let`/`const` (use `var`, `UPPER_SNAKE_CASE` for constants); no arrow functions (use
   `function`); double-quote strings.

---

## Front-end (pages/)

- Pages are **fragments** swapped into named target divs via AJAX, or delivered by full-page reload
  — both valid. Each fragment holds the namespace on a `c:ignore` wrapper
  (`<c:ignore xmlns:c="contractpal">…</c:ignore>`); server values bind with EL (`${user.firstName}`).
- Modal fragments contain **only inner content** — the shell provides the Bootstrap wrapper; the
  `feedback` span receives server messages; `hideModal()` is global.
- Organize fragment JS with the **module pattern** (`onclick="MyModule.fn()"`) — no flat globals, no
  anonymous listeners. Bootstrap dropdowns loaded via AJAX must be manually initialized.
- Common `c:` tags: `c:a`, `c:upload`, `c:list`, `c:set`, `c:if`, `c:choose/when/otherwise`,
  `c:fragment`, `c:download`, `c:field`, `c:ignore`. Full attribute lists + per-tag gotchas (e.g.
  `c:upload allow`, `c:list name`+`id`): `.claude/skills/palbuilder-frontend/references/tag-reference.md`.

---

## Back-end (workflows/)

Every workflow has one `run(controller)` entry point: **(1)** define globals, **(2)** common setup,
**(3)** action switch, one function per `case`, **(4)** prepare and return the response.
Unknown-action fallback is `c.createAjaxResponse("ignore", false)`, never an error message.

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

Declare only the globals you use.

- **Three-layer architecture** as a pal grows: presentation (`run()`, routing) → service (`lib/*.js`)
  → data (`data/*.js`, all dataset I/O); each layer calls only the one below; shared libs take args,
  not globals.
- **Datasets:** camelCase plural; primary key = singular + `Id` (`users` → `userId`); access via
  `pal.getDataSet("name")`, `createFilter()`, `addEqual(...)`, `selectColumns([...])`,
  `findRecord()`/`getRecords()`.
- **Payload** carries data to the template (`${var}`): `payload.set/setBoolean/setInt(...)`, then
  `ajax.addPayload(payload)` / `page.addPayload(payload)`.
- **Remove every debug call (`c.debug*`), commented-out code, and unused file before finishing.**

Full `ConsoleController` + request/payload APIs:
`.claude/skills/palbuilder-backend/references/api-reference.md`.

---

## Anti-patterns to refuse
- Re-architecting around the platform — use the native API directly; if it's genuinely lacking, say
  so rather than working around it.
- Leaving `console.log` / `c.debug` in finished code.
- Inventing tag attributes or API methods instead of looking them up.

---

## Before you finish a task
Valid XHTML (void tags self-closed) · no undocumented `c:` attributes · no `fetch`/ClientPal server
calls · AJAX-loaded JS outside `DOMContentLoaded` · reserved globals used only as defined · debug
calls, dead code, and unused files removed.
