# PalBuilder types & primitives reference (for the pal-spec reality check)

Purpose: give the REALITY CHECK something concrete to verify §8a field types and §10 primitives
against, instead of guessing. Only VERIFIED entries belong here. If you can't verify it, it goes
in "UNVERIFIED — fill from builder" — never promoted to the verified table on a hunch.

---

## VERIFIED — workflow & file primitives (attested in the palbuilder-* skills)

- Pages: page-shell HTML document with `<html>/<head>/<body>` and a `<div id="cp-root">`.
  A page without html/head/body is rejected.
- Fragments: partials on a `<c:ignore xmlns:c="contractpal">` wrapper; loaded via `ajax-target`
  or `<c:fragment name="...">`. Not interchangeable with pages.
- c: tags (frontend): c:a, c:resource, c:field, c:list, c:fragment, c:if, c:when, c:set,
  c:ignore, c:debug. (`onclick` is NOT valid on c:a.)
- c:resource libraries seen in production: bootstrap 5.3.5, jquery-core 3.4.1,
  bootstrap-icons 1.11.3, chartjs 4.0.0.
- Workflow entry: single `run(controller)` per file; action `switch`; console-hub delegation
  via `c.switchToWorkflow("console", c.getAction())`.
- workflowType: 7 = console workflow; 11 = job / message receiver / console-system job.
  (Declared per file in pal.json.)
- Data access APIs: `pal.getDataSet(name)`, `pal.getDataView(name)` (read-model for joins),
  `createRecord()` → `.set(col, val)`, `insertRecord()`; in-memory `c.createData()` (key→value,
  NOT an object literal) and `c.createDataList(name, [cols])` → `row.set(col, val)`.
- DataList methods: copy(name), addColumn, setColumnValue, renameColumn, removeColumn.
- Jobs/HTTP (jobs-http skill): `pal.getJobManager().createJob(name, file, payload)`, the Monitor
  per-run time budget, `c.createServiceRequest`, `c.createJsonParser`, `c.createBuffer`,
  `c.createDownloadResponse`.
- Sockets (websockets skill): `pal.getClientSocketManager().createClientSocket(...)`,
  `getClientSocket(id)`, `getSockets()`, `socket.sendMessage(...)`; receiver = workflowType 11.

## VERIFIED — workflow JS language limits (hard constraints on §5 behavior)
- Restricted ES3-style engine. NO object literals (`{ }` throws), no let/const, no arrow funcs.
- Validated at COMPILE time in the builder; the headless save returns cached validation, never a
  fresh workflow compile. → any workflow JS needs a builder-compile checkpoint before sign-off.

---

## VERIFIED — creatable dataset FIELD TYPES

Source of truth: PalBuilder builder source `DatasetField.java` (type constants) +
`DatasetColumnDialog.java` (the field-type picker dropdown and its renderer labels),
build `2026.1.1.140-7295`.

**Two strings per type — do not confuse them:**
- **Stored type** = the constant value, serialized into the dataset schema / pal.json. This is
  what a spec §8a "type" column MUST name. (The source warns these are "serialized in all pals
  with datasets — do not change.")
- **Picker label** = the friendly text the builder dropdown *displays*. For several types it
  differs from the stored string (e.g. stored `Number` shows as `Integer (…)`, stored `String`
  shows as `Varchar`, stored `Date` shows as `Datetime`). Spec authors who copy the picker label
  verbatim will write an invalid type — always map back to the stored string below.

Size column: only **Varchar (String)**, **Char**, and **Decimal** take a user-set size
(`isSizeAvailable()` — String/Char length, Decimal precision/scale). All other types have a
fixed width; "—" = no size field.

### Text
| stored type | picker label | size | notes |
|---|---|---|---|
| `String` | Varchar | user-set length | the default text field; indexable |
| `Char` | Char | user-set length | fixed-length; indexable |
| `Text` | Text (65KB) | — | up to 65 KB; NOT indexable |
| `Medium text` | Medium Text (16MB) | — | up to 16 MB; NOT indexable |

### Date / time
| stored type | picker label | size | notes |
|---|---|---|---|
| `DateOnly` | Date | — | date, no time |
| `Date` | Datetime | — | date + time |
| `DateTimeMS` | Datetime ms | — | date + time, millisecond precision |

### Boolean
| stored type | picker label | size | notes |
|---|---|---|---|
| `Boolean` | Boolean | — | true/false |

### Signed integers
| stored type | picker label / range | size | notes |
|---|---|---|---|
| `Tiny integer` | Tiny integer (-128 +127) | — | |
| `Small integer` | Small integer (-32768 +32767) | — | |
| `Medium integer` | Medium integer (-8388608 +8388607) | — | |
| `Number` | Integer (-2147483648 +2147483647) | — | the default integer; stored string is `Number` |
| `Big Number` | Big integer (±9.22e18) | — | stored string is `Big Number` |

### Unsigned integers
| stored type | picker label / range | size | notes |
|---|---|---|---|
| `Tiny unsigned integer` | Tiny unsigned integer (0 +255) | — | |
| `Small unsigned integer` | Small unsigned integer (0 +65535) | — | |
| `Medium unsigned integer` | Medium unsigned integer (0 +16777215) | — | |
| `Unsigned integer` | Unsigned integer (0 +4294967295) | — | |
| `Big unsigned integer` | Big unsigned integer (0 +18446744073709551615) | — | |

### Decimal
| stored type | picker label | size | notes |
|---|---|---|---|
| `Decimal` | Decimal | user-set precision/scale | use for money — never a float |

### Encrypted
| stored type | picker label | size | notes |
|---|---|---|---|
| `Encrypted` | Encrypted | — | encrypted at rest; NOT indexable |

### File
| stored type | picker label | size | notes |
|---|---|---|---|
| `File` | File | — | stored file |
| `File Encrypted` | File Encrypted | — | encrypted stored file |
| `Remote File` | Remote File | — | externally-hosted file reference |
| `Remote File Encrypted` | Remote File Encrypted | — | encrypted remote file reference |

### System / key types — NOT free-form data fields
Provisioned by the builder for identity/plumbing, not chosen for ordinary user data. A spec
should name these only when modeling keys/ownership explicitly.

| stored type | picker label | notes |
|---|---|---|
| `Primary key` | Primary key | row id (`CP_ID`); auto, only one |
| `Pal id` | Pal id | `CP_PALID` |
| `Pal id auto populate` | Pal id auto populate | `CP_PALID`, auto-set |
| `Transaction id` | Transaction id | `CP_TXID` |
| `Transaction id auto populate` | Transaction id auto populate | `CP_TXID`, auto-set |
| `Profile id` | Profile id | owner profile |
| `Profile id auto populate` | Profile id auto populate | owner profile, auto-set |

### Reality-check rule for §8a
A §8a field type passes iff its string matches a **stored type** above (left column). If the
spec used a picker label (e.g. `Varchar`, `Integer`, `Datetime`), rewrite it to the stored
string before passing. A type not in any table above is an unverifiable dependency — flag it.

### Indexability (affects §8a indexes / lookups)
NOT indexable: `Encrypted`, `Text`, `Medium text`, and all File types. Everything else is.
An index declared on a non-indexable field fails the reality check.
