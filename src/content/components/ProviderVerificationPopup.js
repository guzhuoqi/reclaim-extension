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

export function createProviderVerificationPopup(providerName, credentialType, dataRequired) {
    const popup = document.createElement('div');
    popup.id = 'humanity-protocol-popup';
    popup.style.position = 'fixed';
    popup.style.bottom = '20px';
    popup.style.left = '20px';
    popup.style.width = '300px';
    popup.style.backgroundColor = '#2C2C2E'; // Dark background similar to image
    popup.style.color = '#FFFFFF';
    popup.style.borderRadius = '12px';
    popup.style.padding = '20px';
    popup.style.fontFamily = 'Arial, sans-serif';
    popup.style.zIndex = '9999';
    popup.style.boxShadow = '0px 4px 12px rgba(0, 0, 0, 0.5)';
    popup.style.fontSize = '14px';

    popup.innerHTML = `
        <div style="display: flex; align-items: center; margin-bottom: 15px;">
            <img src="${chrome.runtime.getURL('assets/img/logo.png')}" alt="Humanity Protocol" style="width: 24px; height: 24px; margin-right: 10px;">
            <h3 style="margin: 0; font-size: 16px; font-weight: 600;">humanity protocol</h3>
        </div>

        <div style="margin-bottom: 15px;">
            <p style="margin: 0 0 5px 0; color: #A0A0A5; font-size: 12px;">Source</p>
            <p style="margin: 0; font-size: 16px; font-weight: 500;">${providerName}</p>
        </div>

        <div style="margin-bottom: 15px;">
            <p style="margin: 0 0 5px 0; color: #A0A0A5; font-size: 12px;">Credential Type</p>
            <p style="margin: 0; font-size: 16px; font-weight: 500;">${credentialType}</p>
        </div>

        <div style="margin-bottom: 20px;">
            <p style="margin: 0 0 5px 0; color: #A0A0A5; font-size: 12px;">Data Required</p>
            <p style="margin: 0; font-size: 16px; font-weight: 500;">${dataRequired}</p>
        </div>

        <hr style="border: none; border-top: 1px solid #4A4A4E; margin: 20px 0;">

        <div style="margin-bottom: 20px;">
            <h4 style="margin: 0 0 10px 0; font-size: 14px; font-weight: 600;">How it works</h4>
            <div style="display: flex; align-items: flex-start; margin-bottom: 8px;">
                <span style="background-color: #4A4A4E; color: #FFFFFF; border-radius: 4px; padding: 2px 6px; font-size: 12px; margin-right: 10px; line-height: 1.5;">1</span>
                <p style="margin: 0; font-size: 13px; line-height: 1.5;">Log in to your [${providerName}.com] account.</p>
            </div>
            <div style="display: flex; align-items: flex-start;">
                <span style="background-color: #4A4A4E; color: #FFFFFF; border-radius: 4px; padding: 2px 6px; font-size: 12px; margin-right: 10px; line-height: 1.5;">2</span>
                <p style="margin: 0; font-size: 13px; line-height: 1.5;">Click "Verify" below.</p>
            </div>
        </div>

        <button id="hp-verify-button" style="width: 100%; padding: 12px; background-color: #007AFF; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; opacity: 0.5;" disabled>
            Verify
        </button>
        <div id="hp-loader" style="display: none; text-align: center; margin-top: 10px;">
            <!-- Basic CSS Loader -->
            <style>
                .hp-spinner {
                    border: 3px solid #f3f3f3; 
                    border-top: 3px solid #007AFF; 
                    border-radius: 50%;
                    width: 20px;
                    height: 20px;
                    animation: hp-spin 1s linear infinite;
                    margin: 0 auto;
                }
                @keyframes hp-spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
            <div class="hp-spinner"></div>
            <p style="font-size: 13px; color: #A0A0A5; margin-top: 5px;">Verifying...</p>
        </div>
         <div id="hp-success-message" style="display: none; text-align: center; margin-top: 10px; color: #34C759; font-size: 14px; font-weight: 500;">
            Verification Successful!
        </div>
    `;

    // Function to show loader and disable button
    popup.showLoader = function() {
        document.getElementById('hp-verify-button').style.display = 'none';
        document.getElementById('hp-loader').style.display = 'block';
    };

    // Function to show success message
    popup.showSuccess = function() {
        document.getElementById('hp-loader').style.display = 'none';
        document.getElementById('hp-success-message').style.display = 'block';
    };

    // Function to enable verify button
    popup.enableVerifyButton = function() {
        const button = document.getElementById('hp-verify-button');
        button.disabled = false;
        button.style.opacity = '1';
        button.style.backgroundColor = '#007AFF'; // Active color
    };

    // Function to disable verify button
    popup.disableVerifyButton = function() {
        const button = document.getElementById('hp-verify-button');
        button.disabled = true;
        button.style.opacity = '0.5';
        button.style.backgroundColor = '#007AFF'; // Keep color but use opacity to show disabled
    };

    // Function to update progress (placeholder for now)
    // You might want to update a progress bar or text
    popup.updateProgress = function(message) {
        const loader = document.getElementById('hp-loader');
        const progressText = loader.querySelector('p');
        if (progressText) {
            progressText.textContent = message;
        }
    };

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