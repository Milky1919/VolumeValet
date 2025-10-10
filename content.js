// content.js

// スクリプト全体が複数回実行されるのを防ぐためのガード
if (typeof window.volumeValetHasRun === 'undefined') {
    window.volumeValetHasRun = true;

    // --- グローバル変数の定義 ---
    const g = {
        audioContext: null,
        gainNodes: new Map(),
        observer: null,
        currentVolume: 1,
        isDisabled: false
    };

    // --- 初期化処理 ---
    async function initialize() {
        const domain = window.location.hostname;
        const settings = await chrome.storage.local.get(['siteVolumes', 'disabledSites', 'isDefaultEnabled', 'defaultVolume', 'maxVolume']);

        g.isDisabled = settings.disabledSites?.includes(domain) || false;
        if (g.isDisabled) {
            console.log('VolumeValet: このサイトでは無効です。');
            // 念のため、既存の音声処理をリセット
            resetAllVolumes();
            return;
        }

        const maxVolume = settings.maxVolume || 150;
        let volumeToApply = settings.siteVolumes?.[domain];

        if (typeof volumeToApply === 'undefined') {
            volumeToApply = settings.isDefaultEnabled ? (settings.defaultVolume || 75) : 100;
        }
        
        if (volumeToApply > maxVolume) {
            volumeToApply = maxVolume;
        }
        
        g.currentVolume = volumeToApply / 100;

        setupAudioProcessing();
        setupMutationObserver();
        // 初期化時に音量を適用
        setAllVolumes(g.currentVolume * 100);
    }

    // --- Web Audio API関連 ---
    function setupAudioProcessing() {
        if (!g.audioContext) {
            try {
                const context = new (window.AudioContext || window.webkitAudioContext)();
                context.resume();
                g.audioContext = context;
            } catch (e) {
                console.error('Web Audio API is not supported in this browser', e);
                return;
            }
        }
        
        document.querySelectorAll('video, audio').forEach(processMediaElement);
    }

    function processMediaElement(element) {
        if (!g.audioContext || g.gainNodes.has(element)) return;

        try {
            const source = g.audioContext.createMediaElementSource(element);
            const gainNode = g.audioContext.createGain();
            gainNode.gain.value = g.currentVolume;
            
            source.connect(gainNode).connect(g.audioContext.destination);
            
            g.gainNodes.set(element, gainNode);
        } catch (e) {
            if (e.name !== 'InvalidStateError') {
                console.warn('Could not process media element:', element, e);
            }
        }
    }

    // --- 動的コンテンツ対応 ---
    function setupMutationObserver() {
        if (g.observer) return;

        g.observer = new MutationObserver((mutations) => {
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

        g.observer.observe(document.body, { childList: true, subtree: true });
    }

    // --- 音量設定 ---
    function setAllVolumes(volumePercentage) {
        // ▼▼▼ 変更点 ▼▼▼
        // 無効化されている場合は、この通常の音量設定は無視する
        if (g.isDisabled) return;
        // ▲▲▲ 変更点 ▲▲▲
        g.currentVolume = volumePercentage / 100;
        g.gainNodes.forEach((gainNode) => {
            if (gainNode && gainNode.gain) {
               gainNode.gain.value = g.currentVolume;
            }
        });
    }
    
    // ▼▼▼ 新規追加 ▼▼▼
    /**
     * 無効化時などに、強制的に全音量を100%に戻す関数
     */
    function resetAllVolumes() {
        g.gainNodes.forEach((gainNode) => {
            if (gainNode && gainNode.gain) {
               gainNode.gain.value = 1.0; // 100%
            }
        });
    }
    // ▲▲▲ 新規追加 ▲▲▲

    // --- ポップアップからのメッセージ受信 ---
    function messageHandler(message, sender, sendResponse) {
        (async () => {
            if (message.type === 'setVolume') {
                setAllVolumes(message.value);
            } else if (message.type === 'updateStatus') {
                g.isDisabled = message.value.isDisabled;
                if (g.isDisabled) {
                    // ▼▼▼ 変更点 ▼▼▼
                    // 無効化されたら、ここで強制的に音量をリセットする
                    resetAllVolumes();
                    // ▲▲▲ 変更点 ▲▲▲
                } else {
                    // 有効化されたら、設定を再読み込みして適用
                    await initialize();
                }
            }
        })();
    }

    if (!chrome.runtime.onMessage.hasListener(messageHandler)) {
        chrome.runtime.onMessage.addListener(messageHandler);
    }

    // --- 実行 ---
    initialize();

}

