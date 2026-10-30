/*
 * 微信读书 · 书房｜设置页逻辑
 *
 * 设置页自己就套用当前主题（所见即所得），改任何一项都立刻写 storage 并重绘预览。
 * 不写内联事件（MV3 的 CSP 默认禁止内联脚本），全部在这里绑定。
 */
(function () {
  'use strict';

  var P = window.RK_PALETTE;
  var DEFAULTS = window.RK_DEFAULTS;
  var EMPTY = window.RK_EMPTY_DATA;
  var SETTINGS_KEY = 'rk:settings';
  var DATA_KEY = 'rk:data';

  var settings = null;
  var data = null;
  var toastTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function toast(text) {
    var el = $('toast');
    el.textContent = text;
    el.setAttribute('data-show', '1');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.removeAttribute('data-show');
    }, 1800);
  }

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function deepMerge(base, patch) {
    var out = clone(base);
    if (!patch || typeof patch !== 'object') return out;
    Object.keys(patch).forEach(function (k) {
      var v = patch[k];
      if (v === undefined) return;
      var isObj = v && typeof v === 'object' && !Array.isArray(v);
      var baseIsObj = base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]);
      out[k] = isObj && baseIsObj ? deepMerge(base[k], v) : v;
    });
    return out;
  }

  function load() {
    return new Promise(function (resolve) {
      chrome.storage.local.get([SETTINGS_KEY, DATA_KEY], function (res) {
        settings = deepMerge(DEFAULTS, res ? res[SETTINGS_KEY] : null);
        data = deepMerge(EMPTY, res ? res[DATA_KEY] : null);
        resolve();
      });
    });
  }

  function save(patch) {
    settings = deepMerge(settings, patch);
    var payload = {};
    payload[SETTINGS_KEY] = settings;
    chrome.storage.local.set(payload, function () {
      applyPreview();
      render();
    });
  }

  /* ---------------- 摘录管理（docs/v0.2-design.md「交互规格」） ---------------- */

  var QK = window.RK_QUOTES;
  var ui = {
    view: 'book',            // 'book' | 'time'（不落存储，刷新回默认）
    editingId: null,         // 全局同一时刻只有一条在编辑
    expanded: {},            // 长摘录展开态（纯 UI，不落存储）
    undo: { entries: [], timer: null },  // 8 秒单一可累积撤销栈
    focusAfter: null,        // 重绘后的焦点落点
    editRefs: null           // 编辑态的三个控件引用
  };

  function validQuotes() {
    return (data.quotes || []).filter(function (q) {
      return q && typeof q.text === 'string' && q.text.trim();
    });
  }

  function persistData() {
    var payload = {};
    payload[DATA_KEY] = data;
    chrome.storage.local.set(payload, function () {});
  }

  // 读屏播报用的短描述；书名/日期必须走 displayBook/dateKeyOf，不许直读字段
  function describeQuote(q) {
    var name = QK.displayBook(q) || '未署名';
    var date = QK.dateKeyOf(q.at);
    return name + (date ? '，' + date : '');
  }

  function buildMeta(q) {
    var parts = [];
    var book = QK.displayBook(q);
    var src = QK.displaySource(q);
    var date = QK.dateKeyOf(q.at);
    if (book) parts.push(book);
    if (src) parts.push(src);
    if (date) parts.push(date);
    return parts.join(' · ');
  }

  // 测试接缝：tools/options-test.js 替换它来捕获导出内容
  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 2000);
  }
  window.__RK_OPTIONS__ = { downloadText: downloadText };

  function buildReadItem(q) {
    var li = document.createElement('li');
    li.className = 'quote-item' + (ui.expanded[q.id] ? ' is-expanded' : '');
    li.tabIndex = -1;
    li.setAttribute('data-id', q.id || '');

    var slip = document.createElement('div');
    slip.className = 'quote-slip';

    var text = document.createElement('div');
    text.className = 'quote-slip-text';
    text.textContent = q.text;
    slip.appendChild(text);

    var meta = buildMeta(q);
    if (meta) {
      var metaEl = document.createElement('div');
      metaEl.className = 'quote-slip-meta';
      metaEl.textContent = meta;
      slip.appendChild(metaEl);
    }

    // 超长摘录（>8 行）：展开/收起是纯 UI 态，导出永远是全文
    if (String(q.text).split('\n').length > 8) {
      var expanded = !!ui.expanded[q.id];
      var more = document.createElement('button');
      more.type = 'button';
      more.className = 'quote-more';
      more.textContent = expanded ? '收起' : '展开';
      more.setAttribute('aria-label', (expanded ? '收起全文：' : '展开全文：') + describeQuote(q));
      more.addEventListener('click', function () {
        if (ui.expanded[q.id]) delete ui.expanded[q.id];
        else ui.expanded[q.id] = true;
        renderQuotes();
      });
      slip.appendChild(more);
    }

    var actions = document.createElement('div');
    actions.className = 'quote-slip-actions';

    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'quote-act';
    editBtn.textContent = '改';
    editBtn.setAttribute('aria-label', '修改这条摘录：' + describeQuote(q));
    editBtn.addEventListener('click', function () {
      startEdit(q.id);
    });

    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'quote-act is-danger';
    delBtn.textContent = '删';
    delBtn.setAttribute('aria-label', '删除这条摘录：' + describeQuote(q));
    delBtn.addEventListener('click', function () {
      deleteQuote(q.id);
    });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    slip.appendChild(actions);
    li.appendChild(slip);
    return li;
  }

  function buildEditItem(q) {
    var li = document.createElement('li');
    li.className = 'quote-item is-editing';
    li.tabIndex = -1;
    li.setAttribute('data-id', q.id || '');

    var box = document.createElement('div');
    box.className = 'quote-edit';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', '修改这条摘录');

    function field(labelText, control) {
      var label = document.createElement('label');
      label.className = 'quote-edit-field';
      var span = document.createElement('span');
      span.className = 'quote-edit-label';
      span.textContent = labelText;
      label.appendChild(span);
      label.appendChild(control);
      return label;
    }

    var ta = document.createElement('textarea');
    ta.className = 'quote-edit-text';
    ta.value = q.text;
    var book = document.createElement('input');
    book.type = 'text';
    book.className = 'quote-edit-book';
    book.value = QK.displayBook(q);
    var source = document.createElement('input');
    source.type = 'text';
    source.className = 'quote-edit-source';
    source.value = QK.displaySource(q);

    box.appendChild(field('正文', ta));
    box.appendChild(field('书名', book));
    box.appendChild(field('出处', source));

    var actions = document.createElement('div');
    actions.className = 'quote-edit-actions';
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn ghost quote-cancel';
    cancel.textContent = '取消';
    cancel.addEventListener('click', function () {
      cancelEdit(q.id);
    });
    var save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn quote-save';
    save.textContent = '保存';
    save.addEventListener('click', function () {
      saveEdit();
    });
    actions.appendChild(cancel);
    actions.appendChild(save);
    box.appendChild(actions);

    // Enter 永不保存（正文是多行文本）；Ctrl/Cmd+Enter 保存；Esc 取消；失焦不动
    [ta, book, source].forEach(function (control) {
      control.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          saveEdit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelEdit(q.id);
        }
      });
    });

    li.appendChild(box);
    ui.editRefs = { textarea: ta, book: book, source: source, id: q.id };
    return li;
  }

  function findQuote(id) {
    var list = data.quotes || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function startEdit(id) {
    if (ui.editingId === id) return;
    if (ui.editingId) {
      // 换一条之前先收尾当前这条：非空自动保存，空则拒绝切换（硬切会丢输入）
      if (!commitEdit(true)) {
        toast('先写点什么');
        if (ui.editRefs) ui.editRefs.textarea.focus();
        return;
      }
    }
    ui.editingId = id;
    ui.focusAfter = { type: 'textarea' };
    renderQuotes();
  }

  // silent=true：被下一条的「改」触发的自动保存，不提示、不挪焦点
  function commitEdit(silent) {
    var refs = ui.editRefs;
    if (!refs || !ui.editingId) return false;
    var id = ui.editingId;
    var text = (refs.textarea.value || '').trim();
    if (!text) return false;
    var q = findQuote(id);
    if (!q) {
      // 这一条已在别处被删
      ui.editingId = null;
      ui.editRefs = null;
      renderQuotes();
      return false;
    }
    q.text = text;
    q.book = (refs.book.value || '').trim();   // 空串也写：用户确认过没有书名
    q.source = (refs.source.value || '').trim();
    persistData();
    ui.editingId = null;
    ui.editRefs = null;
    renderStats();
    if (!silent) {
      ui.focusAfter = { type: 'item', id: id };
      toast('已保存');
    }
    renderQuotes();
    return true;
  }

  function saveEdit() {
    if (commitEdit(false)) return;
    toast('先写点什么');
    if (ui.editRefs) ui.editRefs.textarea.focus();
  }

  function cancelEdit(id) {
    ui.editingId = null;
    ui.editRefs = null;
    ui.focusAfter = { type: 'editBtn', id: id };
    renderQuotes();
  }

  function armUndoTimer() {
    if (ui.undo.timer) clearTimeout(ui.undo.timer);
    ui.undo.timer = setTimeout(function () {
      ui.undo.entries = [];
      ui.undo.timer = null;
      renderUndoBar();
    }, 8000);
  }

  function deleteQuote(id) {
    var list = data.quotes || [];
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return;
    var item = list[idx];
    list.splice(idx, 1);
    persistData();               // 立即写 storage，不搞延迟提交
    ui.undo.entries.push({ item: item, index: idx });
    armUndoTimer();              // 每次删除重置 8 秒
    renderStats();
    ui.focusAfter = { type: 'itemAt', index: idx };
    renderQuotes();
  }

  function undoDelete() {
    if (!ui.undo.entries.length) return;
    var entries = ui.undo.entries.slice().sort(function (a, b) {
      return a.index - b.index;
    });
    entries.forEach(function (e) {
      var at = Math.min(e.index, (data.quotes || []).length);
      data.quotes.splice(at, 0, e.item);       // 按 index 升序插回原位
    });
    var firstId = entries[0] && entries[0].item ? entries[0].item.id : null;
    ui.undo.entries = [];
    if (ui.undo.timer) {
      clearTimeout(ui.undo.timer);
      ui.undo.timer = null;
    }
    persistData();
    renderStats();
    ui.focusAfter = { type: 'item', id: firstId };
    renderQuotes();
    toast('已恢复');
  }

  function renderUndoBar() {
    var el = $('quoteUndo');
    var n = ui.undo.entries.length;
    if (!n) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = '';
    el.appendChild(document.createTextNode('已删除 ' + n + ' 条　'));
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quote-undo-btn';
    btn.textContent = '撤销';
    btn.addEventListener('click', undoDelete);
    el.appendChild(btn);
  }

  function exportAll() {
    var items = validQuotes();
    if (!items.length) return;
    var today = QK.localDateKey(new Date());
    var md = QK.buildMarkdown(items, { today: today });
    window.__RK_OPTIONS__.downloadText('weread-quotes-' + today + '.md', md, 'text/markdown;charset=utf-8');
    toast('已导出 Markdown');
  }

  function exportOne(name, items) {
    if (!items || !items.length) return;
    var today = QK.localDateKey(new Date());
    var md = QK.buildMarkdown(items, { book: name, today: today });
    var seg = QK.sanitizeFilename(name);
    var filename = 'weread-quotes-' + today + (seg ? '-' + seg : '') + '.md';
    window.__RK_OPTIONS__.downloadText(filename, md, 'text/markdown;charset=utf-8');
    toast('已导出「' + name + '」');
  }

  function applyFocusAfter() {
    var f = ui.focusAfter;
    ui.focusAfter = null;
    if (!f) return;
    try {
      if (f.type === 'textarea' && ui.editRefs) {
        var ta = ui.editRefs.textarea;
        ta.focus();
        var len = (ta.value || '').length;
        if (ta.setSelectionRange) ta.setSelectionRange(len, len);
        if (ta.scrollIntoView) ta.scrollIntoView({ block: 'nearest' });
      } else if (f.type === 'editBtn' && f.id) {
        var item = document.querySelector('#quoteBody [data-id="' + f.id + '"]');
        var btn = item && item.querySelector('.quote-act');
        if (btn) btn.focus();
      } else if (f.type === 'item' && f.id) {
        var el = document.querySelector('#quoteBody [data-id="' + f.id + '"]');
        if (el) el.focus();
      } else if (f.type === 'itemAt') {
        var items = document.querySelectorAll('#quoteBody .quote-item');
        var target = items.length ? items[Math.min(f.index, items.length - 1)] : null;
        if (target) target.focus();
      }
    } catch (e) {}
  }

  // 只重建 #quoteCard 内部；摘录相关操作一律不走全量 render()，
  // 否则编辑中的 textarea 会被整个换掉、输入与光标一起丢
  function renderQuotes() {
    var list = validQuotes();
    var empty = $('quoteEmpty');
    var hint = $('quoteHint');
    var toolbar = $('quoteToolbar');
    var body = $('quoteBody');
    var foot = $('quoteFoot');

    empty.hidden = list.length > 0;
    hint.hidden = !list.length;
    toolbar.hidden = !list.length;
    foot.hidden = !list.length;

    renderSeg('quoteView', [
      { name: '按书', value: 'book' },
      { name: '按时间', value: 'time' }
    ], ui.view, function (v) {
      ui.view = v;
      renderQuotes();
    });

    foot.textContent = '';
    foot.removeAttribute('data-full');
    if (list.length) {
      if (list.length >= 200) {
        foot.appendChild(document.createTextNode('共 200 条，已到'));
        var b = document.createElement('b');
        b.textContent = '上限';
        foot.appendChild(b);
        foot.appendChild(document.createTextNode('。再记一句会挤掉最旧的一条。'));
        foot.setAttribute('data-full', '1');
      } else {
        foot.textContent = '共 ' + list.length + ' 条 · 上限 200 条';
      }
    }

    body.textContent = '';
    if (list.length) {
      if (ui.view === 'book') {
        QK.groupQuotes(list).forEach(function (g, gi) {
          var section = document.createElement('section');
          section.className = 'quote-group';
          var headId = 'quote-g-' + (gi + 1);   // id 用序号，不用书名拼（书名有全角标点）
          section.setAttribute('aria-labelledby', headId);

          var head = document.createElement('div');
          head.className = 'quote-group-head';
          var h3 = document.createElement('h3');
          h3.className = 'quote-group-title';
          h3.id = headId;
          h3.textContent = g.name;
          var count = document.createElement('span');
          count.className = 'quote-group-count';
          count.textContent = g.items.length + ' 条';
          h3.appendChild(count);
          head.appendChild(h3);

          var one = document.createElement('button');
          one.type = 'button';
          one.className = 'quote-group-export';
          one.textContent = '导出这一本';
          one.setAttribute('aria-label', '导出「' + g.name + '」的 ' + g.items.length + ' 条摘录');
          one.addEventListener('click', function () {
            exportOne(g.name, g.items);
          });
          head.appendChild(one);
          section.appendChild(head);

          var ul = document.createElement('ul');
          ul.className = 'quote-list';
          g.items.forEach(function (q) {
            ul.appendChild(ui.editingId === q.id ? buildEditItem(q) : buildReadItem(q));
          });
          section.appendChild(ul);
          body.appendChild(section);
        });
      } else {
        var flat = document.createElement('ul');
        flat.className = 'quote-list';
        list.forEach(function (q) {
          flat.appendChild(ui.editingId === q.id ? buildEditItem(q) : buildReadItem(q));
        });
        body.appendChild(flat);
      }
    }

    renderUndoBar();
    applyFocusAfter();
  }

  /* ---------------- 主题预览：把令牌写到设置页自己的 :root ---------------- */

  function resolveMode() {
    if (settings.mode === 'dark') return 'dark';
    if (settings.mode === 'light') return 'light';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyPreview() {
    var theme = P.THEMES[settings.theme] || P.THEMES.paper;
    var set = theme[resolveMode()];
    var font = P.FONTS[settings.fontPreset] || P.FONTS.serif;
    var root = document.documentElement.style;

    root.setProperty('--rk-canvas', set.canvas);
    root.setProperty('--rk-surface', set.surface);
    root.setProperty('--rk-ink', set.ink);
    root.setProperty('--rk-ink-soft', set.inkSoft);
    root.setProperty('--rk-line', set.line);
    root.setProperty('--rk-accent', set.accent);
    root.setProperty('--rk-on-accent', set.onAccent);
    root.setProperty('--rk-accent-soft', set.accentSoft);
    root.setProperty('--rk-font-ui', font.ui);
    root.setProperty('--rk-font-serif', font.serif);
  }

  /* ---------------- 渲染 ---------------- */

  function renderThemes() {
    var box = $('themes');
    box.textContent = '';
    P.themeList.forEach(function (id) {
      var theme = P.THEMES[id];
      var colors = P.swatch(id, resolveMode());
      var strip = document.createElement('div');
      strip.className = 'theme-strip';
      colors.forEach(function (c) {
        var i = document.createElement('i');
        i.style.background = c;
        strip.appendChild(i);
      });

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theme';
      btn.setAttribute('data-active', String(settings.theme === id));

      var name = document.createElement('div');
      name.className = 'theme-name';
      name.textContent = theme.name;

      var desc = document.createElement('div');
      desc.className = 'theme-desc';
      desc.textContent = theme.desc;

      btn.appendChild(strip);
      btn.appendChild(name);
      btn.appendChild(desc);
      btn.addEventListener('click', function () {
        save({ theme: id });
        toast('已切换到「' + theme.name + '」');
      });
      box.appendChild(btn);
    });
  }

  function renderSeg(containerId, options, active, onPick) {
    var box = $(containerId);
    box.textContent = '';
    options.forEach(function (opt) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = opt.name;
      b.setAttribute('data-active', String(opt.value === active));
      b.addEventListener('click', function () {
        onPick(opt.value);
      });
      box.appendChild(b);
    });
  }

  function renderSwitch(id, on, onChange) {
    var el = $(id);
    el.setAttribute('data-on', on ? '1' : '0');
    el.setAttribute('aria-checked', on ? 'true' : 'false');
    el.onclick = function () {
      onChange(!on);
    };
  }

  function renderStats() {
    var box = $('stats');
    box.textContent = '';
    var quotes = (data.quotes || []).length;
    var books = (data.log || []).length;
    var totalSeconds = 0;
    Object.keys(data.stats || {}).forEach(function (k) {
      totalSeconds += (data.stats[k] && data.stats[k].seconds) || 0;
    });
    var minutes = Math.round(totalSeconds / 60);

    [
      { value: String(quotes), label: '条摘录' },
      { value: String(books), label: '本在读记录' },
      { value: minutes >= 60 ? (minutes / 60).toFixed(1) + ' 小时' : minutes + ' 分钟', label: '本机累计' }
    ].forEach(function (item) {
      var cell = document.createElement('div');
      cell.className = 'stat';
      var b = document.createElement('b');
      b.textContent = item.value;
      var s = document.createElement('span');
      s.textContent = item.label;
      cell.appendChild(b);
      cell.appendChild(s);
      box.appendChild(cell);
    });
  }

  function render() {
    applyPreview();
    renderThemes();

    renderSeg('mode', [
      { name: '跟随系统', value: 'auto' },
      { name: '浅色', value: 'light' },
      { name: '深色', value: 'dark' }
    ], settings.mode, function (v) {
      save({ mode: v });
    });

    renderSeg('font', Object.keys(P.FONTS).map(function (k) {
      return { name: P.FONTS[k].name, value: k };
    }), settings.fontPreset, function (v) {
      save({ fontPreset: v });
    });

    renderSeg('density', Object.keys(P.DENSITY).map(function (k) {
      return { name: P.DENSITY[k].name, value: k };
    }), settings.density, function (v) {
      save({ density: v });
    });

    renderSwitch('sw-showDesk', settings.showDesk, function (v) {
      save({ showDesk: v });
    });
    renderSwitch('sw-showDock', settings.showDock, function (v) {
      save({ showDock: v });
    });
    renderSwitch('sw-logReading', settings.logReading, function (v) {
      save({ logReading: v });
    });
    renderSwitch('sw-immersive', settings.immersive, function (v) {
      save({ immersive: v });
    });

    var goal = $('goal');
    goal.value = String(settings.goalMinutes);
    $('goalOut').textContent = settings.goalMinutes + ' 分钟';

    renderStats();
    // 摘录列表单独重绘；编辑中不重绘（不吞用户正在输的内容）
    if (!ui.editingId) renderQuotes();
  }

  /* ---------------- 数据操作 ---------------- */

  function exportData() {
    var payload = {
      app: 'weread-studio',
      version: '0.2.0',
      exportedAt: new Date().toISOString(),
      settings: settings,
      data: data
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'weread-studio-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 2000);
    toast('已导出备份');
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(String(reader.result));
        if (!parsed || parsed.app !== 'weread-studio') {
          toast('这不是书房导出的备份文件');
          return;
        }
        var nextSettings = parsed.settings ? deepMerge(DEFAULTS, parsed.settings) : settings;
        var nextData = parsed.data ? deepMerge(EMPTY, parsed.data) : data;
        var payload = {};
        payload[SETTINGS_KEY] = nextSettings;
        payload[DATA_KEY] = nextData;
        chrome.storage.local.set(payload, function () {
          settings = nextSettings;
          data = nextData;
          render();
          toast('已导入备份');
        });
      } catch (e) {
        toast('文件解析失败，请确认是 JSON 备份');
      }
    };
    reader.readAsText(file);
  }

  function clearData() {
    var ok = window.confirm('清空所有摘录、阅读记录与阅读时长？设置项会保留。此操作不可撤销。');
    if (!ok) return;
    chrome.storage.local.set({ [DATA_KEY]: clone(EMPTY) }, function () {
      data = clone(EMPTY);
      render();
      toast('数据已清空');
    });
  }

  /* ---------------- 绑定 ---------------- */

  document.addEventListener('DOMContentLoaded', function () {
    load().then(function () {
      render();
      $('version').textContent = '版本 0.2.0 · 本地存储，不联网';

      // 摘录管理
      $('quoteExport').addEventListener('click', exportAll);

      // 其它标签页/内容脚本改了摘录数据时同步过来；
      // 正在编辑时跳过重绘，退出编辑那刻再以 storage 为准
      if (chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener(function (changes, area) {
          if (area !== 'local' || !changes[DATA_KEY]) return;
          chrome.storage.local.get([DATA_KEY], function (res) {
            data = deepMerge(EMPTY, res ? res[DATA_KEY] : null);
            if (!ui.editingId) {
              renderQuotes();
              renderStats();
            }
          });
        });
      }

      // 从功能坞「管理摘录」跳过来：渲染之后再滚动定位（渲染前列表高度是 0）
      if (location.hash === '#quotes') {
        var card = $('quoteCard');
        if (card && card.scrollIntoView) card.scrollIntoView({ block: 'start' });
        $('quoteTitle').focus();
      }

      $('goal').addEventListener('input', function (e) {
        var v = Number(e.target.value);
        $('goalOut').textContent = v + ' 分钟';
      });
      $('goal').addEventListener('change', function (e) {
        save({ goalMinutes: Number(e.target.value) });
      });

      $('export').addEventListener('click', exportData);
      $('import').addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        if (file) importData(file);
        e.target.value = '';
      });
      $('clear').addEventListener('click', clearData);

      if (window.matchMedia) {
        var mq = window.matchMedia('(prefers-color-scheme: dark)');
        var onChange = function () {
          if (settings.mode === 'auto') render();
        };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
      }
    });
  });
})();
