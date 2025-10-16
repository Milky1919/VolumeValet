// content.js v1.4.1 (SPA Navigation Fix)

if (typeof window.volumeValet === 'undefined') {
    class ContentScript {
        constructor() {
            this.audioContext = null;
            this.gainNodes = new Map();
            this.observer = null;
            this.currentVolume = 1.0;
            this.isUserInteracted = false;

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
                    this.ensureAudioContext().then(() => {
                        this.setVolumeForAllNodes(message.value);
                    });
                // --- ▼▼▼ ここからが変更点 ▼▼▼ ---
                } else if (message.type === 'URL_CHANGED') {
                    // background.jsからの指示で、設定を再適用する
                    this.applySettings();
                }
                // --- ▲▲▲ ここまでが変更点 ▲▲▲
            });
        }
        
        waitForUserInteraction() {
            if (this.isUserInteracted) return Promise.resolve();
            return new Promise(resolve => {
                const listener = () => {
                    this.isUserInteracted = true;
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
                 await this.waitForUserInteraction();
                try {
                    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                } catch (e) { console.error('VolumeValet: Web Audio API not supported.', e); return; }
            }
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            this.scanAndProcessAllMedia();
        }

        async applySettings() {
            const settings = await chrome.storage.local.get(['siteVolumes', 'maxVolume']);
            const domain = window.location.hostname;
            
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
                        if (node.nodeType === 1) { // ELEMENT_NODE
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

