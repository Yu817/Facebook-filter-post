// FB 社團篩選器 - Service Worker

// 監聽來自 popup 或 content script 的訊息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'openAllGroups') {
        openAllGroups();
        sendResponse({ success: true });
    } else if (message.action === 'openGroup') {
        openGroup(message.url);
        sendResponse({ success: true });
    } else if (message.action === 'openDashboard') {
        chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
        sendResponse({ success: true });
    } else if (message.action === 'sendToDiscord') {
        sendToDiscord(message.post).then(result => {
            sendResponse(result);
        }).catch(err => {
            sendResponse({ success: false, error: err.message });
        });
        return true; // 非同步回應
    }
    return true;
});

// ===== Discord Webhook =====
async function sendToDiscord(post) {
    const data = await chrome.storage.sync.get({ webhookUrl: '', alertKeywords: '' });
    const webhookUrl = data.webhookUrl;
    const alertKeywords = data.alertKeywords;

    if (!webhookUrl) {
        console.log('[FB篩選器] 未設定 Discord Webhook URL');
        return { success: false, error: 'no_webhook' };
    }

    // 檢查是否已發送過
    const sent = await chrome.storage.local.get({ sentPosts: {} });
    const sentPosts = sent.sentPosts;

    if (sentPosts[post.id]) {
        console.log('[FB篩選器] 已發送過，跳過:', post.id);
        return { success: false, error: 'duplicate' };
    }

    // 檢查關鍵字是否命中
    let matchedKeywords = [];
    if (alertKeywords && post.text) {
        const keywords = alertKeywords.split(';').map(k => k.trim()).filter(k => k.length > 0);
        const textLower = post.text.toLowerCase();
        matchedKeywords = keywords.filter(kw => textLower.includes(kw.toLowerCase()));
        if (matchedKeywords.length > 0) {
            console.log('[FB篩選器] 🔔 關鍵字命中:', matchedKeywords.join(', '));
        }
    }

    // 檢查是否為真實貼文連結（而非只是社團首頁）
    // 透過比對 link 的特徵，或是確保它不只是純粹的 /groups/ID 結尾
    let isRealPostLink = false;
    if (post.link) {
        const patterns = [
            '/posts/', 'multi_permalinks', 'permalink', 'pfbid',
            '/videos/', '/photos/', '/reel/', 'set=pcb', 'story_fbid', 'fbid=',
            'story.php', '/p/', '/watch/', '/share/', '/commerce/listing/'
        ];
        isRealPostLink = patterns.some(p => post.link.includes(p));
    }

    let description = post.text ? post.text.substring(0, 1900) : '(無文字內容)';
    if (!isRealPostLink) {
        description += '\n\n📌 *未偵測到獨立貼文網址 (可能為純文字、匿名發佈或系統公告)*';
    }
    if (matchedKeywords.length > 0) {
        description = `🔔 **關鍵字命中：${matchedKeywords.join('、')}**\n\n` + description;
    }

    const embed = {
        title: `📢 ${post.groupName || '社團貼文'}`,
        description: description,
        url: isRealPostLink ? post.link : undefined,
        color: matchedKeywords.length > 0 ? 0xFF4500 : 0x1877F2,
        footer: {
            text: 'FB 社團篩選器'
        },
        timestamp: new Date().toISOString()
    };

    const body = {
        embeds: [embed]
    };

    // 關鍵字命中時加上 @everyone 提醒
    if (matchedKeywords.length > 0) {
        body.content = '@everyone';
    }

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (response.ok || response.status === 204) {
            // 記錄已發送
            sentPosts[post.id] = Date.now();

            // 清理超過 7 天的記錄
            const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
            for (const key in sentPosts) {
                if (sentPosts[key] < oneWeekAgo) {
                    delete sentPosts[key];
                }
            }

            await chrome.storage.local.set({ sentPosts });
            console.log('[FB篩選器] Discord 發送成功:', post.id);
            return { success: true };
        } else {
            const errText = await response.text();
            console.error('[FB篩選器] Discord 發送失敗:', response.status, errText);
            // 如果被限速，等一下再試
            if (response.status === 429) {
                return { success: false, error: 'rate_limited' };
            }
            return { success: false, error: `http_${response.status}` };
        }
    } catch (err) {
        console.error('[FB篩選器] Discord 發送錯誤:', err);
        return { success: false, error: err.message };
    }
}

// ===== 開啟社團 =====
async function openAllGroups() {
    const data = await chrome.storage.sync.get({ groups: [] });
    const groups = data.groups;

    for (const group of groups) {
        const url = buildChronologicalUrl(group.url);
        chrome.tabs.create({ url, active: false });
    }
}

function openGroup(url) {
    const chronologicalUrl = buildChronologicalUrl(url);
    chrome.tabs.create({ url: chronologicalUrl });
}

function buildChronologicalUrl(url) {
    try {
        const urlObj = new URL(url);
        urlObj.searchParams.set('sorting_setting', 'CHRONOLOGICAL');
        return urlObj.toString();
    } catch {
        return url;
    }
}

// 安裝或更新時初始化
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.get({ webhookUrl: '' }, (data) => {
        if (!data.webhookUrl) {
            chrome.storage.sync.set({ webhookUrl: '' });
        }
    });
    chrome.storage.local.get({ sentPosts: {} }, (data) => {
        chrome.storage.local.set(data);
    });
    console.log('[FB篩選器] 擴充功能已安裝/更新，儲存初始化完成');
});
