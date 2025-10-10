// popup.js v1.2.2 (最終修正版)

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
const maxVolumeSelector = document.getElementById('max-volume-selector');
const modeDomainRadio = document.getElementById('mode-domain');
const modePageRadio = document.getElementById('mode-page');
const modeSelector = document.querySelector('.mode-selector');
const settingsButton = document.getElementById('settings-button');

// --- グローバル変数 ---
let state = {
    domain: null,
    pageUrl: null,
    lastVolume: 100,
    settings: {},
    mode: 'domain' // 'domain' or 'page'
};

// --- 関数定義 ---

/**
 * URLから不要なパラメータを除去して正規化する
 */
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

/**
 * UIの状態を更新する
 */
function updateUI() {
    const { settings, domain, pageUrl, mode } = state;

    const maxVolume = settings.maxVolume || 150;
    document.querySelector(`input[name="max_volume"][value="${maxVolume}"]`).checked = true;
    volumeSlider.max = maxVolume;
    defaultVolumeSlider.max = maxVolume;

    defaultEnabledToggle.checked = settings.isDefaultEnabled || false;
    let defaultVolume = settings.defaultVolume || 75;
    if (defaultVolume > maxVolume) defaultVolume = maxVolume;
    defaultVolumeSlider.value = defaultVolume;
    defaultVolumeLabel.textContent = `${defaultVolume}%`;
    defaultVolumeControl.classList.toggle('disabled', !defaultEnabledToggle.checked);

    if (!domain) {
        document.body.classList.add('disabled-page');
        domainDisplay.textContent = "設定対象外のページ";
        return;
    }
    
    document.body.classList.remove('disabled-page');
    const isSiteDisabled = settings.disabledSites?.includes(domain) || false;
    siteEnabledToggle.checked = !isSiteDisabled;
    document.querySelector('.site-settings').classList.toggle('disabled', isSiteDisabled);
    modeSelector.classList.toggle('disabled', isSiteDisabled);
    
    if (isSiteDisabled) {
        domainDisplay.textContent = domain;
        return;
    }

    const siteVolumes = settings.siteVolumes || {};
    const key = mode === 'page' ? pageUrl : domain;
    domainDisplay.textContent = mode === 'page' ? "このページのみ" : domain;

    let currentVolume = siteVolumes[key];
    if (typeof currentVolume === 'undefined') {
        currentVolume = settings.isDefaultEnabled ? defaultVolume : 100;
    }
    if (currentVolume > maxVolume) currentVolume = maxVolume;

    volumeSlider.value = currentVolume;
    volumeLabel.textContent = `${currentVolume}%`;
    state.lastVolume = currentVolume > 0 ? currentVolume : 100;
    updateVolumeIcon(currentVolume);
}

/**
 * ストレージから設定を読み込む
 */
async function loadAllSettings() {
    const defaults = { siteVolumes: {}, disabledSites: [], isDefaultEnabled: false, defaultVolume: 75, maxVolume: 150 };
    state.settings = await chrome.storage.local.get(defaults);
}

/**
 * 音量アイコンを更新する
 */
function updateVolumeIcon(volume) {
    if (volume > 100) volumeIcon.textContent = '🔥';
    else if (volume > 50) volumeIcon.textContent = '🔊';
    else if (volume > 0) volumeIcon.textContent = '🔉';
    else volumeIcon.textContent = '🔇';
}

/**
 * content.jsにメッセージを送信する
 */
function sendMessage(type, value) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, { type, value }, () => {
                if (chrome.runtime.lastError) { /* エラーは無視 */ }
            });
        }
    });
}

// --- イベントリスナー ---

document.addEventListener('DOMContentLoaded', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.startsWith("http")) {
        const url = new URL(tab.url);
        state.domain = url.hostname;
        state.pageUrl = normalizeUrl(tab.url);
    }

    await loadAllSettings();

    state.mode = (state.pageUrl && state.settings.siteVolumes?.[state.pageUrl] !== undefined) ? 'page' : 'domain';
    document.getElementById(`mode-${state.mode}`).checked = true;

    updateUI();
});

modeSelector.addEventListener('change', (e) => {
    state.mode = e.target.value;
    updateUI();
});

volumeSlider.addEventListener('input', () => {
    const volume = parseInt(volumeSlider.value);
    volumeLabel.textContent = `${volume}%`;
    updateVolumeIcon(volume);
    sendMessage('setVolume', volume);
});

volumeSlider.addEventListener('change', async () => {
    const volume = parseInt(volumeSlider.value);
    const key = state.mode === 'page' ? state.pageUrl : state.domain;
    if (!key) return;
    state.settings.siteVolumes[key] = volume;
    await chrome.storage.local.set({ siteVolumes: state.settings.siteVolumes });
    state.lastVolume = volume > 0 ? volume : state.lastVolume;
});

muteButton.addEventListener('click', () => {
    const currentVolume = parseInt(volumeSlider.value);
    const newVolume = currentVolume > 0 ? 0 : state.lastVolume;
    volumeSlider.value = newVolume;
    volumeSlider.dispatchEvent(new Event('input'));
    volumeSlider.dispatchEvent(new Event('change'));
});

resetButton.addEventListener('click', async () => {
    const key = state.mode === 'page' ? state.pageUrl : state.domain;
    if (!key) return;
    delete state.settings.siteVolumes[key];
    if (state.mode === 'page') {
        state.mode = 'domain';
        modeDomainRadio.checked = true;
    }
    await chrome.storage.local.set({ siteVolumes: state.settings.siteVolumes });
    await loadAllSettings();
    updateUI();
    sendMessage('setVolume', parseInt(volumeSlider.value));
});

siteEnabledToggle.addEventListener('click', async () => {
    if (!state.domain) return;
    const isEnabled = siteEnabledToggle.checked;
    const { disabledSites = [] } = state.settings;
    const newDisabledSites = isEnabled
        ? disabledSites.filter(d => d !== state.domain)
        : [...disabledSites, state.domain];
    
    await chrome.storage.local.set({ disabledSites: newDisabledSites });
    await loadAllSettings();
    updateUI();
    sendMessage('updateStatus', { isDisabled: !isEnabled });
});

maxVolumeSelector.addEventListener('change', async (e) => {
    const newMaxVolume = parseInt(e.target.value);
    await chrome.storage.local.set({ maxVolume: newMaxVolume });
    await loadAllSettings();
    updateUI();
    sendMessage('setVolume', parseInt(volumeSlider.value));

    const { siteVolumes = {} } = state.settings;
    let changed = false;
    Object.keys(siteVolumes).forEach(key => {
        if (siteVolumes[key] > newMaxVolume) {
            siteVolumes[key] = newMaxVolume;
            changed = true;
        }
    });
    if (changed) await chrome.storage.local.set({ siteVolumes });
});

defaultEnabledToggle.addEventListener('click', async () => {
    await chrome.storage.local.set({ isDefaultEnabled: defaultEnabledToggle.checked });
    await loadAllSettings();
    updateUI();
});

// ▼▼▼ UIバグ修正 ▼▼▼
defaultVolumeSlider.addEventListener('input', () => {
    const volume = parseInt(defaultVolumeSlider.value, 10);
    defaultVolumeLabel.textContent = `${volume}%`;
});
// ▲▲▲ UIバグ修正 ▲▲▲

defaultVolumeSlider.addEventListener('change', async () => {
    const volume = parseInt(defaultVolumeSlider.value);
    await chrome.storage.local.set({ defaultVolume: volume });
});

