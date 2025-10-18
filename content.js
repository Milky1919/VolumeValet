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

        // Dynamic Audio Graph for "Safe Boost"
        const isBoosted = volume > 1.0;

        // Avoid reconnecting nodes unnecessarily
        if (isBoosted && !mediaNodes.isCompressorActive) {
            source.disconnect();
            source.connect(compressor).connect(gainNode);
            mediaNodes.isCompressorActive = true;
        } else if (!isBoosted && (mediaNodes.isCompressorActive || mediaNodes.isCompressorActive === undefined)) {
            // The "undefined" check handles the initial connection
            source.disconnect();
            source.connect(gainNode);
            mediaNodes.isCompressorActive = false;
        }

        // Apply the volume setting smoothly
        gainNode.gain.setTargetAtTime(volume, audioContext.currentTime, 0.015);
    }

    // 3. The "Pre-emptive Mute" Handler
    function handleNewMediaElement(element) {
        if (mediaMap.has(element)) return; // Already processing this element

        // Create a unique AudioContext and GainNode for each media element
        // This is crucial for sites with multiple videos (e.g., Twitter, Reddit)
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaElementSource(element);
        const gainNode = audioContext.createGain();
        const compressor = audioContext.createDynamicsCompressor();

        // Configure the compressor for "Safe Boost" (transparent limiting)
        compressor.threshold.setValueAtTime(-10, audioContext.currentTime); // Start limiting at -10dB
        compressor.knee.setValueAtTime(0, audioContext.currentTime);       // No knee, hard limiting
        compressor.ratio.setValueAtTime(20, audioContext.currentTime);     // Strong compression
        compressor.attack.setValueAtTime(0.003, audioContext.currentTime); // Fast attack
        compressor.release.setValueAtTime(0.25, audioContext.currentTime); // Smooth release

        // ** PRE-EMPTIVE MUTE **
        // Mute the element immediately upon detection, before it can play.
        gainNode.gain.value = 0;

        // Connect the gain node to the destination once
        gainNode.connect(audioContext.destination);
        // The initial source connection will be handled by the first `setVolume` call

        // Store all nodes for dynamic graph changes
        mediaMap.set(element, { audioContext, source, gainNode, compressor, isCompressorActive: undefined });

        // Define the handler for when the media is ready to play
        const onCanPlay = async () => {
            // Apply the user's saved setting. This function now handles resuming the context.
            await reliableSetInitialVolume(element);
            // Clean up the event listener after it has served its purpose
            element.removeEventListener('canplay', onCanPlay);
        };

        // Wait for the 'canplay' event to apply the final volume
        element.addEventListener('canplay', onCanPlay, { once: true });
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