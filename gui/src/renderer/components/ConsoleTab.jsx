import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import TestRibbon from "./TestRibbon.jsx";
import DebugPanel from "./DebugPanel.jsx";
import StatsPanel from "./StatsPanel.jsx";
import ImagesPanel from "./ImagesPanel.jsx";

// Cap on fetched debug chunks kept in memory/rendered at once — an unattended long auto-refresh
// session would otherwise grow debugLog forever. Oldest chunks drop off first.
const DEBUG_LOG_MAX = 50;

// One real terminal per pal tab, lazily connected to its agent CLI on first mount (i.e. first
// time this tab becomes active) — not eagerly for every tab in the workspace.
export default function ConsoleTab({ pal, agents, active, onAgentChosen }) {
    const hostRef = useRef(null);
    const termRef = useRef(null);
    const fitRef = useRef(null);
    const startedRef = useRef(false);
    const [agentId, setAgentId] = useState(pal.agentId || null);
    const [needsAgentPick, setNeedsAgentPick] = useState(false);
    // "debug" | "stats" | "images" | null — mutually exclusive, sharing the one resizable side pane.
    const [sidePanel, setSidePanel] = useState(null);
    const [debugLog, setDebugLog] = useState([]); // fetched text chunks, oldest first, capped at DEBUG_LOG_MAX
    const [debugWidthPct, setDebugWidthPct] = useState(25);
    const [startError, setStartError] = useState(null);
    const [termReady, setTermReady] = useState(false);
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
            minimumContrastRatio: 4.5,
            // Agent CLIs (Codex's imagegen skill, notably) emit OSC 8 hyperlinks around file
            // paths it saved — e.g. a generated image. xterm.js parses those natively but
            // defaults to window.open(uri), which does nothing useful in this Electron app.
            // Route through the main process's shell.openPath/openExternal instead so the link
            // actually opens the file with its OS-default viewer.
            linkHandler: {
                activate: (event, uri) => { window.palsyncGui.openExternal(uri); }
            }
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
            const noModifierConflict = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey;
            if (noModifierConflict && event.key === "v") {
                navigator.clipboard.readText().then(text => {
                    if (text) term.paste(text);
                }).catch(() => {});
                return false;
            }
            // Ctrl+C/Cmd+C: copy the selection like a real terminal, instead of xterm's default
            // of always forwarding it as the raw interrupt byte. Only intercept when there IS a
            // selection — with nothing selected, Ctrl+C must still reach the agent process as
            // SIGINT (e.g. to interrupt a running turn), so fall through to normal handling.
            if (noModifierConflict && event.key === "c" && term.hasSelection()) {
                navigator.clipboard.writeText(term.getSelection()).catch(() => {});
                return false;
            }
            return true;
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
        // The agent process itself is held back until this first fit lands (see the console-start
        // effect's termReady gate below) — otherwise its splash/banner can be written into a
        // still-wrongly-sized terminal and render garbled until a later manual resize fixes it.
        let ro;
        const ready = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
        ready.then(() => requestAnimationFrame(() => {
            fit.fit();
            window.palsyncGui.resizeConsole(pal.cloudPalId + ":" + pal.path, term.cols, term.rows);
            setTermReady(true);
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
        // pending multi-agent choice the user hasn't confirmed yet. Also wait for termReady (the
        // terminal's first correct fit, gated on the font-load race above) so the agent's splash
        // always writes into a correctly-sized terminal instead of racing the font load.
        if (active && !startedRef.current && agentId && !needsAgentPick && termReady) {
            startedRef.current = true;
            // Previously fire-and-forget: a failure here (bad MCP registration, or the agent
            // command not actually launching even though it was found on PATH) had NOTHING
            // looking at the result — silent blank terminal, no explanation. Surface it, and let
            // the user retry with a different agent (clearing startedRef so the effect can fire
            // again if agentId changes).
            // Pass the already-fitted terminal size so node-pty spawns at the real size instead
            // of its hardcoded 80x24 default — see console:start's own comment (index.js) for why
            // that default, uncorrected until a later resize, is what actually caused the garbled
            // input-box wrapping (resizing "fixed" it only because a resize is what finally sent
            // the correct size to the pty in the first place).
            window.palsyncGui.startConsole(pal.cloudPalId + ":" + pal.path, agentId, pal.path, termRef.current && termRef.current.cols, termRef.current && termRef.current.rows)
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
    }, [active, agentId, needsAgentPick, termReady]);

    // Persistent switcher (TestRibbon's agent dropdown) — unlike the one-time picker above (which
    // only interrupts when the saved agentId is missing/invalid), this lets you change agents at
    // any time once more than one is detected, even when the current choice is already valid.
    // The running console belongs to the OLD agent's command, so it has to actually be killed
    // first: ptyManager.start() / the console:start IPC handler both short-circuit with
    // {alreadyRunning:true} if a session for this palId is already up, so without killing first
    // the new agent would silently never launch.
    async function switchAgent(newId) {
        if (!newId || newId === agentId) return;
        await window.palsyncGui.killConsole(pal.cloudPalId + ":" + pal.path);
        startedRef.current = false;
        setStartError(null);
        if (termRef.current) termRef.current.clear();
        setAgentId(newId);
    }

    // term-host must NEVER be display:none, at any point, for the life of this component.
    // fit.fit() (mount effect above) and the ResizeObserver it installs both need to measure
    // hostRef.current's real layout box to compute correct cols/rows — a display:none element
    // reports zero size, so hiding term-host during ANY of the states below (agents still
    // loading, agent picker shown, start error, waiting on termReady) would let fit() measure a
    // zero-size box at exactly the wrong moment and spawn the agent at the wrong pty size (the
    // "resizing fixes it" bug this exists to prevent — two earlier attempts each hid term-host
    // during a different one of these states and reproduced it). Every one of these messages is
    // instead overlaid absolutely on top of the still-present, still-measurable term-host.
    const showLoadingAgent = !needsAgentPick && agents.length > 0 && !startError && !termReady;

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
                debugVisible={sidePanel === "debug"}
                onToggleDebug={() => setSidePanel(v => (v === "debug" ? null : "debug"))}
                statsVisible={sidePanel === "stats"}
                onToggleStats={() => setSidePanel(v => (v === "stats" ? null : "stats"))}
                imagesVisible={sidePanel === "images"}
                onToggleImages={() => setSidePanel(v => (v === "images" ? null : "images"))}
                agents={agents}
                agentId={agentId}
                onSwitchAgent={switchAgent}
            />
            <div ref={splitRowRef} style={{ display: "flex", flexDirection: "row", flex: 1, minHeight: 0 }}>
                <div style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minWidth: 0, minHeight: 0, position: "relative" }}>
                    <div className="term-host" ref={hostRef} style={{ flex: 1, minHeight: 0 }} />
                    {needsAgentPick && (
                        <div className="agent-picker" style={{ position: "absolute", inset: 0 }}>
                            <p>Choose which agent to open <b>{pal.name}</b> with:</p>
                            <select value={agentId || ""} onChange={e => setAgentId(e.target.value)}>
                                {agents.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                            </select>
                            <button className="btn btn-primary" onClick={() => setNeedsAgentPick(false)}>Open</button>
                        </div>
                    )}
                    {!needsAgentPick && agents.length === 0 && (
                        <div className="term-placeholder" style={{ position: "absolute", inset: 0 }}>
                            No agent CLI found on this machine — install Claude Code or OpenCode and add it to PATH.
                        </div>
                    )}
                    {!needsAgentPick && startError && (
                        <div className="agent-picker" style={{ position: "absolute", inset: 0 }}>
                            <p>Couldn't start {(agents.find(a => a.id === agentId) || {}).label || agentId}:</p>
                            <p className="dep-hint" style={{ maxWidth: 420 }}>{startError}</p>
                            <button className="btn btn-primary" onClick={() => { setStartError(null); setNeedsAgentPick(true); }}>
                                Try a different agent
                            </button>
                        </div>
                    )}
                    {showLoadingAgent && (
                        <div className="term-placeholder" style={{ position: "absolute", inset: 0 }}>Loading agent…</div>
                    )}
                </div>
                {sidePanel && (
                    <>
                        <div className="vsplit-divider" onMouseDown={startDebugResize} title="Drag to resize" />
                        <div style={{ flex: "0 0 " + debugWidthPct + "%", minWidth: 0, minHeight: 0 }}>
                            {sidePanel === "debug" && (
                                <DebugPanel
                                    pal={pal}
                                    log={debugLog}
                                    onFetched={text => setDebugLog(prev => [...prev, text].slice(-DEBUG_LOG_MAX))}
                                    onClear={() => setDebugLog([])}
                                    onHide={() => setSidePanel(null)}
                                />
                            )}
                            {sidePanel === "stats" && (
                                <StatsPanel pal={pal} onHide={() => setSidePanel(null)} />
                            )}
                            {sidePanel === "images" && (
                                <ImagesPanel pal={pal} onHide={() => setSidePanel(null)} />
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
