# SPEC — Nested component fragment rename

pal: impact_02_nested_fragment
workspace: <WORKSPACE URL AND PAL>

Rename `fragments/components/profile/card.html` to
`fragments/components/profile/profile-card.html`. Update `pal.json` and both direct literal
consumers. Preserve the component's behavior and remove the old path and registration.

The task requires direct consumers only; do not infer or claim a transitive dependency graph.
