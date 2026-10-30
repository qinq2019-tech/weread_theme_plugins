/*
 * 微信读书 · 书房｜阅读器增强
 *
 * 三件事，都刻意做得很克制：
 * 1. 护眼色温：一层 pointer-events:none 的暖色叠加，不动正文节点。
 *    为什么不做字体/行距：线上阅读器正文可能是 canvas 绘制（2026-10-30 快照里
 *    阅读器 DOM 只有外壳，正文节点在客户端渲染后才出现），改字号风险高、收益低，
 *    所以只做不破坏排版的光学层。
 * 2. 沉浸：只对适配层命中到的工具栏候选元素加透明隐藏，命中不到就什么都不做。
 *    退出方式始终存在——右下角功能坞一直可见。
 * 3. 阅读记录：把当前书名/章节/进度记到本机，供首页书桌的「继续阅读」使用。
 *    只记录页面上已经显示的文字，不请求接口、不读取正文内容。
 */
(function () {
  'use strict';

  var RK = window.__RK__;
  if (!RK) return;

  var TONE_ID = 'rk-tone-layer';
  var toneEl = null;
  var hidden = [];
  var heartbeatTimer = null;
  var logTimer = null;
  var lastLogKey = '';

  /* ---------------- 护眼色温 ---------------- */

  function ensureToneLayer() {
    if (toneEl && document.contains(toneEl)) return toneEl;
    toneEl = document.getElementById(TONE_ID);
    if (toneEl) return toneEl;
    toneEl = document.createElement('div');
    toneEl.id = TONE_ID;
    toneEl.setAttribute('aria-hidden', 'true');
    toneEl.style.cssText = [
      'position:fixed', 'inset:0', 'pointer-events:none',
      'z-index:2147482000', 'mix-blend-mode:multiply',
      'background:rgb(255,206,150)', 'opacity:0',
      'transition:opacity .25s ease'
    ].join(';');
    (document.body || document.documentElement).appendChild(toneEl);
    return toneEl;
  }

  function applyTone(value) {
    var v = Math.max(0, Math.min(100, Number(value) || 0));
    if (v === 0) {
      if (toneEl && toneEl.parentNode) toneEl.parentNode.removeChild(toneEl);
      toneEl = null;
      return;
    }
    var layer = ensureToneLayer();
    // 浅色面用 multiply 压暖；深色面用 multiply 会越压越暗，改成低透明度叠加，
    // 否则「护眼」变成「更暗」。
    var root = document.documentElement;
    var dark = root.getAttribute('data-rk-mode') === 'dark' ||
      root.getAttribute('data-rk-site-mode') === 'dark';
    if (dark) {
      layer.style.mixBlendMode = 'normal';
      layer.style.background = 'rgb(255,168,86)';
      layer.style.opacity = String((v / 100) * 0.13);
    } else {
      layer.style.mixBlendMode = 'multiply';
      layer.style.background = 'rgb(255,206,150)';
      // 最高只到 0.34，再高会让正文对比度不够
      layer.style.opacity = String((v / 100) * 0.34);
    }
  }

  /* ---------------- 沉浸模式 ---------------- */

  function applyImmersive(on) {
    hidden.forEach(function (node) {
      if (node && node.removeAttribute) node.removeAttribute('data-rk-imm');
    });
    hidden = [];
    if (!on) {
      document.documentElement.removeAttribute('data-rk-immersive');
      return;
    }
    document.documentElement.setAttribute('data-rk-immersive', '1');
    var targets = RK.adapter.immersiveTargets();
    targets.forEach(function (node) {
      if (!node || node.hasAttribute('data-rk-dock')) return;
      if (node.id === TONE_ID) return;
      node.setAttribute('data-rk-imm', '1');
      hidden.push(node);
    });
    if (!targets.length) {
      RK.log('沉浸模式：未命中顶/底栏候选元素，只保留滚动条与色温效果');
    }
  }

  /* ---------------- 阅读记录 ---------------- */

  function recordReading(force) {
    if (!RK.adapter || RK.adapter.detectPage() !== 'reader') return;
    if (document.visibilityState === 'hidden') return;

    var info = RK.adapter.readChapterInfo();
    if (!info) return;

    var key = info.book + '|' + info.chapter + '|' + info.href;
    if (!force && key === lastLogKey) return;
    lastLogKey = key;

    RK.getData().then(function (data) {
      var log = data.log || [];
      var idx = -1;
      for (var i = log.length - 1; i >= 0; i--) {
        if (log[i].book === info.book) {
          idx = i;
          break;
        }
      }
      var entry = {
        book: info.book,
        author: info.author || '',
        chapter: info.chapter,
        progress: info.progress,
        href: info.href,
        at: Date.now()
      };
      if (idx >= 0) log[idx] = entry;
      else log.push(entry);
      // 只留最近 100 本，避免无上限增长
      if (log.length > 100) log = log.slice(log.length - 100);
      return RK.saveData({ log: log });
    }).then(function () {
      RK.bus.emit('data:changed');
    });
  }

  /* ---------------- 阅读时长心跳 ----------------
   * 真正的累加在 service worker 里做（跨标签页去重、防 SW 回收丢状态）。
   * 这里只负责「我还在这页读着」这一件事。
   */

  function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(function () {
      if (document.visibilityState !== 'visible') return;
      try {
        chrome.runtime.sendMessage({ type: 'rk:activity', seconds: 30 });
      } catch (e) {
        // 扩展被重载时 sendMessage 会抛，忽略即可
      }
    }, 30000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  /* ---------------- 生命周期 ---------------- */

  function apply(settings) {
    var page = RK.adapter ? RK.adapter.detectPage() : 'other';
    if (page !== 'reader' || !settings.enabled) {
      applyTone(0);
      applyImmersive(false);
      stopHeartbeat();
      if (logTimer) {
        clearTimeout(logTimer);
        logTimer = null;
      }
      return;
    }

    applyTone(settings.readerTone || 0);
    applyImmersive(!!settings.immersive);

    if (settings.logReading) {
      startHeartbeat();
      if (logTimer) clearTimeout(logTimer);
      // 等待阅读器把书名/章节渲染出来，再记一次
      logTimer = setTimeout(function () {
        recordReading(true);
      }, 2500);
    } else {
      stopHeartbeat();
    }
  }

  RK.reader = {
    apply: apply,
    tone: applyTone,
    immersive: applyImmersive,
    record: recordReading
  };

  RK.bus.on('reader:tone', function (v) {
    applyTone(v);
  });

  // 页面隐藏时停止心跳，回来再续上
  document.addEventListener('visibilitychange', function () {
    if (!RK.reader) return;
    if (document.visibilityState === 'visible') {
      RK.getSettings().then(function (s) {
        RK.reader.apply(s);
      });
    } else {
      stopHeartbeat();
    }
  });
})();
