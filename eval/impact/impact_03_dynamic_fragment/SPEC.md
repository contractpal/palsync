# SPEC — Dynamic fragment rename under uncertainty

pal: impact_03_dynamic_fragment
workspace: <WORKSPACE URL AND PAL>

Rename `fragments/components/dynamic/summary.html` to
`fragments/components/dynamic/report-summary.html` while preserving runtime composition. Update the
manifest and any runtime references required by the rename. Remove the old path and registration.

Investigate runtime composition and unknown incoming coverage rather than assuming a literal
dependency list is complete.
