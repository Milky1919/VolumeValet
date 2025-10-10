// content.js

// グローバル変数
let audioContext;
let gainNodes = new Map(); // 各メディア要素とGainNodeを紐付ける
let observer;
let currentVolume = 1; // 1 = 100%
let isDisabled = false;

// --- 初期化処理 ---
async function initialize() {
    const domain = window.location.hostname;
    // ▼▼▼ 修正点1: maxVolumeも読み込むように変更 ▼▼▼
    const settings = await chrome.storage.local.get(['siteVolumes', 'disabledSites', 'isDefaultEnabled', 'defaultVolume', 'maxVolume']);

    isDisabled = settings.disabledSites?.includes(domain) || false;
    if (isDisabled) {
        console.log('VolumeValet: このサイトでは無効です。');
        return;
    }

    const maxVolume = settings.maxVolume || 150;
    let volumeToApply = settings.siteVolumes?.[domain];

    if (typeof volumeToApply === 'undefined') {
        volumeToApply = settings.isDefaultEnabled ? (settings.defaultVolume || 75) : 100;
    }
    
    // 読み込んだ音量が最大値を超えないように調整
    if (volumeToApply > maxVolume) {
        volumeToApply = maxVolume;
    }
    
    currentVolume = volumeToApply / 100;

    setupAudioProcessing();
    setupMutationObserver();
}

// --- Web Audio API関連 ---
function setupAudioProcessing() {
    if (!audioContext) {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.error('Web Audio API is not supported in this browser', e);
            return;
        }
    }
    
    document.querySelectorAll('video, audio').forEach(processMediaElement);
}

function processMediaElement(element) {
    if (!audioContext || gainNodes.has(element)) return;

    try {
        // ▼▼▼ 修正点2: エラーの原因だったタイポを修正 (audio -> audioContext) ▼▼▼
        const source = audioContext.createMediaElementSource(element);
        const gainNode = audioContext.createGain();
        gainNode.gain.value = currentVolume;
        
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        gainNodes.set(element, gainNode);
    } catch (e) {
        // "InvalidStateNode"エラーは要素が未ロードの場合に発生しうるので無視
        if (e.name !== 'InvalidStateError') {
            console.warn('Could not process media element:', element, e);
        }
    }
}

// --- 動的コンテンツ対応 ---
function setupMutationObserver() {
    observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) { // ELEMENT_NODE
                    if (node.matches('video, audio')) {
                        processMediaElement(node);
                    }
                    node.querySelectorAll('video, audio').forEach(processMediaElement);
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

// --- 音量設定 ---
function setAllVolumes(volumePercentage) {
    if (isDisabled) return;
    currentVolume = volumePercentage / 100;
    gainNodes.forEach((gainNode) => {
        if (gainNode && gainNode.gain) {
           gainNode.gain.value = currentVolume;
        }
    });
}

// --- ポップアップからのメッセージ受信 ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // initialize()が非同期なため、念のためPromiseを扱う
    (async () => {
        if (message.type === 'setVolume') {
            setAllVolumes(message.value);
        } else if (message.type === 'updateStatus') {
            isDisabled = message.value.isDisabled;
            if (isDisabled) {
                setAllVolumes(100); // 無効化されたら音量を100%に戻す
            } else {
                // 有効化されたら、再度設定を読み込んで適用
                await initialize();
            }
        }
    })();
    // sendResponseを使わないので、trueを返さない
});

// --- 実行 ---
// content.jsは複数回注入される可能性があるため、初回のみ実行するよう制御
if (typeof window.volumeValetInitialized === 'undefined') {
    window.volumeValetInitialized = true;
    initialize();
}

