// TODO: Implement HTML structure and basic styling for the popup.
// The popup should match the design in the provided image.
// It needs:
// - A container for the entire popup, positioned at the bottom left.
// - Sections for:
//   - Source (e.g., "Emirates")
//   - Credential Type (e.g., "Skywards")
//   - Data Required (e.g., "Membership Status / Tier")
//   - "How it works" section with two steps
//   - A "Verify" button (initially disabled)
// - Placeholders for dynamic data.

// Basic styling will be added here or in a linked CSS file. 

export function createProviderVerificationPopup(providerName, description, dataRequired) {
    const popup = document.createElement('div');
    popup.id = 'reclaim-protocol-popup';
    popup.style.position = 'fixed';
    popup.style.bottom = '20px';
    popup.style.right = '20px';
    popup.style.width = '300px';
    popup.style.backgroundColor = '#2C2C2E';
    popup.style.color = '#FFFFFF';
    popup.style.borderRadius = '12px';
    popup.style.padding = '20px';
    popup.style.fontFamily = 'Arial, sans-serif';
    popup.style.zIndex = '9999';
    popup.style.boxShadow = '0px 4px 12px rgba(0, 0, 0, 0.5)';
    popup.style.fontSize = '14px';

    popup.innerHTML = `
        <div style="display: flex; align-items: center; margin-bottom: 15px;">
            <img src="${chrome.runtime.getURL('assets/img/logo.png')}" alt="Reclaim Protocol" style="width: 24px; height: 24px; margin-right: 10px;">
            <h3 style="margin: 0; font-size: 16px; font-weight: 600;">Reclaim Protocol</h3>
        </div>

        <div style="margin-bottom: 15px;">
            <p style="margin: 0 0 5px 0; color: #A0A0A5; font-size: 12px;">Source</p>
            <p style="margin: 0; font-size: 16px; font-weight: 500;">${providerName}</p>
        </div>

        <div style="margin-bottom: 15px;">
            <p style="margin: 0 0 5px 0; color: #A0A0A5; font-size: 12px;">Description</p>
            <p style="margin: 0; font-size: 16px; font-weight: 500;">${description}</p>
        </div>

        <div style="margin-bottom: 20px;">
            <p style="margin: 0 0 5px 0; color: #A0A0A5; font-size: 12px;">Data Required</p>
            <p style="margin: 0; font-size: 16px; font-weight: 500;">${dataRequired}</p>
        </div>
    `;

    return popup;
}

// Example usage (for testing - remove later):
/*
if (typeof document !== 'undefined') { // Basic check for browser environment
    const examplePopup = createProviderVerificationPopup('Emirates', 'Skywards', 'Membership Status / Tier');
    document.body.appendChild(examplePopup);
    // To test enabling the button:
    // setTimeout(() => examplePopup.enableVerifyButton(), 2000);
    // To test loader:
    // setTimeout(() => { examplePopup.showLoader(); examplePopup.updateProgress("Generating proof..."); }, 4000);
    // To test success:
    // setTimeout(() => examplePopup.showSuccess(), 6000);
}
*/ 