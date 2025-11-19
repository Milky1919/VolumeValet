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
        ['click', 'keydown', 'touchstart', 'mousedown'].forEach(event => {
            document.addEventListener(event, () => { tryResumeAndConnect(); }, { capture: true, passive: true });
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

            let nodes = mediaMap.get(element);

            // A. まだ接続されていない場合、スライダー操作をきっかけに接続を試みる
            if (!nodes.source) {
                await tryResumeAndConnect();
                // 接続できたか再確認
                nodes = mediaMap.get(element);
            }

            const { audioContext, gainNode, compressor } = nodes;
            if (!audioContext || !gainNode || !compressor) return;

            // B. 音量適用の実行
            // ここで「接続できていなくても、数値だけは書き込む」のが重要
            try {
                const now = audioContext.currentTime;
                const isBoosted = volume > 1.0;
                const rampTime = options.isInitial ? 0.05 : 0.015;

                // コンプレッサー設定
                const threshold = isBoosted ? -10 : 0;
                const ratio = isBoosted ? 20 : 1;

                // ★状態にかかわらず、まずは数値を書き込む（これでスライダー操作が保存される）
                // 停止中なら即時適用、再生中なら滑らかに
                if (audioContext.state === 'suspended') {
                    compressor.threshold.cancelScheduledValues(0);
                    compressor.threshold.setValueAtTime(threshold, 0);
                    compressor.knee.cancelScheduledValues(0);
                    compressor.knee.setValueAtTime(0, 0);
                    compressor.ratio.cancelScheduledValues(0);
                    compressor.ratio.setValueAtTime(ratio, 0);

                    gainNode.gain.cancelScheduledValues(0);
                    gainNode.gain.setValueAtTime(volume, 0);
                } else {
                    compressor.threshold.setTargetAtTime(threshold, now, rampTime);
                    compressor.knee.setTargetAtTime(0, now, rampTime);
                    compressor.ratio.setTargetAtTime(ratio, now, rampTime);
                    
                    gainNode.gain.setTargetAtTime(volume, now, rampTime);
                }

            } catch (error) {
                // Context issue
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