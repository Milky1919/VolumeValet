// background.js v1.3.1 (Bug Fix)

// --- Offscreen Canvas Setup ---
let creating; // Offscreen document creation promise
async function setupOffscreenDocument(path) {
    const offscreenUrl = chrome.runtime.getURL(path);
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
    });

    if (existingContexts.length > 0) {
        return;
    }

    if (creating) {
        await creating;
    } else {
        creating = chrome.offscreen.createDocument({
            url: path,
            reasons: ['CANVAS'],
            justification: 'to dynamically generate extension icons',
        });
        await creating;
        creating = null;
    }
}


// --- Icon Update Logic ---

async function updateIconForTab(tabId) {
    if (!tabId) return;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !tab.url || !tab.url.startsWith('http')) {
        chrome.action.setIcon({ path: "images/icon48.png", tabId: tabId });
        chrome.action.setBadgeText({ text: '', tabId: tabId });
        return;
    }

    const url = new URL(tab.url);
    const domain = url.hostname;
    const pageUrl = normalizeUrl(tab.url);

    const settings = await chrome.storage.local.get(['siteVolumes']);
    const siteVolumes = settings.siteVolumes || {};

    const pageVolume = siteVolumes[pageUrl];
    const domainVolume = siteVolumes[domain];
    
    let isSet = (pageVolume !== undefined || domainVolume !== undefined);
    let isPinned = (pageVolume !== undefined);
    
    let currentVolume = isPinned ? pageVolume : domainVolume;
    if (currentVolume === undefined) currentVolume = 100;

    let isMuted = (currentVolume === 0);

    // --- Determine Icon State based on priority ---
    let iconState = {
        isSet: isSet,
        isMuted: false,
        badgeText: ''
    };

    // 1. Muted State (Top Priority)
    if (isMuted) {
        iconState.isMuted = true;
    }
    // 2. Pinned State
    else if (isPinned) {
        iconState.badgeText = 'PIN';
    }
    
    await drawIcon(iconState, tabId);

    // Set Badge
    chrome.action.setBadgeText({ text: iconState.badgeText, tabId: tabId });
    if (isPinned && !isMuted) {
         chrome.action.setBadgeBackgroundColor({ color: '#007AFF', tabId: tabId }); // Blue
    }
}

async function drawIcon(state, tabId) {
    await setupOffscreenDocument('offscreen.html');
    const imageData = await chrome.runtime.sendMessage({
        target: 'offscreen',
        action: 'drawIcon',
        state: state
    });

    if (imageData) {
        chrome.action.setIcon({ imageData: imageData, tabId: tabId });
    }
}

// --- Event Listeners ---

// ▼▼▼ ここからが変更点 ▼▼▼
// When popup opens and requests an icon refresh
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "refreshIcon") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                updateIconForTab(tabs[0].id);
            }
        });
    }
});
// ▲▲▲ ここまでが変更点 ▲▲▲

chrome.tabs.onActivated.addListener((activeInfo) => {
    updateIconForTab(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
        updateIconForTab(tabId);
    }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes.siteVolumes || changes.maxVolume)) {
         chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                updateIconForTab(tabs[0].id);
            }
        });
    }
});

// --- Utility Function ---
function normalizeUrl(urlString) {
    try {
        const url = new URL(urlString);
        const paramsToRemove = ['t', 'si', 'feature'];
        url.searchParams.forEach((value, key) => {
            if (key.startsWith('utm_') || paramsToRemove.includes(key)) {
                url.searchParams.delete(key);
            }
        });
        return url.origin + url.pathname + url.search;
    } catch (e) { return urlString; }
}

