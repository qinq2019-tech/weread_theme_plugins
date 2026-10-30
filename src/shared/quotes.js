/*
 * 微信读书 · 书房｜摘录纯函数层
 *
 * 为什么单独一个文件：摘录的显示规则（老数据借用）、分组排序、本地日期、
 * 文件名净化、Markdown 拼装都是纯函数，不碰 DOM 也不碰 chrome.storage。
 * 放在独立层里，设置页直接 <script> 引入，node 测试也能加载（tools/quote-test.js）。
 *
 * 规格来源：docs/v0.2-design.md「交互规格」§5–§6。
 * 铁律：只输出真实存在的字段，绝不补推断值（日期非法就不输出日期行）。
 */
(function () {
  'use strict';

  /* ---------------- 归一化与显示（§5.1 / §5.3） ---------------- */

  // 只 trim。不做大小写/全半角/书名号/编辑距离归一——模糊匹配的失败模式
  // 是「两本不同的书被静默合并」，比「同一本书分成两组」糟得多。
  function normName(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  // 书名：有 book 用 book；老数据没有 book 时借用 source（只读，不回写）
  function displayBook(q) {
    if (!q || typeof q !== 'object') return '';
    return normName(q.book) || normName(q.source);
  }

  // 出处：只有 book 存在时 source 才是出处；否则它是被借走的书名，不再重复显示
  function displaySource(q) {
    if (!q || typeof q !== 'object') return '';
    return normName(q.book) ? normName(q.source) : '';
  }

  /* ---------------- 本地日期（§6.2） ---------------- */

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // 本地日期。不能用 toISOString()——那是 UTC，晚上 8 点后会差一天
  function localDateKey(d) {
    if (!d || typeof d.getTime !== 'function' || isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function dateKeyOf(ts) {
    var t = Number(ts);
    if (!t || !isFinite(t)) return '';
    return localDateKey(new Date(t));
  }

  /* ---------------- 文件名净化（§6.2） ---------------- */

  function sanitizeFilename(name) {
    var s = String(name || '')
      .replace(/[\\/:*?"<>|\r\n\t]+/g, '-')
      .trim();
    s = s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
    if (s.length > 40) s = s.slice(0, 40).replace(/[.\s]+$/, '');
    // 剩下的只有分隔符（如书名叫「///」）等于没有名字
    if (!/[^\s.\-]/.test(s)) return '';
    return s;
  }

  /* ---------------- 分组（§5.2） ----------------
   * 返回 [{ name, items }]：组内 at 降序（非法 at 沉底）；组间按组内最新合法 at
   * 降序；未署名组固定最后。归一化只在内存做分组键，不改写原始数据。
   */
  function groupQuotes(items) {
    var valid = (items || []).filter(function (q) {
      return q && typeof q.text === 'string' && q.text.trim();
    });
    var map = {};
    var groups = [];
    valid.forEach(function (q) {
      var name = displayBook(q) || '未署名';
      if (!map[name]) {
        map[name] = [];
        groups.push({ name: name, items: map[name] });
      }
      map[name].push(q);
    });
    groups.forEach(function (g) {
      g.items.sort(function (a, b) {
        return (Number(b.at) || 0) - (Number(a.at) || 0);
      });
      g.latest = g.items.reduce(function (m, q) {
        var t = Number(q.at);
        return isFinite(t) && t > m ? t : m;
      }, 0);
    });
    groups.sort(function (a, b) {
      if (a.name === '未署名' && b.name !== '未署名') return 1;
      if (b.name === '未署名' && a.name !== '未署名') return -1;
      return b.latest - a.latest;
    });
    return groups;
  }

  /* ---------------- Markdown（§6.3） ---------------- */

  function quoteBlockLines(text) {
    return String(text).replace(/\r\n?/g, '\n').split('\n').map(function (line) {
      return line ? '> ' + line : '>';
    });
  }

  /*
   * buildMarkdown(items, opts)
   *   opts.book   单本导出时的书名（含「未署名」）；给出则标题为 # <书名> 且不加 ## 分组
   *   opts.today  导出日期 YYYY-MM-DD；缺省取本地当天
   * 规则：元信息行不加句号；正文每行都带 > 前缀（空行输出 >）；出处行仅
   * displaySource 非空时输出；at 非法时日期行整行不输出；无署名行、无 ---、
   * 无 emoji；\n 换行，末尾恰好一个换行。
   */
  function buildMarkdown(items, opts) {
    opts = opts || {};
    var today = opts.today || localDateKey(new Date());
    var single = typeof opts.book === 'string' && opts.book !== '';
    var groups = groupQuotes(items);
    if (single) {
      groups = groups.filter(function (g) {
        return g.name === opts.book;
      });
    }
    var count = groups.reduce(function (n, g) {
      return n + g.items.length;
    }, 0);

    var lines = [];
    lines.push(single ? '# ' + opts.book : '# 摘录');
    lines.push('');
    lines.push('共 ' + count + ' 条 · 导出于 ' + today);

    groups.forEach(function (g) {
      if (!single) {
        lines.push('');
        lines.push('## ' + g.name);
      }
      g.items.forEach(function (q) {
        lines.push('');
        quoteBlockLines(q.text).forEach(function (l) {
          lines.push(l);
        });
        var src = displaySource(q);
        var date = dateKeyOf(q.at);
        if (src || date) {
          lines.push('');
          if (src) lines.push('- 出处：' + src);
          if (date) lines.push('- ' + date);
        }
      });
    });

    return lines.join('\n') + '\n';
  }

  window.RK_QUOTES = {
    normName: normName,
    displayBook: displayBook,
    displaySource: displaySource,
    localDateKey: localDateKey,
    dateKeyOf: dateKeyOf,
    sanitizeFilename: sanitizeFilename,
    groupQuotes: groupQuotes,
    buildMarkdown: buildMarkdown
  };
})();
