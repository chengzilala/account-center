'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../cloud/functions/accountCenter/app');
const { createJsonStore } = require('../cloud/functions/accountCenter/lib/store-json');

const DEVICE_A = '0123456789abcdef0123456789abcdef';
const DEVICE_B = 'fedcba9876543210fedcba9876543210';

function setup(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'account-center-'));
  const store = createJsonStore(path.join(dir, 'store.json'));
  const outbox = [];
  let clock = 1761000000000;

  const app = createApp({
    store,
    pepper: 'test-pepper',
    now: () => clock,
    allowedOrigins: options.allowedOrigins,
    oauth: options.oauth,
    fetchImpl: options.fetchImpl,
    sms: options.sms,
    captcha: options.captcha,
    sendMail: async ({ to, code }) => {
      outbox.push({ to, code });
    },
    logger: { error() {}, warn() {}, info() {} }
  });

  return {
    app,
    outbox,
    store,
    advance(ms) {
      clock += ms;
    }
  };
}

async function call(app, token, action, payload = {}) {
  return app.handle(
    { ...payload, action },
    { ip: '203.0.113.9', headers: token ? { authorization: `Bearer ${token}` } : {} }
  );
}

async function emailLogin(ctx, email, extra = {}) {
  const sent = await call(ctx.app, '', 'auth.email.send', { email });
  assert.equal(sent.ok, true, JSON.stringify(sent));
  const code = ctx.outbox[ctx.outbox.length - 1].code;
  return call(ctx.app, '', 'auth.email.verify', { email, code, ...extra });
}

test('邮箱验证码登录后能拿到 me；同一邮箱再次登录还是同一个 uid', async () => {
  const ctx = setup();

  const sent = await call(ctx.app, '', 'auth.email.send', { email: 'A@Example.com' });
  assert.equal(sent.ok, true);
  assert.equal(sent.data.masked, 'a***@example.com');

  const login = await call(ctx.app, '', 'auth.email.verify', {
    email: 'a@example.com',
    code: ctx.outbox[0].code
  });
  assert.equal(login.ok, true);
  assert.equal(login.data.isNew, true);
  assert.ok(login.data.uid.startsWith('u_'));

  const me = await call(ctx.app, login.data.token, 'me');
  assert.equal(me.ok, true);
  assert.equal(me.data.uid, login.data.uid);
  assert.equal(me.data.emailMasked, 'a***@example.com');

  ctx.advance(61 * 1000);
  const again = await emailLogin(ctx, 'a@example.com');
  assert.equal(again.ok, true);
  assert.equal(again.data.uid, login.data.uid);
  assert.equal(again.data.isNew, false);
});

test('邮箱登录带本机账户码后，账户码登录落到同一个 uid', async () => {
  const ctx = setup();

  const login = await emailLogin(ctx, 'b@example.com', { deviceId: DEVICE_A });
  assert.equal(login.ok, true);

  const byCode = await call(ctx.app, '', 'auth.accountCode.login', { accountCode: DEVICE_A });
  assert.equal(byCode.ok, true);
  assert.equal(byCode.data.uid, login.data.uid);
  assert.equal(byCode.data.isNew, false);

  const me = await call(ctx.app, byCode.data.token, 'me');
  assert.deepEqual(
    me.data.keys.map((key) => key.kind).sort(),
    ['device', 'email']
  );
});

test('账户码已被别人占用时，邮箱登录不抢钥匙也不报错', async () => {
  const ctx = setup();

  const owner = await call(ctx.app, '', 'auth.accountCode.login', { accountCode: DEVICE_B });
  const other = await emailLogin(ctx, 'c@example.com', { deviceId: DEVICE_B });
  assert.equal(other.ok, true);
  assert.notEqual(other.data.uid, owner.data.uid);

  const stillOwner = await call(ctx.app, '', 'auth.accountCode.login', { accountCode: DEVICE_B });
  assert.equal(stillOwner.data.uid, owner.data.uid);
});

test('6 位码能换到同一 uid，且只能用一次', async () => {
  const ctx = setup();
  const login = await emailLogin(ctx, 'd@example.com');

  const started = await call(ctx.app, login.data.token, 'auth.code.start');
  assert.equal(started.ok, true);
  assert.match(started.data.code, /^\d{6}$/);

  const redeemed = await call(ctx.app, '', 'auth.code.redeem', { code: started.data.code });
  assert.equal(redeemed.ok, true);
  assert.equal(redeemed.data.uid, login.data.uid);

  const again = await call(ctx.app, '', 'auth.code.redeem', { code: started.data.code });
  assert.equal(again.ok, false);
  assert.equal(again.code, 'CODE_INVALID');
});

test('退出后 Token 立即失效，退出全部会让所有会话失效', async () => {
  const ctx = setup();
  const first = await emailLogin(ctx, 'e@example.com');
  ctx.advance(61 * 1000);
  const second = await emailLogin(ctx, 'e@example.com');

  const loggedOut = await call(ctx.app, first.data.token, 'auth.logout');
  assert.equal(loggedOut.ok, true);
  const meAfter = await call(ctx.app, first.data.token, 'me');
  assert.equal(meAfter.ok, false);
  assert.equal(meAfter.code, 'UNAUTHORIZED');

  const all = await call(ctx.app, second.data.token, 'auth.logoutAll');
  assert.equal(all.ok, true);
  assert.ok(all.data.revoked >= 1);

  const meSecond = await call(ctx.app, second.data.token, 'me');
  assert.equal(meSecond.ok, false);
});

test('同一邮箱 60 秒内重复发码会被限流', async () => {
  const ctx = setup();
  const first = await call(ctx.app, '', 'auth.email.send', { email: 'f@example.com' });
  assert.equal(first.ok, true);
  const second = await call(ctx.app, '', 'auth.email.send', { email: 'f@example.com' });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'RATE_LIMITED');
  assert.ok(second.retryAfter > 0);
});

test('注销后钥匙清空、会话失效，同邮箱再登录是新 uid', async () => {
  const ctx = setup();
  const login = await emailLogin(ctx, 'g@example.com');

  const wrongConfirm = await call(ctx.app, login.data.token, 'account.delete', { confirm: '删除' });
  assert.equal(wrongConfirm.ok, false);
  assert.equal(wrongConfirm.code, 'INVALID_PARAM');

  const deleted = await call(ctx.app, login.data.token, 'account.delete', { confirm: '注销' });
  assert.equal(deleted.ok, true);

  const me = await call(ctx.app, login.data.token, 'me');
  assert.equal(me.ok, false);

  const keys = await ctx.store.query('ac_identities', { uid: login.data.uid });
  assert.equal(keys.length, 0);

  ctx.advance(61 * 1000);
  const relogin = await emailLogin(ctx, 'g@example.com');
  assert.equal(relogin.ok, true);
  assert.notEqual(relogin.data.uid, login.data.uid);
});

test('账户凭证回完整邮箱、不回完整账户码，且需登录', async () => {
  const ctx = setup();
  const login = await emailLogin(ctx, 'h@example.com', { deviceId: DEVICE_A });

  const anonymous = await call(ctx.app, '', 'account.credential');
  assert.equal(anonymous.ok, false);
  assert.equal(anonymous.code, 'UNAUTHORIZED');

  const credential = await call(ctx.app, login.data.token, 'account.credential');
  assert.equal(credential.ok, true);
  assert.equal(credential.data.uid, login.data.uid);
  assert.equal(credential.data.email, 'h@example.com');
  assert.ok(!JSON.stringify(credential.data).includes(DEVICE_A));
});

test('未登录访问 me 返回 UNAUTHORIZED', async () => {
  const ctx = setup();
  const me = await call(ctx.app, '', 'me');
  assert.equal(me.ok, false);
  assert.equal(me.code, 'UNAUTHORIZED');
});

test('HTTP 入口：预检带 CORS、POST 返回 JSON 字符串、坏 JSON 返回 400', async () => {
  const ctx = setup();
  const headers = { origin: 'https://account.example.com' };

  const preflight = await ctx.app.handle({ httpMethod: 'OPTIONS', headers });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['Access-Control-Allow-Origin'], '*');
  assert.equal(preflight.body, '');

  const unauthorized = await ctx.app.handle({
    httpMethod: 'POST',
    headers,
    body: JSON.stringify({ action: 'me' })
  });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.headers['Access-Control-Allow-Origin'], '*');
  assert.equal(JSON.parse(unauthorized.body).code, 'UNAUTHORIZED');

  const badJson = await ctx.app.handle({ httpMethod: 'POST', headers, body: '{oops' });
  assert.equal(badJson.statusCode, 400);
  assert.equal(JSON.parse(badJson.body).code, 'INVALID_PARAM');

  const base64Body = await ctx.app.handle({
    httpMethod: 'POST',
    isBase64Encoded: true,
    headers,
    body: Buffer.from(JSON.stringify({ action: 'me' })).toString('base64')
  });
  assert.equal(base64Body.statusCode, 401);
});

test('我的足迹：登录自记，作品上报可查，同页 30 分钟内去重', async () => {
  const ctx = setup();
  const login = await emailLogin(ctx, 'i@example.com', { deviceId: DEVICE_A });

  const wrong = await call(ctx.app, '', 'auth.email.send', { email: 'i@example.com' });
  assert.equal(wrong.ok, false);

  const first = await call(ctx.app, login.data.token, 'track', {
    productId: 'wxread', event: 'open', title: '打开微信悦读', platform: 'h5'
  });
  assert.equal(first.ok, true);
  assert.equal(first.data.recorded, true);

  const again = await call(ctx.app, login.data.token, 'track', {
    productId: 'wxread', event: 'open', title: '打开微信悦读', platform: 'h5'
  });
  assert.equal(again.ok, true);
  assert.equal(again.data.deduped, true);

  const unknown = await call(ctx.app, login.data.token, 'track', {
    productId: 'wxread', event: 'whatever', title: '未知动作'
  });
  assert.equal(unknown.ok, true);
  assert.equal(unknown.data.recorded, true);

  const missing = await call(ctx.app, login.data.token, 'track', { event: 'open' });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'INVALID_PARAM');

  const feed = await call(ctx.app, login.data.token, 'me.activity');
  assert.equal(feed.ok, true);
  const titles = feed.data.items.map((item) => item.title);
  assert.ok(titles.includes('创建账户'));
  assert.ok(titles.includes('打开微信悦读'));
  assert.ok(!titles.includes('未知动作'));
  assert.ok(!titles.includes('发送邮箱验证码'));

  const productOnly = await call(ctx.app, login.data.token, 'me.activity', { scope: 'product' });
  assert.deepEqual(productOnly.data.items.map((item) => item.title), ['打开微信悦读']);

  ctx.advance(31 * 60 * 1000);
  const later = await call(ctx.app, login.data.token, 'track', {
    productId: 'wxread', event: 'open', title: '打开微信悦读', platform: 'h5'
  });
  assert.equal(later.data.recorded, true);
  assert.ok(!later.data.deduped);
});

test('我的足迹只回本人事件，并按 limit / cursor 翻页', async () => {
  const ctx = setup();
  const mine = await emailLogin(ctx, 'j@example.com');
  ctx.advance(61 * 1000);
  const other = await emailLogin(ctx, 'k@example.com');

  for (let i = 0; i < 3; i += 1) {
    ctx.advance(1000);
    await call(ctx.app, mine.data.token, 'track', {
      productId: 'wxread', event: 'use', title: `动作 ${i}`
    });
  }

  const page1 = await call(ctx.app, mine.data.token, 'me.activity', { limit: 2 });
  assert.equal(page1.data.items.length, 2);
  assert.ok(page1.data.nextCursor > 0);

  const page2 = await call(ctx.app, mine.data.token, 'me.activity', {
    limit: 2, cursor: page1.data.nextCursor
  });
  assert.ok(page2.data.items.length > 0);
  assert.ok(page2.data.items.every((item) => item.createdAt < page1.data.nextCursor));

  const theirs = await call(ctx.app, other.data.token, 'me.activity');
  assert.ok(theirs.data.items.every((item) => !item.title.startsWith('动作')));
});

test('清除记录：只清作品 / 浏览，账户与安全保留', async () => {
  const ctx = setup();
  const login = await emailLogin(ctx, 'l@example.com');
  await call(ctx.app, login.data.token, 'track', {
    productId: 'wxread', event: 'browse', title: '书架页'
  });
  await call(ctx.app, login.data.token, 'track', {
    productId: 'wxread', event: 'use', title: '同步跑步'
  });

  const bad = await call(ctx.app, login.data.token, 'me.activity.clear', { scope: 'account' });
  assert.equal(bad.ok, false);

  const cleared = await call(ctx.app, login.data.token, 'me.activity.clear', { scope: 'browse' });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.data.removed, 1);

  const feed = await call(ctx.app, login.data.token, 'me.activity', { range: '90d' });
  const titles = feed.data.items.map((item) => item.title);
  assert.ok(!titles.includes('书架页'));
  assert.ok(titles.includes('同步跑步'));
  assert.ok(titles.includes('创建账户'));
  assert.ok(titles.includes('清除浏览记录'));
});

test('跨域票据：签发后换 Token 只能一次，会话绑定作品', async () => {
  const ctx = setup({ allowedOrigins: ['https://read.example.com'] });
  const login = await emailLogin(ctx, 'n@example.com', { deviceId: DEVICE_A });

  const issued = await call(ctx.app, login.data.token, 'auth.ticket.issue', {
    productId: 'wxread',
    returnUrl: 'https://read.example.com/shelf?tab=all'
  });
  assert.equal(issued.ok, true, JSON.stringify(issued));
  assert.equal(issued.data.expiresIn, 300);
  assert.match(issued.data.ticket, /^[0-9a-f]{32}$/);
  assert.ok(
    issued.data.redirectUrl.startsWith('https://read.example.com/shelf?tab=all&ps_ticket=')
  );

  const redeemed = await call(ctx.app, '', 'auth.ticket.redeem', { ticket: issued.data.ticket });
  assert.equal(redeemed.ok, true, JSON.stringify(redeemed));
  assert.equal(redeemed.data.uid, login.data.uid);

  const sessions = await ctx.store.query('ac_sessions', { uid: login.data.uid });
  assert.ok(sessions.some((session) => session.appId === 'wxread'));

  const reuse = await call(ctx.app, '', 'auth.ticket.redeem', { ticket: issued.data.ticket });
  assert.equal(reuse.ok, false);
  assert.equal(reuse.code, 'CODE_EXPIRED');
});

test('跨域票据：未登录/未登记域名拒签，5 分钟后失效', async () => {
  const ctx = setup({ allowedOrigins: ['https://read.example.com', 'https://other.example.com'] });
  await ctx.store.set('ac_products', 'wxread', {
    appId: 'wxread',
    name: '微信悦读',
    url: 'https://read.example.com',
    status: 'active',
    createdAt: 0
  });

  const anonymous = await call(ctx.app, '', 'auth.ticket.issue', {
    productId: 'wxread',
    returnUrl: 'https://read.example.com/'
  });
  assert.equal(anonymous.ok, false);
  assert.equal(anonymous.code, 'UNAUTHORIZED');

  const login = await emailLogin(ctx, 'o@example.com');

  // 作品已登记域名：即使别的域名在 CORS 白名单里，也不能拿来签票
  const wrongOrigin = await call(ctx.app, login.data.token, 'auth.ticket.issue', {
    productId: 'wxread',
    returnUrl: 'https://other.example.com/'
  });
  assert.equal(wrongOrigin.ok, false);
  assert.equal(wrongOrigin.code, 'INVALID_PARAM');

  // 登记裸域时，www 变体视为同一站点
  const wwwIssued = await call(ctx.app, login.data.token, 'auth.ticket.issue', {
    productId: 'wxread',
    returnUrl: 'https://www.read.example.com/shelf'
  });
  assert.equal(wwwIssued.ok, true, JSON.stringify(wwwIssued));
  assert.ok(wwwIssued.data.redirectUrl.startsWith('https://www.read.example.com/shelf?ps_ticket='));

  const evil = await call(ctx.app, login.data.token, 'auth.ticket.issue', {
    productId: 'unknown-product',
    returnUrl: 'https://evil.example.net/'
  });
  assert.equal(evil.ok, false);
  assert.equal(evil.code, 'INVALID_PARAM');

  const issued = await call(ctx.app, login.data.token, 'auth.ticket.issue', {
    productId: 'wxread'
  });
  assert.equal(issued.ok, true, JSON.stringify(issued));
  assert.ok(issued.data.redirectUrl.startsWith('https://read.example.com/?ps_ticket='));

  ctx.advance(5 * 60 * 1000 + 1000);
  const expired = await call(ctx.app, '', 'auth.ticket.redeem', { ticket: issued.data.ticket });
  assert.equal(expired.ok, false);
  assert.equal(expired.code, 'CODE_EXPIRED');
});

test('作品配色：公开接口按登记回主题，未登记 / 已下线按浅色', async () => {
  const ctx = setup();
  await ctx.store.set('ac_products', 'wxread', {
    appId: 'wxread',
    name: '微信悦读',
    url: '',
    status: 'active',
    theme: 'dark',
    accent: '#2b2b2b',
    createdAt: 0
  });
  await ctx.store.set('ac_products', 'offline', {
    appId: 'offline',
    name: '已下线',
    url: '',
    status: 'disabled',
    theme: 'dark',
    accent: '#2b2b2b',
    createdAt: 0
  });

  const dark = await call(ctx.app, '', 'product.theme', { productId: 'wxread' });
  assert.equal(dark.ok, true, JSON.stringify(dark));
  assert.deepEqual(dark.data, { theme: 'dark', accent: '#2b2b2b' });

  const missing = await call(ctx.app, '', 'product.theme', { productId: 'nope' });
  assert.deepEqual(missing.data, { theme: 'light', accent: '' });

  const offline = await call(ctx.app, '', 'product.theme', { productId: 'offline' });
  assert.deepEqual(offline.data, { theme: 'light', accent: '' });

  const bad = await call(ctx.app, '', 'product.theme', {});
  assert.equal(bad.ok, false);
});

test('90 天前的记录会被清理，新记录保留', async () => {
  const ctx = setup();
  const login = await emailLogin(ctx, 'm@example.com');

  await ctx.store.set('ac_audit_logs', 'old-event', {
    actorUid: login.data.uid,
    action: 'product.use',
    scope: 'product',
    title: '很旧的动作',
    visibleToUser: true,
    createdAt: ctx.store ? 1761000000000 - 91 * 24 * 60 * 60 * 1000 : 0
  });

  const result = await ctx.app.cleanup();
  assert.equal(result.removed, 1);
  assert.equal(await ctx.store.get('ac_audit_logs', 'old-event'), null);

  const feed = await call(ctx.app, login.data.token, 'me.activity', { range: '90d' });
  assert.ok(feed.data.items.some((item) => item.title === '创建账户'));
});

/* ---------------- 第三方登录 ---------------- */

const OAUTH_PROFILES = {
  github: { id: '1001', login: 'octocat', name: 'Octo Cat', email: 'octo@example.com', emailVerified: true },
  gitee: { id: '2002', login: 'gitee-user', name: 'Gitee 用户', email: 'gitee@example.com' },
  microsoft: { id: '3003', login: 'ms@example.com', name: 'MS 用户', email: 'ms@example.com' }
};

function fakeFetchFor(profiles) {
  return async (url) => {
    const target = String(url);
    let body;
    if (target.includes('github.com/login/oauth/access_token')) {
      body = { access_token: 'gh-token' };
    } else if (target.includes('api.github.com/user/emails')) {
      body = profiles.github.email
        ? [{ email: profiles.github.email, primary: true, verified: profiles.github.emailVerified }]
        : [];
    } else if (target.includes('api.github.com/user')) {
      body = {
        id: profiles.github.id,
        login: profiles.github.login,
        name: profiles.github.name,
        avatar_url: '',
        email: null
      };
    } else if (target.includes('gitee.com/oauth/token')) {
      body = { access_token: 'gitee-token' };
    } else if (target.includes('gitee.com/api/v5/user')) {
      body = {
        id: profiles.gitee.id,
        login: profiles.gitee.login,
        name: profiles.gitee.name,
        avatar_url: '',
        email: profiles.gitee.email
      };
    } else if (target.includes('login.microsoftonline.com')) {
      body = { access_token: 'ms-token' };
    } else if (target.includes('graph.microsoft.com')) {
      body = {
        id: profiles.microsoft.id,
        displayName: profiles.microsoft.name,
        mail: profiles.microsoft.email,
        userPrincipalName: profiles.microsoft.login
      };
    } else {
      throw new Error(`unexpected url ${target}`);
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
}

function oauthSetup(profiles = OAUTH_PROFILES) {
  return setup({
    allowedOrigins: ['https://account.example.com'],
    oauth: {
      redirectBase: 'https://account.example.com',
      providers: {
        github: { clientId: 'gh-id', clientSecret: 'gh-secret' },
        gitee: { clientId: 'ge-id', clientSecret: 'ge-secret' },
        microsoft: { clientId: 'ms-id', clientSecret: 'ms-secret' }
      }
    },
    fetchImpl: fakeFetchFor(profiles)
  });
}

async function startOAuth(ctx, provider, { token = '', mode = 'login', returnUrl } = {}) {
  const res = await call(ctx.app, token, 'auth.oauth.start', {
    provider,
    mode,
    returnUrl: returnUrl || 'https://account.example.com/login.html'
  });
  if (!res.ok) return res;
  return { ...res, state: new URL(res.data.url).searchParams.get('state') };
}

async function oauthCallback(ctx, provider, state, code = 'the-code') {
  return ctx.app.handleOAuthCallback(provider, { code, state }, { ip: '203.0.113.9', headers: {} });
}

function callbackParam(result, name) {
  const location = result.headers.Location || result.headers.location;
  assert.ok(location, '回调必须带 Location');
  return new URL(location).searchParams.get(name);
}

test('第三方登录：只暴露已配置 Client ID/Secret 的方式', async () => {
  const closed = await call(setup().app, '', 'auth.oauth.providers');
  assert.equal(closed.ok, true);
  assert.deepEqual(closed.data.providers, []);

  const open = await call(oauthSetup().app, '', 'auth.oauth.providers');
  assert.deepEqual(
    open.data.providers.map((item) => item.id).sort(),
    ['gitee', 'github', 'microsoft']
  );

  const disabled = await call(setup().app, '', 'auth.oauth.start', {
    provider: 'github',
    returnUrl: 'https://account.example.com/login.html'
  });
  assert.equal(disabled.ok, false);
  assert.equal(disabled.code, 'INVALID_PARAM');
});

test('扫码登录：手机确认后电脑换到同一 uid 的 Token，且只能换一次', async () => {
  const ctx = setup();
  const phone = await emailLogin(ctx, 'qr@example.com');

  const started = await call(ctx.app, '', 'auth.qr.start');
  assert.equal(started.ok, true);
  assert.match(started.data.qrId, /^[a-f0-9]{32}$/);

  const pending = await call(ctx.app, '', 'auth.qr.poll', { qrId: started.data.qrId });
  assert.equal(pending.data.status, 'pending');

  const anonymous = await call(ctx.app, '', 'auth.qr.confirm', { qrId: started.data.qrId });
  assert.equal(anonymous.ok, false);
  assert.equal(anonymous.code, 'UNAUTHORIZED');

  const confirmed = await call(ctx.app, phone.data.token, 'auth.qr.confirm', {
    qrId: started.data.qrId
  });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.data.decision, 'approved');

  const done = await call(ctx.app, '', 'auth.qr.poll', {
    qrId: started.data.qrId,
    deviceId: DEVICE_A
  });
  assert.equal(done.data.status, 'approved');
  assert.equal(done.data.uid, phone.data.uid);

  const me = await call(ctx.app, done.data.token, 'me');
  assert.equal(me.ok, true);
  assert.equal(me.data.uid, phone.data.uid);

  const again = await call(ctx.app, '', 'auth.qr.poll', { qrId: started.data.qrId });
  assert.equal(again.data.status, 'used');
});

test('扫码登录：过期、拒绝都拿不到会话', async () => {
  const ctx = setup();
  const phone = await emailLogin(ctx, 'qr2@example.com');

  const expired = await call(ctx.app, '', 'auth.qr.start');
  ctx.advance(3 * 60 * 1000);
  const pollExpired = await call(ctx.app, '', 'auth.qr.poll', { qrId: expired.data.qrId });
  assert.equal(pollExpired.data.status, 'expired');

  const confirmExpired = await call(ctx.app, phone.data.token, 'auth.qr.confirm', {
    qrId: expired.data.qrId
  });
  assert.equal(confirmExpired.code, 'QR_EXPIRED');

  const denied = await call(ctx.app, '', 'auth.qr.start');
  await call(ctx.app, phone.data.token, 'auth.qr.confirm', {
    qrId: denied.data.qrId,
    approve: false
  });
  const pollDenied = await call(ctx.app, '', 'auth.qr.poll', { qrId: denied.data.qrId });
  assert.equal(pollDenied.data.status, 'denied');
  assert.equal(pollDenied.data.token, undefined);
});

test('头像：保存后 me 能取回；格式不对或过大直接拒绝', async () => {
  const ctx = setup();
  const login = await emailLogin(ctx, 'avatar@example.com');
  const avatar = 'data:image/jpeg;base64,' + 'A'.repeat(200);

  const saved = await call(ctx.app, login.data.token, 'account.profile', { avatar });
  assert.equal(saved.ok, true);
  assert.equal(saved.data.avatar, avatar);

  const me = await call(ctx.app, login.data.token, 'me');
  assert.equal(me.data.avatar, avatar);

  const badFormat = await call(ctx.app, login.data.token, 'account.profile', {
    avatar: 'https://example.com/a.png'
  });
  assert.equal(badFormat.code, 'INVALID_PARAM');

  const tooBig = await call(ctx.app, login.data.token, 'account.profile', {
    avatar: 'data:image/png;base64,' + 'A'.repeat(60 * 1024)
  });
  assert.equal(tooBig.code, 'AVATAR_TOO_LARGE');

  const cleared = await call(ctx.app, login.data.token, 'account.profile', { avatar: '' });
  assert.equal(cleared.data.avatar, '');
});

test('新账户没设昵称和头像时，me 自动补一套生成的默认形象', async () => {
  const ctx = setup();
  const login = await emailLogin(ctx, 'persona@example.com');

  const me = await call(ctx.app, login.data.token, 'me');
  assert.ok(me.data.nickname.length > 0);
  assert.ok(me.data.nickname.length <= 20);
  assert.match(me.data.avatar, /^data:image\/svg\+xml;base64,/);

  // 同一 uid 每次拿到同一套，不会每次刷新都变脸
  const again = await call(ctx.app, login.data.token, 'me');
  assert.equal(again.data.nickname, me.data.nickname);
  assert.equal(again.data.avatar, me.data.avatar);

  // 自己设的值不算「空白」，不会被系统覆盖
  const saved = await call(ctx.app, login.data.token, 'account.profile', { nickname: '我自己' });
  assert.equal(saved.data.nickname, '我自己');
  const after = await call(ctx.app, login.data.token, 'me');
  assert.equal(after.data.nickname, '我自己');
  assert.equal(after.data.avatar, me.data.avatar);
});

test('GitHub 登录：新用户建号，再次登录落到同一 uid', async () => {
  const ctx = oauthSetup();

  const started = await startOAuth(ctx, 'github');
  assert.equal(started.ok, true);
  assert.match(started.data.url, /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
  assert.match(started.data.url, /redirect_uri=https%3A%2F%2Faccount\.example\.com%2Foauth%2Fgithub%2Fcallback/);

  const cb = await oauthCallback(ctx, 'github', started.state);
  assert.equal(cb.statusCode, 302);

  const loginCode = callbackParam(cb, 'oauth_code');
  assert.match(loginCode, /^[0-9a-f]{32}$/);

  const exchanged = await call(ctx.app, '', 'auth.oauth.exchange', { code: loginCode });
  assert.equal(exchanged.ok, true, JSON.stringify(exchanged));
  assert.equal(exchanged.data.isNew, true);

  const me = await call(ctx.app, exchanged.data.token, 'me');
  assert.equal(me.ok, true);
  assert.deepEqual(me.data.keys.map((key) => key.kind), ['oauth']);
  assert.equal(me.data.keys[0].provider, 'github');
  assert.match(me.data.keys[0].masked, /^GitHub · octocat$/);

  const again = await startOAuth(ctx, 'github');
  const cb2 = await oauthCallback(ctx, 'github', again.state);
  const exchanged2 = await call(ctx.app, '', 'auth.oauth.exchange', {
    code: callbackParam(cb2, 'oauth_code')
  });
  assert.equal(exchanged2.ok, true);
  assert.equal(exchanged2.data.uid, exchanged.data.uid);
  assert.equal(exchanged2.data.isNew, false);
});

test('第三方登录：state 只能用一次，过期或伪造一律拒绝', async () => {
  const ctx = oauthSetup();
  const started = await startOAuth(ctx, 'github');

  const first = await oauthCallback(ctx, 'github', started.state);
  assert.equal(first.statusCode, 302);

  const replay = await oauthCallback(ctx, 'github', started.state);
  assert.equal(callbackParam(replay, 'oauth_error'), 'state');

  const forged = await oauthCallback(ctx, 'github', 'a'.repeat(32));
  assert.equal(callbackParam(forged, 'oauth_error'), 'state');

  const other = await startOAuth(ctx, 'gitee');
  ctx.advance(11 * 60 * 1000);
  const expired = await oauthCallback(ctx, 'gitee', other.state);
  assert.equal(callbackParam(expired, 'oauth_error'), 'state');
});

test('第三方邮箱已注册：不自动合并，提示先用邮箱登录再绑定', async () => {
  const ctx = oauthSetup();
  const owner = await emailLogin(ctx, 'octo@example.com');

  const started = await startOAuth(ctx, 'github');
  const cb = await oauthCallback(ctx, 'github', started.state);

  assert.equal(callbackParam(cb, 'oauth_error'), 'email_exists');
  assert.equal(await ctx.store.get('ac_identities', 'oauth:github:1001'), null);

  const keys = await ctx.store.query('ac_identities', { uid: owner.data.uid });
  assert.deepEqual(keys.map((key) => key.kind), ['email']);
});

test('已登录可以绑定 GitHub，绑定后 me 显示第三方钥匙', async () => {
  const ctx = oauthSetup();
  const login = await emailLogin(ctx, 'bind@example.com');

  const started = await startOAuth(ctx, 'github', {
    token: login.data.token,
    mode: 'bind',
    returnUrl: 'https://account.example.com/account.html'
  });
  assert.equal(started.ok, true, JSON.stringify(started));

  const cb = await oauthCallback(ctx, 'github', started.state);
  assert.equal(callbackParam(cb, 'oauth_bound'), 'github');
  assert.ok(!callbackParam(cb, 'oauth_code'));

  const me = await call(ctx.app, login.data.token, 'me');
  assert.deepEqual(me.data.keys.map((key) => key.kind).sort(), ['email', 'oauth']);

  const identity = await ctx.store.get('ac_identities', 'oauth:github:1001');
  assert.equal(identity.uid, login.data.uid);
  assert.equal(identity.provider, 'github');

  // 已绑定的钥匙不能再绑给第二个账户
  const second = await emailLogin(ctx, 'second@example.com');
  const started2 = await startOAuth(ctx, 'github', { token: second.data.token, mode: 'bind' });
  const cb2 = await oauthCallback(ctx, 'github', started2.state);
  assert.equal(callbackParam(cb2, 'oauth_error'), 'key_taken');
});

test('登录方式可解绑：至少保留一种，解绑后 me 同步', async () => {
  const ctx = oauthSetup();
  const login = await emailLogin(ctx, 'unbind@example.com', { deviceId: DEVICE_A });

  const before = await call(ctx.app, login.data.token, 'me');
  assert.deepEqual(before.data.keys.map((key) => key.kind).sort(), ['device', 'email']);

  const unbindDevice = await call(ctx.app, login.data.token, 'account.unbind', { kind: 'device' });
  assert.equal(unbindDevice.ok, true, JSON.stringify(unbindDevice));
  assert.equal(unbindDevice.data.removed, 1);

  const after = await call(ctx.app, login.data.token, 'me');
  assert.deepEqual(after.data.keys.map((key) => key.kind), ['email']);

  // 只剩一种钥匙时不允许解绑，避免账户失联
  const last = await call(ctx.app, login.data.token, 'account.unbind', { kind: 'email' });
  assert.equal(last.ok, false);
  assert.equal(last.code, 'LAST_KEY');
  assert.equal((await call(ctx.app, login.data.token, 'me')).data.keys.length, 1);

  // 没绑定的方式 / 未登录都拒绝
  const missing = await call(ctx.app, login.data.token, 'account.unbind', {
    kind: 'oauth',
    provider: 'github'
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'INVALID_PARAM');

  const anonymous = await call(ctx.app, '', 'account.unbind', { kind: 'email' });
  assert.equal(anonymous.ok, false);
  assert.equal(anonymous.code, 'UNAUTHORIZED');
});

test('账户页可生成账户码：能登录同一 uid，重新生成后旧码失效', async () => {
  const ctx = oauthSetup();
  const login = await emailLogin(ctx, 'code-gen@example.com');

  const generated = await call(ctx.app, login.data.token, 'account.code.generate');
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const code = generated.data.accountCode;
  assert.match(code, /^[0-9a-f]{32}$/);

  const me = await call(ctx.app, login.data.token, 'me');
  assert.equal(me.data.keys.filter((key) => key.kind === 'device').length, 1);

  // 生成出来的码能独立登录，落到同一个 uid
  const byCode = await call(ctx.app, '', 'auth.accountCode.login', { accountCode: code });
  assert.equal(byCode.ok, true, JSON.stringify(byCode));
  assert.equal(byCode.data.uid, login.data.uid);
  assert.equal(byCode.data.isNew, false);

  // 重新生成：旧码立即失效（再登录会当成新账户）
  const again = await call(ctx.app, byCode.data.token, 'account.code.generate');
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.notEqual(again.data.accountCode, code);

  const oldCode = await call(ctx.app, '', 'auth.accountCode.login', { accountCode: code });
  assert.equal(oldCode.ok, true);
  assert.notEqual(oldCode.data.uid, login.data.uid);

  const anonymous = await call(ctx.app, '', 'account.code.generate');
  assert.equal(anonymous.ok, false);
  assert.equal(anonymous.code, 'UNAUTHORIZED');
});

test('解绑第三方：绑定后可解绑，且不影响邮箱钥匙', async () => {
  const ctx = oauthSetup();
  const login = await emailLogin(ctx, 'unbind-oauth@example.com');

  const started = await startOAuth(ctx, 'github', {
    token: login.data.token,
    mode: 'bind',
    returnUrl: 'https://account.example.com/account.html'
  });
  await oauthCallback(ctx, 'github', started.state);

  const bound = await call(ctx.app, login.data.token, 'me');
  assert.deepEqual(bound.data.keys.map((key) => key.kind).sort(), ['email', 'oauth']);

  const unbound = await call(ctx.app, login.data.token, 'account.unbind', {
    kind: 'oauth',
    provider: 'github'
  });
  assert.equal(unbound.ok, true, JSON.stringify(unbound));
  assert.equal(await ctx.store.get('ac_identities', 'oauth:github:1001'), null);

  const me = await call(ctx.app, login.data.token, 'me');
  assert.deepEqual(me.data.keys.map((key) => key.kind), ['email']);
});

test('绑定必须登录；returnUrl 只允许登录页 / 账户页', async () => {
  const ctx = oauthSetup();

  const anonymous = await startOAuth(ctx, 'github', { mode: 'bind' });
  assert.equal(anonymous.ok, false);
  assert.equal(anonymous.code, 'UNAUTHORIZED');

  const login = await emailLogin(ctx, 'check@example.com');
  const evil = await startOAuth(ctx, 'github', {
    token: login.data.token,
    returnUrl: 'https://evil.example.net/login.html'
  });
  assert.equal(evil.ok, false);
  assert.equal(evil.code, 'INVALID_PARAM');

  const wrongPage = await startOAuth(ctx, 'github', {
    token: login.data.token,
    returnUrl: 'https://account.example.com/index.html'
  });
  assert.equal(wrongPage.ok, false);
  assert.equal(wrongPage.code, 'INVALID_PARAM');
});

test('Gitee 与 Microsoft 走同一套流程', async () => {
  const ctx = oauthSetup();

  for (const provider of ['gitee', 'microsoft']) {
    const started = await startOAuth(ctx, provider);
    assert.equal(started.ok, true, JSON.stringify(started));
    const cb = await oauthCallback(ctx, provider, started.state);
    const exchanged = await call(ctx.app, '', 'auth.oauth.exchange', {
      code: callbackParam(cb, 'oauth_code')
    });
    assert.equal(exchanged.ok, true, JSON.stringify(exchanged));
    assert.equal(exchanged.data.isNew, true);

    const me = await call(ctx.app, exchanged.data.token, 'me');
    assert.equal(me.data.keys[0].provider, provider);
  }
});

const { createCaptcha } = require('../cloud/functions/accountCenter/lib/captcha');
const { hashCode } = require('../cloud/functions/accountCenter/lib/token');

/** 短信替身：发码只记下号码，校验固定 accept 验证码 */
function smsSetup({ captchaOk = true } = {}) {
  const sent = [];
  const codes = new Map();
  const sms = {
    provider: 'test',
    async send(phone) {
      sent.push(phone);
      codes.set(phone, '246810');
    },
    async check(phone, code) {
      return codes.get(phone) === code;
    }
  };
  const captcha = {
    async issue() {
      return { id: 'c'.repeat(24), svg: '<svg></svg>', expiresIn: 120 };
    },
    async consume() {
      return captchaOk;
    }
  };
  return { ctx: setup({ sms, captcha }), sent, codes };
}

async function smsLogin(ctx, phone, extra = {}) {
  const sent = await call(ctx.app, '', 'auth.sms.send', {
    phone,
    captchaId: 'c'.repeat(24),
    captchaCode: '1234'
  });
  assert.equal(sent.ok, true, JSON.stringify(sent));
  return call(ctx.app, '', 'auth.sms.verify', { phone, code: '246810', ...extra });
}

test('短信未配置时 auth.methods 显示未开放，发码直接拒绝', async () => {
  const ctx = setup();

  const methods = await call(ctx.app, '', 'auth.methods');
  assert.equal(methods.ok, true);
  assert.equal(methods.data.sms, false);

  const sent = await call(ctx.app, '', 'auth.sms.send', {
    phone: '13800138000',
    captchaId: 'c'.repeat(24),
    captchaCode: '1234'
  });
  assert.equal(sent.ok, false);
  assert.equal(sent.code, 'SMS_DISABLED');

  const verified = await call(ctx.app, '', 'auth.sms.verify', { phone: '13800138000', code: '246810' });
  assert.equal(verified.ok, false);
  assert.equal(verified.code, 'SMS_DISABLED');
});

test('手机号验证码登录：首次建号，换格式同一号码仍落到同一 uid', async () => {
  const { ctx, sent } = smsSetup();

  const first = await smsLogin(ctx, '+86 138-0013-8000');
  assert.equal(first.data.isNew, true);
  assert.ok(first.data.uid.startsWith('u_'));
  assert.equal(sent[0], '13800138000');

  const me = await call(ctx.app, first.data.token, 'me');
  assert.equal(me.data.phoneMasked, '138****8000');
  assert.deepEqual(me.data.keys.map((key) => key.kind), ['phone']);

  ctx.advance(61 * 1000);
  const again = await smsLogin(ctx, '13800138000');
  assert.equal(again.data.uid, first.data.uid);
  assert.equal(again.data.isNew, false);
});

test('手机号绑定：登录后绑到当前账户，别人占用时提示已绑定，可解绑', async () => {
  const { ctx } = smsSetup();
  const phone = '13900139000';

  const owner = await emailLogin(ctx, 'bind@example.com');
  assert.equal(owner.ok, true);

  const sent = await call(ctx.app, owner.data.token, 'auth.sms.send', {
    phone,
    captchaId: 'c'.repeat(24),
    captchaCode: '1234'
  });
  assert.equal(sent.ok, true, JSON.stringify(sent));

  const bound = await call(ctx.app, owner.data.token, 'auth.sms.verify', {
    phone,
    code: '246810',
    bind: true
  });
  assert.equal(bound.ok, true, JSON.stringify(bound));
  assert.equal(bound.data.bound, true);
  assert.equal(bound.data.already, false);

  const me = await call(ctx.app, owner.data.token, 'me');
  assert.equal(me.data.phoneMasked, '139****9000');
  assert.deepEqual(me.data.keys.map((key) => key.kind).sort(), ['email', 'phone']);

  // 绑定后，用手机号登录也落到同一个 uid
  ctx.advance(61 * 1000);
  const byPhone = await smsLogin(ctx, phone);
  assert.equal(byPhone.data.uid, owner.data.uid);
  assert.equal(byPhone.data.isNew, false);

  // 另一个账户再绑同一个手机号：提示已被占用，不抢钥匙
  const other = await emailLogin(ctx, 'other@example.com');
  ctx.advance(61 * 1000);
  const sent2 = await call(ctx.app, other.data.token, 'auth.sms.send', {
    phone,
    captchaId: 'c'.repeat(24),
    captchaCode: '1234'
  });
  assert.equal(sent2.ok, true, JSON.stringify(sent2));
  const conflict = await call(ctx.app, other.data.token, 'auth.sms.verify', {
    phone,
    code: '246810',
    bind: true
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'PHONE_TAKEN');

  // 解绑手机号后只剩邮箱
  const unbound = await call(ctx.app, owner.data.token, 'account.unbind', { kind: 'phone' });
  assert.equal(unbound.ok, true, JSON.stringify(unbound));
  const after = await call(ctx.app, owner.data.token, 'me');
  assert.deepEqual(after.data.keys.map((key) => key.kind), ['email']);
  assert.equal(after.data.phoneMasked, '');
});

test('手机号验证码错误时不建号；图形验证码不过时不发短信', async () => {
  const { ctx, sent } = smsSetup();

  const sentRes = await call(ctx.app, '', 'auth.sms.send', {
    phone: '13700137000',
    captchaId: 'c'.repeat(24),
    captchaCode: '1234'
  });
  assert.equal(sentRes.ok, true);

  const wrong = await call(ctx.app, '', 'auth.sms.verify', { phone: '13700137000', code: '000000' });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, 'CODE_INVALID');

  const wrongPhone = await call(ctx.app, '', 'auth.sms.send', {
    phone: '12345',
    captchaId: 'c'.repeat(24),
    captchaCode: '1234'
  });
  assert.equal(wrongPhone.ok, false);
  assert.equal(sent.length, 1);

  const blocked = smsSetup({ captchaOk: false });
  const res = await call(blocked.ctx.app, '', 'auth.sms.send', {
    phone: '13700137001',
    captchaId: 'c'.repeat(24),
    captchaCode: '1234'
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'CAPTCHA_INVALID');
  assert.equal(blocked.sent.length, 0);
});

test('图形验证码：答案只存哈希、答错 5 次作废', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'account-center-'));
  const store = createJsonStore(path.join(dir, 'store.json'));
  const captcha = createCaptcha({ store, pepper: 'test-pepper' });

  const issued = await captcha.issue();
  assert.match(issued.id, /^[0-9a-f]{24}$/);
  assert.ok(issued.svg.startsWith('<svg'));
  assert.ok(!issued.svg.includes('>' + issued.id + '<'));

  const doc = await store.get('ac_login_codes', `captcha:${issued.id}`);
  assert.equal(doc.kind, 'captcha');
  assert.equal(typeof doc.answerHash, 'string');
  assert.equal(doc.used, false);

  // 从哈希反推出答案（只有测试能这么做），用来验证「错 5 次后连正确答案也无效」
  let answer = '';
  for (let i = 0; i < 10000; i += 1) {
    const guess = String(i).padStart(4, '0');
    if (hashCode(guess, 'test-pepper') === doc.answerHash) {
      answer = guess;
      break;
    }
  }
  assert.equal(answer.length, 4);

  const wrong = answer === '0000' ? '1111' : '0000';
  for (let i = 0; i < 5; i += 1) {
    assert.equal(await captcha.consume(issued.id, wrong), false);
  }
  assert.equal(await captcha.consume(issued.id, answer), false);
});
