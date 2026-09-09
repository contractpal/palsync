import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import TestRibbon from "./TestRibbon.jsx";
import DebugPanel from "./DebugPanel.jsx";

// One real terminal per pal tab, lazily connected to its agent CLI on first mount (i.e. first
// time this tab becomes active) — not eagerly for every tab in the workspace.
export default function ConsoleTab({ pal, agents, active, onAgentChosen }) {
    const hostRef = useRef(null);
    const termRef = useRef(null);
    const fitRef = useRef(null);
    const startedRef = useRef(false);
    const [agentId, setAgentId] = useState(pal.agentId || null);
    const [needsAgentPick, setNeedsAgentPick] = useState(false);
    const [showDebug, setShowDebug] = useState(false);
    const [debugLog, setDebugLog] = useState([]); // fetched text chunks, oldest first
    const [debugWidthPct, setDebugWidthPct] = useState(25);
    const [startError, setStartError] = useState(null);
    const splitRowRef = useRef(null);

    // `agents` arrives asynchronously (WorkspaceView starts it at [] and fetches in an
    // effect) — pick a default once it's actually populated, rather than freezing a
    // decision at mount time based on the still-empty initial list.
    //
    // Always seed agentId to the first agent, even when showing the picker for a choice among
    // several: the <select> below has no empty option, so with agentId still null it falls back
    // to visually showing the first option as selected while React's own state stays null —
    // clicking Open without ever touching the dropdown then does nothing (needsAgentPick just
    // clears, but the console-start effect below never fires since agentId is falsy). Seeding it
    // here keeps the visible selection and the actual state in sync from the start.
    //
    // Also re-seeds when the initial agentId (from a previously-saved pal.agentId) refers to an
    // agent that's no longer in the detected/installed list - e.g. it was uninstalled, or the
    // save predates it ever being confirmed on PATH. Trusting stale saved state here silently
    // tried to spawn a nonexistent command: node-pty doesn't throw for that on macOS, it just
    // exits async with code 1 and no output, so the console-start effect below "succeeded" into
    // a permanently blank terminal with no error surfaced anywhere.
    useEffect(() => {
        if (agents.length === 0) return;
        if (agentId && agents.some(a => a.id === agentId)) return;
        setAgentId(agents[0].id);
        if (agents.length > 1) setNeedsAgentPick(true);
    }, [agents, agentId]);

    useEffect(() => {
        if (!hostRef.current) return;
        const term = new Terminal({
            fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
            fontSize: 13,
            theme: { background: "#0b0c0e", foreground: "#d8d8d2" },
            // Some agent CLIs (e.g. Claude Code) emit ANSI colors assuming a light-background
            // terminal, which can render near-invisible against our dark theme. xterm.js
            // auto-adjusts a cell's foreground color to meet this contrast ratio against
            // whatever background it's drawn on, regardless of what color the CLI requested.
            minimumContrastRatio: 4.5
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(hostRef.current);
        termRef.current = term;
        fitRef.current = fit;

        // xterm.js doesn't bind Ctrl+V/Cmd+V to paste by default — a real terminal would
        // treat it as a raw control byte for the shell. Right-click-paste already works via
        // the browser's native context menu; this adds the keyboard shortcut on top of it.
        term.attachCustomKeyEventHandler(event => {
            if (event.type !== "keydown") return true;
            const isPaste = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key === "v";
            if (!isPaste) return true;
            navigator.clipboard.readText().then(text => {
                if (text) term.paste(text);
            }).catch(() => {});
            return false;
        });

        const offData = window.palsyncGui.onConsoleData(pal.cloudPalId + ":" + pal.path, chunk => term.write(chunk));
        // Without this, a process that exits right after spawning (bad MCP config, the agent
        // CLI erroring out before printing anything the pty flushes, etc.) left a permanently
        // blank terminal with zero signal - no thrown error for console:start's try/catch to
        // catch (the spawn itself succeeded), no renderer exception, nothing. Surface it inline
        // so "blank and silent" always becomes "here's what happened", and let a retry re-arm.
        const offExit = window.palsyncGui.onConsoleExit(pal.cloudPalId + ":" + pal.path, code => {
            term.write("\r\n\x1b[90m[agent process exited" + (code ? " with code " + code : "") + "]\x1b[0m\r\n");
            startedRef.current = false;
        });
        term.onData(data => window.palsyncGui.writeToConsole(pal.cloudPalId + ":" + pal.path, data));

        // fit.fit() must run only once (a) the container has its final flex-computed size and
        // (b) the actual terminal font has loaded — fitting against the fallback font's metrics
        // (IBM Plex Mono loads async from Google Fonts) computes the wrong column/row count,
        // and the terminal stays mis-sized relative to its box even after the font swaps in.
        let ro;
        const ready = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
        ready.then(() => requestAnimationFrame(() => {
            fit.fit();
            window.palsyncGui.resizeConsole(pal.cloudPalId + ":" + pal.path, term.cols, term.rows);
            ro = new ResizeObserver(() => {
                fit.fit();
                window.palsyncGui.resizeConsole(pal.cloudPalId + ":" + pal.path, term.cols, term.rows);
            });
            ro.observe(hostRef.current);
        }));

        return () => {
            offData();
            offExit();
            if (ro) ro.disconnect();
            term.dispose();
        };
    }, []);

    useEffect(() => {
        // Wait for the picker to actually be dismissed (Open clicked) before starting — agentId
        // gets seeded to a default the moment `agents` populates (see above), which would
        // otherwise auto-start with that default here immediately, silently ignoring a still-
        // pending multi-agent choice the user hasn't confirmed yet.
        if (active && !startedRef.current && agentId && !needsAgentPick) {
            startedRef.current = true;
            // Previously fire-and-forget: a failure here (bad MCP registration, or the agent
            // command not actually launching even though it was found on PATH) had NOTHING
            // looking at the result — silent blank terminal, no explanation. Surface it, and let
            // the user retry with a different agent (clearing startedRef so the effect can fire
            // again if agentId changes).
            window.palsyncGui.startConsole(pal.cloudPalId + ":" + pal.path, agentId, pal.path)
                .then(res => {
                    if (res && res.error) {
                        setStartError(res.error);
                        startedRef.current = false;
                    }
                })
                .catch(err => {
                    setStartError((err && err.message) || String(err));
                    startedRef.current = false;
                });
            if (agentId !== pal.agentId && onAgentChosen) onAgentChosen(agentId);
        }
    }, [active, agentId, needsAgentPick]);

    // The terminal's host div stays mounted regardless of loading/picker state, so the
    // mount-time effect above (which only runs once) always finds a real ref to attach to —
    // overlaying the picker/placeholder instead of conditionally un-mounting the div.
    const overlayVisible = needsAgentPick || agents.length === 0 || !!startError;

    // Drag-resize the debug panel (starts at 25% width, per David's ask). move/up are scoped to
    // this one drag gesture, not the component's render — so re-renders mid-drag (setState below
    // triggers one) never lose track of which listeners to remove.
    function startDebugResize(e) {
        e.preventDefault();
        const move = (ev) => {
            if (!splitRowRef.current) return;
            const rect = splitRowRef.current.getBoundingClientRect();
            const pct = ((rect.right - ev.clientX) / rect.width) * 100;
            setDebugWidthPct(Math.min(60, Math.max(15, pct)));
        };
        const up = () => {
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", up);
        };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <TestRibbon
                pal={pal}
                debugVisible={showDebug}
                onToggleDebug={() => setShowDebug(v => !v)}
            />
            <div ref={splitRowRef} style={{ display: "flex", flexDirection: "row", flex: 1, minHeight: 0 }}>
                <div style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minWidth: 0, minHeight: 0 }}>
                    {needsAgentPick && (
                        <div className="agent-picker">
                            <p>Choose which agent to open <b>{pal.name}</b> with:</p>
                            <select value={agentId || ""} onChange={e => setAgentId(e.target.value)}>
                                {agents.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                            </select>
                            <button className="btn btn-primary" onClick={() => setNeedsAgentPick(false)}>Open</button>
                        </div>
                    )}
                    {!needsAgentPick && agents.length === 0 && (
                        <div className="term-placeholder">
                            No agent CLI found on this machine — install Claude Code or OpenCode and add it to PATH.
                        </div>
                    )}
                    {!needsAgentPick && startError && (
                        <div className="agent-picker">
                            <p>Couldn't start {(agents.find(a => a.id === agentId) || {}).label || agentId}:</p>
                            <p className="dep-hint" style={{ maxWidth: 420 }}>{startError}</p>
                            <button className="btn btn-primary" onClick={() => { setStartError(null); setNeedsAgentPick(true); }}>
                                Try a different agent
                            </button>
                        </div>
                    )}
                    <div className="term-host" ref={hostRef} style={overlayVisible ? { display: "none" } : { flex: 1, minHeight: 0 } } />
                </div>
                {showDebug && (
                    <>
                        <div className="vsplit-divider" onMouseDown={startDebugResize} title="Drag to resize" />
                        <div style={{ flex: "0 0 " + debugWidthPct + "%", minWidth: 0, minHeight: 0 }}>
                            <DebugPanel
                                pal={pal}
                                log={debugLog}
                                onFetched={text => setDebugLog(prev => [...prev, text])}
                                onClear={() => setDebugLog([])}
                                onHide={() => setShowDebug(false)}
                            />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
