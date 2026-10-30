/*
 * 微信读书 · 书房｜悬浮功能坞
 *
 * 一个 44px 的圆钮 + 展开面板，承载所有可调项：主题、明暗、字体、密度、
 * 阅读色温、沉浸开关、摘录录入、恢复原版。
 *
 * 关键决策：
 * 1. 固定定位 + 高 z-index + Shadow DOM：不参与站点布局，不会被站点样式吃掉。
 * 2. 所有变更立即落 chrome.storage.local，并广播 settings:changed，
 *    由 60-boot 统一重算主题和组件，避免每个控件各自改样式而导致状态不一致。
 * 3. 摘录只存本地，输入内容一律走 textContent/textarea.value，不拼 HTML。
 */
(function () {
  'use strict';

  var RK = window.__RK__;
  if (!RK) return;

  var HOST_ATTR = 'data-rk-dock';
  var hostEl = null;
  var shadow = null;
  var panelOpen = false;
  var toastTimer = null;
  var state = { settings: null, data: null };

  var ICONS = {
    dock:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M4 5.5h6.5A2.5 2.5 0 0 1 13 8v11a2 2 0 0 0-2-2H4z"></path>' +
      '<path d="M20 5.5h-4.5A2.5 2.5 0 0 0 13 8v11a2 2 0 0 1 2-2h5z"></path></svg>',
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' +
      '<path d="M6 6l12 12M18 6L6 18"></path></svg>'
  };

  function toast(text) {
    if (!shadow) return;
    var el = shadow.querySelector('.rk-toast');
    if (!el) {
      el = RK.h('div', { class: 'rk-toast', attrs: { role: 'status' } });
      shadow.appendChild(el);
    }
    el.textContent = text;
    el.setAttribute('data-show', '1');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.setAttribute('data-show', '0');
    }, 1800);
  }

  function commit(patch, message) {
    return RK.saveSettings(patch).then(function (next) {
      state.settings = next;
      RK.bus.emit('settings:changed', next);
      render();
      if (message) toast(message);
      return next;
    });
  }

  function sectionLabel(text) {
    return RK.h('span', { class: 'rk-label', text: text });
  }

  function seg(options, activeValue, onPick) {
    var wrap = RK.h('div', { class: 'rk-seg' });
    options.forEach(function (opt) {
      var btn = RK.h('button', {
        text: opt.name,
        attrs: { type: 'button', 'data-active': String(opt.value === activeValue) },
        on: {
          click: function () {
            onPick(opt.value);
          }
        }
      });
      wrap.appendChild(btn);
    });
    return wrap;
  }

  function switchRow(label, on, onToggle) {
    var sw = RK.h('div', {
      class: 'rk-switch',
      attrs: { 'data-on': on ? '1' : '0', role: 'switch', tabindex: '0', 'aria-checked': on ? 'true' : 'false' }
    }, [RK.h('i')]);
    var row = RK.h('div', { class: 'rk-toggle' }, [RK.h('span', { text: label }), sw]);
    var toggle = function () {
      onToggle(!on);
    };
    sw.addEventListener('click', toggle);
    sw.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
    return row;
  }

  function themeSection(s) {
    var wrap = RK.h('div', { class: 'rk-section' });
    wrap.appendChild(sectionLabel('主题'));
    var row = RK.h('div', { class: 'rk-row' });
    var P = window.RK_PALETTE;
    P.themeList.forEach(function (id) {
      var theme = P.THEMES[id];
      var sw = RK.h('div', { class: 'rk-swatch' });
      P.swatch(id, RK.theme.current ? RK.theme.current.mode : 'light').forEach(function (color) {
        sw.appendChild(RK.h('i', { style: { background: color } }));
      });
      row.appendChild(RK.h('button', {
        class: 'rk-theme',
        attrs: { type: 'button', 'data-active': String(s.theme === id), title: theme.desc },
        on: {
          click: function () {
            commit({ theme: id }, '已切换到「' + theme.name + '」');
          }
        }
      }, [sw, RK.h('span', { class: 'rk-theme-name', text: theme.name })]));
    });
    wrap.appendChild(row);
    return wrap;
  }

  function buildPanel() {
    var s = state.settings || RK.DEFAULTS;
    var P = window.RK_PALETTE;
    var page = RK.adapter ? RK.adapter.detectPage() : 'other';
    var panel = RK.h('div', { class: 'rk-scope rk-panel', attrs: { role: 'dialog', 'aria-label': '书房设置' } });

    // 头部
    var head = RK.h('div', { class: 'rk-panel-head' }, [
      RK.h('div', { class: 'rk-panel-title', text: '书房' }),
      RK.h('button', {
        class: 'rk-x',
        attrs: { type: 'button', 'aria-label': '收起' },
        on: { click: closePanel }
      })
    ]);
    head.lastChild.innerHTML = ICONS.close;
    panel.appendChild(head);

    // 主题
    panel.appendChild(themeSection(s));

    // 明暗
    var modeWrap = RK.h('div', { class: 'rk-section' });
    modeWrap.appendChild(sectionLabel('明暗'));
    modeWrap.appendChild(seg([
      { name: '跟随系统', value: 'auto' },
      { name: '浅色', value: 'light' },
      { name: '深色', value: 'dark' }
    ], s.mode, function (v) {
      commit({ mode: v });
    }));
    panel.appendChild(modeWrap);

    // 字体 + 密度
    var typeWrap = RK.h('div', { class: 'rk-section' });
    typeWrap.appendChild(sectionLabel('字体'));
    typeWrap.appendChild(seg(
      P.themeList ? Object.keys(P.FONTS).map(function (k) {
        return { name: P.FONTS[k].name, value: k };
      }) : [],
      s.fontPreset,
      function (v) {
        commit({ fontPreset: v });
      }
    ));
    typeWrap.appendChild(RK.h('div', { style: { height: '8px' } }));
    typeWrap.appendChild(seg([
      { name: '紧凑', value: 'compact' },
      { name: '适中', value: 'comfortable' },
      { name: '宽松', value: 'spacious' }
    ], s.density, function (v) {
      commit({ density: v });
    }));
    panel.appendChild(typeWrap);

    // 页面开关
    var toggleWrap = RK.h('div', { class: 'rk-section' });
    toggleWrap.appendChild(sectionLabel('显示内容'));
    toggleWrap.appendChild(switchRow('首页书桌', s.showDesk, function (v) {
      commit({ showDesk: v });
    }));
    toggleWrap.appendChild(switchRow('记录阅读时长', s.logReading, function (v) {
      commit({ logReading: v });
    }));
    panel.appendChild(toggleWrap);

    // 阅读器专项
    if (page === 'reader') {
      var readerWrap = RK.h('div', { class: 'rk-section' });
      readerWrap.appendChild(sectionLabel('阅读器'));

      var range = RK.h('input', {
        class: 'rk-range',
        attrs: { type: 'range', min: '0', max: '100', step: '5', value: String(s.readerTone || 0), 'aria-label': '护眼色温' }
      });
      range.addEventListener('input', function () {
        RK.bus.emit('reader:tone', Number(range.value));
      });
      range.addEventListener('change', function () {
        commit({ readerTone: Number(range.value) });
      });
      readerWrap.appendChild(RK.h('div', { class: 'rk-mini', text: '护眼色温' }));
      readerWrap.appendChild(range);
      readerWrap.appendChild(switchRow('沉浸阅读', s.immersive, function (v) {
        commit({ immersive: v });
      }));
      panel.appendChild(readerWrap);
    }

    // 摘录
    var quoteWrap = RK.h('div', { class: 'rk-section' });
    quoteWrap.appendChild(sectionLabel('留一句摘录'));
    var textarea = RK.h('textarea', {
      class: 'rk-note',
      attrs: { placeholder: '记下一句想留住的句子，或此刻的想法…', id: 'rk-quote-input' }
    });
    var save = RK.h('button', {
      class: 'rk-btn',
      text: '收进书桌',
      attrs: { type: 'button' },
      on: {
        click: function () {
          var text = (textarea.value || '').trim();
          if (!text) {
            toast('先写点什么');
            return;
          }
          var chapter = page === 'reader' ? RK.adapter.readChapterInfo() : null;
          RK.getData().then(function (data) {
            var quotes = data.quotes || [];
            quotes.push({
              id: RK.uid(),
              text: text,
              book: '',
              source: chapter && chapter.book ? chapter.book : '',
              at: Date.now()
            });
            var capped = false;
            // 只保留最近 200 条，避免无上限增长；到顶时当场告知，别让用户事后才发现少了
            if (quotes.length > 200) {
              quotes = quotes.slice(quotes.length - 200);
              capped = true;
            }
            return RK.saveData({ quotes: quotes }).then(function () {
              return capped;
            });
          }).then(function (capped) {
            textarea.value = '';
            toast(capped ? '已收进书桌 · 已到 200 条上限，最旧的一条被挤掉' : '已收进书桌');
            RK.bus.emit('data:changed');
          });
        }
      }
    });
    quoteWrap.appendChild(textarea);
    var actions = RK.h('div', { style: { display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-top': '8px' } });
    // 左侧：去设置页管理（编辑/归档/导出）。主操作「收进书桌」留在右下角发射位
    actions.appendChild(RK.h('button', {
      class: 'rk-link',
      text: '管理摘录',
      attrs: { type: 'button', title: '在设置页编辑、按书归档与导出摘录' },
      on: {
        click: function () {
          try {
            chrome.runtime.sendMessage({ type: 'rk:open-options', hash: 'quotes' });
          } catch (e) {}
        }
      }
    }));
    actions.appendChild(save);
    quoteWrap.appendChild(actions);
    panel.appendChild(quoteWrap);

    // 底部
    var foot = RK.h('div', { class: 'rk-foot' });
    foot.appendChild(RK.h('button', {
      class: 'rk-link',
      text: '更多设置',
      attrs: { type: 'button' },
      on: {
        click: function () {
          chrome.runtime.sendMessage({ type: 'rk:open-options' });
        }
      }
    }));
    foot.appendChild(RK.h('button', {
      class: 'rk-link',
      text: '恢复原版',
      attrs: { type: 'button', title: '关闭扩展的一切改动，页面回到微信读书原样' },
      on: {
        click: function () {
          commit({ enabled: false }, '已恢复原版，可在扩展弹窗重新开启');
          closePanel();
        }
      }
    }));
    panel.appendChild(foot);

    return panel;
  }

  function render() {
    if (!shadow) return;
    var old = shadow.querySelector('.rk-panel');
    var next = buildPanel();
    if (old) shadow.replaceChild(next, old);
    else shadow.appendChild(next);
  }

  function openPanel(focus) {
    if (!hostEl) return;
    panelOpen = true;
    hostEl.style.display = 'block';
    render();
    if (focus === 'quote') {
      var ta = shadow.querySelector('#rk-quote-input');
      if (ta) setTimeout(function () { ta.focus(); }, 60);
    }
  }

  function closePanel() {
    panelOpen = false;
    var panel = shadow && shadow.querySelector('.rk-panel');
    if (panel) panel.remove();
  }

  function buildShell() {
    var el = document.createElement('div');
    el.setAttribute(HOST_ATTR, '1');
    // 固定定位写内联：Shadow 内的选择器选不到宿主，靠样式表会变成普通流元素
    el.style.cssText =
      'position:fixed;right:18px;bottom:22px;z-index:2147483000;display:block;margin:0;padding:0;';
    shadow = el.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = RK.UI_CSS;
    shadow.appendChild(style);

    var fab = RK.h('button', {
      class: 'rk-scope rk-fab',
      attrs: { type: 'button', title: '微信读书 · 书房', 'aria-label': '打开书房' },
      on: {
        click: function () {
          if (panelOpen) closePanel();
          else openPanel();
        }
      }
    });
    fab.innerHTML = ICONS.dock;
    shadow.appendChild(fab);
    return el;
  }

  function mount(settings, data) {
    state.settings = settings;
    state.data = data;
    if (!settings.enabled || !settings.showDock) {
      unmount();
      return;
    }
    if (hostEl && document.contains(hostEl)) return;
    if (!RK.lock('dock')) return;

    hostEl = buildShell();
    (document.body || document.documentElement).appendChild(hostEl);
    RK.unlock('dock');
    RK.log('功能坞已挂载');
  }

  function unmount() {
    if (hostEl && hostEl.parentNode) hostEl.parentNode.removeChild(hostEl);
    hostEl = null;
    shadow = null;
    panelOpen = false;
  }

  function syncState(settings, data) {
    state.settings = settings;
    if (data) state.data = data;
    if (panelOpen) render();
  }

  RK.dock = {
    mount: mount,
    unmount: unmount,
    open: openPanel,
    close: closePanel,
    sync: syncState,
    toast: toast,
    get mounted() {
      return !!(hostEl && document.contains(hostEl));
    }
  };

  RK.bus.on('dock:open', function (payload) {
    openPanel(payload && payload.focus);
  });
})();
