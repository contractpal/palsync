# SPEC — Shared fragment rename

pal: impact_01_shared_fragment
workspace: <WORKSPACE URL AND PAL>

Rename `fragments/shared/navbar.html` to `fragments/shared/header.html` while preserving the shared
navigation everywhere it is used. Update the manifest and every literal consumer. Remove the old
path, old registration, and old fragment identity; register the new path and identity.

Do not redesign the pages or change unrelated behavior.
