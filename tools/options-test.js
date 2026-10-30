/*
 * 设置页摘录管理行为测试：node tools/options-test.js <扩展目录>
 * 用 DOM 桩跑 options.js，验证：分组渲染与老数据借用、删除+撤销插回原位、
 * Markdown 导出内容、编辑保存/拒空、storage.onChanged 同步。
 * 不引第三方依赖；chrome API 用桩。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.argv[2];
if (!ROOT) {
  console.error('需要传入扩展目录');
  process.exit(1);
}

/* ---------------- 极简 DOM（与 tools/smoke-test.js 同一套桩） ---------------- */

class Node {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this._text = '';
    this.listeners = {};
    this.shadowRoot = null;
    this.hidden = false;
    this.tabIndex = 0;
    this.style = {
      setProperty(k, v) { this[k] = v; },
      removeProperty(k) { delete this[k]; },
      cssText: ''
    };
  }
  get classList() {
    const cls = (this.attrs.class || '').split(/\s+/).filter(Boolean);
    return { contains: (c) => cls.includes(c) };
  }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = v; }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = v; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(child) {
    if (!child) return child;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get childNodes() { return this.children; }
  contains(node) {
    if (node === this) return true;
    return this.children.some((c) => c.contains && c.contains(node));
  }
  addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
  dispatch(type, ev) {
    (this.listeners[type] || []).forEach((fn) => fn(ev || { preventDefault() {} }));
  }
  focus() { this._focused = true; }
  scrollIntoView() {}
  querySelectorAll(sel) { return matchAll(this, sel); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
}

function parseSimple(part) {
  const out = { tag: null, cls: [], id: null, attrs: [] };
  part.replace(/(\[[^\]]+\]|[.#]?[A-Za-z0-9_-]+)/g, (tok) => {
    if (tok.startsWith('[')) {
      const m = tok.match(/^\[([\w-]+)(\*?)=?"?(.*?)"?\]$/);
      if (m) out.attrs.push({ name: m[1], contains: m[2] === '*', value: m[3] });
    } else if (tok.startsWith('.')) out.cls.push(tok.slice(1));
    else if (tok.startsWith('#')) out.id = tok.slice(1);
    else if (!out.tag) out.tag = tok.toUpperCase();
    return tok;
  });
  return out;
}

function matches(node, simple) {
  if (!node || !node.tagName) return false;
  if (simple.tag && node.tagName !== simple.tag) return false;
  if (simple.id && node.id !== simple.id) return false;
  for (const c of simple.cls) if (!node.classList.contains(c)) return false;
  for (const a of simple.attrs) {
    const v = node.getAttribute(a.name);
    if (v == null) return false;
    if (a.value && (a.contains ? !v.includes(a.value) : v !== a.value)) return false;
  }
  return true;
}

function descendants(node, acc = []) {
  node.children.forEach((c) => {
    acc.push(c);
    descendants(c, acc);
  });
  return acc;
}

function matchAll(root, selector) {
  const groups = selector.split(',').map((s) => s.trim()).filter(Boolean);
  const all = descendants(root);
  const out = [];
  all.forEach((node) => {
    for (const g of groups) {
      const steps = g.split(/\s+/).filter(Boolean).map(parseSimple);
      if (steps.length && matches(node, steps[steps.length - 1])) {
        let i = steps.length - 2;
        let cur = node.parentNode;
        while (i >= 0) {
          if (!cur) break;
          if (matches(cur, steps[i])) i--;
          cur = cur.parentNode;
        }
        if (i < 0 && !out.includes(node)) out.push(node);
        return;
      }
    }
  });
  return out;
}

/* ---------------- 运行环境 ---------------- */

function buildEnv(store) {
  const document = new Node('#document');
  const html = new Node('html');
  const body = new Node('body');
  document.appendChild(html);
  html.appendChild(body);
  document.documentElement = html;
  document.body = body;
  document.head = new Node('head');
  document.readyState = 'complete';
  document.visibilityState = 'visible';
  document.addEventListener = (type, fn) => {
    if (type === 'DOMContentLoaded') fn();
  };
  document.getElementById = (id) => descendants(html).find((n) => n.id === id) || null;
  document.createElement = (tag) => new Node(tag);
  document.contains = (n) => html.contains(n);
  document.createTextNode = (t) => { const n = new Node('#text'); n._text = t; return n; };

  // 设置页用到的静态节点（与 options.html 对应）
  ['themes', 'mode', 'font', 'density', 'sw-showDesk', 'sw-showDock', 'sw-logReading',
    'sw-immersive', 'goal', 'goalOut', 'stats', 'export', 'import', 'clear', 'version', 'toast',
    'quoteCard', 'quoteTitle', 'quoteEmpty', 'quoteHint', 'quoteToolbar', 'quoteView',
    'quoteExport', 'quoteBody', 'quoteUndo', 'quoteFoot'
  ].forEach((id) => {
    const el = new Node(id === 'quoteUndo' ? 'p' : 'div');
    el.id = id;
    body.appendChild(el);
  });

  const win = {
    document,
    location: { pathname: '/', search: '', hash: '', href: 'chrome-extension://test/src/options/options.html' },
    navigator: { userAgent: 'node' },
    addEventListener() {},
    removeEventListener() {},
    setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    console
  };
  win.window = win;

  let onChangedFn = null;
  win.chrome = {
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
            if (k in store) out[k] = JSON.parse(JSON.stringify(store[k]));
          });
          cb(out);
        },
        set(obj, cb) {
          Object.assign(store, JSON.parse(JSON.stringify(obj)));
          cb && cb();
        }
      },
      onChanged: { addListener(fn) { onChangedFn = fn; } }
    },
    runtime: { lastError: null }
  };
  win.__triggerStorageChange__ = (changes, area) => onChangedFn && onChangedFn(changes, area);

  win.ctx = vm.createContext(win);
  return { win, document, store };
}

/* ---------------- fixture ---------------- */

const T = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0).getTime();
const STORE = {
  'rk:settings': {},
  'rk:data': {
    quotes: [
      { id: 'q1', text: '一天之内，把长安走完。', source: '长安十二时辰', at: T(2026, 1, 3) }, // 老数据
      { id: 'q2', text: '流程是弱者才要遵循的规矩。', book: '长安的荔枝', source: '第二章', at: T(2026, 8, 11) },
      { id: 'q3', text: '我是一个很笨的人，只是不太愿意承认。', book: '长安的荔枝', source: '', at: T(2026, 8, 9) }
    ],
    log: [],
    stats: {}
  }
};

const env = buildEnv(STORE);
['src/shared/defaults.js', 'src/shared/palette.js', 'src/shared/quotes.js', 'src/options/options.js']
  .forEach((rel) => {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(code, env.win.ctx, { filename: rel });
  });

const results = [];
let failed = false;
function check(name, ok, detail) {
  if (!ok) failed = true;
  results.push([name + (ok ? '' : '　← ' + (detail || '')) , ok ? 'OK' : 'FAIL']);
}
const $ = (sel) => env.document.querySelector(sel);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 20));

(async () => {
  await tick();

  /* ---- 渲染与老数据借用 ---- */
  const groups = env.document.querySelectorAll('#quoteBody .quote-group');
  check('按书视图分 2 组', groups.length === 2, '实际 ' + groups.length);
  const firstTitle = groups[0] && groups[0].querySelector('h3');
  check('组间按最新排：长安的荔枝在前', firstTitle && firstTitle.textContent.indexOf('长安的荔枝') === 0, firstTitle && firstTitle.textContent);
  check('组头带条数', firstTitle && firstTitle.textContent.indexOf('2 条') > 0, firstTitle && firstTitle.textContent);
  const q1meta = $('[data-id="q1"] .quote-slip-meta');
  check('老数据 meta 不重复书名', q1meta && q1meta.textContent === '长安十二时辰 · 2026-01-03', q1meta && q1meta.textContent);
  const q2meta = $('[data-id="q2"] .quote-slip-meta');
  check('新数据 meta 三段', q2meta && q2meta.textContent === '长安的荔枝 · 第二章 · 2026-08-11', q2meta && q2meta.textContent);
  check('foot 计数行', $('#quoteFoot').textContent.indexOf('共 3 条 · 上限 200 条') === 0, $('#quoteFoot').textContent);
  check('aria-label 各不相同',
    $('[data-id="q1"] .quote-act').getAttribute('aria-label') !== $('[data-id="q2"] .quote-act').getAttribute('aria-label'));

  /* ---- 删除 + 撤销（原位插回） ---- */
  $('[data-id="q3"] .quote-act.is-danger').dispatch('click');
  check('删除立即写 storage', STORE['rk:data'].quotes.length === 2);
  const undoBar = $('#quoteUndo');
  check('撤销条出现', undoBar.hidden === false && undoBar.textContent.indexOf('已删除 1 条') >= 0, undoBar.textContent);
  $('.quote-undo-btn').dispatch('click');
  check('撤销后恢复 3 条', STORE['rk:data'].quotes.length === 3);
  check('撤销按原 index 插回（不是追加）',
    JSON.stringify(STORE['rk:data'].quotes.map((q) => q.id)) === '["q1","q2","q3"]',
    JSON.stringify(STORE['rk:data'].quotes.map((q) => q.id)));

  /* ---- 导出全部 Markdown ---- */
  let captured = null;
  env.win.__RK_OPTIONS__.downloadText = (filename, text) => { captured = { filename, text }; };
  $('#quoteExport').dispatch('click');
  check('导出触发', !!captured);
  check('文件名格式', /^weread-quotes-\d{4}-\d{2}-\d{2}\.md$/.test(captured && captured.filename), captured && captured.filename);
  check('首行 # 摘录', captured && captured.text.startsWith('# 摘录\n'), captured && captured.text.slice(0, 20));
  check('分 2 组', (captured.text.match(/^## /gm) || []).length === 2);
  check('老数据导出不重复书名',
    captured.text.includes('> 一天之内，把长安走完。') &&
    !captured.text.includes('长安十二时辰 · 长安十二时辰') &&
    !captured.text.includes('- 出处：长安十二时辰'), captured.text);
  check('无 BOM 无署名行', !captured.text.includes('\uFEFF') && !captured.text.includes('书房'));

  /* ---- 导出单本 ---- */
  captured = null;
  groups[0].querySelector('.quote-group-export').dispatch('click');
  check('单本首行', captured && captured.text.startsWith('# 长安的荔枝\n'), captured && captured.text.slice(0, 20));
  check('单本不含其它书', captured && !captured.text.includes('长安十二时辰'));
  check('单本文件名带书名', captured && captured.filename.endsWith('-长安的荔枝.md'), captured && captured.filename);

  /* ---- 编辑：保存 ---- */
  $('[data-id="q2"] .quote-act').dispatch('click');
  const ta = $('#quoteBody textarea');
  check('进入编辑态', !!ta);
  ta.value = '流程是弱者才要遵循的规矩。改后。';
  $('[data-id="q2"] .quote-save').dispatch('click');
  const q2after = STORE['rk:data'].quotes.find((q) => q.id === 'q2');
  check('编辑保存落 storage', q2after.text === '流程是弱者才要遵循的规矩。改后。');
  check('保存不改 at', q2after.at === T(2026, 8, 11));
  check('保存回写 book/source', q2after.book === '长安的荔枝' && q2after.source === '第二章');

  /* ---- 编辑：拒空 ---- */
  $('[data-id="q3"] .quote-act').dispatch('click');
  const ta3 = $('#quoteBody textarea');
  ta3.value = '   ';
  $('[data-id="q3"] .quote-save').dispatch('click');
  check('空内容拒保存', $('#toast').textContent === '先写点什么', $('#toast').textContent);
  check('仍处于编辑态', !!$('#quoteBody textarea'));

  /* ---- storage.onChanged 同步 ----
   * 编辑中：跳过重绘（不吞用户正在输的内容）；退出编辑后：以 storage 为准重绘 */
  STORE['rk:data'].quotes = STORE['rk:data'].quotes.map((q) =>
    q.id === 'q1' ? Object.assign({}, q, { text: '被别的标签页改过。' }) : q);
  const draftBefore = $('#quoteBody textarea').value;
  env.win.__triggerStorageChange__({ 'rk:data': {} }, 'local');
  await tick();
  check('编辑中不重绘（草稿不丢）',
    !!$('#quoteBody textarea') && $('#quoteBody textarea').value === draftBefore);
  $('[data-id="q3"] .quote-cancel').dispatch('click');
  check('取消后退出编辑态', !$('#quoteBody textarea'));
  env.win.__triggerStorageChange__({ 'rk:data': {} }, 'local');
  await tick();
  check('退出编辑后列表同步', $('[data-id="q1"] .quote-slip-text').textContent === '被别的标签页改过。');

  /* ---- hash 定位（独立环境） ---- */
  const env2 = buildEnv(JSON.parse(JSON.stringify(STORE)));
  env2.win.location.hash = '#quotes';
  ['src/shared/defaults.js', 'src/shared/palette.js', 'src/shared/quotes.js', 'src/options/options.js']
    .forEach((rel) => {
      const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      vm.runInContext(code, env2.win.ctx, { filename: rel });
    });
  await tick();
  check('#quotes 渲染后聚焦卡片标题', env2.document.getElementById('quoteTitle')._focused === true);

  /* ---- 输出 ---- */
  console.log('');
  results.forEach(([k, v]) => console.log('  ' + k + '：' + v));
  console.log('');
  console.log(failed ? '结果：有问题，需要修' : '结果：全部通过');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('测试运行异常：', e);
  process.exit(1);
});
