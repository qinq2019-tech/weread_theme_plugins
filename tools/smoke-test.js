/*
 * 无浏览器冒烟测试：用极简 DOM 桩跑一遍内容脚本，
 * 验证三件事：
 *   1) 首页能挂上书桌与功能坞；
 *   2) 阅读器只挂功能坞，不残留书桌；
 *   3) 页面结构完全对不上时安静降级，不抛错。
 * 用法：node /tmp/rk-smoke.js <扩展目录>
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.argv[2];
if (!ROOT) {
  console.error('需要传入扩展目录');
  process.exit(1);
}

/* ---------------- 极简 DOM ---------------- */

class Node {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this._text = '';
    this.listeners = {};
    this.style = {
      setProperty(k, v) { this[k] = v; },
      removeProperty(k) { delete this[k]; },
      cssText: ''
    };
    this.shadowRoot = null;
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
  insertBefore(child, ref) {
    child.parentNode = this;
    const i = this.children.indexOf(ref);
    if (i < 0) this.children.push(child);
    else this.children.splice(i, 0, child);
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  replaceChild(next, old) {
    const i = this.children.indexOf(old);
    if (i >= 0) {
      this.children[i] = next;
      next.parentNode = this;
      old.parentNode = null;
    }
    return old;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get nextSibling() {
    const p = this.parentNode;
    if (!p) return null;
    const i = p.children.indexOf(this);
    return i >= 0 ? p.children[i + 1] || null : null;
  }
  get childNodes() { return this.children; }
  contains(node) {
    if (node === this) return true;
    return this.children.some((c) => c.contains && c.contains(node));
  }
  addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
  removeEventListener() {}
  dispatch(type, ev) {
    (this.listeners[type] || []).forEach((fn) => fn(ev || { preventDefault() {} }));
  }
  attachShadow() {
    const root = new Node('#shadow');
    root.host = this;
    this.shadowRoot = root;
    return root;
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v);
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set innerHTML(v) {
    this.children = [];
    this._html = String(v);
  }
  get innerHTML() { return this._html || ''; }
  set src(v) { this.attrs.src = v; }
  get src() { return this.attrs.src || ''; }
  set href(v) { this.attrs.href = v; }
  get href() { return this.attrs.href || ''; }
  set alt(v) { this.attrs.alt = v; }
  set title(v) { this.attrs.title = v; }
  get title() { return this.attrs.title || ''; }
  queriedSelector(sel) { return matchAll(this, sel); }
  querySelector(sel) { return this.queriedSelector(sel)[0] || null; }
  querySelectorAll(sel) { return this.queriedSelector(sel); }
}

// 迷你选择器：支持逗号、后代、.class、#id、tag、[attr]、[attr*="v"]
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
  if (!node || !node.tagName || node.tagName === '#SHADOW') return false;
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
    if (c.shadowRoot) descendants(c.shadowRoot, acc);
  });
  return acc;
}

function matchesChain(node, steps) {
  if (!matches(node, steps[steps.length - 1])) return false;
  let i = steps.length - 2;
  let cur = node.parentNode;
  while (i >= 0) {
    if (!cur || cur.tagName === '#SHADOW') return false;
    if (matches(cur, steps[i])) i--;
    cur = cur.parentNode;
  }
  return true;
}

function matchAll(root, selector) {
  const groups = selector.split(',').map((s) => s.trim()).filter(Boolean);
  const all = descendants(root);
  const out = [];
  all.forEach((node) => {
    for (const g of groups) {
      const steps = g.split(/\s+/).filter(Boolean).map(parseSimple);
      if (steps.length && matchesChain(node, steps)) {
        if (!out.includes(node)) out.push(node);
        return;
      }
    }
  });
  return out;
}

/* ---------------- chrome 桩 ---------------- */

function makeChrome(store, session) {
  const local = {
    get(keys, cb) {
      const out = {};
      (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
        if (k in store) out[k] = JSON.parse(JSON.stringify(store[k]));
      });
      cb && cb(out);
    },
    set(obj, cb) {
      Object.assign(store, JSON.parse(JSON.stringify(obj)));
      cb && cb();
    }
  };
  const sessionArea = {
    get(keys, cb) {
      const out = {};
      (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
        if (k in session) out[k] = session[k];
      });
      cb && cb(out);
    },
    set(obj, cb) { Object.assign(session, obj); cb && cb(); }
  };
  return {
    storage: { local, session: sessionArea, onChanged: { addListener() {} } },
    runtime: {
      lastError: null,
      id: 'smoke-test',
      onMessage: { addListener() {} },
      sendMessage() {},
      openOptionsPage() {}
    },
    tabs: { query(o, cb) { cb([]); }, sendMessage() {} }
  };
}

/* ---------------- 运行环境 ---------------- */

function buildEnv(bodyClass, extra) {
  const document = new Node('#document');
  const html = new Node('html');
  const body = new Node('body');
  body.className = bodyClass;
  document.appendChild(html);
  html.appendChild(body);

  document.documentElement = html;
  document.body = body;
  document.head = new Node('head');
  document.readyState = 'complete';
  document.title = extra.title || '微信读书';
  document.visibilityState = 'visible';
  document.addEventListener = () => {};
  document.getElementById = (id) => descendants(html).find((n) => n.id === id) || null;
  document.createElement = (tag) => new Node(tag);
  document.contains = (n) => html.contains(n);
  document.createTextNode = (t) => { const n = new Node('#text'); n._text = t; return n; };

  if (extra.build) extra.build(document, html, body);

  const win = {
    document,
    location: { pathname: extra.path || '/', search: '', href: 'https://weread.qq.com' + (extra.path || '/') },
    navigator: { userAgent: 'node' },
    addEventListener() {},
    removeEventListener() {},
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({ backgroundColor: 'rgba(0, 0, 0, 0)' }),
    MutationObserver: class { observe() {} disconnect() {} },
    console
  };
  win.window = win;
  win.chrome = makeChrome({}, {});
  win.__RK_DEBUG__ = false;

  const ctx = vm.createContext(win);
  return { ctx, document, html, body, win };
}

const SCRIPTS = [
  'src/shared/defaults.js',
  'src/shared/palette.js',
  'src/content/00-core.js',
  'src/content/05-ui-css.js',
  'src/content/10-adapter.js',
  'src/content/20-theme.js',
  'src/content/30-desk.js',
  'src/content/35-wing.js',
  'src/content/40-dock.js',
  'src/content/50-reader.js',
  'src/content/60-boot.js'
];

function run(env) {
  SCRIPTS.forEach((rel) => {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(code, env.ctx, { filename: rel });
  });
}

/* ---------------- 三个场景 ---------------- */

const results = [];

function scenarioHome() {
  const env = buildEnv('wr_theme_light wr_desktop wr_apple', {
    path: '/web/',
    build(doc, html, body) {
      const wrapper = new Node('div');
      wrapper.className = 'wr_index_page_wrapper';
      const header = new Node('div');
      header.className = 'wr_index_page_header_wrapper';
      const content = new Node('div');
      content.className = 'wr_index_page_content_wrapper';

      const card = new Node('div');
      card.className = 'wr_index_page_mini_bookInfo';
      const img = new Node('img');
      img.setAttribute('src', 'https://example.com/cover.jpg');
      const title = new Node('div');
      title.className = 'wr_index_page_mini_bookInfo_content_title_name';
      title.textContent = '活着';
      card.appendChild(img);
      card.appendChild(title);
      content.appendChild(card);

      wrapper.appendChild(header);
      wrapper.appendChild(content);
      body.appendChild(wrapper);
    }
  });

  run(env);
  const RK = env.ctx.__RK__;
  if (!RK) throw new Error('RK 未初始化');
  RK.getSettings().then((s) => {
    RK.theme.apply(s);
    RK.desk.mount(s, { quotes: [], log: [{ book: '活着', chapter: '第一章', progress: '12%', href: '/web/reader/x', at: Date.now() }], stats: {} });
    RK.dock.mount(s, { quotes: [], log: [], stats: {} });

    const deskHost = env.document.querySelector('[data-rk-desk]');
    const dockHost = env.document.querySelector('[data-rk-dock]');
    const report = RK.adapter.report();

    results.push(['首页', [
      ['书桌挂载', deskHost ? 'OK' : 'FAIL'],
      ['功能坞挂载', dockHost ? 'OK' : 'FAIL'],
      ['识别页面', report.page],
      ['命中内容区', report.hostSelector || '无'],
      ['识别封面', String(report.coverCount)],
      ['书桌首个子节点', env.document.querySelector('.wr_index_page_content_wrapper').firstChild === deskHost ? 'OK（插在最上）' : 'FAIL']
    ]]);

    // 关掉后应完全还原
    RK.theme.remove();
    RK.desk.unmount();
    RK.dock.unmount();
    results.push(['还原', [
      ['主题属性', env.html.hasAttribute('data-rk-on') ? 'FAIL 仍残留' : 'OK 已清除'],
      ['书桌节点', env.document.querySelector('[data-rk-desk]') ? 'FAIL 仍存在' : 'OK 已移除']
    ]]);
  }).catch((e) => {
    results.push(['首页', [['异常', String(e && e.stack || e)]]]);
  });
}

function scenarioReader() {
  const env = buildEnv('wr_macOS wr_Desktop wr_page_reader', {
    path: '/web/reader/abc123',
    title: '活着 - 余华 - 微信读书',
    build(doc, html, body) {
      const bar = new Node('div');
      bar.className = 'readerTopBar';
      body.appendChild(bar);
    }
  });
  run(env);
  const RK = env.ctx.__RK__;

  // 让 boot 的异步流程跑完后检查
  setTimeout(() => {
    RK.getSettings().then((s) => {
      RK.desk.mount(s, { quotes: [], log: [], stats: {} });
      RK.dock.mount(s, { quotes: [], log: [], stats: {} });
      RK.reader.apply({ enabled: true, readerTone: 40, immersive: true, logReading: true });

      const report = RK.adapter.report();
      const info = RK.adapter.readChapterInfo();
      const tone = env.document.getElementById('rk-tone-layer');
      const bar = env.document.querySelector('.readerTopBar');

      results.push(['阅读器', [
        ['识别页面', report.page],
        ['不挂书桌', env.document.querySelector('[data-rk-desk]') ? 'FAIL 挂了' : 'OK 没挂'],
        ['功能坞挂载', env.document.querySelector('[data-rk-dock]') ? 'OK' : 'FAIL'],
        ['解析书名', info ? info.book : '解析失败'],
        ['解析章节', info && info.chapter ? info.chapter : '空（站点未提供，按设计不猜）'],
        ['解析作者', info ? info.author : '-'],
        ['护色温层', tone ? 'OK opacity=' + tone.style.opacity : 'FAIL 无'],
        ['顶栏打标', bar && bar.hasAttribute('data-rk-imm') ? 'OK' : '未命中（可接受）']
      ]]);
    });
  }, 60);
}

function scenarioUnknown() {
  const env = buildEnv('', { path: '/web/category/100000' });
  run(env);
  const RK = env.ctx.__RK__;
  setTimeout(() => {
    const report = RK.adapter.report();
    results.push(['陌生页面', [
      ['识别页面', report.page],
      ['内容区', report.hostSelector || '未匹配（按设计降级）'],
      ['异常', 'none']
    ]]);
  }, 60);
}

/* 主题专属区：三套各挂一次 + 开关关闭 + 卸载还原 */
function scenarioWing() {
  function keyOf(offset) {
    const d = new Date(Date.now() - offset * 86400000);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  const fixture = {
    quotes: [
      { id: 'q1', text: '一天之内，把长安走完。', source: '长安十二时辰', at: Date.now() - 5 * 86400000 },
      { id: 'q2', text: '流程是弱者才要遵循的规矩。', book: '长安的荔枝', source: '第二章', at: Date.now() - 3 * 86400000 },
      { id: 'q3', text: '我是一个很笨的人，只是不太愿意承认。', book: '长安的荔枝', source: '', at: Date.now() - 2 * 86400000 },
      { id: 'q4', text: '最新的一句，书桌右侧已经在展示。', book: '活着', at: Date.now() - 3600000 }
    ],
    log: [
      { book: '活着', author: '余华', chapter: '第一章', progress: '12%', href: '/web/reader/a', at: Date.now() },
      { book: '长安的荔枝', author: '马伯庸', chapter: '', progress: '28%', href: '/web/reader/b', at: Date.now() - 86400000 },
      { book: '长安十二时辰', author: '马伯庸', chapter: '', progress: '', href: '/web/reader/c', at: Date.now() - 2 * 86400000 }
    ],
    stats: {}
  };
  fixture.stats[keyOf(0)] = { seconds: 50 * 60 };
  fixture.stats[keyOf(1)] = { seconds: 20 * 60 };
  fixture.stats[keyOf(3)] = { seconds: 5 * 60 };

  const env = buildEnv('wr_theme_light wr_desktop wr_apple', {
    path: '/web/',
    build(doc, html, body) {
      const wrapper = new Node('div');
      wrapper.className = 'wr_index_page_wrapper';
      const content = new Node('div');
      content.className = 'wr_index_page_content_wrapper';
      wrapper.appendChild(content);
      body.appendChild(wrapper);
    }
  });
  run(env);
  const RK = env.ctx.__RK__;

  RK.getSettings()
    .then(async (base) => {
      const rows = [];
      const content = env.document.querySelector('.wr_index_page_content_wrapper');

      // ---- paper 摘句墙 ----
      let s = await RK.saveSettings({ theme: 'paper' });
      RK.theme.apply(s);
      RK.desk.mount(s, fixture);
      RK.wing.mount(s, fixture);
      const deskHost = env.document.querySelector('[data-rk-desk]');
      const wingHost = env.document.querySelector('[data-rk-wing]');
      const wingRoot = wingHost && wingHost.shadowRoot.querySelector('.rk-wing');
      rows.push(
        ['paper 宿主挂载', wingHost ? 'OK' : 'FAIL'],
        ['插在书桌之后', deskHost && deskHost.nextSibling === wingHost ? 'OK' : 'FAIL'],
        ['data-wing-theme=paper', wingRoot && wingRoot.getAttribute('data-wing-theme') === 'paper' ? 'OK' : 'FAIL'],
        ['便笺 3 条（跳过最新一条）', wingRoot && wingRoot.querySelectorAll('.rk-slip').length === 3 ? 'OK' : 'FAIL'],
        ['老数据 meta 不重复书名', wingRoot && wingRoot.textContent.indexOf('长安十二时辰 · ') >= 0 &&
          wingRoot.textContent.indexOf('长安十二时辰 · 长安十二时辰') < 0 ? 'OK' : 'FAIL'],
        ['纸书签 3 枚', wingRoot && wingRoot.querySelectorAll('.rk-bookmark').length === 3 ? 'OK' : 'FAIL']
      );

      // ---- paper 空态：无摘录且在读不足 3 本，收缩为一行提示 ----
      RK.wing.mount(s, { quotes: [], log: [], stats: {} });
      const pEmpty = wingHost.shadowRoot.querySelector('.rk-wing');
      rows.push(
        ['paper 空态收缩为一行提示', pEmpty && pEmpty.querySelectorAll('.rk-slip,.rk-bookmark').length === 0 &&
          pEmpty.querySelector('.rk-wing-note') ? 'OK' : 'FAIL']
      );

      // ---- gallery 墙上的书 ----
      s = await RK.saveSettings({ theme: 'gallery' });
      RK.theme.apply(s);
      RK.wing.mount(s, fixture);
      const gRoot = wingHost.shadowRoot.querySelector('.rk-wing');
      const spines = gRoot ? gRoot.querySelectorAll('.rk-spine') : [];
      rows.push(
        ['gallery 宿主复用（不新增节点）', env.document.querySelectorAll('[data-rk-wing]').length === 1 ? 'OK' : 'FAIL'],
        ['书脊 3 根 = 在读 3 本', spines.length === 3 ? 'OK' : 'FAIL'],
        ['书脊形态稳定（宽高内联）', spines[0] && /\d+px/.test(String(spines[0].style.width)) ? 'OK' : 'FAIL'],
        ['无题签卡片（信息去重）', gRoot && !gRoot.querySelector('.rk-plate') ? 'OK' : 'FAIL'],
        ['gallery 空态收缩为一行提示', (() => {
          RK.wing.mount(s, { quotes: [], log: [{ book: '西西弗神话', progress: '67%', href: '/web/reader/x', at: Date.now() }], stats: {} });
          const g = wingHost.shadowRoot.querySelector('.rk-wing');
          return g && g.querySelectorAll('.rk-spine').length === 0 && g.querySelector('.rk-wing-note') ? 'OK' : 'FAIL';
        })()]
      );

      // ---- pastel 读过的日子 ----
      s = await RK.saveSettings({ theme: 'pastel' });
      RK.theme.apply(s);
      RK.wing.mount(s, fixture);
      const pRoot = wingHost.shadowRoot.querySelector('.rk-wing');
      const dots = pRoot ? pRoot.querySelectorAll('.rk-cal-dot') : [];
      const lit = (pRoot ? pRoot.querySelectorAll('.rk-cal-dot[data-level="1"],.rk-cal-dot[data-level="2"],.rk-cal-dot[data-level="3"]') : []).length;
      rows.push(
        ['日历 35 个点', dots.length === 35 ? 'OK' : 'FAIL'],
        ['亮起的点 3 个', lit === 3 ? 'OK' : 'FAIL'],
        ['今天有外圈标记', pRoot && pRoot.querySelector('.rk-cal-dot.is-today') ? 'OK' : 'FAIL'],
        ['本周合计', pRoot && pRoot.textContent.indexOf('1 小时 15 分') >= 0 ? 'OK' : 'FAIL'],
        ['连着 2 天（今天为 0 时从昨天起算的反向：今天有值）', pRoot && pRoot.textContent.indexOf('2 天') >= 0 ? 'OK' : 'FAIL']
      );

      // ---- pastel 空态：有记录的天数不足 3 天，日历不渲染 ----
      RK.wing.mount(s, { quotes: [], log: [], stats: {} });
      const eRoot = wingHost.shadowRoot.querySelector('.rk-wing');
      rows.push(
        ['pastel 空态收缩为一行提示', eRoot && eRoot.querySelectorAll('.rk-cal-dot').length === 0 &&
          eRoot.querySelector('.rk-wing-note') ? 'OK' : 'FAIL']
      );

      // ---- 开关关闭：连宿主都不留 ----
      s = await RK.saveSettings({ theme: 'pastel', deskModules: { wingTime: false } });
      RK.theme.apply(s);
      RK.wing.mount(s, fixture);
      rows.push(['关闭 wingTime 后宿主移除', env.document.querySelector('[data-rk-wing]') ? 'FAIL 仍存在' : 'OK 已移除']);

      // ---- 卸载还原 ----
      s = await RK.saveSettings({ deskModules: { wingTime: true } });
      RK.wing.mount(s, fixture);
      RK.wing.unmount();
      rows.push(['手动卸载', env.document.querySelector('[data-rk-wing]') ? 'FAIL 仍存在' : 'OK 已移除']);

      results.push(['主题专属区', rows]);
      results.push(['专属区还原', [
        ['书桌仍在', env.document.querySelector('[data-rk-desk]') ? 'OK' : 'FAIL 误删书桌'],
        ['宿主清零', env.document.querySelector('[data-rk-wing]') ? 'FAIL' : 'OK']
      ]]);
    })
    .catch((e) => {
      results.push(['主题专属区', [['异常', String(e && e.stack || e)]]]);
    });
}

/* 替换式挂载（2026-11-02 起）：书桌原地顶掉登录态首页的原生「继续阅读」分区 */
function scenarioReplace() {
  const env = buildEnv('wr_theme_light wr_desktop wr_apple', {
    path: '/',
    build(doc, html, body) {
      const wrapper = new Node('div');
      wrapper.className = 'wr_index_page_wrapper';
      const content = new Node('div');
      content.className = 'wr_index_page_content_wrapper';
      const section = new Node('div');
      section.className = 'wr_index_page_top_section_wrapper';

      const header = new Node('div');
      header.className = 'wr_index_page_top_section_header_wrapper';
      const action = new Node('div');
      action.className = 'wr_index_page_top_section_header_action';
      const link = new Node('a');
      link.setAttribute('href', '/web/category/all');
      link.textContent = '查看全部 · 22 个';
      action.appendChild(link);
      header.appendChild(action);

      const contentBox = new Node('div');
      contentBox.className = 'wr_index_page_top_section_content_wrapper';
      const card = new Node('a');
      card.className = 'wr_index_page_category_list_content_card';
      card.textContent = '精品小说42563 本书籍';
      contentBox.appendChild(card);

      section.appendChild(header);
      section.appendChild(contentBox);
      content.appendChild(section);
      wrapper.appendChild(content);
      body.appendChild(wrapper);
    }
  });

  run(env);
  const RK = env.ctx.__RK__;
  // 原生分区引用与锚点判断必须在挂载前取：替换后它已不在文档里
  const section = env.document.querySelector('.wr_index_page_top_section_wrapper');
  const content = env.document.querySelector('.wr_index_page_content_wrapper');
  const anchorBefore = RK.adapter.deskAnchor();
  RK.getSettings().then((s) => {
    RK.theme.apply(s);
    RK.desk.mount(s, { quotes: [], log: [{ book: '活着', chapter: '第一章', progress: '12%', href: '/web/reader/x', at: Date.now() }], stats: {} });

    const deskHost = env.document.querySelector('[data-rk-desk]');
    const headLink = deskHost && deskHost.shadowRoot.querySelector('.rk-desk-head-link');

    results.push(['替换式挂载', [
      ['书桌挂载', deskHost ? 'OK' : 'FAIL'],
      ['锚点模式', anchorBefore && anchorBefore.mode === 'replace' && anchorBefore.selector === '.wr_index_page_top_section_wrapper'
        ? 'OK（replace）' : 'FAIL（' + (anchorBefore && anchorBefore.mode) + '）'],
      ['原生分区被顶掉', !env.document.contains(section) ? 'OK' : 'FAIL 仍在文档'],
      ['书桌占住原生位置', deskHost && deskHost.parentNode === content ? 'OK' : 'FAIL'],
      ['「查看全部」入口保留', headLink && headLink.getAttribute('href') === '/web/category/all' &&
        headLink.textContent.indexOf('22') >= 0 ? 'OK' : 'FAIL']
    ]]);

    // 卸载：原生分区必须放回原位（干净还原）
    RK.desk.unmount();
    results.push(['替换式还原', [
      ['书桌移除', env.document.querySelector('[data-rk-desk]') ? 'FAIL 仍存在' : 'OK 已移除'],
      ['原生分区复位', env.document.contains(section) &&
        section.textContent.indexOf('精品小说') >= 0 ? 'OK' : 'FAIL']
    ]]);
  }).catch((e) => {
    results.push(['替换式挂载', [['异常', String(e && e.stack || e)]]]);
  });
}

let failed = false;
const origError = console.error;
console.error = (...args) => {
  failed = true;
  origError('  [页面内报错]', ...args);
};

try {
  scenarioHome();
  scenarioReplace();
  scenarioWing();
  scenarioReader();
  scenarioUnknown();
} catch (e) {
  failed = true;
  origError('运行异常：', e);
}

setTimeout(() => {
  console.log('');
  results.forEach(([title, rows]) => {
    console.log('【' + title + '】');
    rows.forEach(([k, v]) => {
      if (String(v).startsWith('FAIL')) failed = true;
      console.log('  ' + k + '：' + v);
    });
  });
  console.log('');
  console.log(failed ? '结果：有问题，需要修' : '结果：全部通过');
  process.exit(failed ? 1 : 0);
}, 800);
