import React from "react";

// Scan-to-test-on-mobile — same idea as the Java PalBuilder IDE's QR option, but the code is
// rendered in the main process (see qrCode.js) so the raw preview URL never reaches here.
export default function QrCodeModal({ label, dataUrl, onClose }) {
    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ alignItems: "center", textAlign: "center" }}>
                <h3>Scan to test "{label}" on your phone</h3>
                <img src={dataUrl} alt="QR code" width={240} height={240} style={{ alignSelf: "center", borderRadius: 8 }} />
                <p className="dep-hint">Your phone must be able to reach this server (same network or VPN).</p>
                <div className="modal-actions">
                    <button className="btn btn-primary" onClick={onClose}>Done</button>
                </div>
            </div>
        </div>
    );
}
