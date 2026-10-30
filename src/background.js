/*
 * 微信读书 · 书房｜Service Worker
 *
 * 只干三件事：首次安装引导、阅读时长的跨标签聚合、打开设置页。
 *
 * 关键决策：
 * 1. MV3 的 service worker 随时可能被回收，全局变量不可靠。
 *    所以「这个标签页上次上报是什么时候」放在 chrome.storage.session，
 *    累计值放在 chrome.storage.local。SW 重启后行为完全一致。
 * 2. 累加放在这里而不是内容脚本：同一本书开两个标签页时，
 *    内容脚本各自累加会重复计时，SW 用 tabId 做键可以天然去重。
 * 3. 只接受来自本扩展、且页面是 weread 的上报，避免被其它页面伪造。
 */
'use strict';

const DATA_KEY = 'rk:data';
const TICK_ATTR = 'rk:lastTick:';
const MIN_GAP_MS = 25000; // 两次上报的最小间隔，低于这个值视为重复
const KEEP_DAYS = 120; // 统计只保留最近 120 天

function todayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

function readLocal(key, fallback) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (res) => {
      if (chrome.runtime.lastError || !res || res[key] === undefined) resolve(fallback);
      else resolve(res[key]);
    });
  });
}

function writeLocal(key, value) {
  return new Promise((resolve) => {
    const payload = {};
    payload[key] = value;
    chrome.storage.local.set(payload, () => resolve(value));
  });
}

function readSession(key) {
  return new Promise((resolve) => {
    try {
      chrome.storage.session.get([key], (res) => {
        if (chrome.runtime.lastError || !res) resolve(null);
        else resolve(res[key] === undefined ? null : res[key]);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function writeSession(key, value) {
  return new Promise((resolve) => {
    try {
      const payload = {};
      payload[key] = value;
      chrome.storage.session.set(payload, () => resolve(value));
    } catch (e) {
      resolve(null);
    }
  });
}

async function addActivity(tabId, seconds) {
  const tickKey = TICK_ATTR + tabId;
  const now = Date.now();
  const last = await readSession(tickKey);
  if (last && now - last < MIN_GAP_MS) return { skipped: true };
  await writeSession(tickKey, now);

  const data = await readLocal(DATA_KEY, { quotes: [], log: [], stats: {} });
  const stats = data.stats && typeof data.stats === 'object' ? data.stats : {};
  const key = todayKey();
  const rec = stats[key] || { seconds: 0 };
  rec.seconds = (rec.seconds || 0) + (Number(seconds) || 0);
  stats[key] = rec;

  // 顺手清理过期统计，避免无限增长
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  Object.keys(stats).forEach((k) => {
    const t = new Date(k + 'T00:00:00').getTime();
    if (!isNaN(t) && t < cutoff) delete stats[k];
  });

  data.stats = stats;
  await writeLocal(DATA_KEY, data);
  return { ok: true, seconds: rec.seconds };
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // 首次安装直接打开设置页，让用户先选一套主题再去看书
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'rk:open-options') {
    // 带 hash 时直达设置页对应卡片（如 #quotes 摘录管理）；chrome.tabs.create 无需权限
    if (msg.hash) {
      chrome.tabs.create({
        url: chrome.runtime.getURL('src/options/options.html') + '#' + msg.hash,
        active: true
      });
    } else {
      chrome.runtime.openOptionsPage();
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'rk:activity') {
    // 只认本扩展 + weread 页面的上报
    const fromSelf = sender && sender.id === chrome.runtime.id;
    const url = sender && sender.tab && sender.tab.url ? sender.tab.url : '';
    if (!fromSelf || url.indexOf('https://weread.qq.com/') !== 0) {
      sendResponse({ ok: false, reason: 'untrusted' });
      return true;
    }
    addActivity(sender.tab.id, msg.seconds)
      .then((res) => sendResponse(res))
      .catch(() => sendResponse({ ok: false }));
    return true; // 异步响应
  }
});
