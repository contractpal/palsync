import React from "react";

// Replaces the old opaque scrolling progress log for both checkout wizards (create-new-pal and
// open-from-cloud) with a fixed checklist: one row per step of workspace.setup() (see
// src/launcher/workspace.js's STEPS / onStep), a spinner while it's running, a checkmark once
// done. `steps` is the ordered [{step,label}] list from cloud:checkoutSteps; `stepStates` maps
// step id -> "pending" | "running" | "done" | "error", built up from cloud:step events.
export default function CheckoutChecklist({ steps, stepStates }) {
    return (
        <div className="checkout-checklist">
            {steps.map(({ step, label }) => {
                const state = stepStates[step] || "pending";
                return (
                    <div key={step} className={"checklist-row checklist-" + state}>
                        <span className="checklist-icon" aria-hidden="true">
                            {state === "done" && "✓"}
                            {state === "error" && "!"}
                            {state === "running" && <span className="checklist-spinner" />}
                            {state === "pending" && ""}
                        </span>
                        <span className="checklist-label">{label}</span>
                    </div>
                );
            })}
        </div>
    );
}
