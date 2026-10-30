/*
 * 微信读书 · 书房｜设计令牌（内容脚本与设置页共用）
 *
 * 为什么单独抽出来：设置页显示主题预览、内容脚本真正应用主题，
 * 两处必须用同一份色值，否则「预览和实际不一样」。这里只放数据，不含逻辑，
 * 所以既是内容脚本（classic script）也能被扩展页面直接 <script> 引入。
 *
 * 三套主题对应三种审美取向，切换不需要改代码：
 *   paper   私人书房 —— 暖纸、宋体、低饱和木色，安静
 *   gallery 书架画廊 —— 冷白、墨绿、强对比，利落
 *   pastel  轻彩空间 —— 柔紫青渐变、元体，轻快
 */
(function () {
  'use strict';

  var THEMES = {
    paper: {
      id: 'paper',
      name: '私人书房',
      desc: '暖纸底、宋体标题、木色点缀。安静，适合长时间阅读。',
      light: {
        canvas: '#F6F1E7',
        surface: '#FFFDF8',
        ink: '#26231E',
        inkSoft: '#6E675C',
        line: '#E4DACB',
        accent: '#8A6A4F',
        onAccent: '#FFFDF8',
        accentSoft: '#F0E6D6',
        deskBg: 'linear-gradient(180deg,#FFFDF8 0%,#FBF5E9 100%)',
        deskShadow: '0 18px 40px rgba(70,55,35,.10)',
        grain: 'radial-gradient(rgba(80,60,30,.05) 1px, transparent 1px)',
        heat1: '#D5C0A2',
        heat2: '#B08F6B',
        heat3: '#8A6A4F',
        spine1: '#EFE4D2',
        spine2: '#DCC9AE',
        spine3: '#C3AE93',
        shadowSoft: '0 10px 22px rgba(74,58,36,.14)'
      },
      dark: {
        canvas: '#191713',
        surface: '#221F19',
        ink: '#EFE6D6',
        inkSoft: '#A69B88',
        line: '#36302A',
        accent: '#C9A87C',
        onAccent: '#201C16',
        accentSoft: '#2C2620',
        deskBg: 'linear-gradient(180deg,#252118 0%,#1D1A14 100%)',
        deskShadow: '0 18px 40px rgba(0,0,0,.45)',
        grain: 'radial-gradient(rgba(255,240,210,.04) 1px, transparent 1px)',
        heat1: '#4A4136',
        heat2: '#7A664C',
        heat3: '#C9A87C',
        spine1: '#332C24',
        spine2: '#443A2E',
        spine3: '#57493A',
        shadowSoft: '0 10px 22px rgba(0,0,0,.46)'
      }
    },
    gallery: {
      id: 'gallery',
      name: '书架画廊',
      desc: '冷白墙、墨绿强调、封面主导。像逛一间小画廊。',
      light: {
        canvas: '#F2F4F0',
        surface: '#FFFFFF',
        ink: '#1A211C',
        inkSoft: '#66706A',
        line: '#DFE5DE',
        accent: '#1F4B3A',
        onAccent: '#FFFFFF',
        accentSoft: '#E6EFEA',
        deskBg: 'linear-gradient(180deg,#FFFFFF 0%,#F1F5F1 100%)',
        deskShadow: '0 18px 40px rgba(25,50,35,.10)',
        grain: 'radial-gradient(rgba(20,60,40,.045) 1px, transparent 1px)',
        heat1: '#C3D4C8',
        heat2: '#7FA491',
        heat3: '#1F4B3A',
        spine1: '#E3EBE4',
        spine2: '#D8E3DB',
        spine3: '#B9CCC0',
        shadowSoft: '0 10px 22px rgba(26,52,38,.12)'
      },
      dark: {
        canvas: '#131711',
        surface: '#1B201A',
        ink: '#E7EDE6',
        inkSoft: '#99A398',
        line: '#2B332B',
        accent: '#86C7A6',
        onAccent: '#10201A',
        accentSoft: '#202A23',
        deskBg: 'linear-gradient(180deg,#1D231C 0%,#161A15 100%)',
        deskShadow: '0 18px 40px rgba(0,0,0,.45)',
        grain: 'radial-gradient(rgba(200,255,225,.035) 1px, transparent 1px)',
        heat1: '#3A4A3E',
        heat2: '#5A7C68',
        heat3: '#86C7A6',
        spine1: '#20261F',
        spine2: '#2B362C',
        spine3: '#3A493C',
        shadowSoft: '0 10px 22px rgba(0,0,0,.46)'
      }
    },
    pastel: {
      id: 'pastel',
      name: '轻彩空间',
      desc: '柔紫与浅青渐变、圆体字。轻快，更像自己的房间。',
      light: {
        canvas: '#F7F3FC',
        surface: '#FFFFFF',
        ink: '#241E2E',
        inkSoft: '#6A6379',
        line: '#E7E0F3',
        accent: '#6F5BD0',
        onAccent: '#FFFFFF',
        accentSoft: '#EFE9FC',
        deskBg: 'linear-gradient(135deg,#FFFFFF 0%,#F6F1FE 55%,#EEF6FB 100%)',
        deskShadow: '0 18px 40px rgba(85,60,160,.12)',
        grain: 'radial-gradient(rgba(90,60,170,.045) 1px, transparent 1px)',
        heat1: '#D3C6F1',
        heat2: '#A08EE0',
        heat3: '#6F5BD0',
        spine1: '#EAE1F9',
        spine2: '#E0D5F6',
        spine3: '#C9B8F0',
        shadowSoft: '0 10px 22px rgba(86,62,160,.14)'
      },
      dark: {
        canvas: '#16141F',
        surface: '#1F1C2A',
        ink: '#EDE8F8',
        inkSoft: '#A29AB8',
        line: '#2F2A3E',
        accent: '#A99BFF',
        onAccent: '#1A1526',
        accentSoft: '#262137',
        deskBg: 'linear-gradient(135deg,#232030 0%,#1B1826 60%,#181C24 100%)',
        deskShadow: '0 18px 40px rgba(0,0,0,.5)',
        grain: 'radial-gradient(rgba(190,175,255,.04) 1px, transparent 1px)',
        heat1: '#3C3456',
        heat2: '#6A5C9E',
        heat3: '#A99BFF',
        spine1: '#241F33',
        spine2: '#2E2845',
        spine3: '#3C3459',
        shadowSoft: '0 10px 22px rgba(0,0,0,.50)'
      }
    }
  };

  var FONTS = {
    serif: {
      id: 'serif',
      name: '宋体标题',
      ui: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif',
      serif: '"Songti SC","Noto Serif SC","Source Han Serif SC",Georgia,"Times New Roman",serif'
    },
    sans: {
      id: 'sans',
      name: '黑体统一',
      ui: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif',
      serif: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif'
    },
    rounded: {
      id: 'rounded',
      name: '圆体轻松',
      ui: '"Yuanti SC","Hiragino Sans GB","PingFang SC",system-ui,sans-serif',
      serif: '"Yuanti SC","Hiragino Sans GB","PingFang SC",system-ui,sans-serif'
    }
  };

  var DENSITY = {
    compact: { pad: 20, padx: 22, gap: 20, name: '紧凑' },
    comfortable: { pad: 26, padx: 28, gap: 26, name: '适中' },
    spacious: { pad: 34, padx: 36, gap: 32, name: '宽松' }
  };

  var api = {
    THEMES: THEMES,
    FONTS: FONTS,
    DENSITY: DENSITY,
    themeList: ['paper', 'gallery', 'pastel'],
    // 给设置页画色卡用：返回某主题在指定模式下的主要颜色
    swatch: function (themeId, mode) {
      var t = THEMES[themeId] || THEMES.paper;
      var set = t[mode === 'dark' ? 'dark' : 'light'];
      return [set.canvas, set.surface, set.accent];
    }
  };

  window.RK_PALETTE = api;
  // 内容脚本里同时挂到 RK 上，方便其它模块统一用 RK.PALETTE
  if (window.__RK__) window.__RK__.PALETTE = api;
})();
