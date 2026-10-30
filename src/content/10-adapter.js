/*
 * 微信读书 · 书房｜站点适配层（唯一允许出现站点类名的文件）
 *
 * 站点结构实测（2026-10-30，用 CDP 在线上页面读取真实 DOM）：
 *   首页   body.wr_Desktop / #app.app / #routerView.home_page / .home_page_container
 *          书籍封面 .wr_bookCover 24 个；分区 .ranking_block_container / .ranking_topCategory_container
 *   阅读器 body.wr_page_reader → #routerView > .wr_horizontalReader（双栏）
 *          正文由 2 个 <canvas> 绘制（所以不碰字号/行距/划线）
 *          顶栏 .readerTopBar（fixed 1024×72）
 *          document.title = "书名 - 作者 - 微信读书"
 *
 * 重要教训：旧版首页（Nuxt）用的 .wr_index_page_* 类名在当前线上版本已全部消失，
 * 现行版本用的是不带哈希的语义类（home_page_container 等）。所以这里保留了旧候选做
 * 兼容，但主路径走真实结构；并且封面匹配不依赖任何类名，只按「祖先文本里含书名」找。
 * 站点再改版时，只改本文件；其它模块通过 RK.adapter 的接口工作，不受影响。
 *
 * 原则：只读用户本机已渲染的内容（书名/作者/封面），不请求接口、不读登录凭据。
 */
(function () {
  'use strict';

  var RK = window.__RK__;

  // 候选按「新结构优先，旧结构兜底」排列
  var CANDIDATES = {
    // 首页主内容容器：新版 .home_page_container > #routerView > 旧版 .wr_index_page_content_wrapper
    homeContent: [
      '.home_page_container',
      '#routerView',
      '.wr_index_page_content_wrapper',
      '.wr_index_page_wrapper'
    ],
    homeHeader: ['.readerTopBar', '.home_page_header', '.wr_index_page_header_wrapper'],
    // 书籍封面的容器：新版 .ranking_block_book / 旧版 mini_bookInfo
    bookItem: ['.ranking_block_book', '.wr_index_page_mini_bookInfo', '.wr_index_page_category_list_content_card'],
    cover: ['.wr_bookCover'],
    sectionTitle: [
      '.ranking_block_title',
      '.wr_index_page_top_section_header_title_lang',
      '.wr_index_page_rank_list_title'
    ],
    // 阅读器顶/底栏：.readerTopBar 已实测存在
    readerChrome: [
      '.readerTopBar',
      '.readerControls',
      '[class*="readerBottomBar"]',
      '[class*="reader_bottom_bar"]'
    ],
    readerTopBar: ['.readerTopBar']
  };

  function firstMatch(list) {
    for (var i = 0; i < list.length; i++) {
      var node = RK.$(list[i]);
      if (node) return { node: node, selector: list[i] };
    }
    return null;
  }

  function text(node) {
    if (!node) return '';
    return (node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function detectPage() {
    var body = document.body;
    var cls = body ? ' ' + body.className + ' ' : '';
    var path = location.pathname || '';

    if (cls.indexOf('wr_page_reader') >= 0 || /^\/web\/reader\//.test(path)) return 'reader';
    if (cls.indexOf('wr_page_shelf') >= 0 || /^\/web\/shelf/.test(path)) return 'shelf';
    // 新版首页：routerView 上带 home_page
    if (RK.$('#routerView.home_page') || RK.$('.home_page_container')) return 'home';
    if (RK.$('.wr_index_page_wrapper')) return 'home';
    if (path === '/web/' || path === '/web' || path === '/') return 'home';
    return 'other';
  }

  /*
   * 找某本书的封面图。
   * 不靠类名：从每个封面节点向上找 2 层，若这段文本里包含书名，就认为找到了。
   * 书封面上的书名文字和列表标题文字通常都在同一个卡片里，因此命中率足够。
   */
  function findCoverFor(bookName) {
    if (!bookName) return '';
    var covers = RK.$$(CANDIDATES.cover.join(','));
    for (var i = 0; i < covers.length; i++) {
      var node = covers[i];
      var scope = node.parentElement;
      for (var up = 0; up < 2 && scope; up++) {
        var label = text(scope);
        if (label && label.indexOf(bookName) >= 0) {
          var img = node.querySelector('img') || (scope.querySelector('img'));
          var src = img ? img.getAttribute('src') || img.getAttribute('data-src') || '' : '';
          if (src) return src;
          break;
        }
        scope = scope.parentElement;
      }
    }
    return '';
  }

  function coverCount() {
    return RK.$$(CANDIDATES.cover.join(',')).length;
  }

  /*
   * 阅读器当前信息。
   * document.title 实测格式为「书名 - 作者 - 微信读书」，第二段是作者不是章节。
   * 章节名：实测 .readerTopBar 里只有「加入书架/首页/我的书架/登录」这类操作项，
   * 没有章节名，所以不猜——只有站点真的提供了章节标题元素时才填，否则留空。
   * 瞎猜会把「加入书架」当成章节，写进阅读记录反而更糟。
   */
  function readChapterInfo() {
    if (detectPage() !== 'reader') return null;

    var book = '';
    var author = '';
    var raw = (document.title || '').replace(/\s*[-|｜]\s*微信读书\s*$/, '');
    var parts = raw.split(/\s+[-|｜]\s+/).filter(Boolean);
    if (parts.length >= 1) book = parts[0];
    if (parts.length >= 2) author = parts[1];

    var chapter = '';
    var chapterEl = firstMatch([
      '.readerChapterTitle',
      '[class*="chapterTitle"]',
      '[class*="chapter_title"]'
    ]);
    if (chapterEl) {
      var t = text(chapterEl.node);
      if (t && t.length <= 60) chapter = t;
    }

    // 进度：整页唯一的百分比文本
    var progress = null;
    var pctNodes = RK.$$('[class*="progress"]');
    for (var j = 0; j < pctNodes.length; j++) {
      var m = text(pctNodes[j]).match(/(\d{1,3}(?:\.\d+)?)\s*%/);
      if (m) {
        progress = m[1] + '%';
        break;
      }
    }

    if (!book) return null;

    return {
      book: book,
      author: author,
      chapter: chapter,
      progress: progress,
      href: location.pathname + location.search
    };
  }

  function resolveContinue(entry) {
    if (!entry) return null;
    return {
      book: entry.book,
      author: entry.author || '',
      chapter: entry.chapter || '',
      progress: entry.progress || '',
      href: entry.href || '',
      cover: findCoverFor(entry.book),
      at: entry.at || 0
    };
  }

  function readerCanvasLikely() {
    return !!RK.$('canvas');
  }

  function immersiveTargets() {
    var out = [];
    CANDIDATES.readerChrome.forEach(function (sel) {
      RK.$$(sel).forEach(function (node) {
        if (out.indexOf(node) < 0) out.push(node);
      });
    });
    return out;
  }

  RK.adapter = {
    CANDIDATES: CANDIDATES,
    detectPage: detectPage,
    firstMatch: firstMatch,
    text: text,
    findCoverFor: findCoverFor,
    readChapterInfo: readChapterInfo,
    resolveContinue: resolveContinue,
    readerCanvasLikely: readerCanvasLikely,
    immersiveTargets: immersiveTargets,

    deskHost: function () {
      return firstMatch(CANDIDATES.homeContent);
    },

    report: function () {
      var page = detectPage();
      var host = this.deskHost();
      var info = page === 'reader' ? readChapterInfo() : null;
      return {
        page: page,
        url: location.pathname,
        version: RK.VERSION,
        hostSelector: host ? host.selector : null,
        coverCount: coverCount(),
        readerChromeCount: immersiveTargets().length,
        canvasPresent: readerCanvasLikely(),
        chapter: info,
        mounted: {
          desk: !!document.querySelector('[data-rk-desk]'),
          dock: !!document.querySelector('[data-rk-dock]')
        },
        checkedAt: Date.now()
      };
    }
  };
})();
