// background.js v1.4.1 (SPA Navigation Fix)

let creating;
async function setupOffscreenDocument(path) {
    const offscreenUrl = chrome.runtime.getURL(path);
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
    });
    if (existingContexts.length > 0) return;
    if (creating) {
        await creating;
    } else {
        creating = chrome.offscreen.createDocument({
            url: path,
            reasons: ['DOM_PARSER'],
            justification: 'to dynamically generate extension icons',
        });
        await creating;
        creating = null;
    }
}

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

    const isPinned = (pageVolume !== undefined);
    const isDomainSet = (domainVolume !== undefined);
    const isSet = isPinned || isDomainSet;

    let currentVolume = isPinned ? pageVolume : (isDomainSet ? domainVolume : 100);
    const isMuted = (currentVolume === 0);

    const iconState = {
        isSet: isSet,
        isMuted: isMuted,
    };
    
    const badgeText = isPinned ? 'PIN' : '';
    const badgeColor = '#007AFF';

    await drawIcon(iconState, tabId);
    
    chrome.action.setBadgeText({ text: badgeText, tabId: tabId });
    if (badgeText) {
        chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId: tabId });
    }
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

chrome.runtime.onMessage.addListener((message) => {
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
    // --- ▼▼▼ ここからが変更点 ▼▼▼ ---
    // SPAサイトでのページ遷移（URLの変更）を検知する
    if (changeInfo.url) {
        // content.jsに設定の再適用を指示
        chrome.tabs.sendMessage(tabId, { type: 'URL_CHANGED' }).catch(() => {});
        // アイコンも更新
        updateIconForTab(tabId);
    }
    // --- ▲▲▲ ここまでが変更点 ▲▲▲
});

chrome.storage.onChanged.addListener(() => {
     chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            updateIconForTab(tabs[0].id);
        }
    });
});

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

