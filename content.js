const CONTENT_SCRIPT_VERSION = "1.5.0";

// Prevent multiple initializations
if (typeof window.volumeValet === 'undefined') {
    window.volumeValet = true; // Simple flag to prevent re-injection

    function initialize() {
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

        // 2. Retry Mechanism. The robust `setVolume` function now handles all the
        //    complexities of the AudioContext state.
        const maxRetries = 7;
        const initialDelay = 50; // ms

        for (let i = 0; i < maxRetries; i++) {
            // Call the new, robust setVolume function. It will handle ensuring
            // the context is running before applying the volume.
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

    // Centralized helper to ensure the AudioContext is running before any operation.
    async function ensureContextIsRunning(audioContext) {
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        // If the context was closed, we can't do anything.
        if (audioContext.state === 'closed') {
            throw new Error("AudioContext is closed.");
        }
    }


    async function setVolume(element, volume, options = {}) {
        if (!mediaMap.has(element)) return;

        const mediaNodes = mediaMap.get(element);
        const { audioContext, source, gainNode, compressor } = mediaNodes;

        // If the source node hasn't been created yet, queue the volume command.
        if (!source) {
            mediaNodes.pendingVolume = volume;
            return; // Exit early
        }

        if (!audioContext || !gainNode || !compressor) return;

        try {
            await ensureContextIsRunning(audioContext);

            const isBoosted = volume > 1.0;
            const now = audioContext.currentTime;
            const rampTime = 0.015; // Standard ramp time for smooth transitions

            // Instead of disconnecting, we change the compressor's parameters
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
            // The context might be closed.
        }
    }

    // 3. Audio Graph Initialization
    function handleNewMediaElement(element) {
        if (mediaMap.has(element)) return; // Already processing this element

        // STAGE 1: Create the audio context and downstream nodes.
        // This allows for pre-emptive muting before the media source is ready.
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const gainNode = audioContext.createGain();
        const compressor = audioContext.createDynamicsCompressor();

        // The audio graph is now STATIC: Compressor -> Gain -> Destination.
        // The source will be connected to the compressor in Stage 2.
        compressor.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // Default the compressor to be transparent (not limiting).
        // The setVolume function will adjust this as needed.
        const now = audioContext.currentTime;
        compressor.threshold.setValueAtTime(0, now);
        compressor.knee.setValueAtTime(0, now);
        compressor.ratio.setValueAtTime(1, now);
        compressor.attack.setValueAtTime(0.003, now);
        compressor.release.setValueAtTime(0.25, now);

        // ** PRE-EMPTIVE MUTE **
        // Mute the element immediately by setting gain to 0.
        gainNode.gain.value = 0;

        // Store the graph nodes. `source` is null and `pendingVolume` is unset.
        mediaMap.set(element, {
            audioContext,
            source: null,
            gainNode,
            compressor,
            pendingVolume: null
        });

        // Define a one-time handler for setting the initial volume when the media can play.
        const onCanPlay = async () => {
            await reliableSetInitialVolume(element);
            element.removeEventListener('canplay', onCanPlay); // Clean up
        };

        // Define a one-time handler for creating the source node when playback begins.
        const onPlaying = () => {
            createAndConnectSource(element); // Stage 2: Connect the media element
            element.removeEventListener('playing', onPlaying); // Clean up
        };

        element.addEventListener('canplay', onCanPlay, { once: true });
        element.addEventListener('playing', onPlaying, { once: true });
    }

    // STAGE 2: Create the media source and connect it to the static graph.
    function createAndConnectSource(element) {
        if (!mediaMap.has(element)) return;

        const mediaNodes = mediaMap.get(element);
        const { audioContext, compressor } = mediaNodes;

        // Do nothing if the source already exists.
        if (mediaNodes.source) return;

        try {
            const source = audioContext.createMediaElementSource(element);
            mediaNodes.source = source; // Store the source node

            // Connect the source to the start of our static graph.
            // This is the only `connect` call needed for the source, and it never changes.
            source.connect(compressor);

            // ** FINALIZE QUEUED COMMANDS **
            // If a volume command was queued while the source was being created, apply it now.
            if (mediaNodes.pendingVolume !== null && typeof mediaNodes.pendingVolume === 'number') {
                setVolume(element, mediaNodes.pendingVolume);
                mediaNodes.pendingVolume = null; // Clear the queue
            }

        } catch (error) {
            // This can fail if the element is in a bad state (e.g., from a different origin).
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
                   applySettings(element); // applySettings is async and calls setVolume
                }
            });
        } else if (message.type === 'setVolume') {
            // Apply a temporary volume from the popup slider in real-time.
            // This now awaits the robust setVolume function.
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
            return true; // Keep the message channel open for the async response
        }
        return true;
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