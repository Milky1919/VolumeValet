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
// ▼▼▼ ここから追加 ▼▼▼
const maxVolumeSelector = document.getElementById('max-volume-selector');
// ▲▲▲ ここまで追加 ▲▲▲


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
  // ▼▼▼ ここから変更 ▼▼▼
  const maxVolume = settings.maxVolume || 150;
  
  // 最大音量セレクターのUIを更新
  const maxVolumeRadio = document.querySelector(`input[name="max_volume"][value="${maxVolume}"]`);
  if (maxVolumeRadio) {
      maxVolumeRadio.checked = true;
  }
  
  // スライダーの最大値を更新
  volumeSlider.max = maxVolume;
  defaultVolumeSlider.max = maxVolume;
  
  // グローバル設定のUIを更新
  defaultEnabledToggle.checked = settings.isDefaultEnabled || false;
  
  let defaultVolume = settings.defaultVolume || 75;
  if(defaultVolume > maxVolume) defaultVolume = maxVolume; // 最大値を超えないように調整
  defaultVolumeSlider.value = defaultVolume;
  defaultVolumeLabel.textContent = `${defaultVolume}%`;
  // ▲▲▲ ここまで変更 ▲▲▲
  
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
      currentVolume = settings.isDefaultEnabled ? defaultVolume : 100;
  }

  // ▼▼▼ ここから変更 ▼▼▼
  if(currentVolume > maxVolume) currentVolume = maxVolume; // 最大値を超えないように調整
  
  volumeSlider.value = currentVolume;
  volumeLabel.textContent = `${currentVolume}%`;
  lastVolume = currentVolume > 0 ? currentVolume : 100;
  updateVolumeIcon(currentVolume);
  // ▲▲▲ ここまで変更 ▲▲▲
}

/**
 * ストレージから全設定を読み込む
 * @returns {Promise<object>} 全設定オブジェクト
 */
function loadAllSettings() {
  return new Promise((resolve) => {
    // ▼▼▼ ここから変更 ▼▼▼
    chrome.storage.local.get(['siteVolumes', 'disabledSites', 'isDefaultEnabled', 'defaultVolume', 'maxVolume'], resolve);
    // ▲▲▲ ここまで変更 ▲▲▲
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
        chrome.tabs.sendMessage(tab.id, { type, value }, (response) => {
            // メッセージの受信側が存在しない場合のエラーをハンドルする
            // 開発中のリロード時や、content scriptを注入できないページで発生するが、動作上の問題はない
            if (chrome.runtime.lastError) {
                console.log("Message sending failed, likely content script not ready:", chrome.runtime.lastError.message);
            }
        });
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
        const maxVolume = newSettings.maxVolume || 150;
        let volumeToApply = newSettings.isDefaultEnabled ? (newSettings.defaultVolume || 75) : 100;
        if (volumeToApply > maxVolume) volumeToApply = maxVolume;
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

// ▼▼▼ ここから追加 ▼▼▼
// 最大音量セレクター
maxVolumeSelector.addEventListener('change', async (event) => {
    const newMaxVolume = parseInt(event.target.value, 10);
    chrome.storage.local.set({ maxVolume: newMaxVolume }, async () => {
        // UIを再読み込みして、スライダーの最大値や現在の音量値を調整
        const settings = await loadAllSettings();
        updateUI(settings);
        
        // 現在の音量を新しい最大値に合わせてcontent scriptに通知
        const currentVolume = parseInt(volumeSlider.value, 10);
        sendMessageToContentScript('setVolume', currentVolume);

        // もしサイト別音量が設定されていた場合、それも新しい最大値に合わせて更新・保存
        if (currentDomain) {
            const siteVolumes = settings.siteVolumes || {};
            if (siteVolumes[currentDomain] && siteVolumes[currentDomain] > newMaxVolume) {
                siteVolumes[currentDomain] = newMaxVolume;
                chrome.storage.local.set({ siteVolumes });
            }
        }
    });
});
// ▲▲▲ ここまで追加 ▲▲▲

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


