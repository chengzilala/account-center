/**
 * AI Key 集成 · 统一填写面板
 *
 * 用法（零构建，普通 <script> 引入即可）：
 *   <script src="assets/ai-key/providers.js"></script>
 *   <script src="assets/ai-key/key-store.js"></script>
 *   <script src="assets/ai-key/key-panel.js"></script>
 *   <link rel="stylesheet" href="assets/ai-key/key-panel.css">
 *   <script>
 *     AIKeyPanel.mount(document.getElementById('slot'), {
 *       store: AIKeyStore.remote({ call: myRpc }),   // 或 AIKeyStore.local({ scope:'site' })
 *       title: 'AI Key',
 *       note: '自己填、加密托管，随时可清除'
 *     });
 *
 *     // 未配置 Key 的空状态（跳转与文案都由本组件统一维护）
 *     AIKeyPanel.renderEmpty(document.getElementById('aiBox'), { title: '还没有配置 AI Key' });
 *   </script>
 *
 * 设计口径：选平台即自动填好地址与模型，用户只需要粘贴 Key；DeepSeek 始终排第一。
 */
(function (root) {
  'use strict';

  var P = root.AIKeyProviders;
  var S = root.AIKeyStore;
  if (!P || !S) { throw new Error('AIKeyPanel 依赖 providers.js 与 key-store.js，请先引入'); }

  var SEQ = 0;

  // 统一 Key 入口（唯一真源）：所有「去配置 Key」都跳这里，业务页不要写死地址与文案。
  // 换入口只改这一处（或接入时调 AIKeyPanel.setEntry）→ publish.sh 发布，各站自动跟上。
  var ENTRY = {
    url: 'https://account.chesterlee.cn/account.html#ai-key',
    where: '账户中心 → AI Key',
    label: '去配置 Key',
    note: '填一次，所有作品通用'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 全局入口 + 单次覆盖，合成一份完整配置（不改全局） */
  function entryOf(patch) {
    var e = { url: ENTRY.url, where: ENTRY.where, label: ENTRY.label, note: ENTRY.note };
    var p = patch || {};
    if (p.url) { e.url = String(p.url); }
    if (p.where) { e.where = String(p.where); }
    if (p.label) { e.label = String(p.label); }
    if (p.note) { e.note = String(p.note); }
    return e;
  }

  /** 改全局入口：只在自建站 / 离线包里需要，多数站保持母本默认 */
  function setEntry(patch) {
    var p = patch || {};
    if (p.url) { ENTRY.url = String(p.url); }
    if (p.where) { ENTRY.where = String(p.where); }
    if (p.label) { ENTRY.label = String(p.label); }
    if (p.note) { ENTRY.note = String(p.note); }
    return entryOf();
  }

  /** 平台清单取自 providers.js，改注册表后文案自动跟上 */
  function providerNames(max) {
    var list = (P && P.list) || [];
    var names = [];
    for (var i = 0; i < list.length && names.length < (max || 4); i++) {
      if (list[i].custom) { continue; }
      names.push(String(list[i].name || '').replace(/（[^）]*）|\([^)]*\)/g, ''));
    }
    return names.join(' / ');
  }

  /** 未配置 Key 的一句话说明（想自己排版时复用这段文案） */
  function emptyText(options) {
    var o = options || {};
    if (o.desc) { return String(o.desc); }
    var e = entryOf(o.entry);
    var names = providerNames(4);
    return '请到「' + e.where + '」填入你自己的 Key' +
      (names ? '（支持 ' + names + ' 等）' : '') + '，' + e.note + '。';
  }

  /**
   * 未配置 Key 的空状态：文案 + 跳转都取自统一入口，业务页只调用这个方法。
   *   AIKeyPanel.renderEmpty(el, { title: '还没有配置 AI Key' })
   * 不传 el 返回 HTML 字符串。
   */
  function renderEmpty(el, options) {
    var o = options || {};
    var e = entryOf(o.entry);
    var url = o.url || e.url;
    var label = o.label || e.label;
    var html = '<div class="aik-empty" role="status">' +
      '<div class="aik-empty__title">' + esc(o.title || '还没有配置 AI Key') + '</div>' +
      '<div class="aik-empty__desc">' + esc(emptyText(o)) + '</div>' +
      (url ? '<a class="aik-empty__btn" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(label) + '</a>' : '') +
      '</div>';
    if (!el) { return html; }
    el.innerHTML = html;
    return html;
  }

  function mount(el, options) {
    if (!el) { throw new Error('AIKeyPanel.mount 需要容器元素'); }
    var opt = options || {};
    var store = opt.store;
    if (!store) { throw new Error('AIKeyPanel.mount 需要 store（AIKeyStore.local / remote / chrome）'); }

    var providers = opt.providers || P.list;
    var uid = 'aik' + (++SEQ);
    var state = {
      current: '',        // 当前选中厂商 id
      hasKey: false,
      masked: '',
      fetched: false,     // 输入框里的明文是否来自服务端
      busy: false,
      confirmClear: false
    };

    el.innerHTML = render(uid, providers, opt);

    var $ = function (key) { return el.querySelector('[data-k="' + key + '"]'); };
    var chips = el.querySelector('[data-k="chips"]');
    var inputBase = $('base');
    var inputModel = $('model');
    var inputKey = $('key');
    var btnEye = el.querySelector('[data-act="eye"]');
    var msgBox = $('msg');
    var tipKey = $('keytip');
    var datalist = el.querySelector('[data-k="models"]');

    function show(text, ok) {
      msgBox.innerHTML = '<span class="aik-msg__' + (ok ? 'ok' : 'err') + '">' + esc(text) + '</span>';
    }
    function clearMsg() { msgBox.innerHTML = ''; }

    /** 错误文案统一走 ai-client 的映射（同一份人话表），没引入时退回原文 */
    function friendly(j, dflt) {
      var raw = (j && j.error) || '';
      var C = root.AIKeyClient;
      if (C && typeof C.explain === 'function') {
        var r = C.explain(j || { ok: false, error: dflt });
        // 参数类 / 无法归类时，本后端的中文提示通常更具体（如「请先填完整…」），保留原文
        if (r && (r.code === 'param' || r.code === 'unknown') && /[\u4e00-\u9fa5]/.test(raw) && raw.length <= 80) {
          return raw;
        }
        if (r && r.error) { return r.error; }
      }
      return raw || dflt || '操作失败，请重试。';
    }

    function providerById(id) {
      for (var i = 0; i < providers.length; i++) { if (providers[i].id === id) { return providers[i]; } }
      return null;
    }

    function markChips() {
      Array.prototype.forEach.call(chips.querySelectorAll('button'), function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-id') === state.current);
      });
    }

    function fillModels(p) {
      datalist.innerHTML = (p && p.models || []).map(function (m) {
        return '<option value="' + esc(m) + '"></option>';
      }).join('');
    }

    function applyProvider(id, silent) {
      var p = providerById(id);
      if (!p) { return; }
      state.current = id;
      markChips();
      fillModels(p);
      if (p.custom) {
        inputBase.readOnly = false;
        inputBase.classList.remove('is-locked');
        inputModel.readOnly = false;
        if (!silent) { show('自定义端点：请填写服务地址、模型名与 API Key。', true); }
      } else {
        inputBase.value = p.baseUrl;
        inputBase.readOnly = true;
        inputBase.classList.add('is-locked');
        inputModel.readOnly = false;
        if (!silent) { inputModel.value = p.models[0] || ''; }
        if (!silent) { show('已选「' + p.name + '」，地址与模型已自动配好，只需填 API Key。', true); }
      }
      $('tipbase').textContent = p.note || '';
    }

    function renderKeyState(j) {
      var info = j || {};
      state.hasKey = !!info.hasKey;
      state.masked = info.masked || '';
      state.fetched = false;
      setShown(false);
      if (!state.hasKey) {
        tipKey.textContent = '留空表示沿用已托管的 Key。';
        inputKey.placeholder = (providerById(state.current) || {}).keyPrefix
          ? ((providerById(state.current).keyPrefix) + '...')
          : 'sk-...';
      } else {
        tipKey.innerHTML = '当前已托管：<code>' + esc(state.masked || '已托管') + '</code>；留空则保持不变。';
        inputKey.placeholder = state.masked || '已托管';
      }
      syncEye();
    }

    function setShown(on) {
      inputKey.type = on ? 'text' : 'password';
      btnEye.textContent = on ? '隐藏' : '显示';
      if (!on && state.fetched) { inputKey.value = ''; }
      if (!on) { state.fetched = false; }
    }

    function syncEye() {
      btnEye.disabled = state.busy || !(state.masked || inputKey.value);
    }

    function withBusy(btn, text, fn) {
      var old = btn.textContent;
      btn.disabled = true;
      btn.textContent = text;
      return fn().then(function (r) {
        btn.disabled = false;
        btn.textContent = old;
        return r;
      }, function (e) {
        btn.disabled = false;
        btn.textContent = old;
        return { ok: false, error: (e && e.message) || String(e) };
      });
    }

    /** 回显已保存配置：能匹配预设就选中它，否则按自定义解锁 */
    function reflect(info) {
      var baseUrl = (info && info.baseUrl) || '';
      var model = (info && info.model) || '';
      var p = baseUrl ? P.byBaseUrl(baseUrl) : null;
      if (p) {
        applyProvider(p.id, true);
        if (p.custom) {
          inputBase.value = baseUrl;
          inputModel.value = model;
        } else {
          inputModel.value = model || p.models[0] || '';
        }
      } else {
        applyProvider(P.defaultProviderId, true);
        // 首次进入没有已存配置：把默认厂商的模型名带出来，免得看着「已选平台」却要自己猜模型
        var d = providerById(P.defaultProviderId);
        if (d && !d.custom && !inputModel.value) { inputModel.value = d.models[0] || ''; }
      }
      renderKeyState(info);
    }

    // 厂商切换
    chips.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-id]') : null;
      if (!b || state.busy) { return; }
      applyProvider(b.getAttribute('data-id'));
      clearMsg();
    });

    // 显示 / 隐藏
    btnEye.addEventListener('click', function () {
      if (inputKey.type === 'text') { setShown(false); syncEye(); return; }
      if (inputKey.value) { setShown(true); syncEye(); return; }
      if (!state.masked) { return; }
      if (typeof store.reveal !== 'function') { show('当前存储方式不支持查看明文。', false); return; }
      btnEye.disabled = true;
      btnEye.textContent = '读取中…';
      store.reveal().then(function (j) {
        btnEye.disabled = false;
        if (!j || !j.ok) {
          btnEye.textContent = '显示';
          show((j && j.error) || '读取明文失败。', false);
          syncEye();
          return;
        }
        if (!j.key) {
          btnEye.textContent = '显示';
          show('服务端没有返回明文 Key。', false);
          syncEye();
          return;
        }
        inputKey.value = j.key;
        state.fetched = true;
        setShown(true);
        syncEye();
      });
    });

    inputKey.addEventListener('input', function () {
      if (inputKey.value) { state.fetched = false; }
      syncEye();
    });

    // 保存
    el.querySelector('[data-act="save"]').addEventListener('click', function () {
      var btn = this;
      var baseUrl = inputBase.value.trim();
      var model = inputModel.value.trim();
      if (!baseUrl) { show('请先选择一个平台（或点「自定义端点」填写服务地址）。', false); return; }
      if (!model) { show('请填写模型名。', false); return; }
      clearMsg();
      withBusy(btn, '保存中…', function () {
        return store.save({
          providerId: state.current,
          baseUrl: baseUrl,
          model: model,
          key: inputKey.value.trim()
        });
      }).then(function (j) {
        if (!j || !j.ok) { show(friendly(j, '保存失败。'), false); return; }
        inputKey.value = '';
        renderKeyState({ hasKey: true, masked: j.masked || '' });
        show(store.mode === 'local' ? '已保存到本机浏览器。' : '已加密托管，之后打开即用。', true);
        if (typeof opt.onSaved === 'function') { opt.onSaved(j); }
      });
    });

    // 测试连接
    el.querySelector('[data-act="test"]').addEventListener('click', function () {
      var btn = this;
      var baseUrl = inputBase.value.trim();
      var model = inputModel.value.trim();
      if (!baseUrl || !model) { show('请先选平台并填好模型名。', false); return; }
      show('正在测试连接…', true);
      withBusy(btn, '测试中…', function () {
        return store.test({ providerId: state.current, baseUrl: baseUrl, model: model, key: inputKey.value.trim() });
      }).then(function (j) {
        if (!j || !j.ok) { show(friendly(j, '连接测试失败。'), false); return; }
        show('连接成功，模型回复：' + ((j.reply || '').trim() || '(空)'), true);
      });
    });

    // 清除（两段式确认，避免误触）
    var clearBtn = el.querySelector('[data-act="clear"]');
    clearBtn.addEventListener('click', function () {
      if (!state.confirmClear) {
        state.confirmClear = true;
        clearBtn.textContent = '再点一次确认清除';
        setTimeout(function () {
          if (!state.confirmClear) { return; }
          state.confirmClear = false;
          clearBtn.textContent = clearBtn.getAttribute('data-label');
        }, 4000);
        return;
      }
      state.confirmClear = false;
      clearBtn.textContent = clearBtn.getAttribute('data-label');
      withBusy(clearBtn, '清除中…', function () { return store.clear(); }).then(function (j) {
        if (!j || !j.ok) { show((j && j.error) || '清除失败。', false); return; }
        inputKey.value = '';
        renderKeyState(null);
        show('已清除保存的 Key。', true);
        if (typeof opt.onCleared === 'function') { opt.onCleared(); }
      });
    });

    // 初始化
    applyProvider(P.defaultProviderId, true);
    renderKeyState(null);
    store.get().then(function (info) {
      // 读取失败（未登录 / 后端不可用）不吓用户：先按未配置渲染，用户保存时会看到具体错误
      if (info && info.ok) { reflect(info); } else { renderKeyState(null); }
    });

    return {
      refresh: function () { return store.get().then(function (info) { if (info && info.ok) { reflect(info); } }); },
      store: store
    };
  }

  function render(uid, providers, opt) {
    var chips = providers.map(function (p) {
      return '<button type="button" class="aik-chip" data-id="' + esc(p.id) + '">' +
        esc(p.name) + (p.recommended ? '<span class="aik-chip__tag">首推</span>' : '') +
        '</button>';
    }).join('');

    var guide = providers.filter(function (p) { return !p.custom; }).map(function (p) {
      return '<div class="aik-guide__item">' +
        '<a href="' + esc(p.applyUrl) + '" target="_blank" rel="noopener">' + esc(p.name) + '</a>' +
        (p.note ? '<span>' + esc(p.note) + '</span>' : '') +
        '</div>';
    }).join('');

    var footText = opt.footText || 'Key 只提交一次、由你自己的服务端加密托管，页面不保存明文，随时可以一键清除。';

    return '' +
      '<div class="aik">' +
      (opt.title ? '<div class="aik-title">' + esc(opt.title) + '</div>' : '') +
      (opt.note ? '<div class="aik-sub">' + esc(opt.note) + '</div>' : '') +
      '<div class="aik-chips" data-k="chips">' + chips + '</div>' +
      '<div class="aik-field">' +
      '  <label class="aik-label">服务地址（base_url）<span class="aik-auto">自动配置</span></label>' +
      '  <input class="aik-input is-locked" data-k="base" type="text" autocomplete="off" spellcheck="false" readonly>' +
      '  <div class="aik-tip" data-k="tipbase"></div>' +
      '</div>' +
      '<div class="aik-field">' +
      '  <label class="aik-label">模型名（model）<span class="aik-auto">可改</span></label>' +
      '  <input class="aik-input" data-k="model" type="text" list="' + uid + '-models" autocomplete="off" spellcheck="false">' +
      '  <datalist id="' + uid + '-models" data-k="models"></datalist>' +
      '</div>' +
      '<div class="aik-field">' +
      '  <label class="aik-label">API Key</label>' +
      '  <div class="aik-keyrow">' +
      '    <input class="aik-input" data-k="key" type="password" autocomplete="off" spellcheck="false">' +
      '    <button type="button" class="aik-btn aik-btn--ghost" data-act="eye" disabled>显示</button>' +
      '  </div>' +
      '  <div class="aik-tip" data-k="keytip"></div>' +
      '</div>' +
      '<div class="aik-actions">' +
      '  <button type="button" class="aik-btn aik-btn--primary" data-act="save" data-label="保存">保存</button>' +
      '  <button type="button" class="aik-btn" data-act="test" data-label="测试连接">测试连接</button>' +
      '  <button type="button" class="aik-btn aik-btn--danger" data-act="clear" data-label="清除">清除</button>' +
      '</div>' +
      '<div class="aik-msg" data-k="msg" role="status"></div>' +
      '<details class="aik-guide">' +
      '  <summary>还不知道去哪拿 Key？点开看各平台入口</summary>' +
      '  <div class="aik-guide__body">' + guide +
      '    <div class="aik-tip">通用做法：进对应平台控制台 → API Keys / 密钥管理 → 新建并复制，粘贴到上面即可。</div>' +
      '  </div>' +
      '</details>' +
      '<div class="aik-foot">' + esc(footText) + '</div>' +
      '</div>';
  }

  root.AIKeyPanel = {
    mount: mount,
    renderEmpty: renderEmpty,
    emptyText: emptyText,
    entry: function () { return entryOf(); },
    setEntry: setEntry
  };
})(typeof window !== 'undefined' ? window : globalThis);
