# Agent Trim interoperability

PalSync removes domain repetition before returning MCP text. Agent Trim may perform generic terminal
or history trimming afterward. There is no runtime dependency, environment-variable handshake, or
shared ANSI-cleaning implementation.

Every condensed PalSync result ends with `Full result: <workspace-relative path>`. A downstream
trimmer must retain that final line and must not add a second omission marker when PalSync already
states that duplicates were grouped.

```json
{
  "version": 1,
  "fullResultMarker": "^Full result: .+$",
  "preserveTrailer": true,
  "noDoubleOmissionMarkers": true,
  "fields": {
    "rawBytes": "MCP result bytes before PalSync semantic condensation",
    "returnedBytes": "bytes returned by PalSync before Agent Trim",
    "trimmedBytes": "Agent Trim-owned bytes after downstream trimming; not observed or stored by PalSync"
  },
  "ansiCleaningOwner": "Agent Trim"
}
```

The full artifact contains the structured pre-condensation result. `.palsync.usage.json` v2 records
PalSync's raw and returned values; it never fabricates `trimmedBytes`.
