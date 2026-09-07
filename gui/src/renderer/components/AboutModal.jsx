import React, { useEffect, useState } from "react";
import chipLogo from "../assets/chip.svg";

export default function AboutModal({ onClose }) {
    const [info, setInfo] = useState(null);

    useEffect(() => {
        window.palsyncGui.getAppInfo().then(setInfo);
    }, []);

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ alignItems: "center", textAlign: "center" }}>
                <img src={chipLogo} alt="Chip" style={{ width: 96, height: 96 }} />
                <h3 style={{ margin: 0 }}>Chip Pal Builder</h3>
                <p style={{ margin: 0, fontSize: 11, color: "var(--text-faint)" }}>
                    Computerized Helper for Implementing Pals
                </p>
                <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
                    Version {info ? info.version : "…"}
                </p>
                <p style={{ margin: 0, fontSize: 12, color: "var(--text-faint)" }}>
                    © {new Date().getFullYear()} ContractPal. All rights reserved.
                </p>
                <div className="modal-actions" style={{ justifyContent: "center" }}>
                    <button className="btn btn-primary" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}
