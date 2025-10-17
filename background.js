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
            await chrome.action.setIcon({ path: "images/icon48.png", tabId: tabId });
            await chrome.action.setBadgeText({ text: '', tabId: tabId });
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
        await chrome.action.setBadgeText({ text: '', tabId: tabId });

    } catch (error) {
        if (error.message.includes('No tab with id') || error.message.includes('Invalid tab ID')) {
            // Tab was closed, ignore the error.
        } else {
            console.error("Failed to update icon:", error);
        }
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
        await chrome.action.setIcon({ imageData: imageData, tabId: tabId });
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
    // SPAサイトでのURL変更時、またはタブの読み込みが完了した時
    if (changeInfo.url || changeInfo.status === 'complete') {
        // content.jsに設定の再適用を指示
        chrome.tabs.sendMessage(tabId, { type: 'URL_CHANGED' }).catch(() => {});
        // アイコンも更新
        updateIconForTab(tabId);
    }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local' || !changes.siteVolumes) return;

    const oldVolumes = changes.siteVolumes.oldValue || {};
    const newVolumes = changes.siteVolumes.newValue || {};

    // アイコンの更新は常に実行
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
            updateIconForTab(tabs[0].id);
        }
    });

    // 変更されたキーを特定
    let changedKey = null;
    for (const key in newVolumes) {
        if (newVolumes[key] !== oldVolumes[key]) {
            changedKey = key;
            break;
        }
    }
    // 新規追加だけでなく、削除された場合も考慮
    if (!changedKey) {
        for (const key in oldVolumes) {
            if (!(key in newVolumes)) {
                changedKey = key;
                break;
            }
        }
    }

    if (!changedKey) return;

    const newVolume = newVolumes[changedKey]; // Can be undefined if the key was deleted

    // Check if the change is for a specific page URL or a domain
    if (changedKey.includes('/')) {
        // Change is for a specific URL.
        // Query all tabs, normalize their URLs, and sync the ones that match.
        const targetUrl = changedKey;
        chrome.tabs.query({}, (tabs) => {
            for (const tab of tabs) {
                if (tab.url && normalizeUrl(tab.url) === targetUrl) {
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'SYNC_VOLUME',
                        volume: newVolume
                    }).catch(() => {
                        // console.log(`Could not send message to tab ${tab.id}`);
                    });
                }
            }
        });
    } else {
        // Change is for a domain, sync all tabs under that domain
        const changedDomain = changedKey;
        chrome.tabs.query({}, (tabs) => {
            for (const tab of tabs) {
                if (tab.url) {
                    try {
                        const url = new URL(tab.url);
                        if (url.hostname === changedDomain) {
                            chrome.tabs.sendMessage(tab.id, {
                                type: 'SYNC_VOLUME',
                                volume: newVolume
                            }).catch(() => {
                                // console.log(`Could not send message to tab ${tab.id}`);
                            });
                        }
                    } catch (e) {
                        // console.warn(`Invalid URL: ${tab.url}`);
                    }
                }
            }
        });
    }
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