// FB 社團篩選器 - Content Script
// 直接掃描貼文方式，不依賴 role="feed"

(function () {
    'use strict';

    let filterEnabled = false;
    let autoScrollEnabled = false;
    let autoSendEnabled = false;
    let autoRefreshEnabled = true;
    let allowedGroups = [];
    let floatingBtn = null;
    let observer = null;
    let hiddenCount = 0;
    let shownCount = 0;
    let scanTimer = null;
    let scrollTimer = null;
    let refreshTimer = null;
    let scrollIntervalMs = 1000;      // 預設每 1 秒自動滾動
    const SCROLL_AMOUNT = 400;        // 每次滾動 400px
    let refreshIntervalMs = 30 * 1000; // 預設每 30 秒重新整理

    // ===== 初始化 =====
    async function init() {
        const data = await chrome.storage.sync.get({
            groups: [],
            filterEnabled: false,
            autoScrollEnabled: false,
            autoSendEnabled: false,
            autoRefreshEnabled: true,
            scrollInterval: 1,
            refreshInterval: 30
        });
        allowedGroups = data.groups.map(g => {
            const id = extractGroupIdFromUrl(g.url);
            return { ...g, groupId: id };
        });
        filterEnabled = data.filterEnabled;
        autoScrollEnabled = data.autoScrollEnabled;
        autoSendEnabled = data.autoSendEnabled;
        autoRefreshEnabled = data.autoRefreshEnabled;

        scrollIntervalMs = (data.scrollInterval || 1) * 1000;
        refreshIntervalMs = (data.refreshInterval || 30) * 1000;

        console.log('[FB篩選器] 初始化完成', { filterEnabled, autoScrollEnabled, autoSendEnabled, autoRefreshEnabled, scrollIntervalMs, refreshIntervalMs, groups: allowedGroups.length });

        createFloatingButton();

        if (filterEnabled && allowedGroups.length > 0) {
            // 延遲啟動，等 Facebook 載入完內容
            setTimeout(() => startFiltering(), 2000);
        }

        // 監聽來自 popup 的訊息
        chrome.runtime.onMessage.addListener((message) => {
            if (message.action === 'toggleFilter') {
                filterEnabled = message.enabled;
                if (filterEnabled) {
                    startFiltering();
                } else {
                    stopFiltering();
                }
                updateFloatingButton();
            }
            if (message.action === 'toggleAutoScroll') {
                autoScrollEnabled = message.enabled;
                if (autoScrollEnabled && filterEnabled) {
                    startAutoScroll();
                } else {
                    stopAutoScroll();
                }
                updateFloatingButton();
            }
            if (message.action === 'toggleAutoSend') {
                autoSendEnabled = message.enabled;
                updateFloatingButton();
            }
            if (message.action === 'toggleAutoRefresh') {
                autoRefreshEnabled = message.enabled;
                if (autoRefreshEnabled && filterEnabled) {
                    startAutoRefresh();
                } else {
                    stopAutoRefresh();
                }
                updateFloatingButton();
            }
            if (message.action === 'updateIntervals') {
                if (message.scrollInterval) {
                    scrollIntervalMs = message.scrollInterval * 1000;
                    if (autoScrollEnabled && filterEnabled) startAutoScroll(); // 重新啟動計時器
                }
                if (message.refreshInterval) {
                    refreshIntervalMs = message.refreshInterval * 1000;
                    if (autoRefreshEnabled && filterEnabled) startAutoRefresh(); // 重新啟動計時器
                }
            }
        });

        // 監聽儲存變更
        chrome.storage.onChanged.addListener((changes) => {
            if (changes.groups) {
                allowedGroups = (changes.groups.newValue || []).map(g => {
                    const id = extractGroupIdFromUrl(g.url);
                    return { ...g, groupId: id };
                });
                if (filterEnabled) {
                    stopFiltering();
                    startFiltering();
                }
                updateFloatingButton();
            }
            if (changes.filterEnabled) {
                filterEnabled = changes.filterEnabled.newValue;
                if (filterEnabled) {
                    startFiltering();
                } else {
                    stopFiltering();
                }
                updateFloatingButton();
            }
            if (changes.autoScrollEnabled) {
                autoScrollEnabled = changes.autoScrollEnabled.newValue;
                if (autoScrollEnabled && filterEnabled) {
                    startAutoScroll();
                } else {
                    stopAutoScroll();
                }
                updateFloatingButton();
            }
            if (changes.autoSendEnabled) {
                autoSendEnabled = changes.autoSendEnabled.newValue;
                updateFloatingButton();
            }
            if (changes.autoRefreshEnabled) {
                autoRefreshEnabled = changes.autoRefreshEnabled.newValue;
                if (autoRefreshEnabled && filterEnabled) {
                    startAutoRefresh();
                } else {
                    stopAutoRefresh();
                }
                updateFloatingButton();
            }
        });

        // 監聽 URL 變更（Facebook 是 SPA）
        let lastUrl = location.href;
        const urlObserver = new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                stopFiltering();
                hiddenCount = 0;
                shownCount = 0;

                if (filterEnabled && allowedGroups.length > 0) {
                    setTimeout(() => startFiltering(), 2000);
                }
                updateFloatingButton();
            }
        });
        urlObserver.observe(document.body, { childList: true, subtree: true });

        // 監聽分頁切換 — 從背景切回前景時立即重新掃描
        // Chrome 會對背景分頁降速 setInterval/setTimeout（從每秒變成每分鐘一次）
        // 這個監聽確保切回時立刻補掃所有新貼文
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && filterEnabled && allowedGroups.length > 0) {
                console.log('[FB篩選器] 📌 分頁回到前景，立即重新掃描');
                scanAndFilter();

                // 重新啟動計時器（背景期間可能已被降速或停止）
                if (scanTimer) clearInterval(scanTimer);
                scanTimer = setInterval(() => {
                    if (filterEnabled) scanAndFilter();
                }, 3000);

                if (autoScrollEnabled) startAutoScroll();
                if (autoRefreshEnabled) startAutoRefresh();
            }
        });
    }

    // ===== 過濾邏輯 =====
    function startFiltering() {
        console.log('[FB篩選器] 開始過濾...');
        console.log('[FB篩選器] 允許的社團:', allowedGroups.map(g => g.groupId));

        hiddenCount = 0;
        shownCount = 0;

        // 首次掃描
        scanAndFilter();

        // 持續監聽新貼文
        startObserving();

        // 定期重新掃描（每 3 秒）以補抓動態載入的貼文
        if (scanTimer) clearInterval(scanTimer);
        scanTimer = setInterval(() => {
            if (filterEnabled) scanAndFilter();
        }, 3000);

        // 自動滾動（獨立開關）
        if (autoScrollEnabled) {
            startAutoScroll();
        }

        // 定時重新整理（獨立開關）
        if (autoRefreshEnabled) {
            startAutoRefresh();
        }

        updateFloatingButton();
    }

    function stopFiltering() {
        // 停止定期掃描
        if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }

        // 停止自動滾動
        stopAutoScroll();

        // 停止定時重新整理
        stopAutoRefresh();

        // 停止 observer
        if (observer) { observer.disconnect(); observer = null; }

        // 顯示所有被隱藏的貼文
        document.querySelectorAll('[data-fb-filter-hidden]').forEach(el => {
            el.style.cssText = '';
            el.removeAttribute('data-fb-filter-hidden');
        });

        document.querySelectorAll('[data-fb-filter-shown]').forEach(el => {
            el.style.borderLeft = '';
            el.style.borderRadius = '';
            el.removeAttribute('data-fb-filter-shown');
        });

        hiddenCount = 0;
        shownCount = 0;
        updateFloatingButton();
    }

    // ===== 自動滾動 =====
    function startAutoScroll() {
        if (scrollTimer) clearInterval(scrollTimer);

        console.log('[FB篩選器] 🔄 自動滾動已啟動 (每', scrollIntervalMs / 1000, '秒)');

        scrollTimer = setInterval(() => {
            if (!filterEnabled || !autoScrollEnabled) return;

            // 溫和地往下滾動
            window.scrollBy({
                top: SCROLL_AMOUNT,
                behavior: 'smooth'
            });
        }, scrollIntervalMs);
    }

    function stopAutoScroll() {
        if (scrollTimer) { clearInterval(scrollTimer); scrollTimer = null; }
        console.log('[FB篩選器] ⏹️ 自動滾動已停止');
    }

    // ===== 定時重新整理 =====
    function startAutoRefresh() {
        if (refreshTimer) clearTimeout(refreshTimer);

        console.log('[FB篩選器] ⏰ 定時重新整理已啟動 (每', refreshIntervalMs / 1000, '秒)');

        refreshTimer = setTimeout(() => {
            if (!filterEnabled || !autoRefreshEnabled) return;
            console.log('[FB篩選器] 🔄 自動重新整理頁面...');
            location.reload();
        }, refreshIntervalMs);
    }

    function stopAutoRefresh() {
        if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
        console.log('[FB篩選器] ⏹️ 定時重新整理已停止');
    }

    // 防止頻繁觸發強制載入的計時器
    let forceLoadTimeout = null;

    // ===== 核心：掃描並過濾 =====
    function scanAndFilter() {
        // 先找到主要動態牆區域，避免掃描到左邊導覽列或上方 Header
        const mainFeed = document.querySelector('[role="feed"]') || document.querySelector('[role="main"]') || document.body;

        // 找 mainFeed 內所有含社團連結的區塊
        const groupLinks = mainFeed.querySelectorAll('a[href*="/groups/"]');
        if (groupLinks.length === 0) return;

        // 對每個社團連結，找到它的「貼文級」祖先
        const processedPosts = new Set();

        for (const link of groupLinks) {
            // 跳過導航列的 /groups/ 連結（純 /groups/ 不帶ID）
            const href = link.getAttribute('href') || '';
            if (href === '/groups/' || href === 'https://www.facebook.com/groups/') continue;

            // 找到貼文級的祖先
            const postEl = findPostAncestor(link);
            if (!postEl || processedPosts.has(postEl)) continue;
            processedPosts.add(postEl);

            // 已處理過的跳過
            if (postEl.hasAttribute('data-fb-filter-hidden') ||
                postEl.hasAttribute('data-fb-filter-shown')) continue;

            // 判斷是否來自允許的社團
            const groupId = extractGroupFromHref(href);
            const isAllowed = allowedGroups.some(g => g.groupId === groupId);

            if (isAllowed) {
                postEl.setAttribute('data-fb-filter-shown', 'true');
                postEl.style.borderLeft = '3px solid #1877F2';
                postEl.style.borderRadius = '8px';
                shownCount++;
                console.log('[FB篩選器] ✅ 顯示:', groupId);

                // 自動展開「查看更多」
                expandSeeMore(postEl);

                // 發送到 Discord（獨立開關）— 加入佇列逐一發送
                if (autoSendEnabled) {
                    // 給一點時間讓「查看更多」展開完成後再擷取文字
                    setTimeout(() => queuePostForDiscord(postEl, groupId, href), 1500);
                }
            } else {
                postEl.style.cssText = 'display:none !important; height:0 !important; overflow:hidden !important; padding:0 !important; margin:0 !important; border:0 !important; opacity:0 !important; pointer-events:none !important;';
                postEl.setAttribute('data-fb-filter-hidden', 'true');
                hiddenCount++;
                console.log('[FB篩選器] ❌ 隱藏:', groupId);
            }
        }

        // 檢查是否需要自動往下加載（彌補大量貼文隱藏導致的空白停滯），加入防抖 (debounce)
        if (forceLoadTimeout) clearTimeout(forceLoadTimeout);
        forceLoadTimeout = setTimeout(() => {
            checkAndForceLoadMore();
        }, 500);

        updateFloatingButton();
    }

    // 當開啟過濾且隱藏了大量內容時，判斷頁面上到底還有沒有夠多的顯示內容。如果太短，主動幫使用者往下滾一點觸發 Facebook 載入機制。
    function checkAndForceLoadMore() {
        if (!filterEnabled) return;
        if (autoScrollEnabled) return; // 如果已經有開連續自動滾動，就不需要這個額外的機制

        // 檢查目前 document 的高度與可見高度的差異
        const scrollHeight = Math.max(
            document.body.scrollHeight, document.documentElement.scrollHeight,
            document.body.offsetHeight, document.documentElement.offsetHeight,
            document.body.clientHeight, document.documentElement.clientHeight
        );
        const windowHeight = window.innerHeight;
        const scrollY = window.scrollY;

        // 修改：放寬條件。
        // 1. 如果距離頁面底部小於 3 倍的螢幕高度 (Facebook 預先載入通常需要比較大的緩衝區)
        // 2. 或是目前顯示的貼文不夠多（小於 3 篇），且已經隱藏了貼文，就去觸發載入
        const isNearBottom = (scrollHeight - windowHeight - scrollY) < windowHeight * 3.0;
        const visibilityRatioIsLow = (shownCount < 3 && hiddenCount > 0);

        if (isNearBottom || visibilityRatioIsLow) {
            console.log('[FB篩選器] ⬇️ 可見內容太少，執行背景無感加載');

            // 背景無感加載技巧：
            // 由於貼文被 display:none 隱藏，網頁實際高度已經縮短。
            // 但 Facebook 不知道高度變了，我們需要手動觸發一下 scroll 事件讓它重新計算。
            // 我們瞬間往下滾 1px 再瞬間滾回來，人眼看不出來，但足以觸發各種 event listener

            const currentY = window.scrollY;

            // 瞬間滾動下去 1 px
            window.scrollTo({ top: currentY + 1, behavior: 'instant' });

            // 額外送出純事件確保 React 能收到
            window.dispatchEvent(new CustomEvent('scroll', { bubbles: true }));

            // 瞬間滾動回來
            window.scrollTo({ top: currentY, behavior: 'instant' });
        }
    }

    // 找到貼文級的祖先元素
    function findPostAncestor(element) {
        let el = element;
        let lastCandidate = null;

        // 我們最多往上找 25 層
        for (let i = 0; i < 25; i++) {
            if (!el || !el.parentElement) break;
            el = el.parentElement;

            // 如果到了 feed 或 main，就停止往上找
            if (el.getAttribute('role') === 'feed' || el.getAttribute('role') === 'main') {
                break;
            }

            // 如果到了 body 或 HTML，停止
            if (el === document.body || el === document.documentElement) {
                break;
            }

            // 判斷是否為 Facebook 貼文容器的特徵：
            // 1. 帶有 aria-posinset (這是最標準的動態牆貼文屬性)
            if (el.hasAttribute('aria-posinset')) {
                return el;
            }

            // 2. 特定的 data-pagelet 包含 FeedUnit
            const pagelet = el.getAttribute('data-pagelet') || '';
            if (pagelet.includes('FeedUnit') || pagelet.includes('GroupFeed')) {
                return el;
            }

            // 3. 通用備用方案：找到外面的較大卡片容器
            // 通常 Facebook 貼文外層會有 border-radius 或者特定的 class 組合
            // 如果它有很多子元素，且再往上一層是 feed，那它就是貼文
            if (el.parentElement && el.parentElement.getAttribute('role') === 'feed') {
                return el;
            }

            // 作為極限備用，記錄符合「有多個兄弟」的區塊，且本身不是 a 標籤或 span
            if (el.parentElement && el.parentElement.children.length >= 2 && el.tagName === 'DIV') {
                // 不直接 return，而是存為候選，繼續往上找看有沒有更好的
                lastCandidate = el;
            }
        }

        return lastCandidate;
    }

    // 從 href 提取社團 ID
    function extractGroupFromHref(href) {
        try {
            const url = new URL(href, 'https://www.facebook.com');
            const parts = url.pathname.split('/').filter(Boolean);
            const idx = parts.indexOf('groups');
            if (idx >= 0 && parts[idx + 1]) {
                return parts[idx + 1];
            }
        } catch { }
        return '';
    }

    // ===== Discord 發送佇列系統 =====
    const discordQueue = [];
    let isProcessingQueue = false;
    const SEND_DELAY_MS = 2000; // 每則訊息間隔 2 秒，避免 Discord 限速
    const MAX_RETRIES = 3;

    // 將貼文加入發送佇列
    function queuePostForDiscord(postEl, groupId, href) {
        try {
            // 提取貼文內容
            const text = extractPostText(postEl);
            const link = extractPostLink(postEl, href);
            const groupName = extractGroupName(postEl) || groupId;

            // 防重複 ID
            let postId;
            const postIdMatch = link.match(/\/posts\/(\d+)/);
            if (postIdMatch) {
                postId = 'post_' + postIdMatch[1];
            } else {
                const cleanText = text
                    .replace(/查看更多|顯示更多|…|\.\.\.|\s+/g, '')
                    .substring(0, 100);
                postId = 'text_' + simpleHash(cleanText);
            }

            // 檢查佇列中是否已有相同 ID
            if (discordQueue.some(item => item.post.id === postId)) {
                console.log('[FB篩選器] ⏭️ 佇列中已有此貼文，跳過:', postId);
                return;
            }

            const postData = {
                id: postId,
                text: text,
                link: link,
                groupName: groupName
            };

            discordQueue.push({ post: postData, retries: 0 });
            console.log('[FB篩選器] 📥 加入發送佇列:', { groupName, postId, queueLength: discordQueue.length, textPreview: text.substring(0, 40) });

            // 啟動佇列處理
            processQueue();
        } catch (err) {
            console.error('[FB篩選器] 佇列加入錯誤:', err);
        }
    }

    // 逐一處理佇列中的訊息
    function processQueue() {
        if (isProcessingQueue || discordQueue.length === 0) return;
        isProcessingQueue = true;

        const item = discordQueue[0];
        console.log('[FB篩選器] 📤 佇列發送中:', { id: item.post.id, remaining: discordQueue.length });

        chrome.runtime.sendMessage({
            action: 'sendToDiscord',
            post: item.post
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('[FB篩選器] ❗ Discord 訊息錯誤:', chrome.runtime.lastError.message);
                handleSendResult(item, false, 'runtime_error');
                return;
            }
            if (response && response.success) {
                console.log('[FB篩選器] 📨 已發送到 Discord:', item.post.groupName);
                handleSendResult(item, true);
            } else if (response && response.error === 'duplicate') {
                console.log('[FB篩選器] ⏭️ 已發送過，跳過:', item.post.id);
                handleSendResult(item, true); // 視為成功，不重試
            } else if (response && response.error === 'no_webhook') {
                console.error('[FB篩選器] ❗ 未設定 Webhook URL');
                handleSendResult(item, true); // 設定問題，不重試
            } else if (response && response.error === 'rate_limited') {
                console.warn('[FB篩選器] ⏳ Discord 限速中，稍後重試...');
                handleSendResult(item, false, 'rate_limited');
            } else {
                console.error('[FB篩選器] ❗ 發送失敗:', response);
                handleSendResult(item, false, response?.error);
            }
        });
    }

    // 處理發送結果
    function handleSendResult(item, success, errorType) {
        if (success) {
            // 成功：移除佇列中的項目
            discordQueue.shift();
        } else {
            item.retries++;
            if (item.retries >= MAX_RETRIES) {
                console.error('[FB篩選器] ❌ 已達最大重試次數，放棄:', item.post.id);
                discordQueue.shift();
            } else {
                console.log(`[FB篩選器] 🔄 將在 ${errorType === 'rate_limited' ? 5 : 3} 秒後重試 (第 ${item.retries}/${MAX_RETRIES} 次):`, item.post.id);
            }
        }

        isProcessingQueue = false;

        // 繼續處理下一個
        if (discordQueue.length > 0) {
            const delay = errorType === 'rate_limited' ? 5000 : SEND_DELAY_MS;
            setTimeout(() => processQueue(), delay);
        }
    }

    // 簡單 hash 函數
    function simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 轉為 32bit 整數
        }
        return Math.abs(hash).toString(36);
    }

    // 自動點擊「查看更多」按鈕
    function expandSeeMore(postEl) {
        // Facebook 的「查看更多」按鈕通常是 div[role="button"] 或 span，文字包含「查看更多」、「See more」、「顯示更多」等
        const seeMoreKeywords = ['查看更多', 'See more', 'See More', '顯示更多', '展開'];

        // 找所有 role="button" 的元素
        const buttons = postEl.querySelectorAll('div[role="button"], span[role="button"]');
        for (const btn of buttons) {
            const btnText = btn.textContent.trim();
            if (seeMoreKeywords.some(kw => btnText === kw)) {
                try {
                    btn.click();
                    console.log('[FB篩選器] 🔽 已自動展開「查看更多」');
                } catch (e) {
                    console.log('[FB篩選器] 查看更多點擊失敗:', e);
                }
                return; // 每篇最多點一次
            }
        }

        // 備用：某些版本的 Facebook 是用 <a> 標籤包 <span>
        const allSpans = postEl.querySelectorAll('span');
        for (const span of allSpans) {
            const spanText = span.textContent.trim();
            if (seeMoreKeywords.some(kw => spanText === kw) && span.closest('[role="button"], a')) {
                try {
                    (span.closest('[role="button"]') || span.closest('a') || span).click();
                    console.log('[FB篩選器] 🔽 已自動展開「查看更多」 (備用)');
                } catch (e) {
                    console.log('[FB篩選器] 查看更多點擊失敗:', e);
                }
                return;
            }
        }
    }

    // 提取貼文文字（保留原始分行）
    function extractPostText(postEl) {
        // Facebook 貼文的每一行通常是獨立的 div[dir="auto"]
        // 需要找到它們的共同父容器，依序組合成完整文字

        const textEls = postEl.querySelectorAll('div[dir="auto"]');
        if (textEls.length === 0) return '(無法提取文字)';

        // 依照「父容器」把 div[dir="auto"] 分組
        const parentGroups = new Map();
        for (const el of textEls) {
            const parent = el.parentElement;
            if (!parent) continue;
            if (!parentGroups.has(parent)) {
                parentGroups.set(parent, []);
            }
            parentGroups.get(parent).push(el);
        }

        // 對每個群組，把子元素的文字用換行連接
        let bestText = '';
        for (const [parent, children] of parentGroups) {
            const lines = [];
            for (const el of children) {
                // 使用 innerText 保留 <br> 等行內換行
                const t = el.innerText.trim();
                if (t.length > 0) {
                    lines.push(t);
                }
            }
            const combined = lines.join('\n');
            // 取內容最長的那一組（通常就是貼文主體）
            if (combined.length > bestText.length) {
                bestText = combined;
            }
        }

        if (bestText.length > 0) {
            // 清理連續多餘的空行（3 行以上空行縮減為 2 行）
            bestText = bestText.replace(/\n{3,}/g, '\n\n');
            return bestText;
        }

        return '(無法提取文字)';
    }

    // 提取貼文連結
    function extractPostLink(postEl, fallbackHref) {
        const allLinks = Array.from(postEl.querySelectorAll('a[href]'));
        const groupId = extractGroupFromHref(fallbackHref);

        // 常見的貼文特徵路徑或參數
        const postPatterns = [
            '/posts/', '/permalink/', '/videos/', '/photos/', '/reel/',
            'pfbid', 'story_fbid=', 'fbid=', 'multi_permalinks', '/share/',
            'story.php', '/p/', '/watch/', '/commerce/listing/'
        ];

        // 清理多餘的追蹤參數
        const cleanUrl = (urlObj) => {
            for (const key of Array.from(urlObj.searchParams.keys())) {
                if (key.startsWith('__')) urlObj.searchParams.delete(key);
            }
            urlObj.searchParams.delete('ref');
            return urlObj.toString();
        };

        // 策略 1：優先找包含本社團 ID，且有貼文特徵的網址
        for (const link of allLinks) {
            const href = link.getAttribute('href') || '';
            if (href === '#' || href.startsWith('javascript:') || href.includes('comment_id=')) continue;
            try {
                const url = new URL(href, 'https://www.facebook.com');
                const isCurrentGroup = groupId && url.pathname.includes(`/groups/${groupId}`);
                const multiId = url.searchParams.get('multi_permalinks');
                if (multiId && isCurrentGroup) {
                    return `https://www.facebook.com/groups/${groupId}/posts/${multiId}/`;
                }
                const pcbMatch = href.match(/set=pcb\.(\d+)/);
                if (pcbMatch && isCurrentGroup) {
                    return `https://www.facebook.com/groups/${groupId}/posts/${pcbMatch[1]}/`;
                }
                const hasPostPattern = postPatterns.some(p => href.includes(p));
                if (isCurrentGroup && hasPostPattern) {
                    return cleanUrl(url);
                }
            } catch { }
        }

        // 策略 2：找任何符合貼文特徵的網址
        for (const link of allLinks) {
            const href = link.getAttribute('href') || '';
            if (href === '#' || href.startsWith('javascript:') || href.includes('comment_id=')) continue;
            try {
                const url = new URL(href, 'https://www.facebook.com');
                if (postPatterns.some(p => href.includes(p))) {
                    return cleanUrl(url);
                }
            } catch { }
        }

        // 策略 3：找「時間戳記連結」— 透過連結文字或 aria-label 辨識「X 分鐘前」等時間格式
        // 擴充支援簡短格式：1h, 2d, 3w, 1天, 2小時, 3分 等
        const timePatterns = /^\d+\s*(分鐘|小時|天|週|秒|月|年|分)|^(剛才|昨天|前天)|^\d{1,2}月\s*\d{1,2}日|^(January|February|March|April|May|June|July|August|September|October|November|December)|^(\d+\s*(min|hour|day|week|second|month|year)s?\s*ago)|^(Just now|Yesterday)|^\d+\s*[hdwmys]$/i;
        for (const link of allLinks) {
            const href = link.getAttribute('href') || '';
            if (href === '#' || href.startsWith('javascript:') || href.includes('comment_id=')) continue;
            const linkText = link.textContent.trim();
            const ariaLabel = link.getAttribute('aria-label') || '';
            if (timePatterns.test(linkText) || timePatterns.test(ariaLabel)) {
                try {
                    const url = new URL(href, 'https://www.facebook.com');
                    if (!url.pathname.includes('/profile.php') && url.hostname.includes('facebook.com')) {
                        console.log('[FB篩選器] ⏰ 透過時間戳記找到貼文連結:', href);
                        return cleanUrl(url);
                    }
                } catch { }
            }
        }

        // 策略 4：刪去法 — 排除社團首頁、用戶頁、功能頁後的第一個社團連結
        for (const link of allLinks) {
            const href = link.getAttribute('href') || '';
            if (href === '#' || href.startsWith('javascript:') || href.includes('comment_id=')) continue;
            try {
                const url = new URL(href, 'https://www.facebook.com');
                const isCurrentGroup = groupId && url.pathname.includes(`/groups/${groupId}`);
                if (isCurrentGroup) {
                    const path = url.pathname.replace(/\/$/, "");
                    const isGroupHome = path === `/groups/${groupId}`;
                    const isTab = ['/about', '/members', '/media', '/files', '/events', '/buy_sell_discussion', '/announcements'].some(t => path.endsWith(t));
                    const isUserInGroup = path.includes('/user/');
                    if (!isGroupHome && !isTab && !isUserInGroup) {
                        return cleanUrl(url);
                    }
                }
            } catch { }
        }

        // 策略 5：找含有 __cft__ 參數且帶 fragment hash 的連結
        // Facebook SPA 中，時間戳記連結有時只有 ?__cft__...#?fka 格式
        for (const link of allLinks) {
            const href = link.getAttribute('href') || '';
            if (href === '#' || href.startsWith('javascript:') || href.includes('comment_id=')) continue;
            // 匹配只有查詢參數（沒有路徑或路徑為根目錄）且帶 __cft__ 的連結
            if (href.includes('__cft__') && (href.startsWith('?') || href.includes('#'))) {
                try {
                    const url = new URL(href, 'https://www.facebook.com');
                    const path = url.pathname.replace(/\/$/, '');
                    // 排除社團首頁和用戶頁
                    const isGroupHome = groupId && path === `/groups/${groupId}`;
                    const isUserInGroup = path.includes('/user/');
                    if (!isGroupHome && !isUserInGroup) {
                        // 如果有社團 ID，直接用社團首頁連結（因為原始連結可能只是相對路徑）
                        if (groupId) {
                            console.log('[FB篩選器] 🔗 透過 __cft__ 連結找到貼文 (使用社團首頁):', href);
                            return `https://www.facebook.com/groups/${groupId}/`;
                        }
                        console.log('[FB篩選器] 🔗 透過 __cft__ 連結找到貼文:', href);
                        return cleanUrl(url);
                    }
                } catch { }
            }
        }

        // 策略 6：找文字很短的 <a>（可能是縮寫時間如「2天」「3h」），且帶有 __cft__ 參數
        for (const link of allLinks) {
            const href = link.getAttribute('href') || '';
            if (href === '#' || href.startsWith('javascript:') || href.includes('comment_id=')) continue;
            if (!href.includes('__cft__')) continue;
            const linkText = link.textContent.trim();
            // 短文字（1~10字元）且不含常見的非時間關鍵字
            if (linkText.length >= 1 && linkText.length <= 10 && !['加入', '社團', '留言', '分享', '讚', '按讚'].includes(linkText)) {
                try {
                    const url = new URL(href, 'https://www.facebook.com');
                    const path = url.pathname.replace(/\/$/, '');
                    const isGroupHome = groupId && path === `/groups/${groupId}`;
                    const isUserInGroup = path.includes('/user/');
                    if (!isGroupHome && !isUserInGroup) {
                        if (groupId) {
                            console.log('[FB篩選器] 🔗 透過短文字連結找到貼文:', linkText, href);
                            return `https://www.facebook.com/groups/${groupId}/`;
                        }
                        return cleanUrl(url);
                    }
                } catch { }
            }
        }

        // 全部失敗 — 輸出偵錯日誌方便找原因
        console.warn('[FB篩選器] ⚠️ 無法找到貼文連結！此貼文所有連結：',
            allLinks.map(l => l.getAttribute('href')).filter(h => h && h !== '#')
        );

        try {
            const url = new URL(fallbackHref, 'https://www.facebook.com');
            return cleanUrl(url);
        } catch { }
        return fallbackHref;
    }

    // 提取社團名稱
    function extractGroupName(postEl) {
        // 社團名稱通常在連結的文字中
        const groupLinks = postEl.querySelectorAll('a[href*="/groups/"]');
        for (const link of groupLinks) {
            const text = link.textContent.trim();
            // 社團名稱通常比較長，排除「加入」等按鈕文字
            if (text.length > 2 && !['加入', '社團', '留言', '分享'].includes(text)) {
                return text;
            }
        }
        return '';
    }

    // ===== 監聽新內容 =====
    function startObserving() {
        if (observer) observer.disconnect();

        const mainContent = document.querySelector('[role="main"]') || document.body;
        console.log('[FB篩選器] 監聽容器:', mainContent.getAttribute('role') || mainContent.tagName);

        observer = new MutationObserver(() => {
            if (!filterEnabled) return;
            // 有 DOM 變動時重新掃描
            scanAndFilter();
        });

        observer.observe(mainContent, { childList: true, subtree: true });
    }

    // ===== 浮動按鈕 =====
    function createFloatingButton() {
        if (floatingBtn) return;

        floatingBtn = document.createElement('div');
        floatingBtn.id = 'fb-filter-floating-btn';

        const container = document.createElement('div');
        container.id = 'fb-filter-container';

        floatingBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
        <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>
      </svg>
      <span class="fb-filter-badge" id="fb-filter-badge">${allowedGroups.length}</span>
    `;

        const panel = document.createElement('div');
        panel.id = 'fb-filter-panel';
        panel.innerHTML = `
      <div class="fb-filter-panel-header">社團篩選器</div>
      <div class="fb-filter-panel-stats" id="fb-filter-stats">
        追蹤 ${allowedGroups.length} 個社團
      </div>
      <div class="fb-filter-panel-debug" id="fb-filter-debug" style="font-size:11px;color:#888;padding:6px 0;border-bottom:1px solid #3A3B3C;margin-bottom:8px;font-family:monospace;">
        載入中...
      </div>
      <div class="fb-filter-panel-actions">
        <button id="fb-filter-goto-feed" class="fb-filter-panel-btn fb-filter-panel-btn-primary">
          📋 前往社團動態（已篩選）
        </button>
        <button id="fb-filter-toggle" class="fb-filter-panel-btn">
          ${filterEnabled ? '🔴 關閉過濾' : '🟢 開啟過濾'}
        </button>
        <button id="fb-filter-open-all" class="fb-filter-panel-btn">
          📂 全部開啟（各分頁）
        </button>
        <button id="fb-filter-clear-sent" class="fb-filter-panel-btn" style="color:#FF6B6B;border-color:#FF6B6B;">
          🗑️ 清除已發送記錄
        </button>
      </div>
    `;

        container.appendChild(floatingBtn);
        container.appendChild(panel);

        floatingBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.toggle('show');
        });

        document.addEventListener('click', () => {
            panel.classList.remove('show');
        });

        panel.addEventListener('click', (e) => e.stopPropagation());

        document.body.appendChild(container);

        setTimeout(() => {
            document.getElementById('fb-filter-goto-feed').addEventListener('click', () => {
                window.location.href = 'https://www.facebook.com/?filter=groups&sk=h_chr';
                panel.classList.remove('show');
            });

            document.getElementById('fb-filter-toggle').addEventListener('click', async () => {
                filterEnabled = !filterEnabled;
                await chrome.storage.sync.set({ filterEnabled });
                if (filterEnabled) {
                    startFiltering();
                } else {
                    stopFiltering();
                }
                updateFloatingButton();
                panel.classList.remove('show');
            });

            document.getElementById('fb-filter-open-all').addEventListener('click', () => {
                chrome.runtime.sendMessage({ action: 'openAllGroups' });
                panel.classList.remove('show');
            });

            document.getElementById('fb-filter-clear-sent').addEventListener('click', async () => {
                await chrome.storage.local.set({ sentPosts: {} });
                console.log('[FB篩選器] 🗑️ 已清除所有發送記錄');
                alert('✅ 已清除所有發送記錄！\n下次掃描到的貼文會重新發送到 Discord。');
                panel.classList.remove('show');
            });
        }, 100);

        updateFloatingButton();
    }

    function updateFloatingButton() {
        if (!floatingBtn) return;

        const badge = document.getElementById('fb-filter-badge');
        if (badge) badge.textContent = allowedGroups.length;

        if (filterEnabled) {
            floatingBtn.classList.add('active');
        } else {
            floatingBtn.classList.remove('active');
        }

        // 診斷
        const debugEl = document.getElementById('fb-filter-debug');
        if (debugEl) {
            const linkCount = document.querySelectorAll('a[href*="/groups/"]').length;
            debugEl.innerHTML = [
                `過濾: ${filterEnabled ? '✅ 開' : '❌ 關'} | 刷新: ${autoRefreshEnabled ? '✅ 開' : '❌ 關'}`,
                `滾動: ${autoScrollEnabled ? '✅ 開' : '❌ 關'} | 發送: ${autoSendEnabled ? '✅ 開' : '❌ 關'}`,
                `社團數: ${allowedGroups.length} | 頁面連結: ${linkCount} 個`,
                `顯示: ${shownCount} / 隱藏: ${hiddenCount}`,
            ].join('<br>');
        }

        const stats = document.getElementById('fb-filter-stats');
        if (stats) {
            if (filterEnabled && (shownCount > 0 || hiddenCount > 0)) {
                stats.textContent = `顯示 ${shownCount} 則 ／ 隱藏 ${hiddenCount} 則`;
            } else {
                stats.textContent = `追蹤 ${allowedGroups.length} 個社團`;
            }
        }

        const toggleBtn = document.getElementById('fb-filter-toggle');
        if (toggleBtn) {
            toggleBtn.textContent = filterEnabled ? '🔴 關閉過濾' : '🟢 開啟過濾';
        }
    }

    // ===== 工具 =====
    function extractGroupIdFromUrl(url) {
        try {
            const urlObj = new URL(url);
            const parts = urlObj.pathname.split('/').filter(Boolean);
            const idx = parts.indexOf('groups');
            if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
        } catch { }
        return '';
    }

    // ===== 啟動 =====
    // 只在社團動態牆頁面運行
    const params = new URLSearchParams(window.location.search);
    const isGroupFeed = params.get('filter') === 'groups' && params.get('sk') === 'h_chr';

    if (!isGroupFeed) {
        console.log('[FB篩選器] 非社團動態牆頁面，跳過執行', window.location.href);
        return;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
