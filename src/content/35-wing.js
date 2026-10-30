/*
 * 微信读书 · 书房｜主题专属内容区（.rk-wing）
 *
 * 书桌旁边「摊开的那页纸」：每套主题在这里长出自己的模块，体现的不是换配色，
 * 而是换内容气质。规格：docs/v0.2-design.md「视觉方向」§2–§8。
 *
 *   paper   → 摘句墙   便笺叠 + 纸书签   （数据：quotes[] + log[]）
 *   gallery → 墙上的书 书脊墙 + 题签     （数据：log[]）
 *   pastel  → 读过的日子 35 点日历 + 轻记 （数据：stats{}）
 *
 * 关键决策：
 * 1. 只渲染当前主题对应的那一个模块，另两个不产生任何 DOM；
 *    对应开关（deskModules.wingPaper / wingGallery / wingTime）关闭时连宿主都不留，
 *    否则书桌下方会多出一段幽灵留白。
 * 2. 与书桌的差别是「没有框」：专属区不加边框/底色/阴影/纸纹，层级靠书桌那张卡说话。
 * 3. 所有颜色走 var(--rk-*) 令牌，JS 里不写死 hex；书脊的宽高与色档由书名 hash 决定，
 *    同一本书每次刷新形态不变。
 * 4. 只挂首页（书架页未登录实测过，v0.2 不在那里挂任何东西）。
 */
(function () {
  'use strict';

  var RK = window.__RK__;
  if (!RK || !RK.adapter) return;

  var HOST_ATTR = 'data-rk-wing';
  var MOUNTED = null;

  /* ---------------- 纯函数（不进 00-core，模块私有） ---------------- */

  // djb2：同一本书每次刷新得到同一个 hash，书脊形态因此稳定
  function hashName(name) {
    var s = String(name || '');
    var h = 5381;
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  function keyOf(d) {
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    if (m.length < 2) m = '0' + m;
    if (day.length < 2) day = '0' + day;
    return d.getFullYear() + '-' + m + '-' + day;
  }

  // 相对时间：刚刚 / 今天 / 昨天 / N 天前 / N 个月前 / N 年前（§10 与摘录管理对齐）
  function relativeTime(ts) {
    var t = Number(ts);
    if (!t || !isFinite(t)) return '';
    var now = new Date();
    var d = new Date(t);
    var startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var startD = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var days = Math.round((startNow - startD) / 86400000);
    if (days < 0) return '';
    if (days === 0) return now.getTime() - t < 3600000 ? '刚刚' : '今天';
    if (days === 1) return '昨天';
    if (days < 30) return days + ' 天前';
    if (days < 365) return Math.floor(days / 30) + ' 个月前';
    return Math.floor(days / 365) + ' 年前';
  }

  // 显示层借用规则（与摘录管理 §5.3 同一套）：老数据把书名存在 source 里
  function displayBook(q) {
    return (q && (String(q.book || '').trim() || String(q.source || '').trim())) || '';
  }

  function validQuotes(quotes) {
    return (quotes || []).filter(function (q) {
      return q && typeof q.text === 'string' && q.text.trim();
    });
  }

  function sortedLog(data) {
    return (data.log || []).slice().sort(function (a, b) {
      return (b.at || 0) - (a.at || 0);
    });
  }

  function parseProgress(p) {
    if (p == null) return null;
    var v = parseFloat(p);
    if (isNaN(v) || v < 0 || v > 100) return null;
    return v;
  }

  // 竖排文字的 ASCII 兜底（§2.1）：中英混排超过 3 个 ASCII 就换 text-orientation 并截短
  function asciiCount(s) {
    return (String(s).match(/[\x20-\x7E]/g) || []).length;
  }

  function clipName(name, max) {
    var s = String(name || '').trim();
    if (!s) return '';
    return s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s;
  }

  function spineCap() {
    var w = (typeof window !== 'undefined' && window.innerWidth) || 1280;
    return w < 1000 ? 7 : w < 1280 ? 10 : 14;
  }

  /* ---------------- 公共骨架 ---------------- */

  function wingRoot(themeId) {
    var mode = 'light';
    try {
      mode = document.documentElement.getAttribute('data-rk-mode') || 'light';
    } catch (e) {}
    return RK.h('section', {
      class: 'rk-scope rk-wing',
      attrs: { 'data-wing-theme': themeId, 'data-mode': mode }
    });
  }

  function wingHead(eyebrow, title, sub) {
    var head = RK.h('div', { class: 'rk-wing-head' }, [
      RK.h('span', { class: 'rk-wing-eyebrow', text: eyebrow }),
      RK.h('h3', { class: 'rk-wing-title', text: title })
    ]);
    if (sub) head.appendChild(RK.h('span', { class: 'rk-wing-sub', text: sub }));
    return head;
  }

  /* ---------------- paper · 摘句墙 ---------------- */

  function buildSlip(q) {
    var name = displayBook(q);
    var rel = relativeTime(q.at);
    var metaParts = [name, rel].filter(Boolean);
    var slip = RK.h('div', { class: 'rk-slip' }, [
      RK.h('div', { class: 'rk-slip-text', text: q.text })
    ]);
    if (metaParts.length) {
      slip.appendChild(RK.h('div', { class: 'rk-slip-meta', text: metaParts.join(' · ') }));
    }
    return slip;
  }

  function buildSlipEmpty(text, withButton) {
    var box = RK.h('div', { class: 'rk-slip rk-slip-empty' }, [
      RK.h('div', { class: 'rk-slip-empty-text', text: text })
    ]);
    if (withButton) {
      box.appendChild(RK.h('button', {
        class: 'rk-btn rk-ghost rk-slip-btn',
        text: '留一句',
        attrs: { type: 'button' },
        on: {
          click: function () {
            RK.bus.emit('dock:open', { focus: 'quote' });
          }
        }
      }));
    }
    return box;
  }

  function buildBookmark(entry) {
    if (!entry) {
      // 空书签：内部无文字——空书架比「没有书架」更像一个房间
      return RK.h('div', { class: 'rk-bookmark rk-bookmark-empty' });
    }
    var bm = RK.h('div', { class: 'rk-bookmark', attrs: { title: entry.book || '' } });
    var name = clipName(entry.book || '', 9);
    if (name && asciiCount(name) <= 3) {
      bm.appendChild(RK.h('span', { class: 'rk-bookmark-name', text: name }));
    } else if (name) {
      bm.appendChild(RK.h('span', {
        class: 'rk-bookmark-name rk-bookmark-name-mixed',
        text: clipName(entry.book || '', 6)
      }));
    }
    var pct = parseProgress(entry.progress);
    if (pct != null) {
      var bar = RK.h('div', { class: 'rk-bookmark-progress' });
      bar.appendChild(RK.h('i', { style: { width: Math.max(2, pct) + '%' } }));
      bm.appendChild(bar);
    }
    return bm;
  }

  function buildPaper(settings, data) {
    var root = wingRoot('paper');
    root.appendChild(wingHead('私人书房 · 摘句', '摘句墙', '更早留下的句子，按时间从上往下。'));
    var body = RK.h('div', { class: 'rk-wing-body' });
    var slips = RK.h('div', { class: 'rk-slips' });
    var marks = RK.h('div', { class: 'rk-bookmarks' });

    var quotes = validQuotes(data.quotes);
    var deskQuoteOn = settings.deskModules && settings.deskModules.quote !== false;
    // 书桌「最近一句」已展示最新一条：跳过它，避免同一句话在一页出现两次
    var picks = deskQuoteOn ? quotes.slice(-4, -1) : quotes.slice(-3);
    picks = picks.slice().reverse();

    if (picks.length) {
      picks.forEach(function (q) {
        slips.appendChild(buildSlip(q));
      });
    } else {
      var msg = quotes.length
        ? '再记一句，这里会排成一小叠。'
        : '还没留下句子。读到打动你的一句，从右下角的圆钮记下来。';
      slips.appendChild(buildSlipEmpty(msg, !quotes.length));
    }

    var logs = sortedLog(data).slice(0, 3);
    var wide = (window.innerWidth || 1280) >= 1280;
    var markCount = wide ? 3 : 2;
    for (var i = 0; i < markCount; i++) {
      marks.appendChild(buildBookmark(logs[i] || null));
    }

    body.appendChild(slips);
    body.appendChild(marks);
    root.appendChild(body);
    return root;
  }

  /* ---------------- gallery · 墙上的书 ---------------- */

  function buildSpine(entry) {
    var h = hashName(entry.book || '');
    var widths = [14, 20, 28];
    var heights = [126, 132, 138];
    var tone = h % 3;
    // 必须用无符号右移：h 最大到 2^32-1，带符号 >> 会得到负索引，档位取成 undefined
    var width = widths[(h >>> 3) % 3];
    var height = heights[(h >>> 5) % 3];

    var tag = entry.href ? 'a' : 'div';
    var spine = RK.h(tag, {
      class: 'rk-spine',
      attrs: {
        'data-linked': entry.href ? '1' : '0',
        title: entry.book || ''
      },
      style: {
        width: width + 'px',
        height: height + 'px',
        background: 'var(--rk-spine-' + (tone + 1) + ')'
      }
    });
    if (entry.href) {
      spine.setAttribute('href', entry.href);
      spine.addEventListener('click', function (e) {
        e.preventDefault();
        location.href = entry.href;
      });
    }
    // 宽度 14px 的书脊不显示文字；16px 及以上才显示，字数按高度算（垂直居中后两头都会被切）
    if (width >= 16) {
      var max = Math.floor((height - 24) / 13);
      var name = clipName(entry.book || '', max);
      if (name) spine.appendChild(RK.h('span', { class: 'rk-spine-label', text: name }));
    }
    return spine;
  }

  function buildPlate(entry) {
    var plate = RK.h('div', { class: 'rk-plate' });
    plate.appendChild(RK.h('span', { class: 'rk-eyebrow', text: '最近在读' }));

    if (!entry) {
      // 空态：题签变成入口，而不是空盒
      plate.appendChild(RK.h('div', { class: 'rk-plate-title', text: '从书架挑一本' }));
      plate.appendChild(RK.h('a', {
        class: 'rk-plate-link',
        text: '书架 →',
        attrs: { href: '/web/shelf' },
        on: {
          click: function (e) {
            e.preventDefault();
            location.href = '/web/shelf';
          }
        }
      }));
      return plate;
    }

    var longTitle = (entry.book || '').length > 14;
    plate.appendChild(RK.h('div', { class: 'rk-plate-title', text: entry.book || '' }));
    // 题签高度固定 168px：优先舍作者行，再舍百分比（进度条保留），绝不让题签变高
    if (!longTitle && entry.author) {
      plate.appendChild(RK.h('div', { class: 'rk-plate-author', text: entry.author }));
    }
    var pct = parseProgress(entry.progress);
    var foot = RK.h('div', { class: 'rk-plate-foot' });
    if (pct != null) {
      var bar = RK.h('div', { class: 'rk-plate-progress' });
      bar.appendChild(RK.h('i', { style: { width: Math.max(2, pct) + '%' } }));
      foot.appendChild(bar);
      if ((entry.book || '').length <= 20) {
        foot.appendChild(RK.h('div', { class: 'rk-plate-pct', text: Math.round(pct) + '%' }));
      }
    }
    if (entry.href) {
      foot.appendChild(RK.h('a', {
        class: 'rk-plate-link',
        text: '继续读 →',
        attrs: { href: entry.href },
        on: {
          click: function (e) {
            e.preventDefault();
            location.href = entry.href;
          }
        }
      }));
    }
    plate.appendChild(foot);
    return plate;
  }

  function buildGallery(settings, data) {
    var root = wingRoot('gallery');
    root.appendChild(wingHead('书架画廊 · 书脊', '墙上的书'));
    var body = RK.h('div', { class: 'rk-wing-body' });
    var wall = RK.h('div', { class: 'rk-spine-wall' });
    var logs = sortedLog(data).slice(0, spineCap());

    if (logs.length) {
      logs.forEach(function (entry) {
        wall.appendChild(buildSpine(entry));
      });
    } else {
      wall.appendChild(RK.h('div', {
        class: 'rk-spine-empty',
        text: '书架还空着。打开一本书，它会站在这里。'
      }));
    }

    body.appendChild(wall);
    body.appendChild(buildPlate(logs[0] || null));
    root.appendChild(body);
    return root;
  }

  /* ---------------- pastel · 读过的日子 ---------------- */

  function daySeconds(stats, d) {
    var rec = stats && stats[keyOf(d)];
    return (rec && rec.seconds) || 0;
  }

  function heatLevel(minutes) {
    if (minutes <= 0) return 0;
    if (minutes < 15) return 1;
    if (minutes < 40) return 2;
    return 3;
  }

  function buildPastel(settings, data) {
    var root = wingRoot('pastel');
    root.appendChild(wingHead('轻彩空间 · 日历', '读过的日子'));
    var body = RK.h('div', { class: 'rk-wing-body' });
    var stats = data.stats || {};
    var today = new Date();
    var todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // 左列：7 列 × 5 行 = 最近 35 天；未来日期不占位不画灰点
    var calWrap = RK.h('div', { class: 'rk-cal-wrap' });
    var calBox = RK.h('div', { class: 'rk-cal-box' });
    var week = RK.h('div', { class: 'rk-cal-week' });
    ['一', '二', '三', '四', '五', '六', '日'].forEach(function (w) {
      week.appendChild(RK.h('span', { text: w }));
    });
    var cal = RK.h('div', { class: 'rk-cal' });

    for (var i = 0; i < 35; i++) {
      var d = new Date(todayStart.getTime() - (34 - i) * 86400000);
      var mins = daySeconds(stats, d) / 60;
      var dow = (d.getDay() + 6) % 7; // 周一 = 0
      var dot = RK.h('i', {
        class: 'rk-cal-dot' + (i === 34 ? ' is-today' : ''),
        attrs: {
          'data-level': String(heatLevel(mins)),
          title: (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · ' +
            (mins > 0 ? Math.round(mins) + ' 分钟' : '没有记录')
        },
        style: { 'grid-column': String(dow + 1) }
      });
      cal.appendChild(dot);
    }
    calBox.appendChild(week);
    calBox.appendChild(cal);
    calWrap.appendChild(calBox);

    // 右列：轻记三行；任一值不存在就整行不渲染
    var figures = RK.h('div', { class: 'rk-figures' });
    var weekTotal = 0;
    for (var j = 0; j < 7; j++) {
      weekTotal += daySeconds(stats, new Date(todayStart.getTime() - j * 86400000));
    }
    if (weekTotal > 0) {
      figures.appendChild(RK.h('div', { class: 'rk-figure-row' }, [
        RK.h('span', { class: 'rk-figure-label', text: '本周' }),
        RK.h('span', { class: 'rk-figure', text: RK.formatMinutes(weekTotal / 60) })
      ]));
    }

    // 连着：今天为 0 则从昨天起算，否则新用户第一天就像断签
    var streak = 0;
    var cursor = new Date(todayStart.getTime());
    if (daySeconds(stats, cursor) <= 0) cursor = new Date(cursor.getTime() - 86400000);
    while (streak < 999 && daySeconds(stats, cursor) > 0) {
      streak++;
      cursor = new Date(cursor.getTime() - 86400000);
    }
    if (streak > 0) {
      figures.appendChild(RK.h('div', { class: 'rk-figure-row' }, [
        RK.h('span', { class: 'rk-figure-label', text: '连着' }),
        RK.h('span', { class: 'rk-figure', text: streak + ' 天' })
      ]));
    }

    var earliest = null;
    Object.keys(stats).forEach(function (k) {
      var rec = stats[k];
      if (rec && rec.seconds > 0 && (!earliest || k < earliest)) earliest = k;
    });
    if (earliest) {
      var p = earliest.split('-');
      figures.appendChild(RK.h('div', { class: 'rk-figure-row' }, [
        RK.h('span', { class: 'rk-figure-label', text: '最早' }),
        RK.h('span', { class: 'rk-figure', text: Number(p[1]) + ' 月 ' + Number(p[2]) + ' 日' })
      ]));
    }

    var todayMins = daySeconds(stats, todayStart) / 60;
    if (todayMins <= 0) {
      figures.appendChild(RK.h('div', { class: 'rk-wing-guide', text: '今天还没开始。翻开就是开始。' }));
      if (!Object.keys(stats).length) {
        figures.appendChild(RK.h('div', { class: 'rk-wing-guide', text: '读几分钟，这里会亮起一个点。' }));
      }
    }

    body.appendChild(calWrap);
    body.appendChild(figures);
    root.appendChild(body);
    return root;
  }

  /* ---------------- 挂载 / 卸载 ---------------- */

  function moduleFor(settings) {
    var themeId = settings.theme;
    var key = { paper: 'wingPaper', gallery: 'wingGallery', pastel: 'wingTime' }[themeId];
    if (!key) return null;
    if (settings.deskModules && settings.deskModules[key] === false) return null;
    var build = { paper: buildPaper, gallery: buildGallery, pastel: buildPastel }[themeId];
    return build ? { key: key, build: build } : null;
  }

  function mount(settings, data) {
    RK._lastWingState = { settings: settings, data: data };
    if (RK.adapter.detectPage() !== 'home') {
      unmount();
      return null;
    }
    if (!settings || !settings.enabled) {
      unmount();
      return null;
    }
    var mod = moduleFor(settings);
    if (!mod) {
      unmount();
      return null;
    }
    if (MOUNTED && document.contains(MOUNTED)) {
      refresh(settings, data);
      return MOUNTED;
    }
    if (!RK.lock('wing')) return MOUNTED;

    var host = RK.adapter.deskHost();
    if (!host) {
      RK.warn('未找到首页内容区，主题专属区不挂载');
      RK.unlock('wing');
      return null;
    }

    var el = document.createElement('div');
    el.setAttribute(HOST_ATTR, '1');
    // 宿主定位写内联：Shadow 内的属性选择器选不到宿主
    el.style.cssText = 'display:block;position:relative;margin:0;padding:0;';

    var shadow = el.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = RK.UI_CSS;
    shadow.appendChild(style);

    var box = mod.build(settings, data);
    box.settings = settings;
    box.data = data;
    shadow.appendChild(box);

    // 位置：书桌之后；书桌没挂就插在内容区最前
    var deskEl = document.querySelector('[data-rk-desk]');
    if (deskEl && deskEl.parentNode === host.node) {
      host.node.insertBefore(el, deskEl.nextSibling);
    } else {
      host.node.insertBefore(el, host.node.firstChild);
    }

    MOUNTED = el;
    RK.unlock('wing');
    RK.log('主题专属区已挂载 →', host.selector, settings.theme);
    return el;
  }

  function unmount() {
    if (MOUNTED && MOUNTED.parentNode) MOUNTED.parentNode.removeChild(MOUNTED);
    MOUNTED = null;
  }

  function refresh(settings, data) {
    if (!MOUNTED || !MOUNTED.shadowRoot) return;
    var mod = moduleFor(settings);
    if (!mod) {
      unmount();
      return;
    }
    var old = MOUNTED.shadowRoot.querySelector('.rk-wing');
    if (!old) return;
    var next = mod.build(settings, data);
    next.settings = settings;
    next.data = data;
    MOUNTED.shadowRoot.replaceChild(next, old);
  }

  RK.wing = {
    mount: mount,
    unmount: unmount,
    refresh: refresh,
    get mounted() {
      return !!MOUNTED;
    }
  };

  // 窄屏断点会改变书脊数量上限，只对 gallery 有意义；静默重绘
  window.addEventListener('resize', RK.debounce(function () {
    if (!MOUNTED || !RK._lastWingState) return;
    refresh(RK._lastWingState.settings, RK._lastWingState.data);
  }, 300));
})();
