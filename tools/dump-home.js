/*
 * 登录态首页结构侦察（只读，不改页面任何东西）
 *
 * 用法：
 *   1. 在登录态的微信读书首页，先点扩展「恢复原版」（或关掉扩展），刷新页面
 *   2. 打开 DevTools（⌥⌘I）→ Console，粘贴本文件全部内容回车
 *   3. 输出会自动 copy() 到剪贴板，直接粘贴回对话即可
 *
 * 产出三块信息：
 *   A. 内容容器的直接子块清单（类名 / 文本摘要 / 位置尺寸）——找替换锚点用
 *   B. 含「继续阅读 / 最近在读」的元素及其 6 层祖先链——确定原地替换的挂载点
 *   C. 容器与视口宽度——判断布局列，决定书桌卡片的目标宽度
 */
(function () {
  var out = { url: location.href, at: new Date().toISOString() };

  // A. 内容容器与直接子块
  var host = document.querySelector('.home_page_container') ||
    document.querySelector('#routerView');
  out.hostSelector = host ? (host.className || host.id || host.tagName) : null;
  out.blocks = [];
  if (host) {
    Array.prototype.forEach.call(host.children, function (el, i) {
      var r = el.getBoundingClientRect();
      out.blocks.push({
        i: i,
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).slice(0, 140),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        rect: [Math.round(r.x), Math.round(r.y + window.scrollY), Math.round(r.width), Math.round(r.height)]
      });
    });
  }

  // B. 「继续阅读」锚点：只匹配自身直接文本命中关键词的元素，向上收 6 层祖先链
  var hits = [];
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  var node;
  while ((node = walker.nextNode())) {
    var own = '';
    for (var c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) own += c.nodeValue;
    }
    if (/继续阅读|最近在读/.test(own.trim())) {
      var chain = [];
      var p = node;
      for (var up = 0; up < 6 && p && p !== document.body; up++) {
        var pr = p.getBoundingClientRect();
        chain.push({
          tag: p.tagName.toLowerCase(),
          cls: String(p.className).slice(0, 140),
          id: p.id || '',
          rect: [Math.round(pr.x), Math.round(pr.y + window.scrollY), Math.round(pr.width), Math.round(pr.height)]
        });
        p = p.parentElement;
      }
      hits.push({ text: own.trim().slice(0, 24), chain: chain });
    }
  }
  out.continueHits = hits.slice(0, 10);

  // C. 布局宽度
  out.viewport = [window.innerWidth, window.innerHeight];
  var main = host || document.body;
  out.hostWidth = Math.round(main.getBoundingClientRect().width);
  var body = document.body.getBoundingClientRect();
  out.pageWidth = Math.round(body.width);

  var json = JSON.stringify(out, null, 1);
  try {
    copy(json);
    console.log('已复制到剪贴板（长度 ' + json.length + '），直接粘贴回对话即可');
  } catch (e) {
    console.log('copy() 不可用，请手动复制下方输出');
  }
  console.log(json);
})();
