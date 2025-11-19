const CONTENT_SCRIPT_VERSION = "1.5.1";

// Prevent multiple initializations
if (typeof window.volumeValet === 'undefined') {
    window.volumeValet = true;

    function initialize() {
        const mediaMap = new WeakMap();

        // AudioContext Singleton
        let sharedAudioContext = null;

        function getSharedAudioContext() {
            if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
                sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            return sharedAudioContext;
        }

        // ▼▼▼ 接続・復帰ロジック ▼▼▼
        // ユーザー操作があった時だけ、エンジンの起動と接続を試みる
        async function tryResumeAndConnect() {
            const ctx = getSharedAudioContext();

            // 1. エンジンが止まっていたら起動を試みる
            if (ctx.state === 'suspended') {
                try {
                    await ctx.resume();
                } catch (e) {
                    // 起動に失敗（ブラウザにブロックされた）場合は、
                    // 無理に接続せず終了する（これで動画スタックを防ぐ）
                    return false;
                }
            }

            // 2. エンジンが動いているなら、未接続の要素をすべて接続する
            if (ctx.state === 'running') {
                connectAllPendingElements();
                return true;
            }
            return false;
        }

        // 確実なユーザー操作のみ監視（スクロールは除外）
        // 一度実行されたら十分なので { once: true } を指定
        ['click', 'keydown', 'touchstart', 'mousedown'].forEach(event => {
            document.addEventListener(event, tryResumeAndConnect, { once: true, capture: true, passive: true });
        });

        function connectAllPendingElements() {
            document.querySelectorAll('video, audio').forEach(element => {
                if (mediaMap.has(element)) {
                    const nodes = mediaMap.get(element);
                    // まだソースが繋がっていない場合のみ接続
                    if (!nodes.source) {
                        createAndConnectSource(element);
                    }
                }
            });
        }
        // ▲▲▲▲▲▲

        // 1. Core Logic
        async function applySettings(element) {
            if (!element) return;
            const { siteVolumes = {} } = await chrome.storage.local.get('siteVolumes');
            const pageUrl = normalizeUrl(window.location.href);
            const domain = window.location.hostname;
            let targetVolume = 1.0;
            if (siteVolumes[pageUrl] !== undefined) targetVolume = siteVolumes[pageUrl] / 100;
            else if (siteVolumes[domain] !== undefined) targetVolume = siteVolumes[domain] / 100;
            
            setVolume(element, targetVolume);
        }

        // Reliable set
        async function reliableSetInitialVolume(element) {
            if (!element || !mediaMap.has(element)) return;
            await applySettings(element);
            // 念のため数回リトライ
            for (let i = 0; i < 3; i++) {
                await new Promise(r => setTimeout(r, 100));
                await applySettings(element);
            }
        }

        // ▼▼▼ 音量適用ロジック（ここが修正の要） ▼▼▼
        async function setVolume(element, volume, options = {}) {
            if (!mediaMap.has(element)) return;

            const nodes = mediaMap.get(element);
            const { audioContext, gainNode, compressor } = nodes;
            if (!audioContext || !gainNode || !compressor) return;

            // 方針3：音量適用ロジックの分離
            // 1. 数値の書き込み（絶対実行）
            // 接続状態に関わらず、GainNodeの数値プロパティは必ず上書きする
            try {
                const now = audioContext.currentTime;
                const isBoosted = volume > 1.0;
                const rampTime = options.isInitial ? 0.05 : 0.015;

                const threshold = isBoosted ? -10 : 0;
                const ratio = isBoosted ? 20 : 1;

                // AudioContextが停止中でも、パラメータの予約はエラーにならない
                if (audioContext.state === 'suspended') {
                    gainNode.gain.cancelScheduledValues(0);
                    gainNode.gain.setValueAtTime(volume, 0);
                    compressor.threshold.cancelScheduledValues(0);
                    compressor.threshold.setValueAtTime(threshold, 0);
                    compressor.ratio.cancelScheduledValues(0);
                    compressor.ratio.setValueAtTime(ratio, 0);
                } else {
                    gainNode.gain.setTargetAtTime(volume, now, rampTime);
                    compressor.threshold.setTargetAtTime(threshold, now, rampTime);
                    compressor.ratio.setTargetAtTime(ratio, now, rampTime);
                }
                compressor.knee.cancelScheduledValues(0);
                compressor.knee.setValueAtTime(0, 0);

            } catch (error) {
                // Context issue
            }

            // 2. 接続の試行（条件付き実行）
            // 数値を書き込んだ後で、未接続であれば接続を試みる
            if (!nodes.source) {
                await tryResumeAndConnect();
            }
        }

        function handleNewMediaElement(element) {
            if (mediaMap.has(element)) return;

            const ctx = getSharedAudioContext();
            const gain = ctx.createGain();
            const comp = ctx.createDynamicsCompressor();

            // 下流グラフのみ構築
            comp.connect(gain);
            gain.connect(ctx.destination);

            // 初期値
            gain.gain.value = 1.0; 

            mediaMap.set(element, {
                audioContext: ctx,
                source: null, // 未接続
                gainNode: gain,
                compressor: comp
            });

            element._volumeValetCleanup = () => {
                cleanUpMediaElement(element);
            };

            // 【重要】自動接続（playingイベントでの接続）は削除済み。
            // これによりリロード直後のスタックを完全回避。
        }

        function createAndConnectSource(element) {
            if (!mediaMap.has(element)) return;
            const nodes = mediaMap.get(element);
            if (nodes.source) return;

            try {
                const source = nodes.audioContext.createMediaElementSource(element);
                nodes.source = source;
                source.connect(nodes.compressor);
                
                // 接続できたので音量を適用
                reliableSetInitialVolume(element);
            } catch (e) {
                // CORSエラー等
            }
        }

        function cleanUpMediaElement(element) {
            if (!mediaMap.has(element)) return;
            const nodes = mediaMap.get(element);
            try {
                if (nodes.source) nodes.source.disconnect();
                nodes.gainNode.disconnect();
                nodes.compressor.disconnect();
            } catch(e) {}
            mediaMap.delete(element);
        }

        // Observer
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                m.addedNodes.forEach(n => {
                    if (n.nodeType === 1) {
                        if (n.matches('video, audio')) handleNewMediaElement(n);
                        n.querySelectorAll('video, audio').forEach(handleNewMediaElement);
                    }
                });
                m.removedNodes.forEach(n => {
                    if (n.nodeType === 1) {
                        if (n.matches('video, audio')) {
                            if (n._volumeValetCleanup) n._volumeValetCleanup();
                        }
                        n.querySelectorAll('video, audio').forEach(child => {
                             if (child._volumeValetCleanup) child._volumeValetCleanup();
                        });
                    }
                });
            }
        });

        observer.observe(document.documentElement, { childList: true, subtree: true });
        document.querySelectorAll('video, audio').forEach(handleNewMediaElement);

        // Message Listener
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            if (msg.type === 'URL_CHANGED' || msg.type === 'SYNC_VOLUME') {
                document.querySelectorAll('video, audio').forEach(applySettings);
            } else if (msg.type === 'setVolume') {
                const vol = msg.value / 100;
                const promises = [];
                document.querySelectorAll('video, audio').forEach(el => {
                    promises.push(setVolume(el, vol));
                });
                Promise.all(promises).then(() => sendResponse({ success: true }));
                return true; 
            }
        });

        function normalizeUrl(urlString) {
            try {
                const url = new URL(urlString);
                const params = ['t', 'si', 'feature', 'list', 'index', 'ab_channel'];
                params.forEach(k => url.searchParams.delete(k));
                return url.origin + url.pathname + url.search;
            } catch (e) { return urlString; }
        }
    } 

    chrome.runtime.sendMessage({ type: 'GET_VERSION' }, (res) => {
        if (res && res.version === CONTENT_SCRIPT_VERSION) initialize();
    });
}