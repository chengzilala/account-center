/**
 * 账户中心页面的最小请求封装（零依赖）。
 * 只做三件事：拼接口地址、带 Token、统一解析 { ok, data } / { ok:false, code, message }。
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'ps_token';
  var API_BASE_KEY = 'ps_api_base_v2';
  var LOCAL_API_PORT = '8942';

  // 生产：页面与接口同域，留空即可；本机调试：页面 18830 / 接口 8942，自动指向接口端口
  // 本机可用 ?api=http://127.0.0.1:8943 指定接口地址（记在 localStorage，跨页面有效），用于端口被占用时
  var API_BASE = (function () {
    if (location.protocol === 'file:') return 'http://localhost:' + LOCAL_API_PORT;
    var isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    if (!isLocal) return '';

    var asked = new URLSearchParams(location.search).get('api');
    if (asked && /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(asked)) {
      localStorage.setItem(API_BASE_KEY, asked);
    }
    var saved = localStorage.getItem(API_BASE_KEY);
    if (saved) return saved;

    if (location.port && location.port !== LOCAL_API_PORT) {
      return 'http://' + location.hostname + ':' + LOCAL_API_PORT;
    }
    return '';
  })();

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  async function call(action, payload) {
    var headers = { 'Content-Type': 'application/json' };
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    var res;
    try {
      res = await fetch(API_BASE + '/accountCenter', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(Object.assign({ action: action }, payload || {}))
      });
    } catch (err) {
      throw errorOf('NETWORK', '连不上服务器，请检查网络后重试');
    }

    var body = null;
    try {
      body = await res.json();
    } catch (err) {
      throw errorOf('BAD_RESPONSE', '服务器返回异常，请稍后再试');
    }

    if (!body || body.ok !== true) {
      var e = errorOf(
        (body && body.code) || 'UNKNOWN',
        (body && body.message) || '操作失败，请稍后再试'
      );
      if (body && body.retryAfter) e.retryAfter = body.retryAfter;
      throw e;
    }
    return body.data;
  }

  function errorOf(code, message) {
    var err = new Error(message);
    err.code = code;
    return err;
  }

  function isLoggedOut(err) {
    return err && (err.code === 'UNAUTHORIZED' || err.code === 'ACCOUNT_DELETED');
  }

  function goLogin() {
    clearToken();
    location.replace('login.html');
  }

  window.AC = {
    TOKEN_KEY: TOKEN_KEY,
    API_BASE: API_BASE,
    call: call,
    getToken: getToken,
    setToken: setToken,
    clearToken: clearToken,
    isLoggedOut: isLoggedOut,
    goLogin: goLogin
  };
})();
