/**
 * 主题引导（必须放在 <head> 里同步加载，避免先亮后暗闪一下）。
 *
 * 配色来源优先级：
 *   1. 链接参数：login.html?theme=dark&accent=%23d6402a（临时覆盖 / 预览用）
 *   2. 账户中心里的作品登记：登录页带 productId 时自动取（日常就靠这个，作品代码零改动）
 *   3. 本机上次用过的主题
 *
 * 登记方式（在账户中心项目里跑一行）：
 *   node tools/register-product.js 微信悦读 微信悦读 https://… dark '#2b2b2b'
 */
(function () {
  'use strict';

  var THEME_KEY = 'ac_theme';
  var ACCENT_KEY = 'ac_accent';
  var PRODUCT_THEME_PREFIX = 'ac_theme_of:';

  var root = document.documentElement;
  var params = new URLSearchParams(location.search);

  var askedTheme = (params.get('theme') || '').toLowerCase();
  var askedAccent = (params.get('accent') || '').trim();
  var productId = (params.get('productId') || '').trim();
  var explicitTheme = askedTheme === 'dark' || askedTheme === 'light';
  var explicitAccent = /^#[0-9a-f]{6}$/i.test(askedAccent);

  function read(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch (err) {
      return '';
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      /* 无痕模式等读不到本机存储时，只按本次参数上色 */
    }
  }

  function remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      /* 同上 */
    }
  }

  function applyTheme(value) {
    root.setAttribute('data-ac-theme', value === 'dark' ? 'dark' : 'light');
  }

  function applyAccent(value) {
    if (/^#[0-9a-f]{6}$/i.test(value || '')) root.style.setProperty('--ac-accent', value);
  }

  // 先按「本次指定 > 这个作品上次的 > 任意页面上次的」上色，尽量不闪
  var theme = '';
  if (explicitTheme) {
    theme = askedTheme;
    write(THEME_KEY, theme);
    if (productId) write(PRODUCT_THEME_PREFIX + productId, theme);
  } else if (productId) {
    theme = read(PRODUCT_THEME_PREFIX + productId) || read(THEME_KEY);
  } else {
    theme = read(THEME_KEY);
  }
  applyTheme(theme);

  var accent = explicitAccent ? askedAccent : read(ACCENT_KEY);
  if (explicitAccent) write(ACCENT_KEY, accent);
  applyAccent(accent);

  // 带 productId 且链接没指定主题：问账户中心这个作品该用什么配色（登记处是唯一来源）
  if (productId && !explicitTheme) {
    fetchProductTheme(productId);
  }

  function apiBase() {
    if (location.protocol === 'file:') return 'http://localhost:8942';
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return '';
    var saved = read('ps_api_base_v2');
    if (saved) return saved;
    return location.port && location.port !== '8942'
      ? 'http://' + location.hostname + ':8942'
      : '';
  }

  function fetchProductTheme(id) {
    var payload = JSON.stringify({ action: 'product.theme', productId: id });
    var done = false;

    try {
      fetch(apiBase() + '/accountCenter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }).then(function (res) {
        return res.json();
      }).then(function (body) {
        if (done || !body || body.ok !== true) return;
        done = true;

        var data = body.data || {};
        var next = data.theme === 'dark' ? 'dark' : 'light';
        write(PRODUCT_THEME_PREFIX + id, next);
        write(THEME_KEY, next);
        if (root.getAttribute('data-ac-theme') !== next) applyTheme(next);

        if (!explicitAccent) {
          if (/^#[0-9a-f]{6}$/i.test(data.accent || '')) {
            applyAccent(data.accent);
            write(ACCENT_KEY, data.accent);
          } else if (read(ACCENT_KEY)) {
            // 这个作品没登记强调色：别把别的作品的配色带过来
            root.style.removeProperty('--ac-accent');
            remove(ACCENT_KEY);
          }
        }
      }).catch(function () {
        /* 取不到就用本机缓存，不打扰用户 */
      });
    } catch (err) {
      /* 老浏览器没有 fetch 时按缓存主题显示 */
    }
  }
})();
