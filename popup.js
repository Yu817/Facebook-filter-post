// FB 社團篩選器 - Popup 邏輯

document.addEventListener('DOMContentLoaded', init);

async function init() {
    // 載入資料
    const data = await chrome.storage.sync.get({
        groups: [],
        filterEnabled: false,
        autoScrollEnabled: false,
        autoSendEnabled: false,
        autoRefreshEnabled: true,
        scrollInterval: 1,
        refreshInterval: 30,
        alertKeywords: '',
        webhookUrl: ''
    });

    // 渲染社團列表
    renderGroups(data.groups);

    // 設定開關狀態
    document.getElementById('filterToggle').checked = data.filterEnabled;
    document.getElementById('autoScrollToggle').checked = data.autoScrollEnabled;
    document.getElementById('autoSendToggle').checked = data.autoSendEnabled;
    document.getElementById('autoRefreshToggle').checked = data.autoRefreshEnabled;

    // 設定數值
    document.getElementById('scrollIntervalInput').value = data.scrollInterval;
    document.getElementById('refreshIntervalInput').value = data.refreshInterval;
    document.getElementById('webhookUrlInput').value = data.webhookUrl || '';
    document.getElementById('alertKeywordsInput').value = data.alertKeywords;

    // 事件監聽
    document.getElementById('addBtn').addEventListener('click', addGroup);
    document.getElementById('groupUrl').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addGroup();
    });
    document.getElementById('openAllBtn').addEventListener('click', openAllGroups);
    document.getElementById('dashboardBtn').addEventListener('click', openDashboard);
    document.getElementById('filterToggle').addEventListener('change', toggleFilter);
    document.getElementById('autoScrollToggle').addEventListener('change', toggleAutoScroll);
    document.getElementById('autoSendToggle').addEventListener('change', toggleAutoSend);
    document.getElementById('autoRefreshToggle').addEventListener('change', toggleAutoRefresh);
    document.getElementById('scrollIntervalInput').addEventListener('change', updateScrollInterval);
    document.getElementById('refreshIntervalInput').addEventListener('change', updateRefreshInterval);
    document.getElementById('webhookUrlInput').addEventListener('change', updateWebhookUrl);
    document.getElementById('toggleWebhookVisibility').addEventListener('click', toggleWebhookVisibility);
    document.getElementById('alertKeywordsInput').addEventListener('change', updateAlertKeywords);
    document.getElementById('goFeedBtn').addEventListener('click', goToGroupsFeed);
}

// ===== 新增社團 =====
async function addGroup() {
    const input = document.getElementById('groupUrl');
    const errorMsg = document.getElementById('errorMsg');
    const url = input.value.trim();

    // 驗證
    if (!url) {
        showError('請輸入社團網址');
        return;
    }

    if (!isValidFacebookGroupUrl(url)) {
        showError('請輸入有效的 Facebook 社團網址');
        return;
    }

    // 標準化網址
    const normalizedUrl = normalizeFacebookUrl(url);

    // 取得現有社團
    const data = await chrome.storage.sync.get({ groups: [] });
    const groups = data.groups;

    // 檢查重複
    if (groups.some(g => g.url === normalizedUrl)) {
        showError('這個社團已經在清單中了');
        return;
    }

    // 從網址中提取社團名稱/ID
    const groupId = extractGroupId(normalizedUrl);
    const newGroup = {
        id: Date.now().toString(),
        url: normalizedUrl,
        name: groupId,
        addedAt: new Date().toISOString()
    };

    groups.push(newGroup);
    await chrome.storage.sync.set({ groups });

    // 清空輸入並隱藏錯誤
    input.value = '';
    errorMsg.style.display = 'none';

    // 重新渲染
    renderGroups(groups);
}

// ===== 刪除社團 =====
async function removeGroup(id) {
    const data = await chrome.storage.sync.get({ groups: [] });
    const groups = data.groups.filter(g => g.id !== id);
    await chrome.storage.sync.set({ groups });
    renderGroups(groups);
}

// ===== 渲染社團列表 =====
function renderGroups(groups) {
    const list = document.getElementById('groupList');
    const emptyState = document.getElementById('emptyState');

    // 清除舊項目（保留空狀態）
    list.querySelectorAll('.group-item').forEach(el => el.remove());

    if (groups.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    groups.forEach((group, index) => {
        const item = document.createElement('div');
        item.className = 'group-item';
        item.style.animationDelay = `${index * 0.05}s`;

        const initial = getInitial(group.name);
        const colors = getAvatarColors(index);

        item.innerHTML = `
      <div class="group-avatar" style="background: linear-gradient(135deg, ${colors[0]}, ${colors[1]})">
        ${initial}
      </div>
      <div class="group-info">
        <div class="group-name" title="${group.name}">${group.name}</div>
        <div class="group-url-display" title="${group.url}">${shortenUrl(group.url)}</div>
      </div>
      <div class="group-actions">
        <button class="btn-icon btn-go" title="前往社團（按時間排序）" data-url="${group.url}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </button>
        <button class="btn-icon btn-delete" title="移除社團" data-id="${group.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
      </div>
    `;

        // 事件綁定
        item.querySelector('.btn-go').addEventListener('click', (e) => {
            const url = e.currentTarget.dataset.url;
            chrome.runtime.sendMessage({ action: 'openGroup', url });
        });

        item.querySelector('.btn-delete').addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            removeGroup(id);
        });

        list.appendChild(item);
    });
}

// ===== 前往社團動態 =====
async function goToGroupsFeed() {
    // 自動開啟過濾
    await chrome.storage.sync.set({ filterEnabled: true });
    document.getElementById('filterToggle').checked = true;

    // 通知所有 Facebook 分頁
    const tabs = await chrome.tabs.query({ url: 'https://www.facebook.com/*' });
    tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'toggleFilter', enabled: true }).catch(() => { });
    });

    // 開啟社團動態頁面
    chrome.tabs.create({ url: 'https://www.facebook.com/?filter=groups&sk=h_chr' });
}

// ===== 開啟所有社團 =====
function openAllGroups() {
    chrome.runtime.sendMessage({ action: 'openAllGroups' });
}

// ===== 開啟儀表板 =====
function openDashboard() {
    chrome.runtime.sendMessage({ action: 'openDashboard' });
}

// ===== 過濾開關 =====
async function toggleFilter(e) {
    const enabled = e.target.checked;
    await chrome.storage.sync.set({ filterEnabled: enabled });

    // 通知所有 Facebook 分頁
    const tabs = await chrome.tabs.query({ url: 'https://www.facebook.com/*' });
    tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'toggleFilter', enabled }).catch(() => { });
    });
}

// ===== 自動滾動開關 =====
async function toggleAutoScroll(e) {
    const enabled = e.target.checked;
    await chrome.storage.sync.set({ autoScrollEnabled: enabled });

    const tabs = await chrome.tabs.query({ url: 'https://www.facebook.com/*' });
    tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'toggleAutoScroll', enabled }).catch(() => { });
    });
}

// ===== 自動發送開關 =====
async function toggleAutoSend(e) {
    const enabled = e.target.checked;
    await chrome.storage.sync.set({ autoSendEnabled: enabled });

    const tabs = await chrome.tabs.query({ url: 'https://www.facebook.com/*' });
    tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'toggleAutoSend', enabled }).catch(() => { });
    });
}

// ===== 自動刷新開關 =====
async function toggleAutoRefresh(e) {
    const enabled = e.target.checked;
    await chrome.storage.sync.set({ autoRefreshEnabled: enabled });

    const tabs = await chrome.tabs.query({ url: 'https://www.facebook.com/*' });
    tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'toggleAutoRefresh', enabled }).catch(() => { });
    });
}

// ===== 更新設定秒數 =====
async function updateScrollInterval(e) {
    let seconds = parseInt(e.target.value, 10);
    if (isNaN(seconds) || seconds < 1) seconds = 1;
    await chrome.storage.sync.set({ scrollInterval: seconds });

    // 通知 content script
    const tabs = await chrome.tabs.query({ url: 'https://www.facebook.com/*' });
    tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'updateIntervals', scrollInterval: seconds }).catch(() => { });
    });
}

async function updateRefreshInterval(e) {
    let seconds = parseInt(e.target.value, 10);
    if (isNaN(seconds) || seconds < 5) seconds = 5;
    await chrome.storage.sync.set({ refreshInterval: seconds });

    // 通知 content script
    const tabs = await chrome.tabs.query({ url: 'https://www.facebook.com/*' });
    tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'updateIntervals', refreshInterval: seconds }).catch(() => { });
    });
}

// ===== 更新 Webhook URL 設定 =====
async function updateWebhookUrl(e) {
    const url = e.target.value.trim();
    await chrome.storage.sync.set({ webhookUrl: url });
    console.log('[FB篩選器] Discord Webhook URL 已更新');
}

// 👁️ 切換 Webhook 顯示隱藏
function toggleWebhookVisibility() {
    const input = document.getElementById('webhookUrlInput');
    const btn = document.getElementById('toggleWebhookVisibility');
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🔒';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
    }
}

// ===== 更新關鍵字設定 =====
async function updateAlertKeywords(e) {
    const keywords = e.target.value.trim();
    await chrome.storage.sync.set({ alertKeywords: keywords });
    console.log('[FB篩選器] 關鍵字提醒已更新:', keywords);
}

// ===== 工具函數 =====

function isValidFacebookGroupUrl(url) {
    try {
        const urlObj = new URL(url);
        return (urlObj.hostname === 'www.facebook.com' || urlObj.hostname === 'facebook.com' || urlObj.hostname === 'm.facebook.com')
            && urlObj.pathname.includes('/groups/');
    } catch {
        // 嘗試加上 https://
        try {
            const urlObj = new URL('https://' + url);
            return urlObj.hostname.includes('facebook.com') && urlObj.pathname.includes('/groups/');
        } catch {
            return false;
        }
    }
}

function normalizeFacebookUrl(url) {
    try {
        let urlObj = new URL(url);
        // 統一使用 www.facebook.com
        urlObj.hostname = 'www.facebook.com';
        // 移除查詢參數
        let path = urlObj.pathname;
        // 確保結尾有 /
        if (!path.endsWith('/')) path += '/';
        return `https://www.facebook.com${path}`;
    } catch {
        try {
            let urlObj = new URL('https://' + url);
            urlObj.hostname = 'www.facebook.com';
            let path = urlObj.pathname;
            if (!path.endsWith('/')) path += '/';
            return `https://www.facebook.com${path}`;
        } catch {
            return url;
        }
    }
}

function extractGroupId(url) {
    try {
        const urlObj = new URL(url);
        const parts = urlObj.pathname.split('/').filter(Boolean);
        const groupIndex = parts.indexOf('groups');
        if (groupIndex >= 0 && parts[groupIndex + 1]) {
            return decodeURIComponent(parts[groupIndex + 1]);
        }
    } catch { }
    return '社團';
}

function shortenUrl(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.pathname.replace(/\/$/, '');
    } catch {
        return url;
    }
}

function getInitial(name) {
    if (!name) return '?';
    // 如果是中文，取第一個字
    const firstChar = name.charAt(0);
    if (/[\u4e00-\u9fff]/.test(firstChar)) return firstChar;
    return firstChar.toUpperCase();
}

function getAvatarColors(index) {
    const palettes = [
        ['#1877F2', '#0D47A1'],
        ['#E91E63', '#AD1457'],
        ['#9C27B0', '#6A1B9A'],
        ['#00BCD4', '#00838F'],
        ['#FF9800', '#E65100'],
        ['#4CAF50', '#2E7D32'],
        ['#F44336', '#C62828'],
        ['#3F51B5', '#283593'],
        ['#009688', '#00695C'],
        ['#FF5722', '#BF360C'],
    ];
    return palettes[index % palettes.length];
}

function showError(msg) {
    const errorMsg = document.getElementById('errorMsg');
    errorMsg.textContent = msg;
    errorMsg.style.display = 'block';
    setTimeout(() => {
        errorMsg.style.display = 'none';
    }, 3000);
}
