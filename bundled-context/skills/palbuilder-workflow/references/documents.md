# Documents — HTML & PDF, Fields, Signatures (`workflowType: 2`, transaction only)

**Documents** are the primary auditing surface inside a transaction `Packet`: the rendered
document is the record of what was agreed to, and every signature is bound to one specific
document, not to the packet as a whole. This reference covers the two document content types
(HTML and PDF), how their fields differ in `pal.json`, the click-signature flow, and the
`c:document` tag that renders whichever document the workflow attached to the page.

Companion:
- `../SKILL.md` — this skill's overview and the one gotcha to memorize
- `palbuilder-workflow/references/transaction.md` — the `tx` global, packet mutation model;
  read this first
- `palbuilder-workflow/references/wizards.md` — example of optionally feeding wizard-collected `Data` into a
  document at creation time
- `palbuilder-core/references/pal-structure.md` — the `documents/` folder
- `palbuilder-core/references/pal-json.md` — general manifest entry shape

**Official APIs** (verified against these; consult them before writing anything not covered
here — the `Document` API surface is large):
- `Document` — https://secure.cloudpiston.com/cpal/cp-api/transaction/Document.html
- `Packet` (add/get/delete document) — https://secure.cloudpiston.com/cpal/cp-api/transaction/Packet.html
- `Page` (`addDocumentToPage`) — https://secure.cloudpiston.com/cpal/cp-api/transaction/Page.html
- `c:document` tag — https://secure.cloudpiston.com/cpal/cp-api/transaction-tags/document.html
- `c:signature` tag — https://secure.cloudpiston.com/cpal/cp-api/transaction-tags/signature.html

---

## Ground truth — a minimal example pal

The tree and code below are a standalone example pal built to verify this reference — it is
not the same demo pal used in `wizards.md` (different wizard name, action names, and fragment
structure). Don't assume continuity between the two; each is self-contained.

```
pages/tx.html          — host page, one <c:document> placeholder, action buttons
fragments/wizard.html  — hosts <c:wizard/> when a wizard is in progress
wizards/wiz.xml         — one dialog collecting "name"
workflows/tx.js         — action switch: getWiz / getDoc / sign / reset
documents/htmlDoc.html  — Document, contentType text/html
documents/pdfDoc.pdf    — Document, contentType application/pdf
```

`workflows/tx.js`:

```js
var c;
var tx;
var page;
var doc;

function run(controller) {
    c = controller;
    tx = c.getPacket();
    page = c.getPage("tx");
    page.set("showWizard", "false");

    var user = c.getUser();
    if (!user.hasRole("signer")) {          // signing requires the role the Signature entry names
        user.assignRole("signer");
    }

    switch (c.getAction()) {
        case "reset":
            tx.deleteWizard("wiz");
            tx.deleteDocument("pdfDoc");
            tx.deleteDocument("htmlDoc");
            break;
        case "getWiz":
            getWiz();
            break;
        case "reload":
        case "getDoc":
            getDoc();
            break;
        case "sign":
            sign();
            break;
    }
    return page;
}

function sign() {
    doc = getDoc();
    doc.sign();
    page.addDocumentToPage(doc);
}

function getDoc() {
    var type = c.getRequest().get("type");
    var data = c.createData();
    var wiz = getWiz();
    if (wiz != null) {
        data = wiz.getData();               // feed wizard answers straight into the new document
    }
    if (type == "pdf") {
        doc = tx.getDocument("pdfDoc");
        if (doc == null) {
            doc = tx.addDocument("pdfDoc", data);
        }
    } else {
        doc = tx.getDocument("htmlDoc");
        if (doc == null) {
            doc = tx.addDocument("htmlDoc", data);
        }
    }
    page.set("type", type);
    if (c.isAction("getDoc")) {             // only wire up signing / attach-to-page when reached as an action
        doc.enableSigning("sign", "cancel");
        page.addDocumentToPage(doc);
    }
    return doc;
}

function getWiz() {
    var wiz = tx.getWizard("wiz");
    if (wiz == null && c.isAction("getWiz")) {
        wiz = tx.addWizard("wiz");
    }
    if (c.isAction("getWiz")) {
        page.addWizardToPage(wiz);
        page.set("showWizard", "true");
    }
    return wiz;
}
```

Notice the **dual-purpose helper pattern**: `getDoc()` and `getWiz()` are each called both as an
action-switch handler *and* as a plain data-fetch helper from another handler (`sign()` calls
`getDoc()`; `getDoc()` calls `getWiz()`). `c.isAction("<name>")` gates the page-mutating side
effects (attach-to-page, `enableSigning`, `showWizard`) so the helper is side-effect-free when
called only for its return value.

`pages/tx.html` — the host page, no `name` attribute on `c:document`:

```xml
<c:button action="getWiz" value="Wizard"/>
<c:button action="getDoc?type=html" value="HTML"/>
<c:button action="getDoc?type=pdf" value="PDF"/>
<c:fragment name="wizard" test="${showWizard}"/>
<c:document style="width:80%;height:11in"></c:document>
```

`documents/htmlDoc.html` — an HTML document declares its own signature capture point inline:

```xml
<div id="cp-root">
    HTML Doc
    Name: <input type="text" name="name"/>
    <input type="text" cp-sig-id="sig1" cp-sig-type="click" cp-sig-role="signer"/>
</div>
```

`documents/pdfDoc.pdf` is a real PDF binary — it has no inline `cp-sig-*` markup; its field and
signature *positions* live entirely in `pal.json` (below).

---

## Two content types, one `Document` type

`pal.json` → `documents.entry[]` holds both kinds side by side; the only structural signal is
`contentType`:

```json
{ "string": "htmlDoc.html", "Document": { "contentType": "text/html",  "filename": "htmlDoc.html", ... } },
{ "string": "pdfDoc.pdf",   "Document": { "contentType": "application/pdf", "filename": "pdfDoc.pdf", ... } }
```

`documents/` on disk holds both `.html` and `.pdf` files under the same `Document` category —
it is not HTML-only despite the name.

`Document.getType()` returns `"html"`, `"pdf"`, `"files"`, or `"adhoc"` at runtime — `files` and
`adhoc` exist but aren't covered here; verify against the API before relying on them.

### `fields.Field` — position metadata differs by type

Both documents in this example declare one field named `name`, but the entries are shaped
differently:

```json
// htmlDoc — HTML field: position comes from the markup itself
{ "id": "name", "x": 0, "y": 0, "width": 0, "height": 0, "page": 0, "palDefined": false }

// pdfDoc — PDF field: position is designer-placed coordinates
{ "id": "name", "type": "TEXT", "x": 332, "y": 308, "width": 200, "height": 20, "page": 1, "palDefined": true }
```

- **HTML documents** place fields by writing a normal input into the markup —
  `<input type="text" name="name"/>` — same `${var}`/named-input convention as pages and
  fragments. The field's `x`/`y`/`width`/`height`/`page` are all `0` and `palDefined` is
  `false`: PalBuilder isn't tracking a position for it, the browser lays it out like any other
  HTML element.
- **PDF documents** have no markup to put an input into — a PDF page is a fixed layout. Its
  fields are overlaid at explicit `x`/`y`/`width`/`height`/`page` pixel coordinates set in the
  PalBuilder designer, and `palDefined: true` marks that the position was defined there. `type`
  (`"TEXT"` here) sets the field's input kind.

**Never hand-guess PDF field coordinates.** They come from placing the field visually in the
PalBuilder desktop designer, not from reasoning about the PDF's layout. If you need a new PDF
field and don't have designer access, say so rather than inventing `x`/`y` values.

### `signatures.Signature` — same asymmetry

```json
// htmlDoc — target is empty; the signing point is the cp-sig-* markup in the document itself.  If needed,
// the signature target can be the id of a div so that content referenced by one signature can be locked by the signature 
// while unsigned signature targets can be modified.
{ "id": "sig1", "type": "click", "target": "", "role": "signer", "required": false, "page": 0, "x": 0, "y": 0 }

// pdfDoc — positioned like a field, target names the containing element
{ "id": "sig1", "type": "click", "target": "cp-root", "role": "signer", "required": false, "page": 1, "x": 378, "y": 725 }
```

- **HTML documents** declare a signature capture point directly in markup with
  `cp-sig-id`/`cp-sig-type`/`cp-sig-role` attributes on any element (see `htmlDoc.html` above) —
  the manifest's `target` is empty because the markup itself is the anchor.
- **PDF documents** have no markup to attach to, so the signature is positioned by `x`/`y`/`page`
  like a field. **The exact meaning of `target` for a PDF signature (`"cp-root"` here, matching
  the host page's `<div id="cp-root">`) is not confirmed by the API docs** —
  `Document.addClickSignature(sigId, role, target)` takes a `target` parameter but its semantics
  aren't documented beyond the name. Treat the observed value as this example's working
  configuration, not a rule to copy blindly into an unrelated page layout — verify with a real
  signing test (`pal_screenshot`) if you change the host page structure.
- `type: "click"` is the simplest signature kind. `Document` also supports `addAudioSignature`
  (with a `recordTime` minute limit), `addImageSignature`, and initials
  (`addInitial`/`addExclusiveInitial`) — not exercised in this example.

---

## Workflow API — creating, fetching, deleting documents

`Packet` methods (see `palbuilder-workflow/references/transaction.md` for the `tx` global):

| Call | Purpose |
|---|---|
| `tx.getDocument(name)` | Fetch an existing document instance; `null` if not yet added to this packet |
| `tx.addDocument(name)` | Add the named document (from the pal template) to the packet, empty |
| `tx.addDocument(name, data)` | Add it and populate its fields from a `Data` object in one call |
| `tx.deleteDocument(name)` | Remove it from the packet |
| `tx.hasDocument(name)` | Boolean existence check |
| `tx.getCurrentDocument()` | The document last shown for signing/viewing |

**Always null-guard before adding** — re-adding a name that already exists on the packet is
not the pattern; check `getDocument` first and only `addDocument` when it returns `null` (see
`getDoc()` above).

`Document` signing methods used here:

| Call | Purpose |
|---|---|
| `doc.enableSigning(acceptAction, rejectAction)` | Wires up the document's next signature for the current user's role; clicking the rendered signature point posts `acceptAction` (or `rejectAction`) back into the workflow's action switch |
| `doc.sign()` | Completes the pending signature for the current user. Throws if the user isn't in the signing path (no role, or `enableSigning` never called) |

`Page` method:

| Call | Purpose |
|---|---|
| `page.addDocumentToPage(doc)` | Attaches a `Document` instance to the page response so `<c:document>` (below) has something to render |

---

## The `c:document` tag

Renders an inline frame around **whatever `Document` the workflow attached via
`page.addDocumentToPage(doc)`** — there is no `name` attribute; you cannot select a document by
name from the tag itself. One `<c:document>` per response.

| Attribute | Notes |
|---|---|
| `style`, `class` | Standard CSS hooks |
| `border`, `frameborder`, `scrolling` | Iframe display controls |
| `test` | `${...}` EL — conditional rendering, same dialect as everywhere else (golden rule 7) |
| `page`, `scale`, `grayscale`, `head`, `adhoc` | Documented as valid attributes; exact effect of each isn't detailed on the tag's own doc page — verify by testing before relying on non-obvious behavior |

```xml
<c:document/>
<c:document test="${showDocument=='true'}"/>
<div style="height:500px;width:800px">
    <c:document class="myframe" style="width:100%;height:100%"
                 frameborder="0" border="0" scrolling="auto"/>
</div>
```

**Don't confuse `c:document` with `c:pdf`.** `c:pdf` renders an arbitrary `PdfFile` returned by
a workflow **action** (`<c:pdf action="showPdf?file=${myfile}"/>`) — it's for rendering a PDF
that isn't a packet `Document` at all. `c:document` is specifically "the `Document` object the
current workflow cycle attached to this page." Use `c:document` for packet documents (this
reference); reach for `c:pdf` only when you have a standalone `PdfFile`, not a `Document`.

---

## Gotchas

- **`c:document` has no `name` attribute.** The document it shows is whatever the *last*
  `page.addDocumentToPage(doc)` call in this cycle attached — there's no way to target a
  specific document by name from the tag. If a page needs to show more than one document, that
  has to happen across separate requests/actions, not one `<c:document>` per document.
- **HTML document fields are just named inputs; PDF document fields are designer-placed
  coordinates.** Don't try to add an `x`/`y`/`width`/`height` field to an HTML document's
  markup, or a plain `name="..."` input to a PDF — they use different mechanisms entirely (see
  `fields.Field` above).
- **`doc.sign()` throws if `enableSigning` was never called for this user/role in this cycle.**
  Signing is a two-step handshake: `enableSigning(acceptAction, rejectAction)` when the document
  is first shown, then `sign()` when the accept action fires back.
- **Signatures are per-document, never per-packet.** There's no "sign everything" call — each
  signature id belongs to exactly one document (`palbuilder-workflow/references/transaction.md`
  covers this at the packet level too).
- **`tx.deleteDocument(name)` doesn't touch `pal.json`.** It removes the document *instance* from
  this packet at runtime; the `Document` template registered in the manifest is untouched and
  can be re-added with `tx.addDocument(name, ...)` (see `reset()` above).
- **PDF field/signature coordinates come from the PalBuilder designer, not from reading the
  PDF.** Never invent `x`/`y`/`width`/`height`/`page` values for a PDF field — say so if you
  need one placed and don't have designer access.
