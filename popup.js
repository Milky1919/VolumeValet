// popup.js v1.2.8 (リアルタイムスライダー修正版)

class PopupApp {
    constructor() {
        this.nodes = {
            masterEnableToggle: document.getElementById('master-enable-toggle'),
            modeDisplayHeader: document.getElementById('mode-display-header'),
            modeSelector: document.getElementById('mode-selector'),
            modeDomainRadio: document.getElementById('mode-domain'),
            volumeIcon: document.getElementById('volume-icon'),
            volumeSlider: document.getElementById('volume-slider'),
            volumeLabel: document.getElementById('volume-label'),
            maxVolumeInput: document.getElementById('max-volume-input'),
            muteButton: document.getElementById('mute-button'),
            resetButton: document.getElementById('reset-button'),
        };

        this.state = {
            domain: null,
            pageUrl: null,
            lastVolume: 100,
            settings: {},
            mode: 'domain'
        };
        
        // スライダーの頻繁な書き込みを制御するためのタイマー
        this.sliderSaveTimeout = null;

        this.initialize();
    }

    async initialize() {
        await this.loadCurrentTabInfo();
        await this.loadAllSettings();
        this.determineInitialMode();
        this.updateUI();
        this.addEventListeners();
    }
    
    async loadCurrentTabInfo() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url?.startsWith("http")) {
            const url = new URL(tab.url);
            this.state.domain = url.hostname;
            this.state.pageUrl = this.normalizeUrl(tab.url);
        }
    }

    normalizeUrl(urlString) {
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

    async loadAllSettings() {
        const defaults = { siteVolumes: {}, disabledSites: [], maxVolume: 200, lastActiveModes: {} };
        this.state.settings = await chrome.storage.local.get(defaults);
    }

    determineInitialMode() {
        const lastMode = this.state.settings.lastActiveModes?.[this.state.domain];
        if (lastMode) {
            this.state.mode = lastMode;
        } else {
            this.state.mode = (this.state.pageUrl && this.state.settings.siteVolumes?.[this.state.pageUrl] !== undefined) ? 'page' : 'domain';
        }
        document.getElementById(`mode-${this.state.mode}`).checked = true;
    }

    updateUI() {
        const { settings, domain, pageUrl, mode } = this.state;

        if (!domain) {
            document.body.classList.add('disabled-page');
            this.nodes.masterEnableToggle.disabled = true;
            this.nodes.modeDisplayHeader.textContent = "設定対象外";
            document.querySelector('.controls').style.display = 'none';
            return;
        }
        
        const isSiteDisabled = settings.disabledSites?.includes(domain) || false;
        this.nodes.masterEnableToggle.checked = !isSiteDisabled;
        document.body.classList.toggle('disabled-page', isSiteDisabled);
        
        const maxVolume = settings.maxVolume || 200;
        this.nodes.maxVolumeInput.value = maxVolume;
        this.nodes.volumeSlider.max = maxVolume;

        const siteVolumes = settings.siteVolumes || {};
        
        this.nodes.modeDisplayHeader.textContent = isSiteDisabled 
            ? `${domain} (無効)` 
            : (mode === 'page' ? "このページのみ" : domain);
        
        let currentVolume = (mode === 'page')
            ? (siteVolumes[pageUrl] ?? siteVolumes[domain] ?? 100)
            : (siteVolumes[domain] ?? 100);

        if (currentVolume > maxVolume) currentVolume = maxVolume;

        this.nodes.volumeSlider.value = currentVolume;
        this.nodes.volumeLabel.textContent = `${currentVolume}%`;
        this.state.lastVolume = currentVolume > 0 ? currentVolume : 100;
        this.updateVolumeIcon(currentVolume);
    }

    updateVolumeIcon(volume) {
        if (volume > 100) this.nodes.volumeIcon.textContent = '🔥';
        else if (volume > 50) this.nodes.volumeIcon.textContent = '🔊';
        else if (volume > 0) this.nodes.volumeIcon.textContent = '🔉';
        else this.nodes.volumeIcon.textContent = '🔇';
    }

    addEventListeners() {
        this.nodes.masterEnableToggle.addEventListener('click', this.handleMasterToggle.bind(this));
        this.nodes.modeSelector.addEventListener('change', this.handleModeChange.bind(this));
        // ▼▼▼ ここからが変更点 ▼▼▼
        this.nodes.volumeSlider.addEventListener('input', this.handleSliderInput.bind(this));
        // 'change' イベントリスナーは不要になったため削除
        // ▲▲▲ ここまでが変更点 ▲▲▲
        this.nodes.muteButton.addEventListener('click', this.handleMute.bind(this));
        this.nodes.resetButton.addEventListener('click', this.handleReset.bind(this));
        this.nodes.maxVolumeInput.addEventListener('change', this.handleMaxVolumeChange.bind(this));
    }

    async handleMasterToggle() {
        if (!this.state.domain) return;
        const isEnabled = this.nodes.masterEnableToggle.checked;
        const { disabledSites = [], lastActiveModes = {} } = this.state.settings;

        if (!isEnabled) {
            lastActiveModes[this.state.domain] = this.state.mode;
        }

        const newDisabledSites = isEnabled
            ? disabledSites.filter(d => d !== this.state.domain)
            : [...disabledSites, this.state.domain];
        
        await chrome.storage.local.set({ disabledSites: newDisabledSites, lastActiveModes });
        await this.loadAllSettings();
        this.updateUI();
    }

    async handleModeChange(e) {
        this.state.mode = e.target.value;
        
        if(this.state.domain) {
            const { lastActiveModes = {} } = this.state.settings;
            lastActiveModes[this.state.domain] = this.state.mode;
            await chrome.storage.local.set({ lastActiveModes });
            this.state.settings.lastActiveModes = lastActiveModes;
        }
        this.updateUI();
    }

    // ▼▼▼ ここからが変更点 ▼▼▼
    /**
     * スライダーが動いている最中の処理 (リアルタイム反映)
     */
    handleSliderInput() {
        const volume = parseInt(this.nodes.volumeSlider.value);
        
        // 1. UIの表示を即時更新
        this.nodes.volumeLabel.textContent = `${volume}%`;
        this.updateVolumeIcon(volume);
        this.state.lastVolume = volume > 0 ? volume : this.state.lastVolume;

        // 2. ストレージへの書き込みをスロットリング（負荷軽減）
        // 前回のタイマーが設定されていればクリア
        if (this.sliderSaveTimeout) {
            clearTimeout(this.sliderSaveTimeout);
        }
        // 50ms後に保存処理を実行するタイマーを設定
        this.sliderSaveTimeout = setTimeout(() => {
            this.saveSliderValue(volume);
        }, 50);
    }
    
    /**
     * スライダーの値をストレージに保存する
     * @param {number} volume 保存する音量
     */
    async saveSliderValue(volume) {
        const key = this.state.mode === 'page' ? this.state.pageUrl : this.state.domain;
        if (!key) return;
        
        // 最新の設定を読み込んでから更新する
        const currentSettings = await chrome.storage.local.get('siteVolumes');
        const siteVolumes = currentSettings.siteVolumes || {};
        siteVolumes[key] = volume;
        await chrome.storage.local.set({ siteVolumes });
    }
    // ▲▲▲ ここまでが変更点 ▲▲▲

    handleMute() {
        const currentVolume = parseInt(this.nodes.volumeSlider.value);
        const newVolume = currentVolume > 0 ? 0 : this.state.lastVolume;
        this.nodes.volumeSlider.value = newVolume;
        this.handleSliderInput(); // UI更新と保存処理を呼び出す
        this.saveSliderValue(newVolume); // 即時保存
    }

    async handleReset() {
        const key = this.state.mode === 'page' ? this.state.pageUrl : this.state.domain;
        if (!key) return;
        delete this.state.settings.siteVolumes[key];
        if (this.state.mode === 'page') {
            this.state.mode = 'domain';
            this.nodes.modeDomainRadio.checked = true;
        }
        await chrome.storage.local.set({ siteVolumes: this.state.settings.siteVolumes });
        await this.loadAllSettings();
        this.updateUI();
    }

    async handleMaxVolumeChange(e) {
        let newMaxVolume = parseInt(e.target.value, 10);
        if (isNaN(newMaxVolume) || newMaxVolume < 100) newMaxVolume = 100;
        else if (newMaxVolume > 1000) newMaxVolume = 1000;
        e.target.value = newMaxVolume;

        await chrome.storage.local.set({ maxVolume: newMaxVolume });
        await this.loadAllSettings();
        
        const { siteVolumes = {} } = this.state.settings;
        let changed = false;
        Object.keys(siteVolumes).forEach(key => {
            if (siteVolumes[key] > newMaxVolume) {
                siteVolumes[key] = newMaxVolume;
                changed = true;
            }
        });
        if (changed) await chrome.storage.local.set({ siteVolumes });

        this.updateUI();
    }
}

document.addEventListener('DOMContentLoaded', () => new PopupApp());

