/*
 * 微信读书 · 书房｜主题应用层
 *
 * 关键决策：
 * 1. 主题只写 CSS 自定义属性到 <html>，不逐条改站点元素样式。
 *    站点自己的 Vue 样式优先级很高，逐条覆盖既脆弱又要写一堆 !important；
 *    变量 + 少量页面级规则（page-theme.css）更稳，也更好撤。
 * 2. 明暗三态：auto 跟随系统，通过 matchMedia 监听，切换时重算令牌。
 * 3. 关掉扩展时必须能干净还原：remove() 移除我们加的所有属性与变量，
 *    页面样式回到站点原样，不留残余。
 */
(function () {
  'use strict';

  var RK = window.__RK__;
  var P = window.RK_PALETTE;

  var TOKEN_MAP = {
    canvas: '--rk-canvas',
    surface: '--rk-surface',
    ink: '--rk-ink',
    inkSoft: '--rk-ink-soft',
    line: '--rk-line',
    accent: '--rk-accent',
    onAccent: '--rk-on-accent',
    accentSoft: '--rk-accent-soft',
    deskBg: '--rk-desk-bg',
    deskShadow: '--rk-desk-shadow',
    grain: '--rk-desk-grain',
    heat1: '--rk-heat-1',
    heat2: '--rk-heat-2',
    heat3: '--rk-heat-3',
    spine1: '--rk-spine-1',
    spine2: '--rk-spine-2',
    spine3: '--rk-spine-3',
    shadowSoft: '--rk-shadow-soft'
  };

  var mediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var current = null;

  function resolveMode(settings) {
    if (settings.mode === 'dark') return 'dark';
    if (settings.mode === 'light') return 'light';
    return mediaQuery && mediaQuery.matches ? 'dark' : 'light';
  }

  /*
   * 站点自己的明暗：微信读书用 body 上的类切换（wr_theme_dark / wr_whiteTheme …）。
   * 为什么要判断：如果站点是深色而我们强制铺浅色底，站点的浅色文字会落在浅底上，
   * 直接不可读。所以「页面底色」只在两边明暗一致时才覆盖，不一致就只改我们自己的组件。
   */
  function detectSiteMode() {
    var body = document.body;
    if (!body) return 'unknown';
    var cls = ' ' + (body.className || '') + ' ';
    if (/wr_theme_dark|wr_blackTheme|wr_theme_night/.test(cls)) return 'dark';
    if (/wr_theme_light|wr_whiteTheme|wr_theme_green|wr_theme_yellow/.test(cls)) return 'light';
    // wr_theme_dynamic 是站点的「跟随系统」，不表态
    try {
      var bg = window.getComputedStyle(body).backgroundColor || '';
      var parts = bg.match(/[\d.]+/g);
      if (parts && parts.length >= 3) {
        // 透明底色说明真正的底色在别处（阅读器常见），这种情况判不了，交给上层按 unknown 处理
        var alpha = parts.length >= 4 ? Number(parts[3]) : 1;
        if (alpha === 0) return 'unknown';
        var lum = 0.299 * Number(parts[0]) + 0.587 * Number(parts[1]) + 0.114 * Number(parts[2]);
        return lum < 128 ? 'dark' : 'light';
      }
    } catch (e) {}
    return 'unknown';
  }

  function apply(settings) {
    var themeId = P.THEMES[settings.theme] ? settings.theme : 'paper';
    var mode = resolveMode(settings);
    var tokens = P.THEMES[themeId][mode];
    var font = P.FONTS[settings.fontPreset] || P.FONTS.serif;
    var density = P.DENSITY[settings.density] || P.DENSITY.comfortable;
    var root = document.documentElement;
    var style = root.style;

    Object.keys(TOKEN_MAP).forEach(function (key) {
      if (tokens[key]) style.setProperty(TOKEN_MAP[key], tokens[key]);
    });

    style.setProperty('--rk-font-ui', font.ui);
    style.setProperty('--rk-font-serif', font.serif);
    style.setProperty('--rk-desk-pad', density.pad + 'px');
    style.setProperty('--rk-desk-padx', density.padx + 'px');
    style.setProperty('--rk-desk-gap', density.gap + 'px');

    root.setAttribute('data-rk-theme', themeId);
    root.setAttribute('data-rk-mode', mode);
    root.setAttribute('data-rk-density', settings.density);
    root.setAttribute('data-rk-on', '1');

    var siteMode = detectSiteMode();
    root.setAttribute('data-rk-site-mode', siteMode);
    // 判不出站点明暗（unknown）时按一致处理：阅读器正文有自己的绘制面，覆盖风险低；
    // 一旦明确判出不一致，就只改结构和字体，不动底色与字色。
    var match = siteMode === 'unknown' || siteMode === mode;
    root.setAttribute('data-rk-theme-match', match ? '1' : '0');

    current = { themeId: themeId, mode: mode, siteMode: siteMode, match: match, tokens: tokens };
    RK.bus.emit('theme:changed', current);
    return current;
  }

  // 完全撤除：把站点交还给它自己
  function remove() {
    var root = document.documentElement;
    root.removeAttribute('data-rk-theme');
    root.removeAttribute('data-rk-mode');
    root.removeAttribute('data-rk-density');
    root.removeAttribute('data-rk-site-mode');
    root.removeAttribute('data-rk-theme-match');
    root.removeAttribute('data-rk-on');
    Object.keys(TOKEN_MAP).forEach(function (key) {
      root.style.removeProperty(TOKEN_MAP[key]);
    });
    root.style.removeProperty('--rk-font-ui');
    root.style.removeProperty('--rk-font-serif');
    root.style.removeProperty('--rk-desk-pad');
    root.style.removeProperty('--rk-desk-padx');
    root.style.removeProperty('--rk-desk-gap');
    current = null;
    RK.bus.emit('theme:removed');
  }

  if (mediaQuery) {
    var onSystemChange = function () {
      if (!current) return;
      RK.getSettings().then(function (s) {
        if (s.enabled && s.mode === 'auto') apply(s);
      });
    };
    if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', onSystemChange);
    else if (mediaQuery.addListener) mediaQuery.addListener(onSystemChange);
  }

  RK.theme = {
    apply: apply,
    remove: remove,
    resolveMode: resolveMode,
    get current() {
      return current;
    }
  };
})();
