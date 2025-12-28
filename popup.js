// popup.js
document.getElementById('saveBtn').addEventListener('click', async () => {
    const config = {
        apiKey: document.getElementById('apiKey').value,
        roi: {
            x: parseInt(document.getElementById('roiX').value) || 500,
            y: parseInt(document.getElementById('roiY').value) || 800,
            width: parseInt(document.getElementById('roiW').value) || 300,
            height: parseInt(document.getElementById('roiH').value) || 150
        }
    };

    // Save to storage
    chrome.storage.local.set(config, () => {
        document.getElementById('status').innerText = 'Config Saved & Applied';

        // Notify content script
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'UPDATE_ROI', roi: config.roi });
            }
        });
    });
});

document.getElementById('calFold').addEventListener('click', () => triggerCalibration('fold'));
document.getElementById('calCall').addEventListener('click', () => triggerCalibration('call'));
document.getElementById('calRaise').addEventListener('click', () => triggerCalibration('raise'));

function triggerCalibration(action) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_CLICK_TARGET', action });
            window.close(); // Close popup to allow clicking site
        }
    });
}
chrome.storage.local.get(['apiKey', 'roi'], (data) => {
    if (data.apiKey) document.getElementById('apiKey').value = data.apiKey;
    if (data.roi) {
        document.getElementById('roiX').value = data.roi.x;
        document.getElementById('roiY').value = data.roi.y;
        document.getElementById('roiW').value = data.roi.width;
        document.getElementById('roiH').value = data.roi.height;
    }
});
