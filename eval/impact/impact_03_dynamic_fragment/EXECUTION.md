# Execution

1. Inspect the target and investigate the runtime composition that depends on it.
2. Rename it to `fragments/components/dynamic/report-summary.html`.
3. Update `pal.json` and any affected runtime references; preserve dynamic composition.
4. Validate with zero errors and zero warnings, run a server test, run regression, then push.
