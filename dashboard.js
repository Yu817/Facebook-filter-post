// FB 社團篩選器 - 儀表板邏輯

document.addEventListener('DOMContentLoaded', init);

async function init() {
    const data = await chrome.storage.sync.get({
        groups: [],
        filterEnabled: false,
        webhookUrl: '',
        alertKeywords: ''
    });

    renderGroups(data.groups);
    updateStats(data.groups);
    updateFilterStatus(data.filterEnabled);

    // 設定值
    document.getElementById('webhookUrlInput').value = data.webhookUrl || '';
    document.getElementById('alertKeywordsInput').value = data.alertKeywords || '';

    // 事件監聽
    document.getElementById('addBtn').addEventListener('click', addGroup);
    document.getElementById('groupUrl').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addGroup();
    });
    document.getElementById('openAllBtn').addEventListener('click', openAllGroups);
    document.getElementById('webhookUrlInput').addEventListener('change', updateWebhookUrl);
    document.getElementById('toggleWebhookVisibility').addEventListener('click', toggleWebhookVisibility);
    document.getElementById('alertKeywordsInput').addEventListener('change', updateAlertKeywords);

    // 監聽儲存變更（其他地方修改時同步更新）
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.groups) {
            renderGroups(changes.groups.newValue || []);
            updateStats(changes.groups.newValue || []);
        }
        if (changes.filterEnabled) {
            updateFilterStatus(changes.filterEnabled.newValue);
        }
        if (changes.webhookUrl) {
            document.getElementById('webhookUrlInput').value = changes.webhookUrl.newValue || '';
        }
        if (changes.alertKeywords) {
            document.getElementById('alertKeywordsInput').value = changes.alertKeywords.newValue || '';
        }
    });
}

// ===== 新增社團 =====
async function addGroup() {
    const input = document.getElementById('groupUrl');
    const errorMsg = document.getElementById('errorMsg');
    const url = input.value.trim();

    if (!url) {
        showError('請輸入社團網址');
        return;
    }

    if (!isValidFacebookGroupUrl(url)) {
        showError('請輸入有效的 Facebook 社團網址（包含 /groups/）');
        return;
    }

    const normalizedUrl = normalizeFacebookUrl(url);
    const data = await chrome.storage.sync.get({ groups: [] });
    const groups = data.groups;

    if (groups.some(g => g.url === normalizedUrl)) {
        showError('這個社團已經在清單中了');
        return;
    }

    const groupId = extractGroupId(normalizedUrl);
    const newGroup = {
        id: Date.now().toString(),
        url: normalizedUrl,
        name: groupId,
        addedAt: new Date().toISOString()
    };

    groups.push(newGroup);
    await chrome.storage.sync.set({ groups });

    input.value = '';
    errorMsg.style.display = 'none';

    renderGroups(groups);
    updateStats(groups);
}

// ===== 刪除社團 =====
async function removeGroup(id) {
    const data = await chrome.storage.sync.get({ groups: [] });
    const groups = data.groups.filter(g => g.id !== id);
    await chrome.storage.sync.set({ groups });
    renderGroups(groups);
    updateStats(groups);
}

// ===== 渲染社團卡片 =====
function renderGroups(groups) {
    const grid = document.getElementById('groupsGrid');
    const emptyState = document.getElementById('emptyState');

    // 清除舊卡片
    grid.querySelectorAll('.group-card').forEach(el => el.remove());

    if (groups.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    groups.forEach((group, index) => {
        const card = document.createElement('div');
        card.className = 'group-card';
        card.style.animationDelay = `${index * 0.08}s`;

        const initial = getInitial(group.name);
        const colors = getAvatarColors(index);

        card.innerHTML = `
      <div class="card-header" style="background: linear-gradient(135deg, ${colors[0]}33, ${colors[1]}22);">
        <div class="card-avatar" style="background: linear-gradient(135deg, ${colors[0]}, ${colors[1]})">
          ${initial}
        </div>
      </div>
      <div class="card-body">
        <div class="card-name" title="${group.name}">${group.name}</div>
        <div class="card-url" title="${group.url}">${shortenUrl(group.url)}</div>
        <div class="card-actions">
          <button class="card-btn card-btn-go" data-url="${group.url}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            按時間排序前往
          </button>
          <button class="card-btn card-btn-delete" data-id="${group.id}" title="移除">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
    `;

        card.querySelector('.card-btn-go').addEventListener('click', (e) => {
            const url = e.currentTarget.dataset.url;
            chrome.runtime.sendMessage({ action: 'openGroup', url });
        });

        card.querySelector('.card-btn-delete').addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            // 刪除動畫
            card.style.transition = '0.3s ease';
            card.style.opacity = '0';
            card.style.transform = 'scale(0.9)';
            setTimeout(() => removeGroup(id), 300);
        });

        grid.appendChild(card);
    });
}

// ===== 更新統計 =====
function updateStats(groups) {
    const statsBar = document.getElementById('statsBar');
    const countEl = document.getElementById('groupCount');
    const lastEl = document.getElementById('lastAdded');

    if (groups.length === 0) {
        statsBar.style.display = 'none';
        return;
    }

    statsBar.style.display = 'flex';
    countEl.textContent = groups.length;

    // 最近新增
    const sorted = [...groups].sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
    if (sorted.length > 0) {
        lastEl.textContent = `最近新增：${sorted[0].name}`;
    }
}

// ===== 過濾狀態 =====
function updateFilterStatus(enabled) {
    const statusEl = document.getElementById('filterStatus');
    const textEl = statusEl.querySelector('.status-text');

    if (enabled) {
        statusEl.classList.add('active');
        textEl.textContent = '動態過濾：開啟';
    } else {
        statusEl.classList.remove('active');
        textEl.textContent = '動態過濾：關閉';
    }
}

// ===== 開啟所有社團 =====
function openAllGroups() {
    chrome.runtime.sendMessage({ action: 'openAllGroups' });
}

// ===== 工具函數（與 popup.js 共用） =====

function isValidFacebookGroupUrl(url) {
    try {
        const urlObj = new URL(url);
        return (urlObj.hostname === 'www.facebook.com' || urlObj.hostname === 'facebook.com' || urlObj.hostname === 'm.facebook.com')
            && urlObj.pathname.includes('/groups/');
    } catch {
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
        urlObj.hostname = 'www.facebook.com';
        let path = urlObj.pathname;
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

function getInitial(name) {
    if (!name) return '?';
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
    setTimeout(() => { errorMsg.style.display = 'none'; }, 3000);
}
