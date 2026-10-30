/*
 * 微信读书 · 书房｜启动与生命周期
 *
 * 这是唯一负责「什么时候挂载、什么时候拆掉」的地方，其它模块只管自己那一块。
 *
 * 关键决策：
 * 1. 站点是 SPA，地址变了但页面不刷新。content script 跑在隔离世界（isolated world），
 *    在这里给 history.pushState 打补丁改不到页面自己的调用，所以不靠它。
 *    只用三件可靠手段：location 轮询、popstate、MutationObserver（DOM 是共享的）。
 * 2. 所有挂载都做幂等检查（宿主节点是否还在文档里），避免重复叠加。
 * 3. 关掉开关时调用 teardown：移除主题属性、卸载 UI、撤掉色温层，把页面还给站点。
 */
(function () {
  'use strict';

  var RK = window.__RK__;
  if (!RK) return;

  var settings = null;
  var data = null;
  var lastUrl = location.href;
  var lastPage = '';
  var observer = null;
  var pollTimer = null;

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function loadState() {
    return Promise.all([RK.getSettings(), RK.getData()]).then(function (res) {
      settings = res[0];
      data = res[1];
      return res;
    });
  }

  function teardown() {
    try {
      RK.theme.remove();
    } catch (e) {}
    if (RK.desk) RK.desk.unmount();
    if (RK.wing) RK.wing.unmount();
    if (RK.dock) RK.dock.unmount();
    if (RK.reader) RK.reader.apply({ enabled: false });
  }

  function applyTheme() {
    if (!settings) return;
    if (settings.enabled) RK.theme.apply(settings);
    else RK.theme.remove();
  }

  // 按页面类型决定挂什么
  function mountForPage() {
    if (!settings || !settings.enabled) {
      teardown();
      lastPage = '';
      return;
    }

    var page = RK.adapter.detectPage();

    if (page !== lastPage) {
      // 换页了：先把上一页的 UI 收掉，避免首页书桌留在阅读器上
      if (RK.desk) RK.desk.unmount();
      if (RK.wing) RK.wing.unmount();
      lastPage = page;
    }

    if (page === 'home' && settings.showDesk) {
      var host = RK.adapter.deskHost();
      if (host) RK.desk.mount(settings, data);
    } else if (RK.desk) {
      RK.desk.unmount();
    }

    // 主题专属区跟书桌同页挂载，但开关独立（deskModules.wing*），书桌关了它还能在
    if (page === 'home' && RK.wing) {
      RK.wing.mount(settings, data);
    }

    if (page !== 'other' && settings.showDock) {
      RK.dock.mount(settings, data);
    }

    if (RK.reader) RK.reader.apply(settings);
  }

  function sync(force) {
    if (!settings) return;
    var changed = location.href !== lastUrl;
    if (!changed && !force) {
      // 地址没变，但可能是首次渲染完成，只补挂缺失的组件
      if (settings.enabled && settings.showDock && RK.dock && !RK.dock.mounted) {
        RK.dock.mount(settings, data);
      }
      if (settings.enabled && settings.showDesk && RK.adapter.detectPage() === 'home' && RK.desk && !RK.desk.mounted) {
        if (RK.adapter.deskHost()) RK.desk.mount(settings, data);
      }
      if (
        settings.enabled &&
        RK.adapter.detectPage() === 'home' &&
        RK.wing && !RK.wing.mounted &&
        RK.adapter.deskHost()
      ) {
        RK.wing.mount(settings, data);
      }
      return;
    }
    lastUrl = location.href;
    mountForPage();
  }

  var throttledSync = RK.throttle(function () {
    sync(false);
  }, 900);

  /* ---------------- 变更响应 ---------------- */

  RK.bus.on('settings:changed', function (next) {
    settings = next;
    applyTheme();
    mountForPage();
    if (RK.dock) RK.dock.sync(settings, data);
  });

  RK.bus.on('data:changed', function () {
    RK.getData().then(function (fresh) {
      data = fresh;
      if (RK.desk && RK.desk.mounted) RK.desk.refresh(settings, data);
      if (RK.wing && RK.wing.mounted) RK.wing.refresh(settings, data);
      if (RK.dock) RK.dock.sync(settings, data);
    });
  });

  // 其它扩展页面（设置页/弹窗）改了设置，这里要跟上
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes[RK.SETTINGS_KEY] || changes[RK.DATA_KEY]) {
      loadState().then(function () {
        applyTheme();
        mountForPage();
        if (RK.dock) RK.dock.sync(settings, data);
        if (RK.desk && RK.desk.mounted) RK.desk.refresh(settings, data);
        if (RK.wing && RK.wing.mounted) RK.wing.refresh(settings, data);
      });
    }
  });

  // 弹窗/设置页来问诊断信息
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    if (msg.type === 'rk:diag') {
      sendResponse({
        ok: true,
        report: RK.adapter ? RK.adapter.report() : null,
        settings: settings,
        version: RK.VERSION
      });
      return true;
    }
    if (msg.type === 'rk:apply-settings') {
      loadState().then(function () {
        applyTheme();
        mountForPage();
        sendResponse({ ok: true });
      });
      return true;
    }
  });

  /* ---------------- SPA 导航探测 ---------------- */

  function watchNavigation() {
    window.addEventListener('popstate', function () {
      setTimeout(function () { sync(true); }, 80);
    });
    window.addEventListener('hashchange', throttledSync);

    // 兜底：轻量轮询地址（SPA 推入历史不一定有事件）
    pollTimer = setInterval(function () {
      if (location.href !== lastUrl) sync(true);
    }, 1500);

    // 客户端渲染完成时，锚点可能还不存在，靠 DOM 变化补挂
    observer = new MutationObserver(function () {
      throttledSync();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  ready(function () {
    loadState().then(function () {
      applyTheme();
      mountForPage();
      watchNavigation();
      RK.log('已启动，页面类型：', RK.adapter.detectPage());
    });
  });
})();
