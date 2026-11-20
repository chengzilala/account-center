/**
 * 运营后台（/admin/）——原生 JS，零构建。
 * 所有数据都走 admin.* 接口；权限由服务端判定，这里只按 permissions 隐藏按钮。
 */
(function () {
  'use strict';

  var AC = window.AC;
  var state = {
    me: null,
    tab: 'overview',
    products: [],
    users: { keyword: '', status: 'all', page: 1, pageSize: 20, total: 0, items: [] },
    audit: { uid: '', action: '', page: 1, pageSize: 20, total: 0, items: [] },
    release: { status: 'all', page: 1, pageSize: 10, total: 0, items: [], suggested: '1.0.0', repos: {}, current: null },
    detailUid: ''
  };

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function two(n) { return String(n).padStart(2, '0'); }

  function fmt(ts) {
    if (!ts) return '—';
    var d = new Date(Number(ts));
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate())
      + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }

  function fmtDay(ts) {
    if (!ts) return '—';
    var d = new Date(Number(ts));
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }

  function dayToTs(value) {
    if (!value) return 0;
    var ts = new Date(value + 'T23:59:59+08:00').getTime();
    return Number.isFinite(ts) ? ts : 0;
  }

  function can(cap) {
    return Boolean(state.me && state.me.permissions && state.me.permissions.indexOf(cap) >= 0);
  }

  function goLogin() {
    AC.clearToken();
    location.replace('../login.html?next=' + encodeURIComponent('/admin/'));
  }

  var toastTimer = null;
  function toast(message) {
    var el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  function fail(err) {
    toast((err && err.message) || '操作失败');
  }

  // ---------- 启动 ----------

  async function boot() {
    if (!AC.getToken()) return goLogin();

    try {
      state.me = await AC.call('admin.me');
    } catch (err) {
      if (AC.isLoggedOut(err) || (err && err.code === 'ACCOUNT_DISABLED')) return goLogin();
      if (err && err.code === 'FORBIDDEN') return showDenied(err.message);
      $('boot').textContent = '后台暂时打不开：' + ((err && err.message) || '请稍后再试');
      return;
    }

    $('boot').hidden = true;
    $('app').hidden = false;
    $('meLabel').textContent = (state.me.nickname || state.me.uid) + ' · ' + state.me.role;

    await loadProducts().catch(function () {});
    switchTab('overview');
  }

  function showDenied(message) {
    $('boot').hidden = true;
    $('denied').hidden = false;
    if (message) $('deniedText').textContent = message;
  }

  function switchTab(tab) {
    state.tab = tab;
    var names = ['overview', 'users', 'products', 'release', 'audit'];
    names.forEach(function (name) {
      $('panel-' + name).hidden = name !== tab;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.adm-nav-item'), function (item) {
      item.classList.toggle('is-on', item.getAttribute('data-tab') === tab);
    });

    if (tab === 'overview') loadOverview().catch(fail);
    if (tab === 'users') loadUsers().catch(fail);
    if (tab === 'products') loadProducts().catch(fail);
    if (tab === 'release') loadRelease().catch(fail);
    if (tab === 'audit') loadAudit().catch(fail);
  }

  // ---------- 总览 ----------

  async function loadOverview() {
    var data = await AC.call('admin.overview');

    $('overviewCards').innerHTML = [
      card(data.users.total, '账户总数'),
      card(data.users.activeToday, '今日活跃'),
      card(data.users.newToday, '今日新增'),
      card(data.users.disabled, '已禁用'),
      card(data.login.today, '今日登录'),
      card(data.login.successRate === null ? '—' : data.login.successRate + '%', '登录成功率')
    ].join('');

    var rows = data.products.map(function (item) {
      return '<tr><td>' + esc(item.name) + '</td><td>' + esc(item.appId) + '</td><td>' + item.users + '</td></tr>';
    }).join('');
    $('overviewProducts').innerHTML = rows
      ? '<thead><tr><th>作品</th><th>appId</th><th>用户数</th></tr></thead><tbody>' + rows + '</tbody>'
      : '<tbody><tr><td class="adm-empty">还没有使用记录</td></tr></tbody>';

    $('overviewAudit').innerHTML = data.recentAudit.length
      ? data.recentAudit.map(function (row) {
        return '<li><span>' + esc(row.title) + '</span>'
          + '<span class="adm-list-meta">' + esc(row.scope) + '</span>'
          + '<span class="adm-list-time">' + fmt(row.createdAt) + '</span></li>';
      }).join('')
      : '<li class="adm-empty">还没有审计记录</li>';
  }

  function card(value, label) {
    return '<div class="adm-card"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
  }

  // ---------- 用户 ----------

  async function loadUsers() {
    var data = await AC.call('admin.users.list', {
      keyword: state.users.keyword,
      status: state.users.status,
      page: state.users.page,
      pageSize: state.users.pageSize
    });
    state.users.total = data.total;
    state.users.items = data.items;

    var rows = data.items.map(function (user) {
      var tag = user.status === 'disabled'
        ? '<span class="adm-tag adm-tag--off">已禁用</span>'
        : '<span class="adm-tag adm-tag--ok">正常</span>';
      return '<tr>'
        + '<td class="grow">' + esc(user.nickname || '（未命名）') + '<br><span class="adm-list-meta">' + esc(user.uid) + '</span></td>'
        + '<td>' + esc(user.emailMasked || '—') + '</td>'
        + '<td>' + esc(user.phoneMasked || '—') + '</td>'
        + '<td>' + (user.providers.length ? esc(user.providers.join(' / ')) : '—') + '</td>'
        + '<td>' + fmt(user.createdAt) + '</td>'
        + '<td>' + fmt(user.lastActiveAt) + '</td>'
        + '<td>' + user.sessionCount + '</td>'
        + '<td>' + tag + '</td>'
        + '<td><button class="adm-btn adm-btn--mini" data-detail="' + esc(user.uid) + '" type="button">详情</button></td>'
        + '</tr>';
    }).join('');

    $('userTable').innerHTML = rows
      ? '<thead><tr><th>用户</th><th>邮箱</th><th>手机</th><th>第三方</th><th>注册</th><th>最近活跃</th><th>在线</th><th>状态</th><th></th></tr></thead><tbody>' + rows + '</tbody>'
      : '<tbody><tr><td class="adm-empty">没有匹配的用户</td></tr></tbody>';

    renderPager('userPager', state.users, 'user');
  }

  // ---------- 作品与权益 ----------

  async function loadProducts() {
    var data = await AC.call('admin.products.list');
    state.products = data.items;

    var rows = data.items.map(function (product) {
      var mode = '<select class="adm-input" data-mode="' + esc(product.appId) + '"' + (can('product.write') ? '' : ' disabled') + '>'
        + '<option value="open"' + (product.accessMode === 'open' ? ' selected' : '') + '>open（登录即可用）</option>'
        + '<option value="grant"' + (product.accessMode === 'grant' ? ' selected' : '') + '>grant（需授权）</option>'
        + '</select>';
      var statusTag = product.status === 'active'
        ? '<span class="adm-tag adm-tag--ok">在线</span>'
        : '<span class="adm-tag adm-tag--warn">已下线</span>';
      return '<tr>'
        + '<td class="grow">' + esc(product.name) + '<br><span class="adm-list-meta">' + esc(product.appId) + '</span></td>'
        + '<td><a href="' + esc(product.url) + '" target="_blank" rel="noopener">' + esc(product.url) + '</a></td>'
        + '<td>' + statusTag + '</td>'
        + '<td>' + mode + '</td>'
        + '<td>' + product.entitlementCount + '</td>'
        + '<td>'
        + '<button class="adm-btn adm-btn--mini" data-save-product="' + esc(product.appId) + '" type="button"' + (can('product.write') ? '' : ' disabled') + '>保存</button> '
        + '<button class="adm-btn adm-btn--mini" data-toggle-product="' + esc(product.appId) + '" data-status="' + esc(product.status === 'active' ? 'offline' : 'active') + '" type="button"' + (can('product.write') ? '' : ' disabled') + '>'
        + (product.status === 'active' ? '下线' : '上线') + '</button>'
        + '</td>'
        + '</tr>';
    }).join('');

    $('productTable').innerHTML = rows
      ? '<thead><tr><th>作品</th><th>地址</th><th>状态</th><th>准入</th><th>授权数</th><th></th></tr></thead><tbody>' + rows + '</tbody>'
      : '<tbody><tr><td class="adm-empty">还没有登记作品</td></tr></tbody>';

    $('grantProduct').innerHTML = data.items.map(function (product) {
      return '<option value="' + esc(product.appId) + '">' + esc(product.name) + '</option>';
    }).join('');
  }

  // ---------- 审计 ----------

  async function loadAudit() {
    var data = await AC.call('admin.audit.list', {
      uid: state.audit.uid,
      actionPrefix: state.audit.action,
      page: state.audit.page,
      pageSize: state.audit.pageSize
    });
    state.audit.total = data.total;
    state.audit.items = data.items;

    $('auditList').innerHTML = data.items.length
      ? data.items.map(function (row) {
        return '<li><span>' + esc(row.title) + '</span>'
          + '<span class="adm-list-meta">' + esc(row.action) + (row.target ? ' · ' + esc(row.target) : '') + '</span>'
          + '<span class="adm-list-time">' + fmt(row.createdAt) + '</span></li>';
      }).join('')
      : '<li class="adm-empty">没有匹配的审计记录</li>';

    renderPager('auditPager', state.audit, 'audit');
  }

  function renderPager(id, box, kind) {
    var pages = Math.max(1, Math.ceil(box.total / box.pageSize));
    $(id).innerHTML = '<button class="adm-btn adm-btn--mini" data-page="' + kind + '" data-delta="-1" type="button"' + (box.page <= 1 ? ' disabled' : '') + '>上一页</button>'
      + '<span>第 ' + box.page + ' / ' + pages + ' 页 · 共 ' + box.total + ' 条</span>'
      + '<button class="adm-btn adm-btn--mini" data-page="' + kind + '" data-delta="1" type="button"' + (box.page >= pages ? ' disabled' : '') + '>下一页</button>';
  }

  // ---------- 用户详情 ----------

  async function openUser(uid) {
    state.detailUid = uid;
    var data = await AC.call('admin.user.detail', { uid: uid });
    renderDetail(data);
    $('userModal').hidden = false;
  }

  function renderDetail(data) {
    var statusTag = data.status === 'disabled'
      ? '<span class="adm-tag adm-tag--off">已禁用</span>'
      : '<span class="adm-tag adm-tag--ok">正常</span>';

    var keys = data.keys.length
      ? data.keys.map(function (key) {
        return '<div class="adm-row"><div class="adm-row-main">' + esc(key.masked)
          + '<div class="adm-row-sub">' + esc(key.kind) + (key.provider ? ' · ' + esc(key.provider) : '')
          + ' · 最近使用 ' + fmt(key.lastUsedAt) + '</div></div></div>';
      }).join('')
      : '<div class="adm-empty">没有绑定登录方式</div>';

    var sessions = data.sessions.length
      ? data.sessions.map(function (session) {
        var tag = session.alive
          ? '<span class="adm-tag adm-tag--ok">在线</span>'
          : (session.revoked ? '<span class="adm-tag">已退出</span>' : '<span class="adm-tag">已过期</span>');
        return '<div class="adm-row">' + tag
          + '<div class="adm-row-main">' + esc(session.appId)
          + '<div class="adm-row-sub">' + esc(session.ua || '未知设备') + ' · 最近 ' + fmt(session.lastSeenAt) + '</div></div>'
          + (session.alive && can('session.revoke')
            ? '<button class="adm-btn adm-btn--mini" data-revoke="' + esc(session.sid) + '" type="button">下线</button>'
            : '')
          + '</div>';
      }).join('')
      : '<div class="adm-empty">没有会话</div>';

    var ents = data.entitlements.length
      ? data.entitlements.map(function (item) {
        var active = item.status === 'active' && (!item.expiresAt || item.expiresAt > Date.now());
        return '<div class="adm-row">'
          + '<div class="adm-row-main">' + esc(item.productName)
          + '<div class="adm-row-sub">' + esc(item.appId) + ' · ' + esc(item.status)
          + (item.expiresAt ? ' · 到期 ' + fmtDay(item.expiresAt) : ' · 长期') + '</div></div>'
          + (active && can('entitlement.write')
            ? '<button class="adm-btn adm-btn--mini adm-btn--danger" data-revoke-ent="' + esc(item.appId) + '" type="button">撤销</button>'
            : '')
          + '</div>';
      }).join('')
      : '<div class="adm-empty">还没有单独授权（open 作品不需要）</div>';

    var audits = data.audits.length
      ? data.audits.map(function (row) {
        return '<div class="adm-row"><div class="adm-row-main">' + esc(row.title)
          + '<div class="adm-row-sub">' + esc(row.action) + ' · ' + esc(row.scope) + '</div></div>'
          + '<span class="adm-list-meta">' + fmt(row.createdAt) + '</span></div>';
      }).join('')
      : '<div class="adm-empty">没有事件</div>';

    var productOptions = state.products.map(function (product) {
      return '<option value="' + esc(product.appId) + '">' + esc(product.name) + '</option>';
    }).join('');

    $('modalBody').innerHTML = ''
      + '<div class="adm-detail-head"><h2>' + esc(data.nickname || '（未命名）') + '</h2>' + statusTag + '</div>'
      + '<dl class="adm-kv">'
      + '<dt>uid</dt><dd>' + esc(data.uid) + '</dd>'
      + '<dt>注册</dt><dd>' + fmt(data.createdAt) + '</dd>'
      + '<dt>AI Key</dt><dd>' + (data.aiKey.hasKey ? '已托管（仅显示状态，不可查看明文）' : '未托管') + '</dd>'
      + '</dl>'
      + '<div class="adm-form">'
      + '<button class="adm-btn" data-toggle-user="' + esc(data.uid) + '" data-status="' + esc(data.status === 'disabled' ? 'active' : 'disabled') + '" type="button"' + (can('user.write') ? '' : ' disabled') + '>'
      + (data.status === 'disabled' ? '启用账户' : '禁用账户') + '</button>'
      + '<button class="adm-btn adm-btn--danger" data-revoke-all="' + esc(data.uid) + '" type="button"' + (can('session.revoke') ? '' : ' disabled') + '>全部下线</button>'
      + '</div>'
      + '<div class="adm-box"><h3>登录方式</h3>' + keys + '</div>'
      + '<div class="adm-box"><h3>会话</h3>' + sessions + '</div>'
      + '<div class="adm-box"><h3>作品授权</h3>' + ents
      + (can('entitlement.write') && productOptions
        ? '<div class="adm-form" style="margin-top:12px">'
        + '<select class="adm-input" id="detailGrantProduct">' + productOptions + '</select>'
        + '<input class="adm-input" id="detailGrantExpire" type="date" title="到期日（留空 = 长期）">'
        + '<button class="adm-btn adm-btn--solid" data-grant="' + esc(data.uid) + '" type="button">授权</button>'
        + '</div>'
        : '')
      + '</div>'
      + '<div class="adm-box"><h3>备注</h3>'
      + '<textarea class="adm-textarea" id="detailNote" placeholder="只给后台看，不会展示给用户">' + esc(data.note.note) + '</textarea>'
      + '<div class="adm-form" style="margin-top:8px">'
      + '<input class="adm-input" id="detailTags" placeholder="标签，逗号分隔" value="' + esc((data.note.tags || []).join(',')) + '">'
      + '<button class="adm-btn" data-save-note="' + esc(data.uid) + '" type="button"' + (can('note.write') ? '' : ' disabled') + '>保存备注</button>'
      + '</div></div>'
      + '<div class="adm-box"><h3>最近事件</h3>' + audits + '</div>';
  }

  function closeModal() {
    $('userModal').hidden = true;
    state.detailUid = '';
  }

  // ---------- 动作 ----------

  async function toggleUser(uid, status) {
    if (status === 'disabled' && !confirm('禁用后该用户会被立刻踢下线，且无法再登录。确定？')) return;
    await AC.call('admin.user.status', { uid: uid, status: status });
    toast(status === 'disabled' ? '已禁用并下线' : '已启用');
    await openUser(uid);
    if (state.tab === 'users') await loadUsers();
  }

  async function revokeSessions(uid, sid) {
    if (!sid && !confirm('确定让该用户在所有设备下线？')) return;
    await AC.call('admin.user.sessions.revoke', { uid: uid, sid: sid || '' });
    toast('已下线');
    await openUser(uid);
    if (state.tab === 'users') await loadUsers();
  }

  async function saveNote(uid) {
    var tags = ($('detailTags').value || '').split(/[,，]/).map(function (item) { return item.trim(); }).filter(Boolean);
    await AC.call('admin.user.note', { uid: uid, note: $('detailNote').value, tags: tags });
    toast('备注已保存');
  }

  async function grant(uid, appId, expiresAt, note) {
    await AC.call('admin.entitlement.set', { uid: uid, appId: appId, expiresAt: expiresAt || 0, source: 'grant', note: note || '' });
    toast('已授权');
    await openUser(uid);
  }

  async function revokeEntitlement(uid, appId) {
    if (!confirm('撤销后该用户将失去此作品（grant 模式下会被拦）。确定？')) return;
    await AC.call('admin.entitlement.revoke', { uid: uid, appId: appId });
    toast('已撤销');
    await openUser(uid);
  }

  async function saveProduct(appId) {
    var select = document.querySelector('[data-mode="' + appId + '"]');
    await AC.call('admin.product.upsert', { appId: appId, accessMode: select ? select.value : 'open' });
    toast('已保存');
    await loadProducts();
  }

  async function toggleProduct(appId, status) {
    if (status === 'offline' && !confirm('下线后该作品不会再出现在「我的作品」，确定？')) return;
    await AC.call('admin.product.upsert', { appId: appId, status: status });
    toast(status === 'offline' ? '已下线' : '已上线');
    await loadProducts();
  }

  // ---------- 发布台账 ----------

  var RELEASE_TEXT = { planned: '待发布', pushed: '已推送', failed: '失败', cancelled: '已作废' };
  var SCOPE_TEXT = { cloud: '云函数', web: '网页', docs: '文档', ops: '运维' };

  function releaseCommand(item) {
    var branch = state.release.repos.branch || 'main';
    var summary = String(item.summary || '').replace(/"/g, "'").slice(0, 60);
    return 'git add -A && git commit -m "release: v' + item.version + ' ' + summary +
      '" && git tag v' + item.version + ' && git push origin ' + branch +
      ' && git push origin v' + item.version;
  }

  async function loadRelease() {
    var data = await AC.call('admin.release.current');
    state.release.suggested = data.suggestedVersion || '1.0.0';
    state.release.repos = data.repos || {};
    state.release.current = data.current;
    renderReleaseCurrent(data);
    await loadReleaseList();
  }

  function renderReleaseCurrent(data) {
    var cur = data.current;
    if (!cur) {
      $('releaseCurrent').innerHTML = card('—', '当前版本') + card('v' + data.suggestedVersion, '建议第一版');
      return;
    }
    var links = '<a class="adm-link" href="' + esc(cur.githubUrl) + '" target="_blank" rel="noopener">GitHub</a>' +
      ' · <a class="adm-link" href="' + esc(cur.giteeUrl) + '" target="_blank" rel="noopener">Gitee</a>';
    $('releaseCurrent').innerHTML =
      card('v' + cur.version, '当前版本') +
      card(cur.tag, 'tag') +
      card(cur.commitShort || '—', 'commit') +
      card(fmt(cur.pushedAt), '推送时间') +
      card('v' + data.suggestedVersion, '建议下一版') +
      '<p class="adm-hint" style="grid-column:1/-1;margin:4px 0 0">' + links + '</p>';
  }

  function renderReleaseList() {
    var box = state.release;
    if (!box.items.length) {
      $('releaseList').innerHTML = '<div class="adm-box adm-empty">还没有发布记录</div>';
      $('releasePager').innerHTML = '';
      return;
    }

    $('releaseList').innerHTML = box.items.map(function (item) {
      var editable = item.status === 'planned' || item.status === 'failed';
      var checkHtml = ['tested', 'backup', 'health'].map(function (key) {
        var done = Boolean(item.checks[key + 'At']);
        return '<label><input type="checkbox" data-check="' + key + '" data-version="' + esc(item.version) + '"' +
          (done ? ' checked' : '') + (editable ? '' : ' disabled') + '>' +
          ({ tested: '测试通过', backup: '数据已备份', health: '已跑体检' })[key] + '</label>';
      }).join('');

      var scope = (item.scope || []).map(function (key) { return SCOPE_TEXT[key] || key; }).join(' / ');
      var actions = '';
      if (editable) {
        actions = '<div class="adm-toolbar" style="margin-top:10px">' +
          '<button class="adm-btn adm-btn--solid" type="button" data-release-complete="' + esc(item.version) + '">标记已推送</button>' +
          '<button class="adm-btn" type="button" data-release-fail="' + esc(item.version) + '">标记失败</button>' +
          '<button class="adm-btn" type="button" data-release-cancel="' + esc(item.version) + '">作废</button>' +
          '</div><div class="adm-cmd"><code>' + esc(releaseCommand(item)) + '</code>' +
          '<button class="adm-btn" type="button" data-copy-cmd="' + esc(item.version) + '">复制</button></div>';
      }
      if (item.status === 'pushed') {
        actions = '<p class="adm-hint" style="margin:8px 0 0">' + esc(item.commitShort) + ' · ' +
          '<a class="adm-link" href="' + esc(item.githubUrl) + '" target="_blank" rel="noopener">GitHub</a> · ' +
          '<a class="adm-link" href="' + esc(item.giteeUrl) + '" target="_blank" rel="noopener">Gitee</a></p>';
      }
      if (item.status === 'failed' && item.reason) {
        actions = '<p class="adm-hint" style="margin:8px 0 0;color:#b3261e">失败原因：' + esc(item.reason) + '</p>' + actions;
      }

      return '<div class="adm-box adm-release">' +
        '<div class="adm-row"><strong style="font-size:15px">v' + esc(item.version) + '</strong>' +
        '<span class="adm-tag">' + esc(RELEASE_TEXT[item.status] || item.status) + '</span>' +
        '<span class="adm-list-meta">' + fmt(item.plannedAt) + (scope ? ' · ' + esc(scope) : '') + '</span></div>' +
        '<p style="margin:8px 0 0;font-size:13px">' + esc(item.summary) + '</p>' +
        '<div class="adm-checks">' + checkHtml + '</div>' + actions + '</div>';
    }).join('');

    $('releasePager').innerHTML = '<span class="adm-list-meta">共 ' + box.total + ' 条 · 第 ' + box.page + ' 页</span>' +
      '<button class="adm-btn" type="button" data-page="release" data-delta="-1"' + (box.page <= 1 ? ' disabled' : '') + '>上一页</button>' +
      '<button class="adm-btn" type="button" data-page="release" data-delta="1"' +
      (box.page * box.pageSize >= box.total ? ' disabled' : '') + '>下一页</button>';
  }

  async function loadReleaseList() {
    var data = await AC.call('admin.release.list', {
      page: state.release.page,
      pageSize: state.release.pageSize,
      status: state.release.status
    });
    state.release.items = data.items || [];
    state.release.total = data.total || 0;
    renderReleaseList();
  }

  function openReleaseModal(html) {
    $('releaseModalBody').innerHTML = html;
    $('releaseModal').hidden = false;
  }

  function closeReleaseModal() {
    $('releaseModal').hidden = true;
  }

  function openReleaseCreate() {
    var options = ['cloud', 'web', 'docs', 'ops'].map(function (key) {
      return '<label><input type="checkbox" value="' + key + '" data-scope>' + SCOPE_TEXT[key] + '</label>';
    }).join('');
    openReleaseModal(
      '<h2 style="margin:0 0 6px;font-size:16px">新建发布</h2>' +
      '<p class="adm-hint">创建后生成命令，本地执行推送，成功再回来「标记已推送」。</p>' +
      '<label class="adm-field">版本号<input class="adm-input" id="relVersion" value="' + esc(state.release.suggested) + '"></label>' +
      '<label class="adm-field">变更摘要<textarea class="adm-input" id="relSummary" rows="3" maxlength="200" placeholder="10-200 字，写清这次改了什么"></textarea></label>' +
      '<div class="adm-checks" id="relScope">' + options + '</div>' +
      '<label class="adm-field">备注<input class="adm-input" id="relNote" maxlength="200" placeholder="可空"></label>' +
      '<div class="adm-toolbar"><button class="adm-btn adm-btn--solid" type="button" data-create-release>创建发布单</button></div>'
    );
  }

  async function createRelease() {
    var scope = [];
    Array.prototype.forEach.call(document.querySelectorAll('#relScope [data-scope]'), function (input) {
      if (input.checked) scope.push(input.value);
    });
    var item = await AC.call('admin.release.create', {
      version: $('relVersion').value.trim(),
      summary: $('relSummary').value.trim(),
      scope: scope,
      note: $('relNote').value.trim()
    });
    closeReleaseModal();
    toast('已创建 v' + item.version);
    state.release.page = 1;
    await loadRelease();
  }

  function openReleaseComplete(version) {
    openReleaseModal(
      '<h2 style="margin:0 0 6px;font-size:16px">标记已推送 · v' + esc(version) + '</h2>' +
      '<p class="adm-hint">先在本地执行命令，确认 GitHub / Gitee 都成功后再回填；两边链接都要填。</p>' +
      '<label class="adm-field">commit 哈希<input class="adm-input" id="relCommit" maxlength="40" placeholder="至少 7 位，如 3f2a9c1"></label>' +
      '<label class="adm-field">GitHub 链接<input class="adm-input" id="relGithub" placeholder="https://github.com/..."></label>' +
      '<label class="adm-field">Gitee 链接<input class="adm-input" id="relGitee" placeholder="https://gitee.com/..."></label>' +
      '<div class="adm-toolbar"><button class="adm-btn adm-btn--solid" type="button" data-complete-submit="' + esc(version) + '">确认已推送</button></div>'
    );
  }

  async function completeRelease(version) {
    await AC.call('admin.release.complete', {
      version: version,
      commit: $('relCommit').value.trim(),
      githubUrl: $('relGithub').value.trim(),
      giteeUrl: $('relGitee').value.trim()
    });
    closeReleaseModal();
    toast('已标记 v' + version + ' 为已推送');
    await loadRelease();
  }

  function openReleaseFail(version) {
    openReleaseModal(
      '<h2 style="margin:0 0 6px;font-size:16px">标记失败 · v' + esc(version) + '</h2>' +
      '<label class="adm-field">失败原因<textarea class="adm-input" id="relReason" rows="3" maxlength="100" placeholder="如：Gitee 推送超时"></textarea></label>' +
      '<div class="adm-toolbar"><button class="adm-btn adm-btn--solid" type="button" data-fail-submit="' + esc(version) + '">确认失败</button></div>'
    );
  }

  async function failRelease(version) {
    await AC.call('admin.release.fail', { version: version, reason: $('relReason').value.trim() });
    closeReleaseModal();
    toast('已标记失败，可重试');
    await loadRelease();
  }

  async function cancelRelease(version) {
    if (!confirm('作废后不能再标记，确定？')) return;
    await AC.call('admin.release.cancel', { version: version });
    toast('已作废 v' + version);
    await loadRelease();
  }

  async function toggleReleaseCheck(version, key, checked) {
    await AC.call('admin.release.update', { version: version, checks: { [key]: checked } });
    await loadRelease();
  }

  function copyReleaseCommand(version) {
    var item = state.release.items.filter(function (row) { return row.version === version; })[0];
    if (!item) return;
    var text = releaseCommand(item);
    var done = function () { toast('命令已复制'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fail);
    } else {
      toast('请手动选中命令复制');
    }
  }

  // ---------- 事件 ----------

  document.addEventListener('click', function (event) {
    var el = event.target.closest ? event.target.closest('[data-tab],[data-detail],[data-page],[data-toggle-user],[data-revoke],[data-revoke-all],[data-save-note],[data-grant],[data-revoke-ent],[data-save-product],[data-toggle-product],[data-copy-cmd],[data-release-complete],[data-release-fail],[data-release-cancel],[data-close-release],[data-create-release],[data-complete-submit],[data-fail-submit]') : null;
    if (!el) return;

    var run = null;

    if (el.hasAttribute('data-tab')) {
      switchTab(el.getAttribute('data-tab'));
      return;
    }
    if (el.hasAttribute('data-detail')) run = function () { return openUser(el.getAttribute('data-detail')); };
    else if (el.hasAttribute('data-page')) {
      var pageBox = el.getAttribute('data-page');
      var box = pageBox === 'user' ? state.users : pageBox === 'release' ? state.release : state.audit;
      box.page = Math.max(1, box.page + Number(el.getAttribute('data-delta')));
      run = pageBox === 'user' ? loadUsers : pageBox === 'release' ? loadReleaseList : loadAudit;
    } else if (el.hasAttribute('data-toggle-user')) {
      run = function () { return toggleUser(el.getAttribute('data-toggle-user'), el.getAttribute('data-status')); };
    } else if (el.hasAttribute('data-revoke')) {
      run = function () { return revokeSessions(state.detailUid, el.getAttribute('data-revoke')); };
    } else if (el.hasAttribute('data-revoke-all')) {
      run = function () { return revokeSessions(el.getAttribute('data-revoke-all'), ''); };
    } else if (el.hasAttribute('data-save-note')) {
      run = function () { return saveNote(el.getAttribute('data-save-note')); };
    } else if (el.hasAttribute('data-grant')) {
      run = function () {
        var product = $('detailGrantProduct');
        var expire = $('detailGrantExpire');
        return grant(el.getAttribute('data-grant'), product ? product.value : '', dayToTs(expire ? expire.value : ''));
      };
    } else if (el.hasAttribute('data-revoke-ent')) {
      run = function () { return revokeEntitlement(state.detailUid, el.getAttribute('data-revoke-ent')); };
    } else if (el.hasAttribute('data-save-product')) {
      run = function () { return saveProduct(el.getAttribute('data-save-product')); };
    } else if (el.hasAttribute('data-toggle-product')) {
      run = function () { return toggleProduct(el.getAttribute('data-toggle-product'), el.getAttribute('data-status')); };
    } else if (el.hasAttribute('data-copy-cmd')) {
      run = function () { return copyReleaseCommand(el.getAttribute('data-copy-cmd')); };
    } else if (el.hasAttribute('data-release-complete')) {
      run = function () { return openReleaseComplete(el.getAttribute('data-release-complete')); };
    } else if (el.hasAttribute('data-release-fail')) {
      run = function () { return openReleaseFail(el.getAttribute('data-release-fail')); };
    } else if (el.hasAttribute('data-release-cancel')) {
      run = function () { return cancelRelease(el.getAttribute('data-release-cancel')); };
    } else if (el.hasAttribute('data-create-release')) {
      run = function () { return createRelease(); };
    } else if (el.hasAttribute('data-complete-submit')) {
      run = function () { return completeRelease(el.getAttribute('data-complete-submit')); };
    } else if (el.hasAttribute('data-fail-submit')) {
      run = function () { return failRelease(el.getAttribute('data-fail-submit')); };
    } else if (el.hasAttribute('data-close-release')) {
      closeReleaseModal();
      return;
    }

    if (run) Promise.resolve(run()).catch(fail);
  });

  $('modalClose').addEventListener('click', closeModal);
  $('userModal').addEventListener('click', function (event) {
    if (event.target === $('userModal')) closeModal();
  });

  $('userSearch').addEventListener('click', function () {
    state.users.keyword = $('userKeyword').value.trim();
    state.users.status = $('userStatus').value;
    state.users.page = 1;
    loadUsers().catch(fail);
  });

  $('userKeyword').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') $('userSearch').click();
  });

  $('auditSearch').addEventListener('click', function () {
    state.audit.uid = $('auditUid').value.trim();
    state.audit.action = $('auditAction').value.trim();
    state.audit.page = 1;
    loadAudit().catch(fail);
  });

  $('grantSubmit').addEventListener('click', function () {
    var uid = $('grantUid').value.trim();
    var appId = $('grantProduct').value;
    if (!uid || !appId) return toast('请填 uid 并选作品');
    grant(uid, appId, dayToTs($('grantExpire').value), $('grantNote').value).catch(fail);
  });

  $('releaseNew').addEventListener('click', openReleaseCreate);

  $('releaseStatus').addEventListener('change', function () {
    state.release.status = $('releaseStatus').value;
    state.release.page = 1;
    loadReleaseList().catch(fail);
  });

  $('releaseModal').addEventListener('click', function (event) {
    if (event.target === $('releaseModal')) closeReleaseModal();
  });

  document.addEventListener('change', function (event) {
    var input = event.target;
    if (!input || !input.hasAttribute || !input.hasAttribute('data-check')) return;
    toggleReleaseCheck(input.getAttribute('data-version'), input.getAttribute('data-check'), input.checked).catch(fail);
  });

  boot();
})();
