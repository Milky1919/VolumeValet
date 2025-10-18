// content.js v2.0.0 (Pre-emptive Mute Architecture)

// Prevent multiple initializations
if (typeof window.volumeValet === 'undefined') {
    window.volumeValet = true; // Simple flag to prevent re-injection

    const mediaMap = new WeakMap(); // Tracks media elements and their associated audio nodes

    // 1. Core Logic: Apply Volume Settings
    async function applySettings(element) {
        if (!element) return;

        const { siteVolumes = {} } = await chrome.storage.local.get('siteVolumes');
        const domain = window.location.hostname;
        // The normalizeUrl function in content.js must be kept in sync with background.js
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

        const { audioContext } = mediaMap.get(element);
        if (!audioContext) return;


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

        // 2. Retry Mechanism to combat race conditions on complex sites
        const maxRetries = 7;
        const initialDelay = 50; // ms

        for (let i = 0; i < maxRetries; i++) {
            try {
                // Ensure the AudioContext is running before trying to set volume
                if (audioContext.state === 'suspended') {
                    await audioContext.resume();
                }

                // If the context was closed for any reason, we cannot proceed.
                if (audioContext.state === 'closed') {
                    return;
                }

                setVolume(element, targetVolume);

                // Give the browser a moment to apply the change
                await new Promise(resolve => setTimeout(resolve, 25));

                const { gainNode } = mediaMap.get(element) || {};
                // Check if the gain value is close enough to the target
                if (gainNode && Math.abs(gainNode.gain.value - targetVolume) < 0.01) {
                    return; // Success
                }
            } catch (error) {
                // Errors are possible if the element is removed during the process
            }


            // Exponential backoff for subsequent retries
            const delay = initialDelay * Math.pow(2, i);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // 2. Audio Control: Set Volume via Web Audio API
    function setVolume(element, volume) {
        if (!mediaMap.has(element)) return; // Should not happen if called correctly

        const mediaNodes = mediaMap.get(element);
        const { audioContext, source, gainNode, compressor } = mediaNodes;

        if (!audioContext || !source || !gainNode || !compressor) return;

        const isBoosted = volume > 1.0;

        // This function can be called before the source node is created.
        // The isCompressorActive flag is set, and the source will be connected
        // to the correct node when it is created in createAndConnectSource.
        if (source) {
            // If the source exists, we can manage its connections dynamically.
            if (isBoosted && !mediaNodes.isCompressorActive) {
                // Switch to: source -> compressor -> gain -> destination
                source.disconnect(gainNode);
                source.connect(compressor).connect(gainNode);
            } else if (!isBoosted && mediaNodes.isCompressorActive) {
                // Switch back to: source -> gain -> destination
                source.disconnect(compressor);
                source.connect(gainNode);
            }
        }
        mediaNodes.isCompressorActive = isBoosted;

        // Apply the volume setting smoothly
        gainNode.gain.setTargetAtTime(volume, audioContext.currentTime, 0.015);
    }

    // 3. The "Pre-emptive Mute" Handler
    function handleNewMediaElement(element) {
        if (mediaMap.has(element)) return; // Already processing this element

        // STAGE 1: Create the downstream audio graph, but NOT the source node.
        // The source node will only be created when the 'playing' event fires.
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const gainNode = audioContext.createGain();
        const compressor = audioContext.createDynamicsCompressor();

        // Configure the compressor for "Safe Boost" (transparent limiting)
        compressor.threshold.setValueAtTime(-10, audioContext.currentTime); // Start limiting at -10dB
        compressor.knee.setValueAtTime(0, audioContext.currentTime);       // No knee, hard limiting
        compressor.ratio.setValueAtTime(20, audioContext.currentTime);     // Strong compression
        compressor.attack.setValueAtTime(0.003, audioContext.currentTime); // Fast attack
        compressor.release.setValueAtTime(0.25, audioContext.currentTime); // Smooth release

        // Connect the gain node to the destination. This is crucial for pre-emptive mute.
        gainNode.connect(audioContext.destination);

        // ** PRE-EMPTIVE MUTE **
        // Mute the element immediately, even before the source node exists.
        gainNode.gain.value = 0;

        // Store the incomplete graph. `source` is null until 'playing' event.
        mediaMap.set(element, { audioContext, source: null, gainNode, compressor, isCompressorActive: false });

        // Define a one-time handler for setting the initial volume once the media is playable.
        const onCanPlay = async () => {
            // This function sets the gainNode's value. It doesn't need the source node.
            await reliableSetInitialVolume(element);
            element.removeEventListener('canplay', onCanPlay); // Clean up
        };

        // Define a one-time handler for creating the source node when playback actually starts.
        const onPlaying = () => {
            createAndConnectSource(element); // Stage 2 of initialization
            element.removeEventListener('playing', onPlaying); // Clean up
        };

        // Wait for 'canplay' to set the volume and 'playing' to build the final audio path.
        element.addEventListener('canplay', onCanPlay, { once: true });
        element.addEventListener('playing', onPlaying, { once: true });
    }

    // STAGE 2: Create the source node and connect it to the existing downstream graph.
    // This is called by the 'playing' event handler.
    function createAndConnectSource(element) {
        if (!mediaMap.has(element)) return;

        const mediaNodes = mediaMap.get(element);
        const { audioContext, gainNode, compressor } = mediaNodes;

        // If a source already exists, do nothing. This can happen in some edge cases.
        if (mediaNodes.source) return;

        try {
            const source = audioContext.createMediaElementSource(element);
            mediaNodes.source = source; // Update the map with the new source

            // Connect to the correct next node, respecting the current "boost" state.
            if (mediaNodes.isCompressorActive) {
                source.connect(compressor);
            } else {
                source.connect(gainNode);
            }
        } catch (error) {
            // This can fail if the element is in a bad state.
        }
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
        }
    });

    // Start observing the entire document
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
    });

    // Initial scan for media elements already present on the page
    document.querySelectorAll('video, audio').forEach(handleNewMediaElement);

    // 5. Message Listener: Handle commands from the background script or popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'URL_CHANGED' || message.type === 'SYNC_VOLUME') {
            // Re-apply saved settings for all currently tracked media elements
            document.querySelectorAll('video, audio').forEach(element => {
                if (mediaMap.has(element)) {
                   applySettings(element);
                }
            });
        } else if (message.type === 'setVolume') {
            // Apply a temporary volume from the popup slider in real-time
            const newVolume = message.value / 100;
            document.querySelectorAll('video, audio').forEach(element => {
                if (mediaMap.has(element)) {
                    setVolume(element, newVolume);
                }
            });
        }
        return true; // Indicate that the response may be asynchronous
    });

    // 6. Utility: URL Normalization
    function normalizeUrl(urlString) {
        try {
            const url = new URL(urlString);
            // This list MUST be kept in sync with background.js
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
}