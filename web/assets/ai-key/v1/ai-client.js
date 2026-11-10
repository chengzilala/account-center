/**
 * AI Key 集成 · 统一调用客户端
 *
 * 各项目不再自己拼 base_url / 自己判厂商，只调：
 *   var ai = AIKeyClient.create({ endpoint: 'api/ai/chat' });
 *   ai.chat(messages, { feature: 'daily-card', maxTokens: 800 }).then(function (r) {
 *     if (!r.ok) { 显示 r.error; if (r.retryable) 给个重试按钮; return; }  用 r.text
 *   });
 *
 * 两条通道：
 *   - 半托管（默认）：Key 在服务端，浏览器只发对话内容 → POST endpoint
 *   - 纯本机：Key 在浏览器（AIKeyStore.local），每次调用带上 baseUrl/model/apiKey → 仍由服务端转发，
 *     避免浏览器直连厂商（厂商接口普遍不放 CORS）
 *
 * 失败统一返回：
 *   { ok:false, code, title, error, hint, retryable, action, sourceCode? }
 *   - error 仍是「一句话人话」（旧字段，业务页不改也能用）
 *   - retryable 决定要不要给「重试」按钮；组件不自动重试
 *   - 可选：AIKeyClient.explain(任意错误) / AIKeyClient.renderError(el, r, { onRetry })
 *
 * 安全：不记录、不上报任何正文；错误文本统一清洗，不出现 Key / URL / 上游原文。
 */
(function (root) {
  'use strict';

  var DEFAULT_TIMEOUT = 90000;

  // ---------------- 文案表（唯一来源，各站不要另写） ----------------
  var MAP = {
    no_key: {
      title: '还没配置 Key',
      error: '还没有配置 AI Key。',
      hint: '到设置页选平台、粘贴 Key 保存后回来重试。',
      retryable: false,
      action: 'open_settings'
    },
    login_required: {
      title: '登录已失效',
      error: '登录状态已失效，需要重新登录。',
      hint: '重新登录后再试；Key 不会被清除。',
      retryable: false,
      action: 'login'
    },
    invalid_key: {
      title: 'API Key 无效',
      error: 'API Key 无效或已失效，请重新填写。',
      hint: '重新粘贴 Key（前后别带空格），或到厂商控制台确认 Key 未删除。',
      retryable: false,
      action: 'open_settings'
    },
    forbidden: {
      title: '没有权限',
      error: '当前账号没有调用该模型的权限。',
      hint: '确认账号已开通该模型；不确定就换一个平台试。',
      retryable: false,
      action: 'none'
    },
    quota_insufficient: {
      title: '额度不足',
      error: '这个 Key 的额度已用完。',
      hint: '到厂商控制台充值，或换一个可用的 Key。',
      retryable: false,
      action: 'none'
    },
    subscription_expired: {
      title: '订阅已过期',
      error: '这个 Key 的订阅已过期。',
      hint: '到厂商控制台续费，或换一个可用的 Key。',
      retryable: false,
      action: 'none'
    },
    rate_limit: {
      title: '请求太频繁',
      error: '请求太频繁，稍等一下再试。',
      hint: '等 30–60 秒再点；连续触发可以换个时段。',
      retryable: true,
      action: 'retry'
    },
    bad_model: {
      title: '模型不可用',
      error: '模型名或服务地址不正确。',
      hint: '点「测试连接」确认；或换回该平台默认模型。',
      retryable: false,
      action: 'open_settings'
    },
    too_long: {
      title: '内容太长',
      error: '这次内容太长了，模型装不下。',
      hint: '精简后再试，或减少引用 / 历史对话。',
      retryable: true,
      action: 'retry'
    },
    blocked: {
      title: '内容被拦截',
      error: '这段内容被模型服务拦截了。',
      hint: '换个说法，或删掉可能敏感的表述后重试。',
      retryable: true,
      action: 'retry'
    },
    upstream: {
      title: '服务暂时不可用',
      error: 'AI 服务暂时不可用，请稍后重试。',
      hint: '稍后重试；连续失败请点「测试连接」检查 Key 与地址。',
      retryable: true,
      action: 'retry'
    },
    timeout: {
      title: '响应超时',
      error: '等了太久没有回应。',
      hint: '稍后重试；长文可以先缩短再试。',
      retryable: true,
      action: 'retry'
    },
    network: {
      title: '网络连接失败',
      error: '网络连接失败，请检查网络后重试。',
      hint: '检查网络 / 代理；若是跨域问题，确认已走自己的服务端转发。',
      retryable: true,
      action: 'retry'
    },
    param: {
      title: '请求不完整',
      error: '这次请求缺少内容，没法发送。',
      hint: '重新输入后再试。',
      retryable: false,
      action: 'none'
    },
    empty: {
      title: '没有返回内容',
      error: 'AI 服务没有返回内容，请重试。',
      hint: '稍后重试；若持续出现，点「测试连接」确认配置。',
      retryable: true,
      action: 'retry'
    },
    unknown: {
      title: '生成失败',
      error: '生成失败，请稍后重试。',
      hint: '若持续失败，到设置页点「测试连接」确认配置。',
      retryable: true,
      action: 'retry'
    }
  };

  // 上游 / 服务端的机器码 → 本组件稳定码
  var CODE_ALIAS = {
    ai_nokey: 'no_key', no_key: 'no_key', noapikey: 'no_key', key_missing: 'no_key', key_not_configured: 'no_key',
    unauthorized: 'login_required', account_deleted: 'login_required', login_required: 'login_required', token_expired: 'login_required',
    key_unreadable: 'invalid_key', invalid_key: 'invalid_key', invalid_api_key: 'invalid_key', authentication_error: 'invalid_key',
    forbidden: 'forbidden', permission_denied: 'forbidden',
    quota_insufficient: 'quota_insufficient', insufficient_quota: 'quota_insufficient', insufficient_balance: 'quota_insufficient',
    quota_exceeded: 'quota_insufficient', payment_required: 'quota_insufficient', billing_hard_limit_reached: 'quota_insufficient',
    subscription_expired: 'subscription_expired', plan_expired: 'subscription_expired', trial_expired: 'subscription_expired',
    rate_limited: 'rate_limit', rate_limit: 'rate_limit', too_many_requests: 'rate_limit',
    model_not_found: 'bad_model', invalid_model: 'bad_model', bad_model: 'bad_model', model_unavailable: 'bad_model',
    context_length_exceeded: 'too_long', too_long: 'too_long', request_too_large: 'too_long',
    content_filter: 'blocked', content_policy_violation: 'blocked', blocked: 'blocked',
    upstream_failed: 'upstream', ai_upstream: 'upstream', bad_gateway: 'upstream', service_unavailable: 'upstream',
    internal_error: 'upstream', bad_response: 'upstream',
    timeout: 'timeout', etimedout: 'timeout',
    network: 'network', network_error: 'network', fetch_failed: 'network',
    invalid_param: 'param', param: 'param', bad_request: 'param',
    empty: 'empty'
  };

  // 消息关键字（短语白名单；拿不到明确 code / 状态码时才用）
  var RULES = [
    { code: 'subscription_expired', re: /订阅|续费|会员.{0,4}过期|试用.{0,6}(结束|到期)|subscription|plan[^a-z]{0,4}expired|trial[^a-z]{0,4}expired/i },
    { code: 'quota_insufficient', re: /余额|额度|欠费|充值|insufficient[_ ]?(quota|balance|funds)|exceeded your (current )?quota|payment required|arrears/i },
    { code: 'no_key', re: /还没有(保存|配置).{0,6}(api\s*)?key|未配置.{0,6}key|no api key|ai_nokey|not configured/i },
    { code: 'login_required', re: /(登录|账户|账号|token).{0,8}(失效|过期|无效|注销)|请重新登录|unauthorized|account[_ ]?deleted/i },
    { code: 'invalid_key', re: /invalid[_ ]?api[_ ]?key|incorrect api key|api key.{0,12}(invalid|expired|not valid|revoked)|key.{0,8}(无效|失效|不正确|无法解密)|authentication[_ ]?(failed|error)/i },
    { code: 'bad_model', re: /model.{0,16}(not found|not exist|not supported|invalid|unavailable)|invalid model|模型.{0,8}(不存在|不可用|无效|不支持)|no such model/i },
    { code: 'too_long', re: /context.{0,16}(length|limit|too long)|maximum context|too many tokens|request too large|内容过长|超出.{0,6}(长度|上限)/i },
    { code: 'blocked', re: /content[_ ]?filter|content[_ ]?policy|safety|risk.{0,6}content|审核|违规|敏感/i },
    { code: 'rate_limit', re: /rate[_ ]?limit|too many requests|请求太频繁|限流/i },
    { code: 'timeout', re: /timeout|timed out|超时|abort/i },
    { code: 'network', re: /failed to fetch|networkerror|network error|连不上|网络(连接)?(失败|异常|不可用)|econn|getaddrinfo|dns|certificate|ssl/i },
    { code: 'upstream', re: /upstream|模型服务返回错误|连接模型服务失败|服务暂时不可用|bad gateway|gateway|internal server error|上游/i },
    { code: 'param', re: /缺少|请先填|invalid[_ ]?param|参数(错误|不对)|请求体不是合法/i }
  ];

  // 通用兜底码：拿到它们时，优先看消息里的 HTTP 状态 / 关键字
  var GENERIC = { upstream: 1, unknown: 1, empty: 1 };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 展示前的清洗：去密钥、去 URL、压空白、截断；不用于逻辑判断 */
  function sanitize(s) {
    var t = String(s == null ? '' : s);
    t = t.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***');
    t = t.replace(/\bsk-[A-Za-z0-9._\-]{6,}/g, 'sk-***');
    t = t.replace(/https?:\/\/[^\s"'，。；）)]+/gi, '<地址>');
    t = t.replace(/\s+/g, ' ').trim();
    if (t.length > 160) { t = t.slice(0, 157) + '...'; }
    return t;
  }

  function byStatus(status) {
    if (status === 401) { return 'invalid_key'; }
    if (status === 402) { return 'quota_insufficient'; }
    if (status === 403) { return 'forbidden'; }
    if (status === 404) { return 'bad_model'; }
    if (status === 413) { return 'too_long'; }
    if (status === 429) { return 'rate_limit'; }
    if (status >= 500) { return 'upstream'; }
    return '';
  }

  function fail(code, cause) {
    var key = MAP[code] ? code : 'unknown';
    var item = MAP[key];
    var out = {
      ok: false,
      code: key,
      title: item.title,
      error: item.error,
      hint: item.hint,
      retryable: item.retryable,
      action: item.action
    };
    var api = root.AIKeyClient;
    if (api && api.debug && cause) { out.cause = sanitize(cause); }
    return out;
  }

  /**
   * 把任意失败输入归一成统一结构。永不抛错。
   * 支持：{ok:false,code,error,status} / Error（带 code/status）/ 字符串 / undefined
   */
  function normalize(input) {
    if (input == null) { return fail('empty'); }

    var codeRaw = '';
    var status = 0;
    var msg = '';

    if (typeof input === 'string') {
      msg = input;
    } else if (typeof input === 'object') {
      codeRaw = String(input.sourceCode || input.code || '').trim();
      var st = Number(input.status || input.__http || 0);
      status = isFinite(st) ? st : 0;
      msg = String(input.error || input.message || '');
    } else {
      msg = String(input);
    }

    var code = CODE_ALIAS[codeRaw.toLowerCase()] || '';

    var statusCode = byStatus(status);
    if (!statusCode) {
      var m = msg.match(/HTTP\s*(\d{3})/i);
      if (m) { statusCode = byStatus(Number(m[1])); }
    }

    var keywordCode = '';
    if (msg) {
      for (var i = 0; i < RULES.length; i++) {
        if (RULES[i].re.test(msg)) { keywordCode = RULES[i].code; break; }
      }
    }

    // 明确 code 优先；通用兜底码让位给更具体的状态 / 关键字
    var finalCode = code;
    if (!finalCode || GENERIC[finalCode]) {
      if (statusCode) { finalCode = statusCode; }
      else if (keywordCode) { finalCode = keywordCode; }
    }
    if (!finalCode) { finalCode = 'unknown'; }

    var out = fail(finalCode, msg || codeRaw);
    if (codeRaw) { out.sourceCode = codeRaw; }
    return out;
  }

  function create(options) {
    var opt = options || {};
    var endpoint = (opt.endpoint || '/api/ai/chat').replace(/\/+$/, '');
    var owner = opt.owner || '';
    var call = typeof opt.call === 'function' ? opt.call : null;
    var store = opt.store || null;
    var timeoutMs = opt.timeoutMs || DEFAULT_TIMEOUT;

    function post(url, body) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
      var headers = { 'Content-Type': 'application/json' };
      if (owner) { headers['X-Owner'] = owner; }
      return fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (r) {
        return r.text().then(function (text) {
          var j = null;
          if (text) { try { j = JSON.parse(text); } catch (e) { j = null; } }
          if (!r.ok) {
            // 非 2xx：保留状态码给归一化用，文案交给统一映射
            return {
              ok: false,
              __http: r.status,
              code: (j && j.code) || '',
              error: (j && (j.error || j.message)) || ('HTTP ' + r.status)
            };
          }
          return j;
        });
      }).catch(function (e) {
        if (e && e.name === 'AbortError') {
          return { ok: false, code: 'timeout', error: '请求超时' };
        }
        return { ok: false, code: 'network', error: (e && e.message) || String(e) };
      }).then(function (j) {
        if (timer) { clearTimeout(timer); }
        return j;
      });
    }

    /** 本机模式的 Key 从 store 现取；半托管模式不带 Key */
    function keyPayload() {
      if (!store || store.mode !== 'local' && store.mode !== 'chrome') { return Promise.resolve({}); }
      return store.get().then(function (info) {
        if (!info || !info.hasKey) { return {}; }
        return store.reveal().then(function (k) {
          if (!k || !k.ok) { return {}; }
          return { baseUrl: info.baseUrl, model: info.model, apiKey: k.key };
        });
      });
    }

    function toResult(j) {
      if (!j) { return fail('empty'); }
      if (j instanceof Error) { return normalize(j); }
      if (j.ok === true) {
        if (!j.text) { return fail('empty'); }
        return { ok: true, text: j.text, usage: j.usage || null, provider: j.provider || '', model: j.model || '' };
      }
      if (j.ok === false || j.error) { return normalize(j); }
      if (j.text) {
        return { ok: true, text: j.text, usage: j.usage || null, provider: j.provider || '', model: j.model || '' };
      }
      return normalize('AI 返回结果无效');
    }

    function chat(messages, opts2) {
      var o = opts2 || {};
      if (!Array.isArray(messages) || !messages.length) {
        return Promise.resolve(fail('param'));
      }
      return keyPayload().then(function (kp) {
        var payload = {
          owner: owner,
          messages: messages,
          feature: o.feature || '',
          maxTokens: o.maxTokens || 0,
          temperature: typeof o.temperature === 'number' ? o.temperature : 0.7
        };
        if (kp.apiKey) {
          payload.baseUrl = kp.baseUrl;
          payload.model = kp.model;
          payload.apiKey = kp.apiKey;
        }
        if (call) {
          // 账户中心等宿主通道失败时 reject；这里兜住，统一转成人话
          return Promise.resolve().then(function () { return call('aiChat', payload); })
            .then(function (j) { return j; }, function (e) { return e; });
        }
        return post(endpoint, payload);
      }).then(toResult).catch(function (e) {
        return normalize(e);
      });
    }

    return { chat: chat, endpoint: endpoint, owner: owner };
  }

  /** 渲染统一错误卡：给 el 就挂进去，不给就返回 HTML 字符串（字符串模式不含按钮） */
  function renderError(el, result, opts) {
    var o = opts || {};
    var r = normalize(result);
    var showRetry = !!(el && typeof o.onRetry === 'function' && r.retryable);
    var html = '<div class="aik-err" role="status" aria-live="polite">' +
      '<div class="aik-err__title">' + esc(r.title) + '</div>' +
      '<div class="aik-err__desc">' + esc(String(r.error).replace(/。$/, '')) + '</div>' +
      (r.hint ? '<div class="aik-err__hint">' + esc(r.hint) + '</div>' : '') +
      (showRetry ? '<button type="button" class="aik-err__retry">重试</button>' : '') +
      '</div>';
    if (!el) { return html; }
    el.innerHTML = html;
    var btn = el.querySelector ? el.querySelector('.aik-err__retry') : null;
    if (btn) {
      btn.addEventListener('click', function () { o.onRetry(); });
    }
    return html;
  }

  root.AIKeyClient = {
    create: create,
    explain: normalize,
    renderError: renderError,
    debug: false
  };
})(typeof window !== 'undefined' ? window : globalThis);
