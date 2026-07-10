# Files — the File class, upload, storage, and rendering

The platform's generic **File** class is the common interface for anything file-like:
dataset file columns, uploads, and attachments all expose it. **Upload** (what you get back
from an incoming file upload) extends **File**, so everything here applies to both.

**Official API:**
- File — https://secure.cloudpiston.com/cpal/cp-api/console/File.html
- Upload — https://secure.cloudpiston.com/cpal/cp-api/console/Upload.html
- PdfFile — https://secure.cloudpiston.com/cpal/cp-api/console/PdfFile.html
- ImageFile — https://secure.cloudpiston.com/cpal/cp-api/console/ImageFile.html
- ExcelFile — https://secure.cloudpiston.com/cpal/cp-api/console/ExcelFile.html
- AudioFile — https://secure.cloudpiston.com/cpal/cp-api/console/AudioFile.html

Companion:
- `datasets.md` — the file / encrypted file / remote file / encrypted remote file column
  types for storing files in a dataset
- `payloads.md` — `Data`/DataMap shape that `file.toData()` produces, and how to attach it
  to a payload
- `../SKILL.md` — storage decision section, and where CDN-backed remote file columns fit

---

## The File API

Every File (and therefore every Upload) supports:

```js
file.getContentType()      // MIME type
file.getFileName()
file.getFileSize()         // KB
file.getFileLength()       // bytes
file.getFileType()
file.setFilename("name")
file.calcMD5()
file.isValid()
file.isVirus()
```

**Text-based files:**

```js
var text = file.readFile();   // entire content as a String
var line = file.readLine();   // one line at a time
```

**Conversions** — each returns `null` if the file can't be converted to that type:

```js
file.toData()               // Data with fileName, contentType, base64 — see below
file.toDataList("name")     // CSV or .xls only
file.toExcelFile()          // ExcelFile
file.toImage()              // ImageFile
file.toAudioFile()          // AudioFile
file.toPdf("filename")      // PdfFile — check isPdfConversionSupported() first — see below
```

Each conversion returns the corresponding typed subclass (`ExcelFile`, `ImageFile`,
`AudioFile`, `PdfFile` — see the Official API links above) or `null` if the source file
can't be converted to that type.

**Before converting to PDF**, check whether the source format is supported:

```js
if (file.isPdfConversionSupported()) {
    var pdf = file.toPdf("report.pdf");
}
```

---

## Attaching a file to a response — `toData()` + `addDataMap`

Payload has no `setFile` method. The pattern is: convert the file to `Data` via `toData()`,
then attach that `Data` as a named DataMap:

```js
var imageData = file.toData();               // Data: fileName, contentType, base64
payload.addDataMap("imageX", imageData);
```

Template side, render with `c:image`:

```html
<c:image base64="${imageX.base64}" contentType="${imageX.contentType}" embed="true"/>
```

If you only have a URL to a file (not a `File` object in hand), `c:image` also accepts a
`file` attribute directly:

```html
<c:image file="${fileUrl}"/>
```

---

## Rendering by extension — routing to the right tag

When a page needs to display "whatever kind of file this is" (an attachment, an upload
result, a URL from a dataset column), branch on the extension and pick the matching tag:

```html
<c:choose>
    <c:when test="${ext eq 'mp4' or ext eq 'mov'}">
        <video controls="controls" class="rounded mx-auto d-block mw-100">
            <source src="${file}"></source>
        </video>
    </c:when>
    <c:when test="${ext eq 'mp3' or ext eq 'm4a'}">
        <audio controls="controls" class="rounded mx-auto d-block mw-100">
            <source src="${file}"></source>
        </audio>
    </c:when>
    <c:when test="${ext eq 'png' or ext eq 'jpg' or ext eq 'jpeg' or ext eq 'gif' or ext eq 'webp'}">
        <c:image src="${file}" class="rounded mx-auto d-block mw-100"></c:image>
    </c:when>
    <c:when test="${ext eq 'pdf'}">
        <c:rfile src="${file}"/>
    </c:when>
    <c:otherwise>
        <p>Unknown extension: ${ext}</p>
    </c:otherwise>
</c:choose>
```

Video and audio use plain `<video>`/`<audio>` with a `<source>` child; images use `c:image`;
PDFs use `c:rfile`; anything unrecognized falls through to an explicit "unknown" branch
rather than failing silently.

---

## Storage — where a file actually lives

Files can be stored two ways:

- **In a dataset**, via the **file**, **encrypted file**, **remote file**, or **encrypted
  remote file** column types (full column-type list in `datasets.md`).
- **Directly on a CDN**, if a storage provider is configured for the pal or the enterprise.

**Storage providers (CDNs)** are configured at the enterprise level and assigned per-pal:

```js
var providers = c.getEnterprise().getStorageProviders();   // DataList
var provider  = pal.getStorageProvider();                  // this pal's default
var namedOne  = pal.getStorageProvider("providerName");    // a specific one by name
```

**If a default storage provider is enabled for the pal, remote file columns store only a
small reference** — the actual bytes live on the CDN, not in the dataset. Plan encrypted
remote file columns accordingly: the reference row is encrypted at rest, and the CDN handles
the underlying object.

### Small images in a list — base64 directly in a text column

For small images that need to render inline in a list (profile pictures, thumbnails, icons),
it can be simpler to skip a file column entirely and store the base64 string directly in a
plain **varchar/text** column:

```js
// Writing — store the base64 string itself, not a File/file column
rec.set("avatarBase64", imageFile.toData().get("base64"));
rec.set("avatarContentType", imageFile.getContentType());
```

Render each row directly from the DataList/record fields:

```html
<c:image base64="${item.avatarBase64}" contentType="${item.avatarContentType}"/>
```

This avoids a separate file-column fetch per row when rendering a list, which is convenient
at small sizes. It doesn't scale to large images or high row counts — a text column holding
base64 is roughly a third larger than the original bytes and isn't a substitute for a real
file/remote file column or CDN storage once images get larger or the list gets long.

---

## Pal-level files — attachments and images bundled with the pal

Separate from datasets and uploads, a pal can bundle its own **Attachments** and **Images**
directly (pal.json's `attachments` and `images` sections — see
`palbuilder-core/references/pal-json.md` for how these are registered). These are static
files shipped with the pal itself, not per-user data.

```js
var invoiceTemplate = pal.getAttachment("Invoice Template.pdf");   // File
var logo            = pal.getImage("logo.png");                    // ImageFile
```

`pal.getAttachment(name)` returns a plain **File** — the same API documented above (readFile,
toData, toImage, etc.) works on it. `pal.getImage(name)` returns an **ImageFile** directly,
so there's no `toImage()` conversion step needed.

Use these for static assets the pal ships with — a report template, a logo, boilerplate
PDFs/images referenced by name — as opposed to `datasets.md` file columns (per-record,
per-user files) or the cache (runtime data, not build-time assets).

---

## Upload — accepting files from the user

`<c:upload>` renders a file upload input. **Only one upload input can render per page.**

```html
<c:upload style="" action="x" limit="300" allow="pdf,word"/>

<c:upload ajax-handler="function" limit="300" allow="office" silent="false"/>

<c:upload action="processUpload" limit="${maxUpload}" stylesheet="upload.css"
          allow="office" class="upload" uploadText="Continue" script="upload.js"
          validate="preCheck"/>
```

Key attributes:

| Attribute | Notes |
|---|---|
| `allow` | **Required.** Allowed file type(s) or type group (e.g. `pdf,word`, `office`). |
| `limit` | Max upload size. |
| `action` | Workflow action invoked on upload. |
| `ajax-handler` | Client-side function invoked instead of/alongside the action. |
| `validate` | Function run first — in the local script if provided, else in the context of the container page. |
| `stylesheet` | The upload widget is iframe-loaded — style it with `stylesheet`, not `style`/`class` (see `palbuilder-frontend/references/tags.md` for the general `c:upload` styling restriction). |
| `provider` / `providerSettings` | Route the upload straight to a specific storage provider (CDN). |
| `multiple` | Allow multiple files in one input. |
| `cancelAction` / `cancelText` | Cancel handling. |
| `fragment` / `script` / `head` / `workflow` | Ajax-target wiring, same idioms as other action-driven tags. |

**If you use a storage provider, only allow one specific upload type** — mixing types
against a single provider integration is unsupported.

**Receiving the upload in the workflow:**

```js
var upload  = request.getUpload();            // the single upload, unnamed field
var named   = request.getUpload("fieldName");  // a specific named field
var uploads = request.getUploads();            // Upload[] — for multiple="true"
```

`Upload` extends `File`, so everything in the File API section above (readFile, toData,
toImage, toPdf, etc.) works directly on what you get back from these calls.

---

## Common gotchas

- **Payload has no `setFile`.** Always `file.toData()` → `payload.addDataMap(name, data)`,
  then read it back in the template as `${name.base64}` / `${name.contentType}`.
- **Only one `<c:upload>` per page.** Multiple upload widgets require multiple pages/fragments.
- **All File conversions (`toExcelFile`, `toImage`, `toAudioFile`, `toPdf`) return `null`**
  on failure — null-check before using the result, don't assume the conversion succeeded.
- **Check `isPdfConversionSupported()` before calling `toPdf()`** for formats you're not sure
  about — it avoids a wasted conversion attempt.
- **Remote file columns store a reference, not the bytes**, whenever a default storage
  provider is enabled for the pal. Don't assume the dataset row holds the actual file data.
- **`c:upload` styling only accepts the `stylesheet` attribute** — it's iframe-loaded, so
  page-level `style`/`class` won't reach into it.
- **If using a storage provider, restrict `allow` to one file type** — this is a hard
  constraint, not just a recommendation.
- **A base64-in-column image is roughly a third larger than the source bytes and adds up
  fast across a list.** Fine for small profile pictures/icons; move to a file column or CDN
  once images or row counts grow.
- **`pal.getImage(name)` already returns an `ImageFile`** — don't call `.toImage()` on it,
  that conversion is only needed when starting from a plain `File`/`Upload`.
