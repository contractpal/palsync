Read GOAL.md. It is the user's approved goal; the interview is complete, so do not interview or run pal-spec. Build the pal so that every acceptance check in GOAL.md is true on the pushed pal.

Plan the work yourself. Delegate the implementation to subagents that use `model: "sonnet"`. Give each subagent a clear brief and tell it which palbuilder-* skills to load. Run one writer at a time, because all subagents share this workspace. You own the plan and the verification: check each subagent's result yourself with PalSync tools, and send fixes back to a subagent.

When you stop, end your final message with exactly one line: `RESULT: DONE` or `RESULT: BLOCKED — <reason>`.
