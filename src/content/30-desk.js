/*
 * 微信读书 · 书房｜首页「我的书桌」
 *
 * 这是「让页面更丰富」的主承载。
 * 挂载方式（2026-11-02 起，替换式）：登录态首页命中原生「继续阅读」分区时，
 * 书桌原地替换该分区——位置与宽度自动继承原生栅格，原生内容不被下推；
 * 原生分区的「查看全部 · N 个」入口保留为书桌头部的小链接。
 * 其它首页结构回退为插在内容区最前（旧行为）。
 *
 * 关键决策：
 * 1. 全部渲染在 Shadow DOM 里。站点是 Nuxt + Vue，全局样式和 class 名都很容易打架，
 *    隔离后我们的视觉不受站点改版影响，也不会污染站点。
 * 2. 只读本机记录：继续阅读来自本机阅读日志（用户在阅读器停留时记录的书名/章节），
 *    封面借用当前页面已经渲染好的图片，不请求任何接口。
 * 3. 挂载点找不到就安静降级（只在控制台留诊断信息），不硬塞到不确定的位置。
 * 4. 卸载时把被替换的原生分区放回原位——「干净还原」是铁律。
 */
(function () {
  'use strict';

  var RK = window.__RK__;
  if (!RK || !RK.adapter) return;

  var HOST_ATTR = 'data-rk-desk';
  var MOUNTED = null;
  // 替换式挂载（2026-11-02 起）：书桌原地顶掉原生「继续阅读」分区。
  // NATIVE 记住被摘下的原生节点，卸载时放回原位，保证「关掉开关干净还原」。
  var NATIVE = null;
  // 锚点附属信息（「查看全部」入口），refresh 重建时还要用
  var ANCHOR_INFO = null;

  var RING_R = 23;
  var RING_C = 2 * Math.PI * RING_R;

  function greetingWord() {
    var h = new Date().getHours();
    if (h < 5) return '夜深了';
    if (h < 11) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  }

  function dateLine() {
    var d = new Date();
    var week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return d.getMonth() + 1 + ' 月 ' + d.getDate() + ' 日 · ' + week;
  }

  function todayMinutes(data) {
    var key = RK.todayKey();
    var rec = data.stats && data.stats[key];
    return rec && rec.seconds ? rec.seconds / 60 : 0;
  }

  function weekMinutes(data) {
    var total = 0;
    var now = new Date();
    for (var i = 0; i < 7; i++) {
      var d = new Date(now.getTime() - i * 86400000);
      var m = String(d.getMonth() + 1);
      var day = String(d.getDate());
      if (m.length < 2) m = '0' + m;
      if (day.length < 2) day = '0' + day;
      var key = d.getFullYear() + '-' + m + '-' + day;
      var rec = data.stats && data.stats[key];
      if (rec && rec.seconds) total += rec.seconds / 60;
    }
    return total;
  }

  function latestLog(data) {
    var log = (data.log || []).slice();
    if (!log.length) return null;
    log.sort(function (a, b) {
      return (b.at || 0) - (a.at || 0);
    });
    return log[0];
  }

  function buildRing(minutes, goal) {
    var pct = goal > 0 ? Math.min(1, minutes / goal) : 0;
    var offset = RING_C * (1 - pct);
    var wrap = RK.h('div', { class: 'rk-ring' });
    wrap.innerHTML =
      '<svg width="54" height="54" viewBox="0 0 54 54" aria-hidden="true">' +
      '<circle class="rk-ring-track" cx="27" cy="27" r="' + RING_R + '" fill="none" stroke-width="3"></circle>' +
      '<circle class="rk-ring-value" cx="27" cy="27" r="' + RING_R + '" fill="none" stroke-width="3" ' +
      'stroke-dasharray="' + RING_C.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '"></circle>' +
      '</svg>';
    wrap.appendChild(RK.h('div', { class: 'rk-ring-text', text: Math.round(pct * 100) + '%' }));
    return wrap;
  }

  function buildContinue(box, entry, data) {
    var resolved = entry ? RK.adapter.resolveContinue(entry) : null;

    if (!resolved) {
      var empty = RK.h('div', { class: 'rk-continue', attrs: { role: 'note' } }, [
        RK.h('div', { class: 'rk-cover', text: '书' }),
        RK.h('div', { class: 'rk-continue-body' }, [
          RK.h('div', { class: 'rk-continue-label', text: '继续阅读' }),
          RK.h('div', { class: 'rk-empty', text: '打开一本书后，这里会记住你读到哪。' })
        ])
      ]);
      box.appendChild(empty);
      return;
    }

    var cover = RK.h('div', { class: 'rk-cover' });
    if (resolved.cover) {
      var img = document.createElement('img');
      img.alt = '';
      img.src = resolved.cover;
      // 站点图片可能已失效，失败就退回文字底
      img.addEventListener('error', function () {
        img.remove();
        cover.textContent = '书';
      });
      cover.appendChild(img);
    } else {
      cover.textContent = solvedFirstChar(resolved.book);
    }

    var body = RK.h('div', { class: 'rk-continue-body' }, [
      RK.h('div', { class: 'rk-continue-label', text: '继续阅读' }),
      RK.h('div', { class: 'rk-continue-title', text: resolved.book, attrs: { title: resolved.book } }),
      RK.h('div', {
        class: 'rk-continue-sub',
        text: [resolved.chapter, resolved.author, resolved.progress].filter(Boolean).join(' · ') || '继续上次的位置'
      })
    ]);

    if (resolved.progress) {
      var pct = parseFloat(resolved.progress);
      if (!isNaN(pct)) {
        var bar = RK.h('div', { class: 'rk-progress' });
        bar.appendChild(RK.h('i', { style: { width: Math.max(2, Math.min(100, pct)) + '%' } }));
        body.appendChild(bar);
      }
    }

    var node = RK.h('a', {
      class: 'rk-continue',
      attrs: { href: resolved.href || '/web/shelf' },
      on: {
        click: function (e) {
          if (!resolved.href) return; // 没有可靠地址就交给链接默认行为
          e.preventDefault();
          location.href = resolved.href;
        }
      }
    }, [cover, body]);

    box.appendChild(node);

    var meta = RK.h('div', { class: 'rk-mini', text: '记录来自本机，不含手机端与其它设备' });
    meta.style.marginTop = '8px';
    box.appendChild(meta);
  }

  function solvedFirstChar(name) {
    var s = (name || '').trim();
    return s ? s.slice(0, 1) : '书';
  }

  function buildDesktop(settings, data) {
    var root = RK.h('div', { class: 'rk-scope rk-desk' });
    var main = RK.h('div', { class: 'rk-desk-main' });
    var side = RK.h('div', { class: 'rk-desk-side' });
    var modules = settings.deskModules || {};

    if (modules.greeting !== false) {
      var head = RK.h('div', { class: 'rk-desk-head' }, [
        RK.h('div', {}, [
          RK.h('div', { class: 'rk-eyebrow', text: '我的书桌' }),
          RK.h('div', { class: 'rk-greet rk-serif', text: greetingWord() + '，读点什么？' }),
          RK.h('div', { class: 'rk-date', text: dateLine() })
        ])
      ]);
      // 替换式挂载时保留原分区标题行的「查看全部 · N 个」入口（站点没给链接就不渲染）
      if (ANCHOR_INFO && ANCHOR_INFO.allHref && ANCHOR_INFO.allLabel) {
        head.appendChild(RK.h('a', {
          class: 'rk-desk-head-link',
          text: ANCHOR_INFO.allLabel,
          attrs: { href: ANCHOR_INFO.allHref, title: ANCHOR_INFO.allLabel }
        }));
      }
      main.appendChild(head);
    }

    if (modules.continue !== false) {
      buildContinue(main, latestLog(data), data);
    }

    if (modules.goal !== false) {
      var minutes = todayMinutes(data);
      var goal = settings.goalMinutes || 30;
      var goalCard = RK.h('div', { class: 'rk-card rk-goal' }, [
        buildRing(minutes, goal),
        RK.h('div', { class: 'rk-goal-info' }, [
          RK.h('div', { class: 'rk-goal-title', text: '今日 ' + Math.round(minutes) + ' / ' + goal + ' 分钟' }),
          RK.h('div', {
            class: 'rk-goal-sub',
            text: minutes >= goal ? '今天达标了，收工也体面' : '还差 ' + RK.formatMinutes(goal - minutes) + ' · 本周 ' + RK.formatMinutes(weekMinutes(data))
          })
        ])
      ]);
      side.appendChild(goalCard);
    }

    if (modules.quote !== false) {
      side.appendChild(buildQuote(data));
    }

    root.appendChild(main);
    if (side.childNodes.length) root.appendChild(side);
    return root;
  }

  function buildQuote(data) {
    var quotes = data.quotes || [];
    var latest = quotes.length ? quotes[quotes.length - 1] : null;

    if (!latest) {
      return RK.h('div', { class: 'rk-card' }, [
        RK.h('div', { class: 'rk-eyebrow', text: '留一句话' }),
        RK.h('div', {
          class: 'rk-quote-empty',
          text: '写一句今天想记住的话 →',
          attrs: { role: 'button', tabindex: '0' },
          on: {
            click: function () {
              RK.bus.emit('dock:open', { focus: 'quote' });
            },
            keydown: function (e) {
              if (e.key === 'Enter' || e.key === ' ') RK.bus.emit('dock:open', { focus: 'quote' });
            }
          }
        })
      ]);
    }

    return RK.h('div', { class: 'rk-card' }, [
      RK.h('div', { class: 'rk-eyebrow', text: '最近一句' }),
      RK.h('div', { class: 'rk-quote' }, [
        RK.h('div', { class: 'rk-quote-text', text: latest.text }),
        latest.source ? RK.h('div', { class: 'rk-quote-src', text: '— ' + latest.source }) : null
      ])
    ]);
  }

  function mount(settings, data) {
    var page = RK.adapter.detectPage();
    if (page !== 'home') return null;
    if (!settings.enabled || !settings.showDesk) return null;
    if (MOUNTED && document.contains(MOUNTED)) return MOUNTED;
    if (!RK.lock('desk')) return MOUNTED;

    var anchor = RK.adapter.deskAnchor();
    if (!anchor) {
      RK.warn('未找到首页内容区，书桌不挂载（可用设置页诊断查看）');
      RK.unlock('desk');
      return null;
    }

    var el = document.createElement('div');
    el.setAttribute(HOST_ATTR, '1');
    // 宿主的布局用内联样式，避免依赖样式表注入顺序（Shadow 内选不到宿主）

    if (anchor.mode === 'replace') {
      // 原地替换：书桌占住原生分区的位置，宽度与偏移自动继承；
      // 再抄一份原生节点的外距，双保险对齐原生栅格。
      NATIVE = anchor.node;
      ANCHOR_INFO = anchor;
      var margin = '';
      try {
        var m = getComputedStyle(NATIVE).margin;
        if (m && m !== '0px') margin = 'margin:' + m + ';';
      } catch (e) {}
      el.style.cssText = 'display:block;position:relative;' + margin;
      NATIVE.parentNode.insertBefore(el, NATIVE);
      NATIVE.parentNode.removeChild(NATIVE);
    } else {
      ANCHOR_INFO = anchor;
      el.style.cssText = 'display:block;position:relative;margin:0;padding:0;';
      anchor.node.insertBefore(el, anchor.node.firstChild);
    }

    var shadow = el.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = RK.UI_CSS;
    shadow.appendChild(style);

    var box = buildDesktop(settings, data);
    box.settings = settings;
    box.data = data;
    shadow.appendChild(box);

    MOUNTED = el;
    RK.unlock('desk');
    RK.log('书桌已挂载（' + anchor.mode + ' → ' + anchor.selector + '）');
    return el;
  }

  function unmount() {
    if (MOUNTED && MOUNTED.parentNode) {
      var parent = MOUNTED.parentNode;
      // 替换式：先把原生分区放回书桌的位置再撤书桌，页面恢复原样。
      // 若站点已自行重渲染（NATIVE 不在文档里且已被替换）就直接撤，避免插回过期节点。
      if (NATIVE && !document.contains(NATIVE) && !parent.contains(NATIVE)) {
        parent.insertBefore(NATIVE, MOUNTED);
      }
      parent.removeChild(MOUNTED);
    }
    MOUNTED = null;
    NATIVE = null;
    ANCHOR_INFO = null;
  }

  // 数据变化时只重绘内容，不动宿主节点，避免页面滚动位置跳动
  function refresh(settings, data) {
    if (!MOUNTED || !MOUNTED.shadowRoot) return;
    var old = MOUNTED.shadowRoot.querySelector('.rk-desk');
    if (!old) return;
    var next = buildDesktop(settings, data);
    next.settings = settings;
    next.data = data;
    MOUNTED.shadowRoot.replaceChild(next, old);
  }

  RK.desk = {
    mount: mount,
    unmount: unmount,
    refresh: refresh,
    get mounted() {
      return !!MOUNTED;
    }
  };
})();
