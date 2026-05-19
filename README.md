# 📢 FB 社團篩選器 | Facebook Group Filter Chrome Extension

<p align="center">
  <img src="icons/icon128.png" width="128" height="128" alt="FB 社團篩選器 Icon" />
</p>

<p align="center">
  <strong>只看你想看的 Facebook 社團貼文，支援時間排序，並可即時自動轉傳至 Discord！</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue?style=flat-square" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/Platform-Chrome%20%7C%20Edge-lightgrey?style=flat-square" alt="Platform Support" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License" />
</p>

---

## 🌟 核心特點

*   **🔍 精準動態過濾**：自動掃描 Facebook 動態牆，只保留您設定的特定社團（白名單），並為其加上精緻的藍色邊框，其餘不感興趣的社團貼文會直接使用 CSS 強力隱藏。
*   **⏰ 真正時間排序**：一鍵前往並固定在 Facebook 官方的「最新社團動態」頁面，擺脫演算法控制。
*   **🔽 自動展開「查看更多」**：對於篩選保留下來的優質貼文，程式會自動模擬點擊將其長內文完整展開。
*   **⬇️ 智慧無感自動加載**：由於大量貼文被過濾隱藏，網頁容易出現空白。程式會在背景偵測並輕微滾動 1px（對人眼無感），主動觸發 Facebook 的 React/DOM 機制往下加載更多貼文。
*   **🔄 定時自動刷新與滾動**：支援「自動滾動」與「定時重新整理（如每 30 秒）」，實現無人值守掛機監控。
*   **📨 Discord 自動轉傳**：支援配置 Discord Webhook 網址，自動將篩選出的允許貼文發送至指定的 Discord 頻道。
*   **🔔 關鍵字高亮與強提醒**：可自訂敏感關鍵字。當貼文內容命中關鍵字時，Discord 發送時會附帶 `@everyone` 提標，且訊息卡片以亮橘色 (0xFF4500) 警示呈現。
*   **🔒 隱私與安全第一**：採用符合現代安全規範的設計，拒絕將任何 Webhook URL 硬編碼在程式中。所有設定均安全地儲存在您的瀏覽器本地空間（`chrome.storage.sync`），且設定欄位採用密碼隱碼設計，支援一鍵隱藏與顯示，防止意外洩漏。

---

## 📸 介面設計

本擴充功能提供兩種配置介面：

1.  **Popup 懸浮小視窗**：點擊瀏覽器右上角圖示，即可快速開關過濾、自動滾動、自動刷新、自動發送 Discord，並支援快速新增社團與關鍵字。
2.  **Dashboard 後台儀表板**：大畫面、極具科技感的暗黑系管理介面，方便您集中管理追蹤的社團清單與配置核心設定。

---

## 🛠️ 安裝教學

1.  下載本專案代碼，並將其解壓縮至您的電腦中。
2.  打開 **Google Chrome** 瀏覽器，在網址列輸入 `chrome://extensions/` 並進入。
3.  將右上角的 **「開發人員模式 (Developer mode)」** 切換為開啟。
4.  點擊左上角的 **「載入未封裝項目 (Load unpacked)」** 按鈕。
5.  選擇本專案解壓縮後的資料夾，即可完成安裝！

---

## 📖 使用指南

### 1. 新增社團
將想要追蹤的 Facebook 社團網址（例如：`https://www.facebook.com/groups/xxxxx`）複製，貼入 Popup 視窗或 Dashboard 儀表板中的輸入框，點擊「新增社團」即可加入白名單。

### 2. 配置 Discord Webhook 與轉傳
1. 在您的 Discord 伺服器頻道中建立一個 Webhook，並複製其 URL。
2. 開啟本擴充功能的設定面板，在 **「Discord Webhook 網址」** 欄位貼上 URL（支援點擊 👁️ 圖示隱藏/顯示該網址）。
3. 勾選 **「自動發送 Discord」** 開關。
4. （選填）在 **「關鍵字提醒」** 欄位中輸入您想監控的主題，多個關鍵字請使用英文分號 `;` 隔開。

### 3. 開始過濾
點擊面板上的 **「📋 前往社團動態（已篩選）」** 按鈕，即可進入過濾後的 FB 動態牆頁面，此時畫面右下角會出現一個半透明的圓形懸浮按鈕，點擊可即時開關過濾器與檢視篩選統計。

---

## 📁 專案檔案架構

```text
├── manifest.json       # 擴充功能配置文件 (Manifest V3)
├── background.js       # 後台 Service Worker (處理 Discord 發送與跨頁面任務)
├── content.js          # 注入 Facebook 頁面的核心過濾與加載邏輯
├── content.css         # 控制貼文隱藏與懸浮按鈕的樣式
├── popup.html/css/js   # 右上角設定彈出視窗的 UI 與邏輯
├── dashboard.html/css/js # 後台儀表板的管理介面與邏輯
└── icons/              # 經過特別壓縮與尺寸最佳化的圖標集 (16x16, 48x48, 128x128)
```

---

## 📜 許可證

本專案基於 **MIT License** 開源。您可以自由地進行修改、二次開發與分發。
