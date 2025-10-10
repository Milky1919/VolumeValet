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