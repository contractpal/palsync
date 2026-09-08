import React, { useEffect, useState } from "react";
import LauncherView from "./components/LauncherView.jsx";
import WorkspaceView from "./components/WorkspaceView.jsx";
import DependencyCheckModal from "./components/DependencyCheckModal.jsx";
import AboutModal from "./components/AboutModal.jsx";
import SettingsModal from "./components/SettingsModal.jsx";

export default function App() {
    const [workspace, setWorkspace] = useState(null);
    const [workspacePath, setWorkspacePath] = useState(null);
    const [showLeaveWarning, setShowLeaveWarning] = useState(false);
    const [showDepsCheck, setShowDepsCheck] = useState(false);
    const [showAbout, setShowAbout] = useState(false);
    const [showSettings, setShowSettings] = useState(false);

    useEffect(() => {
        return window.palsyncGui.onOpenDependencyCheck(() => setShowDepsCheck(true));
    }, []);

    useEffect(() => {
        return window.palsyncGui.onOpenAbout(() => setShowAbout(true));
    }, []);

    useEffect(() => {
        return window.palsyncGui.onOpenSettings(() => setShowSettings(true));
    }, []);

    function onWorkspaceOpened(result) {
        if (!result || result.error) return;
        setWorkspace(result.workspace);
        setWorkspacePath(result.filePath);
    }

    async function leaveWorkspace() {
        if (await window.palsyncGui.anyConsolesRunning()) {
            setShowLeaveWarning(true);
            return;
        }
        setWorkspace(null);
    }

    async function confirmLeave() {
        await window.palsyncGui.killAllConsoles();
        setShowLeaveWarning(false);
        setWorkspace(null);
    }

    return (
        <div className="app">
            <div className="titlebar">
                <span className="app-name">
                    {workspace ? <b>{workspace.name}</b> : "No workspace open"}
                </span>
                {workspace && (
                    <button className="btn" onClick={leaveWorkspace}>
                        ← Workspaces
                    </button>
                )}
            </div>

            {!workspace && <LauncherView onOpened={onWorkspaceOpened} />}
            {workspace && (
                <WorkspaceView
                    workspace={workspace}
                    workspacePath={workspacePath}
                    onWorkspaceChange={setWorkspace}
                />
            )}

            {showLeaveWarning && (
                <div className="modal-backdrop" onClick={() => setShowLeaveWarning(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <h3>You have agents running</h3>
                        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
                            Going back to Workspaces will stop every running agent in this
                            workspace. Anything in progress will be interrupted.
                        </p>
                        <div className="modal-actions">
                            <button className="btn" onClick={() => setShowLeaveWarning(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={confirmLeave}>Stop and Leave</button>
                        </div>
                    </div>
                </div>
            )}

            {showDepsCheck && <DependencyCheckModal onClose={() => setShowDepsCheck(false)} />}
            {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
            {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
        </div>
    );
}
