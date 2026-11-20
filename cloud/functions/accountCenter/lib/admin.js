'use strict';

/**
 * 运营后台的接口层（admin.*）。
 * 原则：不新建用户体系，全部读写在 ac_users / ac_identities / ac_sessions / ac_products / ac_entitlements 上；
 * 每个 admin.* 都是「先验 Token → 再验角色 → 再写审计」，非后台账号一律 FORBIDDEN。
 */

const v = require('./validate');
const { AppError, invalid } = require('./errors');

const DAY = 24 * 60 * 60 * 1000;
const PAGE_MAX = 50;

const ROLE_CAPS = {
  owner: [
    'user.read', 'user.write', 'session.revoke', 'note.write',
    'product.write', 'entitlement.write', 'stats.read', 'audit.read', 'member.write',
    'release.read', 'release.write'
  ],
  ops: [
    'user.read', 'user.write', 'session.revoke', 'note.write',
    'product.write', 'entitlement.write', 'stats.read', 'audit.read',
    'release.read', 'release.write'
  ],
  support: ['user.read', 'session.revoke', 'note.write']
};

const ROLES = Object.keys(ROLE_CAPS);
const RELEASE_STATUS = ['planned', 'pushed', 'failed', 'cancelled'];
const RELEASE_SCOPES = ['cloud', 'web', 'docs', 'ops'];

function createAdmin({ store, now, requireUser, audit, ownerUids = [], repos = {}, projectVersion = '' }) {
  const bootOwners = new Set(ownerUids.map((id) => String(id || '').trim()).filter(Boolean));

  function forbidden(message = '没有后台权限') {
    return new AppError('FORBIDDEN', message, 403);
  }

  function notFound(message = '用户不存在') {
    return new AppError('NOT_FOUND', message, 404);
  }

  function clean(value, max) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  }

  /** 北京时间的当天 0 点 */
  function dayStart(ts = now()) {
    const offset = 8 * 60 * 60 * 1000;
    return Math.floor((ts + offset) / DAY) * DAY - offset;
  }

  function pageArgs(input) {
    const page = Math.max(1, Math.floor(Number(input.page) || 1));
    const pageSize = Math.min(PAGE_MAX, Math.max(1, Math.floor(Number(input.pageSize) || 20)));
    return { page, pageSize };
  }

  /** 校验后台身份；env 里配了 ADMIN_OWNER_UIDS 的 uid 首次访问自动落一条 owner */
  async function requireAdmin(ctx, cap) {
    const { user } = await requireUser(ctx);
    ctx.uid = user.uid;

    let member = await store.get('ac_admin_members', user.uid);
    if (!member && bootOwners.has(user.uid)) {
      member = await store.set('ac_admin_members', user.uid, {
        uid: user.uid,
        role: 'owner',
        status: 'active',
        createdBy: 'env',
        createdAt: now()
      });
    }

    if (!member || member.status !== 'active' || !ROLE_CAPS[member.role]) throw forbidden();
    const caps = ROLE_CAPS[member.role];
    if (cap && !caps.includes(cap)) throw forbidden('当前角色没有该操作权限');

    return { user, member, caps };
  }

  function maskedKey(key) {
    if (key.kind === 'email') return v.maskEmail(key.value);
    if (key.kind === 'phone') return v.maskPhone(key.value);
    if (key.kind === 'oauth') {
      return key.provider ? `${key.provider} · ${key.value}` : String(key.value || '');
    }
    return v.maskAccountCode(key.value);
  }

  async function loadIdentities() {
    const rows = await store.query('ac_identities', {}, 5000);
    const map = new Map();
    for (const key of rows) {
      if (!map.has(key.uid)) map.set(key.uid, []);
      map.get(key.uid).push(key);
    }
    return map;
  }

  async function loadSessions() {
    const rows = await store.query('ac_sessions', {}, 5000);
    const byUid = new Map();
    for (const session of rows) {
      if (!byUid.has(session.uid)) byUid.set(session.uid, []);
      byUid.get(session.uid).push(session);
    }
    return byUid;
  }

  function isAlive(session) {
    return !session.revoked && session.expiresAt > now();
  }

  function lastActiveOf(user, sessions = []) {
    let last = user.updatedAt || user.createdAt || 0;
    for (const session of sessions) {
      if ((session.lastSeenAt || 0) > last) last = session.lastSeenAt;
    }
    return last;
  }

  // ---------- 我是谁 ----------

  async function adminMe(input, ctx) {
    const { user, member, caps } = await requireAdmin(ctx);
    return {
      uid: user.uid,
      nickname: user.nickname || '',
      role: member.role,
      status: member.status,
      permissions: caps,
      ownerCount: (await store.query('ac_admin_members', { role: 'owner' }, 100))
        .filter((item) => item.status === 'active').length
    };
  }

  // ---------- 用户 ----------

  async function usersList(input, ctx) {
    await requireAdmin(ctx, 'user.read');
    const { page, pageSize } = pageArgs(input);
    const keyword = clean(input.keyword, 60).toLowerCase();
    const status = clean(input.status, 20);

    const users = await store.query('ac_users', {}, 5000);
    const identityMap = await loadIdentities();
    const sessionMap = await loadSessions();

    const rows = users
      .filter((user) => user.status !== 'deleted')
      .filter((user) => !status || status === 'all' || (user.status || 'active') === status)
      .map((user) => {
        const keys = identityMap.get(user.uid) || [];
        const sessions = sessionMap.get(user.uid) || [];
        const email = keys.find((key) => key.kind === 'email');
        const phone = keys.find((key) => key.kind === 'phone');
        return {
          uid: user.uid,
          nickname: user.nickname || '',
          avatar: user.avatar || '',
          status: user.status || 'active',
          createdAt: user.createdAt,
          lastActiveAt: lastActiveOf(user, sessions),
          emailMasked: email ? v.maskEmail(email.value) : '',
          phoneMasked: phone ? v.maskPhone(phone.value) : '',
          providers: keys.filter((key) => key.kind === 'oauth').map((key) => key.provider || ''),
          sessionCount: sessions.filter(isAlive).length,
          _rawKeys: keys.map((key) => String(key.value || '').toLowerCase())
        };
      })
      .filter((item) => {
        if (!keyword) return true;
        return item.uid.toLowerCase().includes(keyword)
          || item.nickname.toLowerCase().includes(keyword)
          || item._rawKeys.some((value) => value.includes(keyword));
      })
      .sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0));

    const start = (page - 1) * pageSize;
    return {
      total: rows.length,
      page,
      pageSize,
      items: rows.slice(start, start + pageSize).map(({ _rawKeys, ...item }) => item)
    };
  }

  async function userDetail(input, ctx) {
    await requireAdmin(ctx, 'user.read');
    const uid = clean(input.uid, 40);
    if (!uid) throw invalid('缺少 uid');

    const user = await store.get('ac_users', uid);
    if (!user || user.status === 'deleted') throw notFound();

    const keys = (await store.query('ac_identities', { uid }, 50)).map((key) => ({
      kind: key.kind,
      provider: key.provider || '',
      masked: maskedKey(key),
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt
    }));

    const sessions = (await store.query('ac_sessions', { uid }, 200))
      .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0))
      .map((session) => ({
        sid: session.sid,
        appId: session.appId || '',
        alive: isAlive(session),
        revoked: Boolean(session.revoked),
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        ua: session.ua || ''
      }));

    const entitlements = await store.query('ac_entitlements', { uid }, 100);
    const products = await store.query('ac_products', {}, 200);
    const productMap = new Map(products.map((product) => [product.appId, product]));

    const notes = await store.get('ac_admin_notes', uid);
    const aiKey = await store.get('ac_ai_keys', uid);

    const audits = (await store.query('ac_audit_logs', { target: uid }, 200))
      .concat(await store.query('ac_audit_logs', { actorUid: uid }, 100))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
      .map((row) => ({
        action: row.action,
        title: row.title || row.action,
        scope: row.scope || 'account',
        createdAt: row.createdAt,
        actorUid: row.actorUid || ''
      }));

    return {
      uid: user.uid,
      nickname: user.nickname || '',
      avatar: user.avatar || '',
      status: user.status || 'active',
      createdAt: user.createdAt,
      updatedAt: user.updatedAt || user.createdAt,
      keys,
      sessions,
      entitlements: entitlements.map((item) => ({
        appId: item.appId,
        productName: (productMap.get(item.appId) || {}).name || item.appId,
        status: item.status || 'active',
        source: item.source || '',
        expiresAt: item.expiresAt || 0,
        note: item.note || ''
      })),
      note: {
        note: (notes && notes.note) || '',
        tags: (notes && notes.tags) || [],
        updatedAt: (notes && notes.updatedAt) || 0
      },
      // AI Key 只给状态，永远不给明文
      aiKey: { hasKey: Boolean(aiKey), provider: (aiKey && aiKey.provider) || '' },
      audits
    };
  }

  async function userStatus(input, ctx) {
    const { member } = await requireAdmin(ctx, 'user.write');
    const uid = clean(input.uid, 40);
    const status = clean(input.status, 20);
    if (!uid) throw invalid('缺少 uid');
    if (!['active', 'disabled'].includes(status)) throw invalid('status 只能是 active 或 disabled');
    if (uid === ctx.uid) throw invalid('不能禁用自己');

    const user = await store.get('ac_users', uid);
    if (!user || user.status === 'deleted') throw notFound();

    const before = user.status || 'active';
    await store.update('ac_users', uid, { status, updatedAt: now() });

    // 禁用时同时踢掉全部会话，保证下一次请求就失效
    let revoked = 0;
    if (status === 'disabled') {
      const sessions = await store.query('ac_sessions', { uid }, 200);
      for (const session of sessions) {
        if (session.revoked) continue;
        await store.update('ac_sessions', session.sid, { revoked: true });
        revoked += 1;
      }
    }

    await audit('admin.user.status', uid, { ...ctx, uid: ctx.uid }, {
      scope: 'admin',
      actorRole: member.role,
      title: status === 'disabled' ? '禁用账户' : '启用账户',
      detail: { before, after: status, revoked }
    });

    return { uid, status, revoked };
  }

  async function userSessionsRevoke(input, ctx) {
    const { member } = await requireAdmin(ctx, 'session.revoke');
    const uid = clean(input.uid, 40);
    const sid = clean(input.sid, 40);
    if (!uid) throw invalid('缺少 uid');

    const sessions = await store.query('ac_sessions', { uid }, 200);
    const targets = sid ? sessions.filter((session) => session.sid === sid) : sessions;
    if (sid && !targets.length) throw notFound('会话不存在');

    let revoked = 0;
    for (const session of targets) {
      if (session.revoked) continue;
      await store.update('ac_sessions', session.sid, { revoked: true });
      revoked += 1;
    }

    await audit('admin.session.revoke', uid, { ...ctx, uid: ctx.uid }, {
      scope: 'admin',
      actorRole: member.role,
      title: '强制下线',
      detail: { sid: sid || 'all', revoked }
    });

    return { revoked };
  }

  async function userNote(input, ctx) {
    const { member } = await requireAdmin(ctx, 'note.write');
    const uid = clean(input.uid, 40);
    if (!uid) throw invalid('缺少 uid');

    const user = await store.get('ac_users', uid);
    if (!user || user.status === 'deleted') throw notFound();

    const note = clean(input.note, 500);
    const tags = Array.isArray(input.tags)
      ? input.tags.map((tag) => clean(tag, 20)).filter(Boolean).slice(0, 10)
      : [];

    await store.set('ac_admin_notes', uid, {
      uid,
      note,
      tags,
      updatedBy: ctx.uid,
      updatedAt: now()
    });

    await audit('admin.user.note', uid, { ...ctx, uid: ctx.uid }, {
      scope: 'admin',
      actorRole: member.role,
      title: '更新备注',
      detail: { tags: tags.join(',') }
    });

    return { uid, note, tags };
  }

  // ---------- 作品与权益 ----------

  async function productsList(input, ctx) {
    await requireAdmin(ctx, 'user.read');

    const products = await store.query('ac_products', {}, 200);
    const entitlements = await store.query('ac_entitlements', {}, 5000);
    const counts = new Map();
    for (const item of entitlements) {
      if ((item.status || 'active') !== 'active') continue;
      counts.set(item.appId, (counts.get(item.appId) || 0) + 1);
    }

    return {
      items: products.map((product) => ({
        appId: product.appId,
        name: product.name || product.appId,
        url: product.url || '',
        status: product.status || 'active',
        accessMode: product.accessMode === 'grant' ? 'grant' : 'open',
        entitlementCount: counts.get(product.appId) || 0,
        createdAt: product.createdAt
      }))
    };
  }

  async function productUpsert(input, ctx) {
    const { member } = await requireAdmin(ctx, 'product.write');
    const appId = clean(input.appId, 40);
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(appId)) throw invalid('appId 只能是小写字母、数字与连字符');

    const current = await store.get('ac_products', appId);
    const patch = {};

    if (input.name !== undefined) {
      const name = clean(input.name, 40);
      if (!name) throw invalid('作品名不能为空');
      patch.name = name;
    }
    if (input.url !== undefined) {
      const url = clean(input.url, 200);
      if (url && !/^https:\/\/[^\s]+$/.test(url)) throw invalid('作品地址必须是 https');
      patch.url = url;
    }
    if (input.status !== undefined) {
      const status = clean(input.status, 20);
      if (!['active', 'offline'].includes(status)) throw invalid('status 只能是 active 或 offline');
      patch.status = status;
    }
    if (input.accessMode !== undefined) {
      const accessMode = clean(input.accessMode, 20);
      if (!['open', 'grant'].includes(accessMode)) throw invalid('accessMode 只能是 open 或 grant');
      patch.accessMode = accessMode;
    }
    if (input.theme !== undefined) {
      patch.theme = clean(input.theme, 10) === 'dark' ? 'dark' : 'light';
    }
    if (input.accent !== undefined) {
      const accent = clean(input.accent, 10);
      patch.accent = /^#[0-9a-f]{6}$/i.test(accent) ? accent : '';
    }

    if (!current) {
      await store.set('ac_products', appId, {
        appId,
        name: patch.name || appId,
        url: patch.url || '',
        status: patch.status || 'active',
        accessMode: patch.accessMode || 'open',
        theme: patch.theme || 'light',
        accent: patch.accent || '',
        createdAt: now()
      });
    } else {
      if (!Object.keys(patch).length) throw invalid('没有要修改的内容');
      await store.update('ac_products', appId, patch);
    }

    await audit(current ? 'admin.product.update' : 'admin.product.create', appId, { ...ctx, uid: ctx.uid }, {
      scope: 'admin',
      actorRole: member.role,
      title: current ? '修改作品' : '登记作品',
      detail: patch
    });

    return { appId, created: !current };
  }

  async function entitlementSet(input, ctx) {
    const { member } = await requireAdmin(ctx, 'entitlement.write');
    const uid = clean(input.uid, 40);
    const appId = clean(input.appId, 40);
    if (!uid || !appId) throw invalid('缺少 uid 或 appId');

    const user = await store.get('ac_users', uid);
    if (!user || user.status === 'deleted') throw notFound();
    const product = await store.get('ac_products', appId);
    if (!product) throw notFound('作品不存在');

    let expiresAt = 0;
    if (input.expiresAt) {
      const ts = Number(input.expiresAt);
      if (!Number.isFinite(ts) || ts < 0) throw invalid('到期时间不合法');
      expiresAt = ts < 1e12 ? ts * 1000 : ts;
    }

    const id = `${uid}:${appId}`;
    const current = await store.get('ac_entitlements', id);
    const doc = {
      uid,
      appId,
      status: 'active',
      source: clean(input.source, 20) || 'grant',
      grantedBy: ctx.uid,
      note: clean(input.note, 200),
      expiresAt,
      createdAt: (current && current.createdAt) || now(),
      updatedAt: now()
    };
    await store.set('ac_entitlements', id, doc);

    await audit('admin.entitlement.set', uid, { ...ctx, uid: ctx.uid }, {
      scope: 'admin',
      actorRole: member.role,
      productId: appId,
      title: '授权作品',
      detail: { appId, source: doc.source, expiresAt }
    });

    return { uid, appId, status: 'active', expiresAt };
  }

  async function entitlementRevoke(input, ctx) {
    const { member } = await requireAdmin(ctx, 'entitlement.write');
    const uid = clean(input.uid, 40);
    const appId = clean(input.appId, 40);
    if (!uid || !appId) throw invalid('缺少 uid 或 appId');

    const id = `${uid}:${appId}`;
    const current = await store.get('ac_entitlements', id);
    if (!current) throw notFound('授权记录不存在');

    await store.update('ac_entitlements', id, { status: 'revoked', updatedAt: now() });

    await audit('admin.entitlement.revoke', uid, { ...ctx, uid: ctx.uid }, {
      scope: 'admin',
      actorRole: member.role,
      productId: appId,
      title: '撤销授权',
      detail: { appId }
    });

    return { uid, appId, status: 'revoked' };
  }

  // ---------- 总览 ----------

  async function overview(input, ctx) {
    await requireAdmin(ctx, 'stats.read');

    const since = dayStart();
    const users = await store.query('ac_users', {}, 5000);
    const aliveUsers = users.filter((user) => user.status !== 'deleted');
    const sessions = await store.query('ac_sessions', {}, 5000);
    const audits = await store.query('ac_audit_logs', {}, 5000);

    const activeUids = new Set(
      sessions.filter((session) => (session.lastSeenAt || 0) >= since).map((session) => session.uid)
    );

    const logins = audits.filter((row) => row.action === 'auth.login' && row.createdAt >= since);
    const loginFailed = audits.filter((row) => row.action === 'auth.login.failed' && row.createdAt >= since);

    const usage = new Map();
    for (const session of sessions) {
      const appId = session.appId || 'account-center';
      if (!usage.has(appId)) usage.set(appId, new Set());
      usage.get(appId).add(session.uid);
    }
    const products = await store.query('ac_products', {}, 200);
    const names = new Map(products.map((product) => [product.appId, product.name || product.appId]));

    const recentAudit = audits
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
      .map((row) => ({
        action: row.action,
        title: row.title || row.action,
        target: row.target || '',
        scope: row.scope || 'account',
        createdAt: row.createdAt
      }));

    return {
      users: {
        total: aliveUsers.length,
        active: aliveUsers.filter((user) => (user.status || 'active') === 'active').length,
        disabled: aliveUsers.filter((user) => user.status === 'disabled').length,
        newToday: aliveUsers.filter((user) => (user.createdAt || 0) >= since).length,
        new7d: aliveUsers.filter((user) => (user.createdAt || 0) >= since - 6 * DAY).length,
        activeToday: activeUids.size
      },
      login: {
        today: logins.length,
        failedToday: loginFailed.length,
        successRate: logins.length + loginFailed.length
          ? Math.round((logins.length / (logins.length + loginFailed.length)) * 100)
          : null
      },
      products: [...usage.entries()]
        .map(([appId, uids]) => ({ appId, name: names.get(appId) || appId, users: uids.size }))
        .sort((a, b) => b.users - a.users),
      recentAudit
    };
  }

  // ---------- 审计 ----------

  async function auditList(input, ctx) {
    await requireAdmin(ctx, 'audit.read');
    const { page, pageSize } = pageArgs(input);
    const uid = clean(input.uid, 40);
    // 注意：input.action 是路由名本身，审计筛选走 actionPrefix
    const actionPrefix = clean(input.actionPrefix, 60);
    const from = Number(input.from) || 0;
    const to = Number(input.to) || 0;

    const rows = (await store.query('ac_audit_logs', {}, 5000))
      .filter((row) => !uid || row.target === uid || row.actorUid === uid)
      .filter((row) => !actionPrefix || String(row.action || '').startsWith(actionPrefix))
      .filter((row) => (!from || row.createdAt >= from) && (!to || row.createdAt <= to))
      .sort((a, b) => b.createdAt - a.createdAt);

    const start = (page - 1) * pageSize;
    return {
      total: rows.length,
      page,
      pageSize,
      items: rows.slice(start, start + pageSize).map((row) => ({
        action: row.action,
        title: row.title || row.action,
        scope: row.scope || 'account',
        target: row.target || '',
        actorUid: row.actorUid || '',
        productId: row.productId || '',
        detail: row.detail || {},
        createdAt: row.createdAt
      }))
    };
  }

  // ---------- 管理员 ----------

  async function membersList(input, ctx) {
    await requireAdmin(ctx, 'member.write');
    const members = await store.query('ac_admin_members', {}, 100);
    const users = await store.query('ac_users', {}, 5000);
    const names = new Map(users.map((user) => [user.uid, user.nickname || '']));

    return {
      items: members.map((member) => ({
        uid: member.uid,
        nickname: names.get(member.uid) || '',
        role: member.role,
        status: member.status || 'active',
        createdBy: member.createdBy || '',
        createdAt: member.createdAt
      }))
    };
  }

  async function memberUpsert(input, ctx) {
    const { member: actor } = await requireAdmin(ctx, 'member.write');
    const uid = clean(input.uid, 40);
    const role = clean(input.role, 20);
    const status = clean(input.status, 20) || 'active';
    if (!uid) throw invalid('缺少 uid');
    if (!ROLES.includes(role)) throw invalid('role 只能是 owner / ops / support');
    if (!['active', 'disabled'].includes(status)) throw invalid('status 只能是 active 或 disabled');

    const user = await store.get('ac_users', uid);
    if (!user || user.status === 'deleted') throw notFound();

    const current = await store.get('ac_admin_members', uid);
    if (current && current.role === 'owner' && (role !== 'owner' || status !== 'active')) {
      const owners = (await store.query('ac_admin_members', { role: 'owner' }, 100))
        .filter((item) => (item.status || 'active') === 'active');
      if (owners.length <= 1) throw invalid('至少要保留一个 owner');
    }

    await store.set('ac_admin_members', uid, {
      uid,
      role,
      status,
      createdBy: (current && current.createdBy) || ctx.uid,
      createdAt: (current && current.createdAt) || now()
    });

    await audit('admin.member.upsert', uid, { ...ctx, uid: ctx.uid }, {
      scope: 'admin',
      actorRole: actor.role,
      title: '调整管理员',
      detail: { role, status }
    });

    return { uid, role, status };
  }

  // ---------- 版本与发布台账（只记账，不执行 git） ----------

  function parseVersion(text) {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(text || '').trim());
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  }

  function compareVersion(a, b) {
    for (let i = 0; i < 3; i += 1) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
  }

  function suggestNext(rows) {
    let max = parseVersion(projectVersion) || null;
    for (const row of rows) {
      const parsed = parseVersion(row.version);
      if (parsed && (!max || compareVersion(parsed, max) > 0)) max = parsed;
    }
    const base = max || [1, 0, 0];
    return `${base[0]}.${base[1]}.${base[2] + 1}`;
  }

  function releaseView(row) {
    if (!row) return null;
    const checks = row.checks || {};
    return {
      version: row.version,
      tag: row.tag || `v${row.version}`,
      summary: row.summary || '',
      scope: row.scope || [],
      status: row.status || 'planned',
      checks: {
        testedAt: checks.testedAt || 0,
        backupAt: checks.backupAt || 0,
        healthAt: checks.healthAt || 0
      },
      checksDone: Boolean(checks.testedAt && checks.backupAt && checks.healthAt),
      commit: row.commit || '',
      commitShort: row.commitShort || '',
      githubUrl: row.githubUrl || '',
      giteeUrl: row.giteeUrl || '',
      note: row.note || '',
      reason: row.reason || '',
      plannedBy: row.plannedBy || '',
      plannedAt: row.plannedAt || 0,
      pushedBy: row.pushedBy || '',
      pushedAt: row.pushedAt || 0
    };
  }

  function sortReleases(rows) {
    return rows.slice().sort((a, b) => {
      const va = parseVersion(a.version);
      const vb = parseVersion(b.version);
      if (va && vb) {
        const diff = compareVersion(vb, va);
        if (diff) return diff;
      }
      return (b.plannedAt || 0) - (a.plannedAt || 0);
    });
  }

  async function releaseCurrent(input, ctx) {
    await requireAdmin(ctx, 'release.read');
    const rows = await store.query('ac_releases', {}, 200);
    const pushed = sortReleases(rows).filter((row) => row.status === 'pushed');

    return {
      current: releaseView(pushed[0] || null),
      previous: releaseView(pushed[1] || null),
      suggestedVersion: suggestNext(rows),
      projectVersion: projectVersion || '',
      repos,
      counts: {
        planned: rows.filter((row) => row.status === 'planned').length,
        failed: rows.filter((row) => row.status === 'failed').length
      }
    };
  }

  async function releaseList(input, ctx) {
    await requireAdmin(ctx, 'release.read');
    const { page, pageSize } = pageArgs(input);
    const status = clean(input.status, 20);

    const rows = sortReleases(await store.query('ac_releases', {}, 200))
      .filter((row) => !status || status === 'all' || (row.status || 'planned') === status);
    const start = (page - 1) * pageSize;

    return {
      total: rows.length,
      page,
      pageSize,
      items: rows.slice(start, start + pageSize).map(releaseView)
    };
  }

  async function releaseCreate(input, ctx) {
    const { member } = await requireAdmin(ctx, 'release.write');
    const rows = await store.query('ac_releases', {}, 200);

    const version = clean(input.version, 20) || suggestNext(rows);
    if (!parseVersion(version)) throw invalid('版本号必须是 x.y.z，例如 1.9.0');
    if (await store.get('ac_releases', version)) throw invalid('该版本已存在，请换一个版本号');

    const summary = clean(input.summary, 200);
    if (summary.length < 10) throw invalid('变更摘要至少 10 个字');

    const scope = Array.isArray(input.scope)
      ? input.scope.map((item) => clean(item, 20)).filter((item) => RELEASE_SCOPES.includes(item)).slice(0, 4)
      : [];

    const doc = {
      version,
      tag: `v${version}`,
      summary,
      scope,
      checks: { testedAt: 0, backupAt: 0, healthAt: 0 },
      status: 'planned',
      note: clean(input.note, 200),
      plannedBy: ctx.uid,
      plannedAt: now()
    };
    await store.set('ac_releases', version, doc);

    await audit('admin.release.create', version, { ...ctx, uid: ctx.uid }, {
      scope: 'admin',
      actorRole: member.role,
      title: '新建发布单',
      detail: { version, scope: scope.join(','), summary }
    });

    return releaseView(doc);
  }

  async function releaseUpdate(input, ctx) {
    const { member } = await requireAdmin(ctx, 'release.write');
    const version = clean(input.version, 20);
    if (!version) throw invalid('缺少版本号');

    const doc = await store.get('ac_releases', version);
    if (!doc) throw notFound('发布单不存在');
    if (!['planned', 'failed'].includes(doc.status)) throw invalid('只有待发布 / 失败的记录可以修改');

    const patch = {};
    if (input.summary !== undefined) {
      const summary = clean(input.summary, 200);
      if (summary.length < 10) throw invalid('变更摘要至少 10 个字');
      patch.summary = summary;
    }
    if (input.scope !== undefined) {
      patch.scope = Array.isArray(input.scope)
        ? input.scope.map((item) => clean(item, 20)).filter((item) => RELEASE_SCOPES.includes(item)).slice(0, 4)
        : [];
    }
    if (input.note !== undefined) patch.note = clean(input.note, 200);
    if (input.checks && typeof input.checks === 'object') {
      const checks = Object.assign({ testedAt: 0, backupAt: 0, healthAt: 0 }, doc.checks || {});
      for (const key of ['tested', 'backup', 'health']) {
        if (input.checks[key] === undefined) continue;
        checks[`${key}At`] = input.checks[key] ? now() : 0;
      }
      patch.checks = checks;
    }
    if (!Object.keys(patch).length) throw invalid('没有要修改的内容');

    await store.update('ac_releases', version, patch);

    await audit('admin.release.update', version, { ...ctx, uid: ctx.uid }, {
      scope: 'admin',
      actorRole: member.role,
      title: '修改发布单',
      detail: { version }
    });

    return releaseView(await store.get('ac_releases', version));
  }

  async function releaseComplete(input, ctx) {
    const { member } = await requireAdmin(ctx, 'release.write');
    const version = clean(input.version, 20);
    if (!version) throw invalid('缺少版本号');

    const doc = await store.get('ac_releases', version);
    if (!doc) throw notFound('发布单不存在');
    if (!['planned', 'failed'].includes(doc.status)) throw invalid('该记录已经结束，不能再标记');

    const checks = doc.checks || {};
    if (!(checks.testedAt && checks.backupAt && checks.healthAt)) {
      throw invalid('三项检查未全部完成，不能标记已推送');
    }

    const commit = clean(input.commit, 40);
    if (!/^[0-9a-f]{7,40}$/i.test(commit)) throw invalid('commit 至少 7 位十六进制字符');

    const githubUrl = clean(input.githubUrl, 300);
    const giteeUrl = clean(input.giteeUrl, 300);
    if (!/^https:\/\/\S+$/.test(githubUrl) || !/^https:\/\/\S+$/.test(giteeUrl)) {
      throw invalid('GitHub / Gitee 链接都必须是 https 地址');
    }

    await store.update('ac_releases', version, {
      status: 'pushed',
      commit,
      commitShort: commit.slice(0, 7),
      githubUrl,
      giteeUrl,
      pushedBy: ctx.uid,
      pushedAt: now(),
      reason: ''
    });

    await audit('admin.release.complete', version, { ...ctx, uid: ctx.uid }, {
      scope: 'admin',
      actorRole: member.role,
      title: '标记已推送',
      detail: { version, commit: commit.slice(0, 7) }
    });

    return releaseView(await store.get('ac_releases', version));
  }

  async function releaseFail(input, ctx) {
    const { member } = await requireAdmin(ctx, 'release.write');
    const version = clean(input.version, 20);
    const reason = clean(input.reason, 100);
    if (!version) throw invalid('缺少版本号');
    if (reason.length < 2) throw invalid('请写明失败原因');

    const doc = await store.get('ac_releases', version);
    if (!doc) throw notFound('发布单不存在');
    if (!['planned', 'failed'].includes(doc.status)) throw invalid('该记录已经结束，不能再标记');

    await store.update('ac_releases', version, { status: 'failed', reason, pushedAt: now() });

    await audit('admin.release.fail', version, { ...ctx, uid: ctx.uid }, {
      scope: 'admin',
      actorRole: member.role,
      title: '标记发布失败',
      detail: { version, reason }
    });

    return releaseView(await store.get('ac_releases', version));
  }

  async function releaseCancel(input, ctx) {
    const { member } = await requireAdmin(ctx, 'release.write');
    const version = clean(input.version, 20);
    if (!version) throw invalid('缺少版本号');

    const doc = await store.get('ac_releases', version);
    if (!doc) throw notFound('发布单不存在');
    if (!['planned', 'failed'].includes(doc.status)) throw invalid('只有待发布 / 失败的记录可以作废');

    await store.update('ac_releases', version, { status: 'cancelled' });

    await audit('admin.release.cancel', version, { ...ctx, uid: ctx.uid }, {
      scope: 'admin',
      actorRole: member.role,
      title: '作废发布单',
      detail: { version }
    });

    return releaseView(await store.get('ac_releases', version));
  }

  return {
    routes: {
      'admin.me': adminMe,
      'admin.users.list': usersList,
      'admin.user.detail': userDetail,
      'admin.user.status': userStatus,
      'admin.user.sessions.revoke': userSessionsRevoke,
      'admin.user.note': userNote,
      'admin.products.list': productsList,
      'admin.product.upsert': productUpsert,
      'admin.entitlement.set': entitlementSet,
      'admin.entitlement.revoke': entitlementRevoke,
      'admin.overview': overview,
      'admin.audit.list': auditList,
      'admin.members.list': membersList,
      'admin.member.upsert': memberUpsert,
      'admin.release.current': releaseCurrent,
      'admin.release.list': releaseList,
      'admin.release.create': releaseCreate,
      'admin.release.update': releaseUpdate,
      'admin.release.complete': releaseComplete,
      'admin.release.fail': releaseFail,
      'admin.release.cancel': releaseCancel
    }
  };
}

module.exports = { createAdmin, ROLE_CAPS, ROLES };
