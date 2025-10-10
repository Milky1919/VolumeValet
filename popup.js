// popup.js v1.2.12 (最終UX調整版)

class PopupApp {
    constructor() {
        this.nodes = {
            body: document.body,
            modeDisplayHeader: document.getElementById('mode-display-header'),
            pinButton: document.getElementById('pin-button'),
            volumeIcon: document.getElementById('volume-icon'),
            volumeSlider: document.getElementById('volume-slider'),
            volumeLabel: document.getElementById('volume-label'),
            muteButton: document.getElementById('mute-button'),
            resetButton: document.getElementById('reset-button'),
            maxVolumeInput: document.getElementById('max-volume-input'),
        };

        this.state = {
            domain: null,
            pageUrl: null,
            lastVolume: 100,
            settings: {},
            activeSetting: 'domain' // 'domain' or 'page'
        };
        
        this.initialize();
    }

    async initialize() {
        await this.loadCurrentTabInfo();
        await this.loadAllSettings();
        this.determineActiveSetting();
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
        const defaults = { siteVolumes: {}, maxVolume: 200 };
        this.state.settings = await chrome.storage.local.get(defaults);
    }

    determineActiveSetting() {
        if (this.state.pageUrl && this.state.settings.siteVolumes?.[this.state.pageUrl] !== undefined) {
            this.state.activeSetting = 'page';
        } else {
            this.state.activeSetting = 'domain';
        }
    }

    updateUI() {
        const { settings, domain, pageUrl, activeSetting } = this.state;

        if (!domain) {
            this.nodes.body.innerHTML = '<div class="container"><header class="header"><h1 class="title">設定対象外のページ</h1></header></div>';
            return;
        }
        
        const maxVolume = settings.maxVolume || 200;
        this.nodes.maxVolumeInput.value = maxVolume;
        this.nodes.volumeSlider.max = maxVolume;

        const siteVolumes = settings.siteVolumes || {};
        
        let currentVolume;
        if (activeSetting === 'page') {
            this.nodes.body.classList.add('is-page-specific');
            this.nodes.pinButton.classList.add('active');
            this.nodes.modeDisplayHeader.textContent = "このページのみ";
            currentVolume = siteVolumes[pageUrl] ?? siteVolumes[domain] ?? 100;
        } else {
            this.nodes.body.classList.remove('is-page-specific');
            this.nodes.pinButton.classList.remove('active');
            this.nodes.modeDisplayHeader.textContent = domain;
            currentVolume = siteVolumes[domain] ?? 100;
        }
        
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
        // ▼▼▼ ここからが変更点 ▼▼▼
        this.nodes.volumeSlider.addEventListener('input', this.handleSliderInput.bind(this));
        this.nodes.volumeSlider.addEventListener('change', this.handleSliderChange.bind(this));
        // ▲▲▲ ここまでが変更点 ▲▲▲
        this.nodes.pinButton.addEventListener('click', this.handlePinClick.bind(this));
        this.nodes.muteButton.addEventListener('click', this.handleMute.bind(this));
        this.nodes.resetButton.addEventListener('click', this.handleReset.bind(this));
        this.nodes.maxVolumeInput.addEventListener('change', this.handleMaxVolumeChange.bind(this));
    }
    
    /**
     * スライダーを動かしている最中の処理（リアルタイム音量変更）
     */
    handleSliderInput() {
        const volume = parseInt(this.nodes.volumeSlider.value);
        this.nodes.volumeLabel.textContent = `${volume}%`;
        this.updateVolumeIcon(volume);
        this.state.lastVolume = volume > 0 ? volume : this.state.lastVolume;
        // content.jsにリアルタイムで音量変更を指示
        this.sendMessage('setVolume', volume);
    }
    
    /**
     * スライダーから指を離した時の処理（設定の保存）
     */
    handleSliderChange() {
        const volume = parseInt(this.nodes.volumeSlider.value);
        this.saveSliderValue(volume);
    }
    
    async saveSliderValue(volume) {
        const key = this.state.activeSetting === 'page' ? this.state.pageUrl : this.state.domain;
        if (!key) return;
        this.state.settings.siteVolumes[key] = volume;
        await chrome.storage.local.set({ siteVolumes: this.state.settings.siteVolumes });
    }

    async handlePinClick() {
        if (this.state.activeSetting === 'domain') {
            this.state.activeSetting = 'page';
            const currentDomainVolume = this.state.settings.siteVolumes[this.state.domain] ?? 100;
            await this.saveSliderValue(currentDomainVolume);
        } else {
            delete this.state.settings.siteVolumes[this.state.pageUrl];
            await chrome.storage.local.set({ siteVolumes: this.state.settings.siteVolumes });
            this.state.activeSetting = 'domain';
        }
        this.updateUI();
        this.sendMessage('setVolume', parseInt(this.nodes.volumeSlider.value));
    }

    handleMute() {
        const currentVolume = parseInt(this.nodes.volumeSlider.value);
        const newVolume = currentVolume > 0 ? 0 : this.state.lastVolume;
        this.nodes.volumeSlider.value = newVolume;
        this.handleSliderInput(); // リアルタイム反映
        this.saveSliderValue(newVolume); // 設定を即時保存
    }
    
    async handleReset() {
        // 現在見ている設定の音量を100%にリセットする
        await this.saveSliderValue(100);
        this.updateUI();
        this.sendMessage('setVolume', 100);
    }

    async handleMaxVolumeChange(e) {
        let newMaxVolume = parseInt(e.target.value, 10);
        if (isNaN(newMaxVolume) || newMaxVolume < 100) newMaxVolume = 100;
        else if (newMaxVolume > 1000) newMaxVolume = 1000;
        e.target.value = newMaxVolume;

        this.state.settings.maxVolume = newMaxVolume;
        await chrome.storage.local.set({ maxVolume: newMaxVolume });
        
        const { siteVolumes = {} } = this.state.settings;
        let changed = false;
        Object.keys(siteVolumes).forEach(key => {
            if (siteVolumes[key] > newMaxVolume) {
                siteVolumes[key] = newMaxVolume;
                changed = true;
            }
        });
        if (changed) {
            this.state.settings.siteVolumes = siteVolumes;
            await chrome.storage.local.set({ siteVolumes });
        }
        this.updateUI();
        this.sendMessage('setVolume', parseInt(this.nodes.volumeSlider.value));
    }
    
    sendMessage(type, value) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, { type, value, allFrames: true }, () => {
                    if (chrome.runtime.lastError) { /* content scriptがなければ無視 */ }
                });
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => new PopupApp());

