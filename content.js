// content.js v1.2.2 (最終修正版)

if (typeof window.volumeValetHasRun === 'undefined' || window.volumeValetHasRun === false) {
    window.volumeValetHasRun = true;

    const g = {
        audioContext: null,
        gainNodes: new Map(),
        observer: null,
        isDisabled: false,
        currentVolume: 1.0
    };

    function getAudioContext() {
        if (!g.audioContext) {
            try {
                g.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const resumeContext = () => {
                    if (g.audioContext && g.audioContext.state === 'suspended') {
                        g.audioContext.resume();
                    }
                    document.body.removeEventListener('click', resumeContext, true);
                    document.body.removeEventListener('keydown', resumeContext, true);
                };
                document.body.addEventListener('click', resumeContext, true);
                document.body.addEventListener('keydown', resumeContext, true);
            } catch (e) {
                console.error('VolumeValet: Could not create AudioContext.', e);
                return null;
            }
        }
        return g.audioContext;
    }

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

    async function initialize() {
        const domain = window.location.hostname;
        const pageUrl = normalizeUrl(window.location.href);

        const settings = await chrome.storage.local.get({
            siteVolumes: {}, disabledSites: [], isDefaultEnabled: false, defaultVolume: 75, maxVolume: 150
        });

        g.isDisabled = settings.disabledSites?.includes(domain) || false;
        if (g.isDisabled) {
            g.currentVolume = 1.0;
            setVolumeForAllNodes(1.0);
            return;
        }

        const maxVolume = settings.maxVolume;
        let volumeToApply = settings.siteVolumes[pageUrl] ?? settings.siteVolumes[domain];
        
        if (typeof volumeToApply === 'undefined') {
            volumeToApply = settings.isDefaultEnabled ? settings.defaultVolume : 100;
        }
        
        if (volumeToApply > maxVolume) {
            volumeToApply = maxVolume;
        }
        
        g.currentVolume = volumeToApply / 100;
        setVolumeForAllNodes(g.currentVolume);

        setupMutationObserver();
        processExistingMediaElements();
    }

    function processExistingMediaElements() {
        document.querySelectorAll('video, audio').forEach(processMediaElement);
    }
    
    function processMediaElement(element) {
        if (g.gainNodes.has(element)) return;

        const audioContext = getAudioContext();
        if (!audioContext) return;

        try {
            const source = audioContext.createMediaElementSource(element);
            const gainNode = audioContext.createGain();
            gainNode.gain.value = g.currentVolume;
            source.connect(gainNode).connect(audioContext.destination);
            g.gainNodes.set(element, gainNode);
        } catch (e) {
            if (e.name !== 'InvalidStateError') {
                console.warn('VolumeValet: Could not process media element:', e);
            }
        }
    }

    function setupMutationObserver() {
        if (g.observer) return;
        g.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1) {
                        if (node.matches('video, audio')) {
                            processMediaElement(node);
                        }
                        node.querySelectorAll('video, audio').forEach(processMediaElement);
                    }
                }
            }
        });
        g.observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    function setVolumeForAllNodes(volume) {
        g.gainNodes.forEach((gainNode) => {
            if (gainNode?.gain) {
               gainNode.gain.value = volume;
            }
        });
    }

    function messageHandler(message) {
        if (message.type === 'setVolume') {
            if (!g.isDisabled) {
                g.currentVolume = message.value / 100;
                setVolumeForAllNodes(g.currentVolume);
            }
        } else if (message.type === 'updateStatus') {
            g.isDisabled = message.value.isDisabled;
            g.currentVolume = g.isDisabled ? 1.0 : g.currentVolume;
            setVolumeForAllNodes(g.currentVolume);
            if (!g.isDisabled) initialize();
        }
    }

    if (!chrome.runtime.onMessage.hasListener(messageHandler)) {
        chrome.runtime.onMessage.addListener(messageHandler);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, {once: true});
    } else {
        initialize();
    }
}

