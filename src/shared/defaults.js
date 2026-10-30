/*
 * 微信读书 · 书房｜默认设置（内容脚本与设置页共用）
 *
 * 为什么单独一个文件：设置项的默认值必须只有一处定义。
 * 内容脚本用 deepMerge 补齐老用户缺失的字段，设置页用它渲染开关初始状态，
 * 两边共用同一份，才不会出现「设置页开着、页面里却关着」这种鬼故事。
 */
(function () {
  'use strict';

  window.RK_DEFAULTS = {
    enabled: true,
    theme: 'paper', // paper | gallery | pastel
    mode: 'auto', // auto | light | dark
    fontPreset: 'serif', // serif | sans | rounded
    density: 'comfortable', // compact | comfortable | spacious
    showDesk: true,
    showDock: true,
    deskModules: {
      greeting: true,
      continue: true,
      goal: true,
      quote: true,
      wingPaper: true, // 摘句墙（paper 专属区）
      wingGallery: true, // 墙上的书（gallery 专属区）
      wingTime: true // 读过的日子（pastel 专属区）
    },
    readerTone: 0, // 0-100，护眼色温
    immersive: false,
    logReading: true,
    goalMinutes: 30
  };

  window.RK_EMPTY_DATA = {
    quotes: [],
    log: [],
    stats: {}
  };
})();
