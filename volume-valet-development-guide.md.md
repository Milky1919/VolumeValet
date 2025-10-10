# Chrome拡張機能『VolumeValet』- 開発手順書

このドキュメントは、仕様打ち合わせで確定した全機能を実装するための、詳細な開発ガイドです。各ファイルの役割とコードの意図を理解しながら、ステップバイステップで開発を進めていきましょう。

## フェーズ1：プロジェクトの設計と Manifest の設定

まず、拡張機能の全体像を定義する `manifest.json` を完成させます。入門ガイドで作成したものに、本格開発で必要となる権限やスクリプトの情報を追記します。

### `manifest.json`

このファイルは拡張機能の戸籍のようなものです。名前、バージョン、使用するAPIの権限、そして各スクリプトの役割をChromeに伝えます。

**以下のコードで `manifest.json` を上書きしてください。**

```
{
  "manifest_version": 3,
  "name": "VolumeValet",
  "version": "1.0.0",
  "description": "Webサイトごとに音量を記憶し、フルスクリーンを妨げないスマートな音量調整アシスタントです。",
  "permissions": [
    "storage",
    "scripting",
    "tabs",
    "activeTab"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_title": "VolumeValet",
    "default_icon": {
      "16": "images/icon16.png",
      "48": "images/icon48.png",
      "128": "images/icon128.png"
    }
  },
  "icons": {
    "16": "images/icon16.png",
    "48": "images/icon48.png",
    "128": "images/icon128.png"
  }
}

```

#### **📝 追加・変更点の解説**

*   `"name"`: プロジェクト名『VolumeValet』に変更しました。
*   `"permissions"`:
    
    *   `"scripting"`: Webページに `content.js` を挿入（注入）するために必要です。
    *   `"tabs"`: 現在のタブ情報を取得するために必要です。
    *   `"activeTab"`: 現在アクティブなタブに限定して操作を許可する、セキュリティ上推奨される権限です。
*   `"host_permissions": ["<all_urls>"]`: `scripting`権限で、全てのWebサイト (`http://*/*`, `https://*/*`) にスクリプトを注入することを許可します。
*   `"background"`: 裏側で動き続ける `background.js` を「サービスワーカー」として登録します。

## フェーズ2：UIの実装 (`popup.html` / `popup.css`)

ユーザーが直接触れる操作パネルを作成します。モダンで直感的なUIを目指します。

### `popup.html`

ポップアップウィンドウの骨格（HTML）です。スライダーやスイッチなどの各パーツを配置します。

**以下のコードで `popup.html` を上書きしてください。**

```
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>VolumeValet</title>
    <link rel="stylesheet" href="popup.css">
</head>
<body>
    <div class="container">
        <header class="header">
            <h1 class="title">VolumeValet</h1>
            <p id="domain-display" class="domain">loading...</p>
        </header>

        <main class="controls">
            <!-- サイト別設定 -->
            <div class="control-group site-settings">
                <div class="slider-container">
                    <span id="volume-icon">🔊</span>
                    <input type="range" id="volume-slider" min="0" max="150" value="100" class="slider">
                    <span id="volume-label" class="volume-value">100%</span>
                </div>
                <div class="button-group">
                    <button id="mute-button" title="ミュート">🔇</button>
                    <button id="reset-button" title="このサイトの設定をリセット">🔄</button>
                </div>
            </div>

            <hr class="divider">

            <!-- 全体設定 -->
            <div class="control-group global-settings">
                <div class="setting-row">
                    <label for="site-enabled-toggle" class="toggle-label">このサイトで有効化</label>
                    <label class="switch">
                        <input type="checkbox" id="site-enabled-toggle" checked>
                        <span class="switch-slider"></span>
                    </label>
                </div>
                <div class="setting-row">
                    <label for="default-enabled-toggle" class="toggle-label">デフォルト音量を設定</label>
                    <label class="switch">
                        <input type="checkbox" id="default-enabled-toggle">
                        <span class="switch-slider"></span>
                    </label>
                </div>
                <div id="default-volume-control" class="setting-row disabled">
                    <label for="default-volume-slider" class="toggle-label sub-label">デフォルト音量</label>
                    <input type="range" id="default-volume-slider" min="0" max="150" value="75" class="slider small">
                    <span id="default-volume-label" class="volume-value">75%</span>
                </div>
            </div>
        </main>

        <footer class="footer">
            <p>Ver 1.0.0</p>
        </footer>
    </div>
    <script src="popup.js"></script>
</body>
</html>

```

### `popup.css` (新規作成)

ポップアップの見た目を整えるためのスタイルシートです。ユーザー体験を大きく左右する重要なファイルです。

**`popup.css` を新規作成し、以下のコードを貼り付けてください。**

```
:root {
  --bg-color: #f0f2f5;
  --container-bg: #ffffff;
  --primary-text: #2c3e50;
  --secondary-text: #828282;
  --accent-color: #3498db;
  --accent-hover: #2980b9;
  --disabled-color: #bdc3c7;
  --border-color: #e0e0e0;
  --shadow-color: rgba(0, 0, 0, 0.1);
}

body {
  font-family: 'Segoe UI', 'Meiryo', sans-serif;
  margin: 0;
  background-color: var(--bg-color);
  width: 320px;
  color: var(--primary-text);
}

.container {
  padding: 16px;
  background-color: var(--container-bg);
}

.header {
  text-align: center;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 12px;
}

.title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--primary-text);
}

.domain {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--secondary-text);
  word-break: break-all;
  min-height: 1.2em;
}

.controls {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.slider-container {
  display: flex;
  align-items: center;
  gap: 10px;
}

#volume-icon {
  font-size: 20px;
}

.slider {
  -webkit-appearance: none;
  width: 100%;
  height: 8px;
  border-radius: 5px;
  background: var(--border-color);
  outline: none;
  opacity: 0.9;
  transition: opacity .2s;
  cursor: pointer;
}
.slider:hover {
  opacity: 1;
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent-color);
  cursor: pointer;
  transition: background .2s;
}
.slider::-webkit-slider-thumb:hover {
  background: var(--accent-hover);
}
.slider.small {
  height: 6px;
}
.slider.small::-webkit-slider-thumb {
  width: 16px;
  height: 16px;
}


.volume-value {
  font-size: 14px;
  font-weight: 600;
  min-width: 45px;
  text-align: right;
  color: var(--accent-color);
}


.button-group {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.button-group button {
  background: none;
  border: 1px solid var(--border-color);
  border-radius: 5px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 16px;
  transition: background-color .2s, border-color .2s;
}
.button-group button:hover {
  background-color: var(--bg-color);
  border-color: #ccc;
}


.divider {
  border: none;
  border-top: 1px solid var(--border-color);
  margin: 4px 0;
}

.global-settings .setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.toggle-label {
  font-size: 14px;
}
.sub-label {
  color: var(--secondary-text);
  padding-left: 10px;
}
.disabled {
  opacity: 0.5;
  pointer-events: none;
}


.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}
.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.switch-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  transition: .4s;
  border-radius: 34px;
}
.switch-slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: .4s;
  border-radius: 50%;
}
input:checked + .switch-slider {
  background-color: var(--accent-color);
}
input:focus + .switch-slider {
  box-shadow: 0 0 1px var(--accent-color);
}
input:checked + .switch-slider:before {
  transform: translateX(20px);
}

.footer {
  text-align: center;
  font-size: 11px;
  color: var(--secondary-text);
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
}

```

## フェーズ3：ポップアップの頭脳 (`popup.js`)

ポップアップの全てのインタラクションを処理します。ドメインの取得、ストレージとのデータ送受信、UIの更新、`content.js` への指示など、司令塔の役割を果たします。

**以下のコードで `popup.js` を上書きしてください。**

```
// popup.js

// --- DOM要素の取得 ---
const domainDisplay = document.getElementById('domain-display');
const volumeSlider = document.getElementById('volume-slider');
const volumeLabel = document.getElementById('volume-label');
const muteButton = document.getElementById('mute-button');
const resetButton = document.getElementById('reset-button');
const siteEnabledToggle = document.getElementById('site-enabled-toggle');
const defaultEnabledToggle = document.getElementById('default-enabled-toggle');
const defaultVolumeControl = document.getElementById('default-volume-control');
const defaultVolumeSlider = document.getElementById('default-volume-slider');
const defaultVolumeLabel = document.getElementById('default-volume-label');
const volumeIcon = document.getElementById('volume-icon');

let currentDomain = '';
let lastVolume = 100; // ミュート解除時のための音量保持用

// --- 関数定義 ---

/**
 * 現在アクティブなタブのドメインを取得する
 * @returns {Promise<string|null>} ドメイン名 or null
 */
async function getCurrentDomain() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && tab.url.startsWith("http")) {
    return new URL(tab.url).hostname;
  }
  return null;
}

/**
 * UIの状態を更新する
 * @param {object} settings - 設定オブジェクト
 */
function updateUI(settings) {
  // グローバル設定のUIを更新
  defaultEnabledToggle.checked = settings.isDefaultEnabled || false;
  defaultVolumeSlider.value = settings.defaultVolume || 75;
  defaultVolumeLabel.textContent = `${settings.defaultVolume || 75}%`;
  
  if (defaultEnabledToggle.checked) {
    defaultVolumeControl.classList.remove('disabled');
  } else {
    defaultVolumeControl.classList.add('disabled');
  }

  // サイト別設定のUIを更新
  if (!currentDomain) {
      document.querySelector('.site-settings').classList.add('disabled');
      siteEnabledToggle.parentElement.parentElement.classList.add('disabled');
      domainDisplay.textContent = "設定対象外のページ";
      return;
  }
  
  domainDisplay.textContent = currentDomain;

  const isSiteDisabled = settings.disabledSites?.includes(currentDomain) || false;
  siteEnabledToggle.checked = !isSiteDisabled;

  if(isSiteDisabled) {
      document.querySelector('.site-settings').classList.add('disabled');
      return;
  } else {
      document.querySelector('.site-settings').classList.remove('disabled');
  }
  
  let currentVolume = settings.siteVolumes?.[currentDomain];
  if (typeof currentVolume === 'undefined') {
      currentVolume = settings.isDefaultEnabled ? settings.defaultVolume : 100;
  }
  
  volumeSlider.value = currentVolume;
  volumeLabel.textContent = `${currentVolume}%`;
  lastVolume = currentVolume > 0 ? currentVolume : 100;
  updateVolumeIcon(currentVolume);
}

/**
 * ストレージから全設定を読み込む
 * @returns {Promise<object>} 全設定オブジェクト
 */
function loadAllSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['siteVolumes', 'disabledSites', 'isDefaultEnabled', 'defaultVolume'], resolve);
  });
}

/**
 * 音量に応じてアイコンを変更する
 * @param {number} volume - 音量
 */
function updateVolumeIcon(volume) {
    if (volume > 100) {
        volumeIcon.textContent = '🔥';
    } else if (volume > 50) {
        volumeIcon.textContent = '🔊';
    } else if (volume > 0) {
        volumeIcon.textContent = '🔉';
    } else {
        volumeIcon.textContent = '🔇';
    }
}

/**
 * 指定したタブにメッセージを送信する
 * @param {string} type - メッセージの種類
 * @param {*} value - 送信する値
 */
async function sendMessageToContentScript(type, value) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { type, value });
    }
}


// --- イベントリスナー ---

// ポップアップ読み込み完了時
document.addEventListener('DOMContentLoaded', async () => {
  currentDomain = await getCurrentDomain();
  const settings = await loadAllSettings();
  updateUI(settings);
});

// 音量スライダー操作時（リアルタイム）
volumeSlider.addEventListener('input', () => {
  const volume = parseInt(volumeSlider.value, 10);
  volumeLabel.textContent = `${volume}%`;
  updateVolumeIcon(volume);
  sendMessageToContentScript('setVolume', volume);
});

// 音量スライダー操作完了時（保存処理）
volumeSlider.addEventListener('change', async () => {
    if (!currentDomain) return;
    const volume = parseInt(volumeSlider.value, 10);
    const settings = await loadAllSettings();
    const siteVolumes = settings.siteVolumes || {};
    siteVolumes[currentDomain] = volume;
    chrome.storage.local.set({ siteVolumes });
    lastVolume = volume > 0 ? volume : lastVolume;
});

// ミュートボタン
muteButton.addEventListener('click', () => {
    const currentVolume = parseInt(volumeSlider.value, 10);
    const newVolume = currentVolume > 0 ? 0 : lastVolume;
    volumeSlider.value = newVolume;
    // inputとchangeイベントを発火させて、UI更新と保存処理を動かす
    volumeSlider.dispatchEvent(new Event('input'));
    volumeSlider.dispatchEvent(new Event('change'));
});

// リセットボタン
resetButton.addEventListener('click', async () => {
    if (!currentDomain) return;
    const settings = await loadAllSettings();
    const siteVolumes = settings.siteVolumes || {};
    delete siteVolumes[currentDomain];
    chrome.storage.local.set({ siteVolumes }, async () => {
        // UIをリロードしてデフォルト値などを再適用
        const newSettings = await loadAllSettings();
        updateUI(newSettings);
        // content scriptにも更新を通知
        const volumeToApply = newSettings.isDefaultEnabled ? newSettings.defaultVolume : 100;
        sendMessageToContentScript('setVolume', volumeToApply);
    });
});

// このサイトで有効化トグル
siteEnabledToggle.addEventListener('click', async () => {
    if (!currentDomain) return;
    const isEnabled = siteEnabledToggle.checked;
    const settings = await loadAllSettings();
    let disabledSites = settings.disabledSites || [];

    if (isEnabled) {
        disabledSites = disabledSites.filter(d => d !== currentDomain);
    } else {
        if (!disabledSites.includes(currentDomain)) {
            disabledSites.push(currentDomain);
        }
    }
    
    chrome.storage.local.set({ disabledSites }, async () => {
        const newSettings = await loadAllSettings();
        updateUI(newSettings);
        sendMessageToContentScript('updateStatus', { isDisabled: !isEnabled });
    });
});

// デフォルト音量有効化トグル
defaultEnabledToggle.addEventListener('click', () => {
    const isEnabled = defaultEnabledToggle.checked;
    defaultVolumeControl.classList.toggle('disabled', !isEnabled);
    chrome.storage.local.set({ isDefaultEnabled: isEnabled });
});

// デフォルト音量スライダー操作時
defaultVolumeSlider.addEventListener('input', () => {
    const volume = parseInt(defaultVolumeSlider.value, 10);
    defaultVolumeLabel.textContent = `${volume}%`;
});
defaultVolumeSlider.addEventListener('change', () => {
    const volume = parseInt(defaultVolumeSlider.value, 10);
    chrome.storage.local.set({ defaultVolume: volume });
});


```

## フェーズ4：バックグラウンド処理 (`background.js`, `content.js`)

Webページに介入し、実際に音量を操作する部隊と、それを管理する司令塔です。

### `background.js` (新規作成)

拡張機能の裏方担当です。主な仕事は、Webページが読み込まれたことを検知して、`content.js` をそのページに送り込むことです。

**`background.js` を新規作成し、以下のコードを貼り付けてください。**

```
// background.js

// 拡張機能のインストール時やアップデート時に実行
chrome.runtime.onInstalled.addListener(() => {
  console.log('VolumeValetがインストールされました。');
  // 初期設定を保存（任意）
  chrome.storage.local.get(['siteVolumes', 'disabledSites', 'isDefaultEnabled', 'defaultVolume'], (settings) => {
    if (typeof settings.isDefaultEnabled === 'undefined') {
      chrome.storage.local.set({ isDefaultEnabled: false });
    }
    if (typeof settings.defaultVolume === 'undefined') {
      chrome.storage.local.set({ defaultVolume: 75 });
    }
    if (typeof settings.siteVolumes === 'undefined') {
      chrome.storage.local.set({ siteVolumes: {} });
    }
    if (typeof settings.disabledSites === 'undefined') {
      chrome.storage.local.set({ disabledSites: [] });
    }
  });
});

// タブが更新されたときに実行
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // ページの読み込みが完了し、URLが存在する場合
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    // content scriptを注入
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    }).catch(err => console.log('Script injection failed:', err));
  }
});

```

### `content.js` (新規作成)

この拡張機能の**心臓部**です。Webページに直接埋め込まれ、Web Audio APIを駆使して音量を制御します。

**`content.js` を新規作成し、以下のコードを貼り付けてください。**

```
// content.js

// グローバル変数
let audioContext;
let gainNodes = new Map(); // 各メディア要素とGainNodeを紐付ける
let observer;
let currentVolume = 1; // 1 = 100%
let isDisabled = false;

// --- 初期化処理 ---
async function initialize() {
    const domain = window.location.hostname;
    const settings = await chrome.storage.local.get(['siteVolumes', 'disabledSites', 'isDefaultEnabled', 'defaultVolume']);

    isDisabled = settings.disabledSites?.includes(domain) || false;
    if (isDisabled) {
        console.log('VolumeValet: このサイトでは無効です。');
        return;
    }

    let volumeToApply = settings.siteVolumes?.[domain];
    if (typeof volumeToApply === 'undefined') {
        volumeToApply = settings.isDefaultEnabled ? settings.defaultVolume : 100;
    }
    
    currentVolume = volumeToApply / 100;

    setupAudioProcessing();
    setupMutationObserver();
}

// --- Web Audio API関連 ---
function setupAudioProcessing() {
    if (!audioContext) {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.error('Web Audio API is not supported in this browser', e);
            return;
        }
    }
    
    document.querySelectorAll('video, audio').forEach(processMediaElement);
}

function processMediaElement(element) {
    if (!audioContext || gainNodes.has(element)) return;

    try {
        const source = audioContext.createMediaElementSource(element);
        const gainNode = audioContext.createGain();
        gainNode.gain.value = currentVolume;
        
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        gainNodes.set(element, gainNode);
    } catch (e) {
        // "InvalidStateNode"エラーは要素が未ロードの場合に発生しうるので無視
        if (e.name !== 'InvalidStateError') {
            console.warn('Could not process media element:', element, e);
        }
    }
}

// --- 動的コンテンツ対応 ---
function setupMutationObserver() {
    observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) { // ELEMENT_NODE
                    if (node.matches('video, audio')) {
                        processMediaElement(node);
                    }
                    node.querySelectorAll('video, audio').forEach(processMediaElement);
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

// --- 音量設定 ---
function setAllVolumes(volumePercentage) {
    if (isDisabled) return;
    currentVolume = volumePercentage / 100;
    gainNodes.forEach((gainNode) => {
        if (gainNode && gainNode.gain) {
           gainNode.gain.value = currentVolume;
        }
    });
}

// --- ポップアップからのメッセージ受信 ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'setVolume') {
        setAllVolumes(message.value);
    } else if (message.type === 'updateStatus') {
        isDisabled = message.value.isDisabled;
        if (isDisabled) {
            setAllVolumes(100); // 無効化されたら音量を100%に戻す
        } else {
            // 有効化されたら、再度設定を読み込んで適用
            initialize();
        }
    }
    // 非同期処理がない場合はtrueを返さない
});

// --- 実行 ---
// content.jsは複数回注入される可能性があるため、初回のみ実行するよう制御
if (typeof window.volumeValetInitialized === 'undefined') {
    window.volumeValetInitialized = true;
    initialize();
}


```

## フェーズ5：最終確認とテスト

お疲れ様でした！全てのファイルが揃いました。

最後に、Chromeに拡張機能を読み込み（または更新し）、以下の項目が仕様通りに動作するかをテストしてください。

1.  **基本の音量調整:**
    
    *   YouTubeなどの動画サイトを開き、ポップアップのスライダーで音量が変わるか確認。
    *   音量を50%に設定した後、ページをリロードしても50%が維持されるか確認。
    *   フルスクリーン表示にして、問題なく動作するか確認。
2.  **データ保存:**
    
    *   別のサイト（例: Twitter）で音量を30%に設定。
    *   元のYouTubeに戻ったとき、音量が50%に戻るか確認。 .
    *   ブラウザを再起動しても、各サイトの設定が保持されているか確認。
3.  **各機能のテスト:**
    
    *   ミュートボタン、リセットボタンが正しく機能するか。
    *   「このサイトで有効化」をOFFにすると、スライダーが無効になり、ページの音量が100%に戻るか。
    *   「デフォルト音量」を設定し、初めて訪れるサイトでその音量が適用されるか。
4.  **動的コンテンツ:**
    
    *   YouTubeのトップページなどで下にスクロールし、新しく読み込まれた動画にも音量設定が適用されているか確認。

これで、『VolumeValet』の開発は完了です。 この手順書が、あなたの開発の助けとなれば幸いです。ご不明な点があれば、いつでも質問してください。