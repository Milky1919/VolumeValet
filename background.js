// background.js v1.3.2 (Final Icon Logic Fix)

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
    
    // --- ▼▼▼ ここからが変更点 ▼▼▼ ---

    // 1. 状態を個別に判定する
    const isPinned = (pageVolume !== undefined);
    const isDomainSet = (domainVolume !== undefined);
    const isSet = isPinned || isDomainSet;

    let currentVolume;
    if (isPinned) {
        currentVolume = pageVolume;
    } else if (isDomainSet) {
        currentVolume = domainVolume;
    } else {
        currentVolume = 100; // 未設定時のデフォルト
    }
    const isMuted = (currentVolume === 0);

    // 2. アイコン描画のための状態オブジェクトを作成
    const iconState = {
        isSet: isSet,
        isMuted: isMuted,
    };
    
    // 3. バッジ表示のための状態を独立して決定
    const badgeText = isPinned ? 'PIN' : '';
    const badgeColor = '#007AFF'; // Blue

    // 4. アイコンとバッジをそれぞれ更新する
    await drawIcon(iconState, tabId);
    
    chrome.action.setBadgeText({ text: badgeText, tabId: tabId });
    if (badgeText) {
        chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId: tabId });
    }
    // --- ▲▲▲ ここまでが変更点 ▲▲▲ ---
}

async function drawIcon(state, tabId) {
    await setupOffscreenDocument('offscreen.html');
    try {
        const imageData = await chrome.runtime.sendMessage({
            target: 'offscreen',
            action: 'drawIcon',
            state: state
        });

        if (imageData) {
            chrome.action.setIcon({ imageData: imageData, tabId: tabId });
        }
    } catch (error) {
        console.warn("Could not draw icon, offscreen document might be closing.", error);
    }
}

// --- Event Listeners ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "refreshIcon") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                updateIconForTab(tabs[0].id);
            }
        });
    }
});

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

