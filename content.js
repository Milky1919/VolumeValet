// content.js v1.2.7 (最終安定化・状態同期版)

if (typeof window.volumeValet === 'undefined') {
    class ContentScript {
        constructor() {
            this.audioContext = null;
            this.gainNodes = new Map();
            this.observer = null;
            this.currentVolume = 1.0;
            this.isDisabled = false;

            this.initialize();
        }

        async initialize() {
            this.setupStorageListener();
            this.setupMutationObserver();
            // ユーザー操作を待ってからAudioContextを初期化
            this.waitForUserInteraction().then(() => this.ensureAudioContext());
        }

        /**
         * chrome.storageの変更を監視するリスナーをセットアップ
         */
        setupStorageListener() {
            chrome.storage.onChanged.addListener((changes, namespace) => {
                if (namespace === 'local') {
                    // 設定が変更されたら、音量を再評価して適用する
                    this.applySettings();
                }
            });
        }
        
        waitForUserInteraction() {
            return new Promise(resolve => {
                const listener = () => {
                    ['click', 'keydown', 'mousedown', 'touchstart'].forEach(type => {
                        window.removeEventListener(type, listener, { capture: true });
                    });
                    resolve();
                };
                ['click', 'keydown', 'mousedown', 'touchstart'].forEach(type => {
                    window.addEventListener(type, listener, { once: true, capture: true });
                });
            });
        }
        
        async ensureAudioContext() {
            if (!this.audioContext) {
                try {
                    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                } catch (e) { console.error('VolumeValet: Web Audio API is not supported.', e); return; }
            }
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            this.scanAndProcessAllMedia();
        }

        /**
         * 現在のストレージ設定に基づいて音量を適用する
         */
        async applySettings() {
            const settings = await chrome.storage.local.get(['siteVolumes', 'disabledSites', 'maxVolume']);
            const domain = window.location.hostname;

            this.isDisabled = settings.disabledSites?.includes(domain) || false;
            
            if (this.isDisabled) {
                this.setVolumeForAllNodes(100); // 無効なら100%に
                return;
            }
            
            const key = settings.siteVolumes?.[this.normalizeUrl(window.location.href)] !== undefined
                ? this.normalizeUrl(window.location.href)
                : domain;
                
            const maxVolume = settings.maxVolume || 200;
            let volumeToApply = settings.siteVolumes?.[key] ?? 100;
            if (volumeToApply > maxVolume) volumeToApply = maxVolume;
            
            this.setVolumeForAllNodes(volumeToApply);
        }

        processMediaElement(element) {
            if (!this.audioContext || this.gainNodes.has(element)) return;

            try {
                const source = this.audioContext.createMediaElementSource(element);
                const gainNode = this.audioContext.createGain();
                gainNode.gain.value = this.currentVolume;
                source.connect(gainNode).connect(this.audioContext.destination);
                this.gainNodes.set(element, gainNode);
            } catch (e) {
                if (e.name !== 'InvalidStateError') {
                    console.warn('VolumeValet: Could not process media element:', element, e);
                }
            }
        }
        
        scanAndProcessAllMedia() {
            if (!this.audioContext) return;
            document.querySelectorAll('video, audio').forEach(el => this.processMediaElement(el));
        }

        setupMutationObserver() {
            this.observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) {
                            if (node.matches('video, audio')) {
                                this.ensureAudioContext().then(() => this.processMediaElement(node));
                            }
                            node.querySelectorAll('video, audio').forEach(el => {
                                this.ensureAudioContext().then(() => this.processMediaElement(el));
                            });
                        }
                    }
                }
            });
            this.observer.observe(document.documentElement, { childList: true, subtree: true });
        }

        setVolumeForAllNodes(volumePercentage) {
            this.currentVolume = volumePercentage / 100;
            if (this.audioContext) {
                this.gainNodes.forEach((gainNode) => {
                    if (gainNode?.gain) {
                       gainNode.gain.setTargetAtTime(this.currentVolume, this.audioContext.currentTime, 0.015);
                    }
                });
            }
        }
        
        normalizeUrl(urlString) {
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
    }
    window.volumeValet = new ContentScript();
}

