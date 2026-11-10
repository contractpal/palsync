Read GOAL.md. It is the user's approved goal; the interview is complete, so do not interview or run pal-spec. Build the pal so that every acceptance check in GOAL.md is true on the pushed pal.

Plan the work yourself. Delegate the implementation to subagents that use `model: "sonnet"`. Give each subagent a clear brief and tell it which palbuilder-* skills to load. Run one writer at a time, because all subagents share this workspace.

When you believe the goal is met, start a NEW verifier subagent (`model: "sonnet"`) with fresh context. Give it only GOAL.md and the instruction to verify every acceptance check on the pushed pal with PalSync tools (pal_exercise, pal_screenshot, pal_validate, pal_test) and to report each check as PASS or FAIL with evidence. Do not tell it what you built or what you expect. Send its failures back to the builder subagent that wrote that code, then verify again with a new verifier. Stop after 3 verify rounds.

When you stop, end your final message with exactly one line: `RESULT: DONE` or `RESULT: BLOCKED — <reason>`.
