// background.js v1.5.1

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
            reasons: ['BLOBS'],
            justification: 'to dynamically generate extension icons',
        });
        await creating;
        creating = null;
    }
}

async function updateIconForTab(tabId) {
    if (!tabId) return;

    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab || !tab.url || !tab.url.startsWith('http')) {
            await drawIcon('unset', tabId);
            return;
        }

        const url = new URL(tab.url);
        const domain = url.hostname;
        const pageUrl = normalizeUrl(tab.url);

        const { siteVolumes = {} } = await chrome.storage.local.get('siteVolumes');

        const pageVolume = siteVolumes[pageUrl];
        const domainVolume = siteVolumes[domain];

        let iconState;
        if (pageVolume !== undefined) {
            iconState = pageVolume === 0 ? 'pageMute' : 'pageSet';
        } else if (domainVolume !== undefined) {
            iconState = domainVolume === 0 ? 'domainMute' : 'domainSet';
        } else {
            iconState = 'unset';
        }
    
        await drawIcon(iconState, tabId);
        chrome.action.setBadgeText({ text: '', tabId: tabId });

    } catch (error) {
        if (error.message.includes('No tab with id') || error.message.includes('Invalid tab ID')) {
            // Tab was closed, ignore.
        } else {
            console.error("Failed to update icon:", error);
        }
    }
}

async function drawIcon(state, tabId) {
    try {
        await setupOffscreenDocument('offscreen.html');

        const rawImageData = await chrome.runtime.sendMessage({
            target: 'offscreen',
            action: 'drawIcon',
            state: state
        });

        if (rawImageData && rawImageData.data) {
            const imageData = new ImageData(
                new Uint8ClampedArray(rawImageData.data),
                rawImageData.width,
                rawImageData.height
            );
            await chrome.action.setIcon({ imageData: imageData, tabId: tabId });
        }
    } catch (error) {
        console.warn(`Could not draw icon for tab ${tabId}:`, error);
        // Fallback to default icon if drawing fails
        await chrome.action.setIcon({ path: "images/icon48.png", tabId: tabId });
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
    if (changeInfo.url || changeInfo.status === 'complete') {
        chrome.tabs.sendMessage(tabId, { type: 'URL_CHANGED' }).catch(() => {});
        updateIconForTab(tabId);
    }
});

// 【修正】設定変更時に全タブを走査して同期する
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local' || !changes.siteVolumes) return;

    const oldVolumes = changes.siteVolumes.oldValue || {};
    const newVolumes = changes.siteVolumes.newValue || {};

    let changedKey = null;
    for (const key in newVolumes) {
        if (newVolumes[key] !== oldVolumes[key]) {
            changedKey = key;
            break;
        }
    }
    if (!changedKey) {
        for (const key in oldVolumes) {
            if (!(key in newVolumes)) {
                changedKey = key;
                break;
            }
        }
    }

    if (!changedKey) return;

    const newVolume = newVolumes[changedKey];
    const isSpecificUrl = changedKey.includes('/');

    // 全タブをチェック
    chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
            if (!tab.url) continue;

            let shouldSync = false;
            if (isSpecificUrl) {
                if (normalizeUrl(tab.url) === changedKey) shouldSync = true;
            } else {
                try {
                    const url = new URL(tab.url);
                    if (url.hostname === changedKey) shouldSync = true;
                } catch (e) {}
            }

            if (shouldSync) {
                // 音量の同期
                chrome.tabs.sendMessage(tab.id, { type: 'SYNC_VOLUME', volume: newVolume }).catch(() => {});
                // アイコンの更新
                updateIconForTab(tab.id);
            }
        }
    });
});

function normalizeUrl(urlString) {
    try {
        const url = new URL(urlString);
        const paramsToRemove = ['t', 'si', 'feature', 'list', 'index', 'ab_channel'];
        url.searchParams.forEach((value, key) => {
            if (key.startsWith('utm_') || paramsToRemove.includes(key)) {
                url.searchParams.delete(key);
            }
        });
        return url.origin + url.pathname + url.search;
    } catch (e) { return urlString; }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_VERSION') {
        sendResponse({ version: chrome.runtime.getManifest().version });
    }
});