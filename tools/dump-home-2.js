/*
 * 登录态首页结构侦察 · 第二段（只读）
 * 针对已确认的 .wr_index_page_* 结构，看清：
 *   1. 内容区 .wr_index_page_content_wrapper 的分区清单
 *   2. 「继续阅读」分区 .wr_index_page_top_section_wrapper 的内部子结构
 *   3. 页面外层 .wr_index_page_wrapper 的顶层构成（头部区在那 280px 里）
 * 用法：在登录态首页 Console 粘贴回车，结果自动进剪贴板。
 */
(function () {
  function brief(el) {
    var r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: String(el.className).slice(0, 120),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      rect: [Math.round(r.x), Math.round(r.y + window.scrollY), Math.round(r.width), Math.round(r.height)]
    };
  }
  function kids(sel, limit) {
    var el = document.querySelector(sel);
    if (!el) return null;
    var self = brief(el);
    self.children = Array.prototype.slice.call(el.children, 0, limit || 24).map(function (c, i) {
      var b = brief(c);
      b.i = i;
      return b;
    });
    return self;
  }
  var out = {
    url: location.href,
    at: new Date().toISOString(),
    indexWrapper: kids('.wr_index_page_wrapper'),
    contentWrapper: kids('.wr_index_page_content_wrapper'),
    continueSection: kids('.wr_index_page_top_section_wrapper')
  };
  // 「继续阅读」分区内部再往下一层：书卡容器的直接子元素
  var sec = document.querySelector('.wr_index_page_top_section_wrapper');
  if (sec && sec.children.length) {
    out.continueSectionDeep = Array.prototype.slice.call(sec.children, 0, 6).map(function (c, i) {
      var b = brief(c);
      b.i = i;
      b.children = Array.prototype.slice.call(c.children, 0, 8).map(function (g, j) {
        var g2 = brief(g);
        g2.i = j;
        return g2;
      });
      return b;
    });
  }
  var json = JSON.stringify(out, null, 1);
  try {
    copy(json);
    console.log('已复制到剪贴板（长度 ' + json.length + '），粘贴回对话即可');
  } catch (e) {
    console.log('copy() 不可用，请手动复制下方输出');
  }
  console.log(json);
})();
