/*
 * 微信读书 · 书房｜核心工具层
 *
 * 关键决策（为什么这么做）：
 * 1. content script 不支持 ES module。文件之间靠全局命名空间 RK 通信，
 *    加载顺序由 manifest 的 js 数组保证（00-core 最先）。所以这里不用 import/export。
 * 2. 所有状态写 chrome.storage.local（扩展源），不写站点的 localStorage：
 *    站点脚本读不到，也不会随站点清理策略丢失。
 * 3. 任何一步失败只降级、不抛给页面。宁可少一个模块，也不能把读书页弄坏。
 * 4. 只在用户本机已渲染的画面上取信息（书名/章节/封面），不请求站点接口、不碰登录态。
 */
(function () {
  'use strict';

  var RK = (window.__RK__ = window.__RK__ || {});

  RK.VERSION = '0.2.0';
  RK.SETTINGS_KEY = 'rk:settings';
  RK.DATA_KEY = 'rk:data';

  // 设置默认值来自 shared/defaults.js（与设置页共用同一份定义）
  RK.DEFAULTS = JSON.parse(JSON.stringify(window.RK_DEFAULTS || {}));
  RK.EMPTY_DATA = JSON.parse(JSON.stringify(window.RK_EMPTY_DATA || { quotes: [], log: [], stats: {} }));

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  RK.clone = clone;

  RK.deepMerge = function (base, patch) {
    var out = clone(base);
    if (!patch || typeof patch !== 'object') return out;
    Object.keys(patch).forEach(function (k) {
      var v = patch[k];
      if (v === undefined) return;
      var isObj = v && typeof v === 'object' && !Array.isArray(v);
      var baseIsObj = base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]);
      out[k] = isObj && baseIsObj ? RK.deepMerge(base[k], v) : v;
    });
    return out;
  };

  function readKey(key, fallback) {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get([key], function (res) {
          var err = chrome.runtime.lastError;
          if (err) {
            resolve(clone(fallback));
            return;
          }
          resolve(res && res[key] !== undefined ? res[key] : clone(fallback));
        });
      } catch (e) {
        resolve(clone(fallback));
      }
    });
  }

  function writeKey(key, value) {
    return new Promise(function (resolve) {
      try {
        var payload = {};
        payload[key] = value;
        chrome.storage.local.set(payload, function () {
          resolve(value);
        });
      } catch (e) {
        resolve(value);
      }
    });
  }

  RK.getSettings = function () {
    return readKey(RK.SETTINGS_KEY, RK.DEFAULTS).then(function (raw) {
      return RK.deepMerge(RK.DEFAULTS, raw);
    });
  };

  RK.saveSettings = function (patch) {
    return RK.getSettings().then(function (cur) {
      var next = RK.deepMerge(cur, patch);
      return writeKey(RK.SETTINGS_KEY, next);
    });
  };

  RK.getData = function () {
    return readKey(RK.DATA_KEY, RK.EMPTY_DATA).then(function (raw) {
      return RK.deepMerge(RK.EMPTY_DATA, raw);
    });
  };

  RK.saveData = function (patch) {
    return RK.getData().then(function (cur) {
      var next = RK.deepMerge(cur, patch);
      return writeKey(RK.DATA_KEY, next);
    });
  };

  /* ---------------- 极简事件总线：模块之间只说事件，不互相调用 ---------------- */

  var listeners = {};

  RK.bus = {
    on: function (type, fn) {
      (listeners[type] || (listeners[type] = [])).push(fn);
      return function () {
        RK.bus.off(type, fn);
      };
    },
    off: function (type, fn) {
      var arr = listeners[type];
      if (!arr) return;
      var i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    emit: function (type, payload) {
      var arr = listeners[type];
      if (!arr) return;
      arr.slice().forEach(function (fn) {
        try {
          fn(payload);
        } catch (e) {
          RK.warn('listener error: ' + type, e);
        }
      });
    }
  };

  /* ---------------- DOM 与通用工具 ---------------- */

  RK.$ = function (sel, root) {
    try {
      return (root || document).querySelector(sel);
    } catch (e) {
      return null;
    }
  };

  RK.$$ = function (sel, root) {
    try {
      return Array.prototype.slice.call((root || document).querySelectorAll(sel));
    } catch (e) {
      return [];
    }
  };

  RK.el = function (tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = String(text);
    return node;
  };

  // 安全建 DOM：用户输入（摘录、书名）只走 textContent，绝不拼 innerHTML
  RK.h = function (tag, props, children) {
    var node = document.createElement(tag);
    props = props || {};
    if (props.class) node.className = props.class;
    if (props.text != null) node.textContent = String(props.text);
    if (props.attrs) {
      Object.keys(props.attrs).forEach(function (k) {
        var v = props.attrs[k];
        if (v != null && v !== false) node.setAttribute(k, v);
      });
    }
    if (props.style) {
      Object.keys(props.style).forEach(function (k) {
        node.style.setProperty(k, props.style[k]);
      });
    }
    if (props.on) {
      Object.keys(props.on).forEach(function (k) {
        node.addEventListener(k, props.on[k]);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c) node.appendChild(c);
      });
    }
    return node;
  };

  RK.uid = function () {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  };

  RK.todayKey = function () {
    var d = new Date();
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    if (m.length < 2) m = '0' + m;
    if (day.length < 2) day = '0' + day;
    return d.getFullYear() + '-' + m + '-' + day;
  };

  RK.formatMinutes = function (minutes) {
    var n = Math.max(0, Math.round(minutes || 0));
    if (n < 60) return n + ' 分钟';
    var h = Math.floor(n / 60);
    var rest = n % 60;
    return rest ? h + ' 小时 ' + rest + ' 分' : h + ' 小时';
  };

  RK.debounce = function (fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        fn.apply(self, args);
      }, wait);
    };
  };

  RK.throttle = function (fn, wait) {
    var last = 0;
    return function () {
      var now = Date.now();
      if (now - last < wait) return;
      last = now;
      fn.apply(this, arguments);
    };
  };

  RK.sleep = function (ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  };

  RK.once = function (key, fn) {
    var map = (RK._onceMap = RK._onceMap || {});
    if (map[key]) return false;
    map[key] = true;
    fn();
    return true;
  };

  RK.log = function () {
    if (!window.__RK_DEBUG__) return;
    try {
      console.info.apply(console, ['[书房]'].concat(Array.prototype.slice.call(arguments)));
    } catch (e) {}
  };

  RK.warn = function () {
    try {
      console.warn.apply(console, ['[书房]'].concat(Array.prototype.slice.call(arguments)));
    } catch (e) {}
  };

  // 页面内跨模块互斥锁：防止 SPA 重复渲染
  RK.locks = {};

  RK.lock = function (name) {
    if (RK.locks[name]) return false;
    RK.locks[name] = true;
    return true;
  };

  RK.unlock = function (name) {
    delete RK.locks[name];
  };
})();
