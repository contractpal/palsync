import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

// One real terminal per pal tab, lazily connected to its agent CLI on first mount (i.e. first
// time this tab becomes active) — not eagerly for every tab in the workspace.
export default function ConsoleTab({ pal, agents, active, onAgentChosen }) {
    const hostRef = useRef(null);
    const termRef = useRef(null);
    const fitRef = useRef(null);
    const startedRef = useRef(false);
    const [agentId, setAgentId] = useState(pal.agentId || null);
    const [needsAgentPick, setNeedsAgentPick] = useState(false);

    // `agents` arrives asynchronously (WorkspaceView starts it at [] and fetches in an
    // effect) — pick a default once it's actually populated, rather than freezing a
    // decision at mount time based on the still-empty initial list.
    useEffect(() => {
        if (agentId || agents.length === 0) return;
        if (agents.length === 1) setAgentId(agents[0].id);
        else setNeedsAgentPick(true);
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
            if (ro) ro.disconnect();
            term.dispose();
        };
    }, []);

    useEffect(() => {
        if (active && !startedRef.current && agentId) {
            startedRef.current = true;
            window.palsyncGui.startConsole(pal.cloudPalId + ":" + pal.path, agentId, pal.path);
            if (agentId !== pal.agentId && onAgentChosen) onAgentChosen(agentId);
        }
    }, [active, agentId]);

    // The terminal's host div stays mounted regardless of loading/picker state, so the
    // mount-time effect above (which only runs once) always finds a real ref to attach to —
    // overlaying the picker/placeholder instead of conditionally un-mounting the div.
    const overlayVisible = needsAgentPick || agents.length === 0;

    return (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
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
            <div className="term-host" ref={hostRef} style={overlayVisible ? { display: "none" } : { flex: 1, minHeight: 0 } } />
        </div>
    );
}
