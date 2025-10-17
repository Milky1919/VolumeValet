// content.js v1.4.3 (Final Manual Fix)

if (typeof window.volumeValet === 'undefined' || !window.volumeValet.initialized) {
    class ContentScript {
        constructor() {
            this.audioContext = null;
            this.gainNodes = new Map();
            this.observer = null;
            this.currentVolume = 1.0;
            this.isUserInteracted = false;
            this.initialized = true; // 初期化フラグ

            this.initialize();
        }

        async initialize() {
            this.setupMessageListener();
            this.setupMutationObserver();
            await this.applySettings();
        }

        setupMessageListener() {
            chrome.runtime.onMessage.addListener((message) => {
                if (message.type === 'setVolume') {
                    // 先にボリューム値を更新し、その後でAudioContextの処理を行う
                    this.currentVolume = message.value / 100;
                    this.setVolumeForAllNodes(message.value); // 既存のノード音量を即時変更
                    this.ensureAudioContext(); // 新規要素のためにスキャンをトリガー
                } else if (message.type === 'URL_CHANGED') {
                    this.applySettings();
                }
                return true; // 非同期応答を示す
            });
        }
        
        waitForUserInteraction() {
            if (this.isUserInteracted) return Promise.resolve();
            return new Promise(resolve => {
                const listener = () => {
                    this.isUserInteracted = true;
                    window.removeEventListener('click', listener, { capture: true });
                    window.removeEventListener('keydown', listener, { capture: true });
                    resolve();
                };
                window.addEventListener('click', listener, { once: true, capture: true });
                window.addEventListener('keydown', listener, { once: true, capture: true });
            });
        }
        
        async ensureAudioContext() {
            if (this.audioContext && this.audioContext.state === 'running') {
                this.scanAndProcessAllMedia();
                return;
            }
            if (!this.isUserInteracted) {
                await this.waitForUserInteraction();
            }
            try {
                if (!this.audioContext) {
                    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                }
                if (this.audioContext.state === 'suspended') {
                    await this.audioContext.resume();
                }
                this.scanAndProcessAllMedia();
            } catch (e) { 
                console.error('VolumeValet: Error ensuring AudioContext.', e); 
            }
        }

        async applySettings() {
            const settings = await chrome.storage.local.get(['siteVolumes', 'maxVolume']);
            const domain = window.location.hostname;
            const pageUrl = this.normalizeUrl(window.location.href);
            
            const key = settings.siteVolumes?.[pageUrl] !== undefined ? pageUrl : domain;
            const maxVolume = settings.maxVolume || 200;
            let volumeToApply = settings.siteVolumes?.[key] ?? 100;

            if (volumeToApply > maxVolume) volumeToApply = maxVolume;
            
            // ★★★ 最重要修正点 ★★★
            // 1. 必ず先にthis.currentVolumeプロパティを更新する
            this.currentVolume = volumeToApply / 100;
            
            // 2. AudioContextの準備と音量適用を行う
            await this.ensureAudioContext();
            this.setVolumeForAllNodes(volumeToApply);
        }

        processMediaElement(element) {
            if (!this.audioContext || this.gainNodes.has(element)) return;

            try {
                const source = this.audioContext.createMediaElementSource(element);
                const gainNode = this.audioContext.createGain();
                gainNode.gain.value = this.currentVolume; // 正しい初期音量を設定
                source.connect(gainNode).connect(this.audioContext.destination);
                this.gainNodes.set(element, gainNode);
            } catch (e) {
                if (e.name !== 'InvalidStateError') {
                    // console.warn('VolumeValet: Could not process media element:', element, e);
                }
            }
        }
        
        scanAndProcessAllMedia() {
            if (!this.audioContext) return;
            document.querySelectorAll('video, audio').forEach(el => this.processMediaElement(el));
        }

        setupMutationObserver() {
            if (this.observer) this.observer.disconnect();
            this.observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) {
                            const media = node.matches('video, audio') ? [node] : Array.from(node.querySelectorAll('video, audio'));
                            if (media.length > 0) {
                                this.ensureAudioContext();
                            }
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