/*
 * 微信读书 · 书房｜弹窗
 *
 * 两件事：一键开关/换主题；以及「页面适配诊断」——告诉用户这次到底匹配到了什么。
 * 诊断放在弹窗而不是设置页，是因为弹窗打开时当前标签页就是微信读书，
 * 可以直接向内容脚本要状态；设置页是独立标签页，问不到目标页面。
 */
(function () {
  'use strict';

  var P = window.RK_PALETTE;
  var DEFAULTS = window.RK_DEFAULTS;
  var KEY = 'rk:settings';
  var settings = null;

  function $(id) {
    return document.getElementById(id);
  }

  function load() {
    return new Promise(function (resolve) {
      chrome.storage.local.get([KEY], function (res) {
        var raw = res ? res[KEY] : null;
        settings = Object.assign({}, DEFAULTS, raw || {});
        resolve();
      });
    });
  }

  function save(patch) {
    settings = Object.assign({}, settings, patch);
    var payload = {};
    payload[KEY] = settings;
    chrome.storage.local.set(payload, function () {
      render();
      notifyTab();
    });
  }

  // 通知内容脚本立刻重算，不用等页面刷新
  function notifyTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || !tab.id) return;
      chrome.tabs.sendMessage(tab.id, { type: 'rk:apply-settings' }, function () {
        // 目标页没有内容脚本时会有 lastError，忽略即可
        void chrome.runtime.lastError;
      });
    });
  }

  function renderThemes() {
    var box = $('themes');
    box.textContent = '';
    P.themeList.forEach(function (id) {
      var theme = P.THEMES[id];
      var strip = document.createElement('div');
      strip.className = 'strip';
      P.swatch(id, 'light').forEach(function (c) {
        var i = document.createElement('i');
        i.style.background = c;
        strip.appendChild(i);
      });
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theme';
      btn.setAttribute('data-active', String(settings.theme === id));
      btn.title = theme.desc;
      var label = document.createElement('span');
      label.textContent = theme.name;
      btn.appendChild(strip);
      btn.appendChild(label);
      btn.addEventListener('click', function () {
        save({ theme: id });
      });
      box.appendChild(btn);
    });
  }

  function render() {
    var power = $('power');
    power.setAttribute('data-on', settings.enabled ? '1' : '0');
    power.setAttribute('aria-checked', settings.enabled ? 'true' : 'false');
    renderThemes();
  }

  function pageName(page) {
    return { home: '首页', shelf: '书架', reader: '阅读器', other: '其它页面' }[page] || page || '未知';
  }

  function showDiag(report, errorText) {
    var box = $('diag');
    box.textContent = '';

    if (errorText) {
      var p = document.createElement('span');
      p.textContent = errorText;
      box.appendChild(p);
      return;
    }
    if (!report) {
      box.textContent = '没有拿到诊断信息。试着刷新一下微信读书页面。';
      return;
    }

    var lines = [
      ['页面', pageName(report.page)],
      ['内容区锚点', report.hostSelector || '未匹配'],
      ['页面封面节点', report.coverCount + ' 个'],
      ['书桌 / 功能坞', (report.mounted.desk ? '已挂载' : '未挂载') + ' / ' + (report.mounted.dock ? '已挂载' : '未挂载')],
      ['顶底栏候选', report.readerChromeCount + ' 个'],
      ['正文 canvas', report.canvasPresent ? '是（正文字体不强行改）' : '否']
    ];
    if (report.chapter) {
      lines.push(['当前书', report.chapter.book]);
      if (report.chapter.author) lines.push(['作者', report.chapter.author]);
      if (report.chapter.chapter) lines.push(['章节', report.chapter.chapter]);
    }

    lines.forEach(function (pair) {
      var row = document.createElement('div');
      var k = document.createElement('span');
      k.textContent = pair[0] + '：';
      var v = document.createElement('b');
      v.textContent = pair[1];
      row.appendChild(k);
      row.appendChild(v);
      box.appendChild(row);
    });
  }

  function check() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || !tab.url || tab.url.indexOf('weread.qq.com') < 0) {
        showDiag(null, '当前标签页不是微信读书。打开 weread.qq.com 后再检测。');
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'rk:diag' }, function (res) {
        if (chrome.runtime.lastError || !res) {
          showDiag(null, '页面还没加载扩展脚本。刷新页面后再试一次。');
          return;
        }
        showDiag(res.report);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    load().then(function () {
      render();
      $('ver').textContent = 'v0.1.0';
      $('power').addEventListener('click', function () {
        save({ enabled: !settings.enabled });
      });
      $('check').addEventListener('click', check);
      $('options').addEventListener('click', function () {
        chrome.runtime.openOptionsPage();
      });
      check();
    });
  });
})();
