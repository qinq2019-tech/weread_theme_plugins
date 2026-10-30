/*
 * 真实页面验证：用 CDP 驱动 headless Chrome 打开线上微信读书，
 * 手动注入扩展脚本（无头模式不加载扩展），验证：
 *   1) 适配层能在真实 DOM 上命中锚点
 *   2) 书桌/功能坞真的挂载、主题属性写入
 *   3) 注入过程无异常
 * 用法：node /tmp/rk-live.js <扩展目录> <url> <截图输出>
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.argv[2];
const URL = process.argv[3] || 'https://weread.qq.com/web/';
const SHOT = process.argv[4] || '/tmp/rk-live.png';
// 端口按进程号随机化：连续两次运行时，上一次的 Chrome 若还没死透，
// 固定端口会让本次 CDP 连到旧实例（旧桩、旧页面），现象极其诡异
const PORT = 9300 + (process.pid % 2000);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

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

// 最小 chrome.* 桩：注入到主世界时没有扩展 API，补一层让脚本能跑。
// local 必须是真实的内存存储，否则 POST 注入的 fixture 与主题切换会被静默丢弃。
const CHROME_STUB = `
(function () {
  var store = {};
  var listeners = [];
  function fire(obj) {
    var changes = {};
    Object.keys(obj).forEach(function (k) { changes[k] = { newValue: obj[k] }; });
    listeners.forEach(function (fn) {
      try { fn(changes, 'local'); } catch (e) {}
    });
  }
  window.chrome = {
    storage: {
      local: {
        get(keys, cb) {
          var out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach(function (k) {
            if (k in store) out[k] = JSON.parse(JSON.stringify(store[k]));
          });
          cb && cb(out);
        },
        set(obj, cb) {
          Object.assign(store, JSON.parse(JSON.stringify(obj)));
          fire(obj);
          cb && cb();
        }
      },
      session: { get(k, cb) { cb && cb({}); }, set(o, cb) { cb && cb(); } },
      onChanged: { addListener(fn) { listeners.push(fn); } }
    },
    runtime: {
      id: 'live-test',
      lastError: null,
      onMessage: { addListener() {} },
      sendMessage() {},
      openOptionsPage() {}
    },
    tabs: { query(o, cb) { cb([]); }, sendMessage() {} }
  };
})();
`;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const profile = '/tmp/rk-live-profile';
  fs.rmSync(profile, { recursive: true, force: true });

  const child = spawn(CHROME, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    '--window-size=1280,1600',
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 还没起来 */ }
  }
  if (!target) {
    console.error('CDP 未就绪');
    child.kill();
    process.exit(1);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const waiting = new Map();
  const errors = [];

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push(d.exception ? `${d.exception.description || d.text}` : d.text);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errors.push('[console] ' + msg.params.entry.text);
    }
  });

  await new Promise((r) => ws.addEventListener('open', r));

  function send(method, params) {
    return new Promise((resolve) => {
      const mid = ++id;
      waiting.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
  }

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    });
    if (res.result && res.result.exceptionDetails) {
      errors.push(res.result.exceptionDetails.text + ' ' +
        (res.result.exceptionDetails.exception ? res.result.exceptionDetails.exception.description : ''));
    }
    return res.result && res.result.result ? res.result.result.value : undefined;
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  await send('Page.navigate', { url: URL });

  // 等页面真正把首页结构渲染出来（新版 .home_page_container / 旧版 .wr_index_page_wrapper）
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    ready = await evaluate(
      'document.readyState === "complete" && !!document.querySelector(".home_page_container, .wr_index_page_wrapper")'
    );
    if (ready) break;
  }

  if (!ready) {
    console.error('页面结构未在预期时间内出现，无法验证');
  }

  // 注入 chrome 桩 + 全部内容脚本
  await evaluate(CHROME_STUB);
  for (const rel of SCRIPTS) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const res = await send('Runtime.evaluate', { expression: code, userGesture: true });
    if (res.result && res.result.exceptionDetails) {
      errors.push(rel + ' → ' + (res.result.exceptionDetails.exception
        ? res.result.exceptionDetails.exception.description
        : res.result.exceptionDetails.text));
    }
  }

  // 注入页面级 CSS（manifest 的 content_scripts.css 在手动注入时不会自动生效）
  const css = fs.readFileSync(path.join(ROOT, 'src/content/page-theme.css'), 'utf8');
  await evaluate('(function(){var s=document.createElement("style");s.setAttribute("data-rk-css","1");s.textContent=' + JSON.stringify(css) + ';document.head.appendChild(s);})()');

  await sleep(2200);
  const POST = process.argv[5];
  if (POST) {
    const r2 = await send('Runtime.evaluate', { expression: POST, userGesture: true, awaitPromise: true });
    if (r2.result && r2.result.exceptionDetails) {
      errors.push('POST → ' + (r2.result.exceptionDetails.exception
        ? r2.result.exceptionDetails.exception.description
        : r2.result.exceptionDetails.text));
    }
    await sleep(1200);
  }
  await evaluate('window.scrollTo(0,0)');
  await sleep(300);

  const diag = await evaluate(`(function(){
    var RK = window.__RK__;
    if (!RK) return { fail: 'RK 未初始化' };
    var r = RK.adapter.report();
    r.deskDom = !!document.querySelector('[data-rk-desk]');
    r.dockDom = !!document.querySelector('[data-rk-dock]');
    r.wingDom = !!document.querySelector('[data-rk-wing]');
    var wing = document.querySelector('[data-rk-wing]');
    if (wing && wing.shadowRoot) {
      var wroot = wing.shadowRoot.querySelector('.rk-wing');
      r.wingTheme = wroot && wroot.getAttribute('data-wing-theme');
      r.wingSlips = wing.shadowRoot.querySelectorAll('.rk-slip').length;
      r.wingMarks = wing.shadowRoot.querySelectorAll('.rk-bookmark').length;
      r.wingSpines = wing.shadowRoot.querySelectorAll('.rk-spine').length;
      r.wingDots = wing.shadowRoot.querySelectorAll('.rk-cal-dot').length;
      var spine = wing.shadowRoot.querySelector('.rk-spine');
      r.wingSpineSample = spine && spine.style.width + '/' + spine.style.height;
      var wb = wing.getBoundingClientRect();
      r.wingRect = [Math.round(wb.x), Math.round(wb.y), Math.round(wb.width), Math.round(wb.height)];
    }
    r.htmlOn = document.documentElement.getAttribute('data-rk-on');
    r.match = document.documentElement.getAttribute('data-rk-theme-match');
    r.siteMode = document.documentElement.getAttribute('data-rk-site-mode');
    r.canvas = getComputedStyle(document.body).backgroundColor;
    r.errors = window.__RK_ERRORS__ || [];
    var dock = document.querySelector('[data-rk-dock]');
    if (dock) {
      var db = dock.getBoundingClientRect();
      r.dockRect = [Math.round(db.x), Math.round(db.y), Math.round(db.width), Math.round(db.height)];
      r.dockPos = getComputedStyle(dock).position;
      var fab = dock.shadowRoot && dock.shadowRoot.querySelector('.rk-fab');
      if (fab) {
        var fb = fab.getBoundingClientRect();
        var fs = getComputedStyle(fab);
        r.fabRect = [Math.round(fb.x), Math.round(fb.y), Math.round(fb.width), Math.round(fb.height)];
        r.fabStyle = { display: fs.display, opacity: fs.opacity, vis: fs.visibility, position: fs.position, z: fs.zIndex, bg: fs.backgroundColor };
      } else {
        r.fabRect = 'shadow 内没有 .rk-fab';
      }
      r.shadowHasStyle = !!(dock.shadowRoot && dock.shadowRoot.querySelector('style'));
    } else {
      r.dockRect = 'no dock';
    }
    return r;
  })()`);

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (shot.result && shot.result.data) {
    fs.writeFileSync(SHOT, Buffer.from(shot.result.data, 'base64'));
  }

  // 存储读回：确认 POST 的写入真的落了桩、boot 的设置读回是否一致
  const storeCheck = await evaluate(
    `window.__RK__.getSettings().then(function(s){
       return window.__RK__.getData().then(function(d){
         return { themeInStorage: s.theme, quotesInStorage: (d.quotes || []).length,
                  statsInStorage: Object.keys(d.stats || {}).length,
                  htmlTheme: document.documentElement.getAttribute('data-rk-theme') };
       });
     })`
  );

  console.log(JSON.stringify({ diag, storeCheck, errors }, null, 2));

  ws.close();
  child.kill();
  // 等 Chrome 真正退出，避免残留实例干扰下一次运行
  await Promise.race([
    new Promise((r) => child.once('exit', r)),
    sleep(3000).then(() => child.kill('SIGKILL'))
  ]);
}

main().catch((e) => {
  console.error('失败：', e);
  process.exit(1);
});
