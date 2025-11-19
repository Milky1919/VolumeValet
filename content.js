const CONTENT_SCRIPT_VERSION = "1.5.0";

// Prevent multiple initializations
if (typeof window.volumeValet === 'undefined') {
    window.volumeValet = true; // Simple flag to prevent re-injection

    function initialize() {
        const mediaMap = new WeakMap(); // Tracks media elements and their associated audio nodes

        // 【修正】AudioContextをシングルトン（共有）で管理
        let sharedAudioContext = null;

        function getSharedAudioContext() {
            if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
                sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            return sharedAudioContext;
        }

        // 1. Core Logic: Apply Volume Settings
        async function applySettings(element) {
            if (!element) return;

            const { siteVolumes = {} } = await chrome.storage.local.get('siteVolumes');
            const domain = window.location.hostname;
            const pageUrl = normalizeUrl(window.location.href);

            const pageVolume = siteVolumes[pageUrl];
            const domainVolume = siteVolumes[domain];

            let targetVolume;
            if (pageVolume !== undefined) {
                targetVolume = pageVolume / 100;
            } else if (domainVolume !== undefined) {
                targetVolume = domainVolume / 100;
            } else {
                targetVolume = 1.0; // Default to 100% if no setting is found
            }

            setVolume(element, targetVolume);
        }

        // NEW: Reliably set the initial volume with a retry mechanism
        async function reliableSetInitialVolume(element) {
            if (!element || !mediaMap.has(element)) return;

            // 1. Determine the target volume from storage
            const { siteVolumes = {} } = await chrome.storage.local.get('siteVolumes');
            const domain = window.location.hostname;
            const pageUrl = normalizeUrl(window.location.href);
            const pageVolume = siteVolumes[pageUrl];
            const domainVolume = siteVolumes[domain];

            let targetVolume;
            if (pageVolume !== undefined) {
                targetVolume = pageVolume / 100;
            } else if (domainVolume !== undefined) {
                targetVolume = domainVolume / 100;
            } else {
                targetVolume = 1.0; // Default to 100%
            }

            // 2. Retry Mechanism.
            const maxRetries = 7;
            const initialDelay = 50; // ms

            for (let i = 0; i < maxRetries; i++) {
                await setVolume(element, targetVolume, { isInitial: true });

                // Give the browser a moment to apply the change
                await new Promise(resolve => setTimeout(resolve, 25));

                const { gainNode } = mediaMap.get(element) || {};
                // Check if the gain value is close enough to the target
                if (gainNode && Math.abs(gainNode.gain.value - targetVolume) < 0.01) {
                    return; // Success
                }

                // Exponential backoff for subsequent retries
                const delay = initialDelay * Math.pow(2, i);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        // 2. Audio Control: Set Volume via Web Audio API

        async function ensureContextIsRunning(audioContext) {
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }
            if (audioContext.state === 'closed') {
                throw new Error("AudioContext is closed.");
            }
        }

        async function setVolume(element, volume, options = {}) {
            if (!mediaMap.has(element)) return;

            const mediaNodes = mediaMap.get(element);
            const { audioContext, source, gainNode, compressor } = mediaNodes;

            // source check is relaxed here as it might not be connected yet, 
            // but context/gain/compressor are required.
            if (!audioContext || !gainNode || !compressor) return;

            try {
                await ensureContextIsRunning(audioContext);

                const isBoosted = volume > 1.0;
                const now = audioContext.currentTime;
                const rampTime = 0.015;

                if (isBoosted) {
                    // Activate the "Safe Boost" limiter
                    compressor.threshold.setTargetAtTime(-10, now, rampTime);
                    compressor.knee.setTargetAtTime(0, now, rampTime);
                    compressor.ratio.setTargetAtTime(20, now, rampTime);
                } else {
                    // Make the compressor transparent
                    compressor.threshold.setTargetAtTime(0, now, rampTime);
                    compressor.knee.setTargetAtTime(0, now, rampTime);
                    compressor.ratio.setTargetAtTime(1, now, rampTime);
                }

                const finalRampTime = options.isInitial ? 0.05 : rampTime;
                gainNode.gain.setTargetAtTime(volume, now, finalRampTime);

            } catch (error) {
                // Context issue or cleanup race condition
            }
        }

        // 3. Audio Graph Initialization
        function handleNewMediaElement(element) {
            if (mediaMap.has(element)) return;

            // 【修正】共有コンテキストを使用
            const audioContext = getSharedAudioContext();

            const gainNode = audioContext.createGain();
            const compressor = audioContext.createDynamicsCompressor();

            compressor.connect(gainNode);
            gainNode.connect(audioContext.destination);

            const now = audioContext.currentTime;
            compressor.threshold.setValueAtTime(0, now);
            compressor.knee.setValueAtTime(0, now);
            compressor.ratio.setValueAtTime(1, now);
            compressor.attack.setValueAtTime(0.003, now);
            compressor.release.setValueAtTime(0.25, now);

            // ** PRE-EMPTIVE MUTE **
            gainNode.gain.value = 0;

            mediaMap.set(element, {
                audioContext,
                source: null,
                gainNode,
                compressor,
                pendingVolume: null
            });

            const onPlaying = () => {
                createAndConnectSource(element);
                element.removeEventListener('playing', onPlaying);
            };

            const onTimeUpdate = () => {
                if (element.currentTime > 0) {
                    createAndConnectSource(element);
                    element.removeEventListener('timeupdate', onTimeUpdate);
                }
            };

            element.addEventListener('playing', onPlaying, { once: true });
            element.addEventListener('timeupdate', onTimeUpdate);
        }

        // STAGE 2: Create the media source and connect it to the static graph.
        function createAndConnectSource(element) {
            if (!mediaMap.has(element)) return;

            const mediaNodes = mediaMap.get(element);
            const { audioContext, compressor } = mediaNodes;

            if (mediaNodes.source) return;

            try {
                const source = audioContext.createMediaElementSource(element);
                mediaNodes.source = source;

                source.connect(compressor);

                reliableSetInitialVolume(element);

            } catch (error) {
                // CORS restricted media cannot be controlled.
                // console.warn("VolumeValet: Could not control volume (likely CORS restricted).", error);
            }
        }

        // 【修正】リソース解放処理
        function cleanUpMediaElement(element) {
            if (!mediaMap.has(element)) return;

            const { source, gainNode, compressor } = mediaMap.get(element);

            try {
                if (source) source.disconnect();
                if (gainNode) gainNode.disconnect();
                if (compressor) compressor.disconnect();
            } catch (e) {
                // Ignore errors during cleanup
            }

            mediaMap.delete(element);
        }

        // 4. MutationObserver: Detect new media elements added to the page
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1) { // ELEMENT_NODE
                        if (node.matches('video, audio')) {
                            handleNewMediaElement(node);
                        }
                        node.querySelectorAll('video, audio').forEach(handleNewMediaElement);
                    }
                }
                // 【修正】削除されたノードのクリーンアップ
                for (const node of mutation.removedNodes) {
                    if (node.nodeType === 1) {
                        if (node.matches('video, audio')) {
                            cleanUpMediaElement(node);
                        }
                        node.querySelectorAll('video, audio').forEach(cleanUpMediaElement);
                    }
                }
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });

        // Initial scan
        document.querySelectorAll('video, audio').forEach(handleNewMediaElement);

        // 5. Message Listener
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === 'URL_CHANGED' || message.type === 'SYNC_VOLUME') {
                document.querySelectorAll('video, audio').forEach(element => {
                    if (mediaMap.has(element)) {
                        applySettings(element);
                    }
                });
            } else if (message.type === 'setVolume') {
                const newVolume = message.value / 100;
                const promises = [];
                document.querySelectorAll('video, audio').forEach(element => {
                    if (mediaMap.has(element)) {
                        promises.push(setVolume(element, newVolume));
                    }
                });
                Promise.all(promises).then(() => {
                    sendResponse({ success: true });
                });
                return true;
            }
            return true;
        });

        // 6. Utility: URL Normalization
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
            } catch (e) {
                return urlString;
            }
        }
    } // End of initialize()

    // Start the version handshake
    chrome.runtime.sendMessage({ type: 'GET_VERSION' }, (response) => {
        if (response && response.version === CONTENT_SCRIPT_VERSION) {
            initialize();
        } else {
            console.log('VolumeValet: Mismatched content script version. Disabling self.');
        }
    });
}