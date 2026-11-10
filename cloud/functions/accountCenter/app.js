'use strict';

const { AppError, invalid, unauthorized, rateLimited } = require('./lib/errors');
const v = require('./lib/validate');
const t = require('./lib/token');
const oauthLib = require('./lib/oauth');
const persona = require('./lib/persona');
const { createRateLimiter } = require('./lib/rateLimit');
const { createCaptcha } = require('./lib/captcha');
const { createKeyVault } = require('./lib/keyVault');

const DAY = 24 * 60 * 60 * 1000;
const SESSION_TTL = 30 * DAY;
const SESSION_RENEW_BEFORE = 7 * DAY;
const SESSION_HEARTBEAT = 60 * 60 * 1000;
const EMAIL_CODE_TTL = 10 * 60 * 1000;
const SMS_CODE_TTL = 10 * 60 * 1000;
const TRANSFER_CODE_TTL = 10 * 60 * 1000;
const QR_TTL = 2 * 60 * 1000;
const AVATAR_MAX_LENGTH = 48 * 1024;
const TICKET_TTL = 5 * 60 * 1000;
const MAX_SESSIONS_PER_USER = 10;
const ACTIVITY_TTL = 90 * DAY;
const ACTIVITY_PAGE_MAX = 50;
const TRACK_DEDUPE = 30 * 60 * 1000;
const OAUTH_STATE_TTL = 30 * 60 * 1000;
const OAUTH_LOGIN_TTL = 5 * 60 * 1000;
const MP_SIGN_TTL = 5 * 60 * 1000;
const AIKEY_TIMEOUT = 20 * 1000;
const AIKEY_REPLY_MAX = 80;
/** 统一 AI 网关：一次对话最多等多久、输入/输出上限 */
const AIKEY_CHAT_TIMEOUT = 90 * 1000;
const AIKEY_CHAT_MAX_CHARS = 30000;
const AIKEY_CHAT_MAX_MSG = 40;
const AIKEY_CHAT_MAX_TOKENS = 3000;
/** 昵称 / 头像每次给几个候选（候选池一次性生成后落库复用） */
const PERSONA_OPTIONS_COUNT = 12;

/** action → 足迹里的默认口径（分类与展示标题） */
const EVENT_META = {
  'account.create': { scope: 'account', title: '创建账户' },
  'auth.login': { scope: 'account', title: '登录' },
  'auth.login.failed': { scope: 'security', title: '登录失败' },
  'auth.login.newDevice': { scope: 'security', title: '新设备登录' },
  'auth.locked': { scope: 'security', title: '验证码错误次数过多' },
  'auth.logout': { scope: 'account', title: '退出当前设备' },
  'auth.logoutAll': { scope: 'account', title: '退出全部设备' },
  'code.start': { scope: 'account', title: '生成 6 位登录码' },
  'auth.qr.login': { scope: 'account', title: '扫码登录' },
  'auth.qr.confirm': { scope: 'security', title: '确认扫码登录', visibleToUser: false },
  'account.credential': { scope: 'account', title: '生成账户凭证' },
  'account.profile': { scope: 'account', title: '修改资料' },
  'account.persona.options': { scope: 'account', title: '生成昵称与头像参考' },
  'account.bind': { scope: 'account', title: '绑定登录方式' },
  'account.unbind': { scope: 'account', title: '解绑登录方式' },
  'account.code': { scope: 'security', title: '生成账户码', visibleToUser: false },
  'account.delete': { scope: 'account', title: '注销账户' },
  'auth.ticket.issue': { scope: 'security', title: '签发跨域登录票据', visibleToUser: false },
  'activity.clear': { scope: 'account', title: '清除行为记录' },
  'product.open': { scope: 'product', title: '打开作品' },
  'product.use': { scope: 'product', title: '使用作品' },
  'product.browse': { scope: 'browse', title: '浏览页面' },
  // AI Key 只记「改过 / 清过」，不记内容；不进「我的足迹」
  'aikey.save': { scope: 'account', title: '更新 AI Key', visibleToUser: false },
  'aikey.clear': { scope: 'account', title: '清除 AI Key', visibleToUser: false },
  'aikey.reveal': { scope: 'security', title: '查看 AI Key 明文', visibleToUser: false },
  'aikey.test': { scope: 'security', title: '测试 AI Key 连通性', visibleToUser: false },
  // 统一 AI 网关：只记用量，不记对话正文
  'aikey.chat': { scope: 'account', title: '使用 AI 对话', visibleToUser: false },
  // 只留审计、不进「我的足迹」
  'email.send': { scope: 'security', title: '发送邮箱验证码', visibleToUser: false },
  'sms.send': { scope: 'security', title: '发送短信验证码', visibleToUser: false }
};

const LOGIN_TITLES = {
  email: '邮箱登录',
  phone: '手机号登录',
  accountCode: '账户码登录',
  transferCode: '6 位码登录',
  qr: '扫码登录',
  ticket: '跨域登录',
  mp: '微信小程序登录'
};

/** 作品上报只认这三种动作；其余直接忽略 */
const TRACK_SCOPES = { open: 'product', use: 'product', browse: 'browse' };
const TRACK_PLATFORMS = ['web', 'h5', 'miniprogram', 'plugin'];
const ACTIVITY_SCOPES = ['all', 'account', 'product', 'browse', 'security', 'login'];

/**
 * 账户中心核心逻辑：与部署平台无关。
 * 依赖注入：store（存储）、sendMail（发信）、pepper（Token 哈希盐）、now（时钟）。
 */
function createApp({
  store,
  sendMail,
  pepper,
  now = Date.now,
  logger = console,
  allowedOrigins = ['*'],
  oauth = {},
  fetchImpl = globalThis.fetch,
  sms = null,
  captcha = null,
  mp = {},
  aiKey = {}
}) {
  if (!store || typeof store.get !== 'function') throw new Error('store 未提供');
  if (typeof sendMail !== 'function') throw new Error('sendMail 未提供');
  if (!pepper) throw new Error('pepper 未提供');

  const limiter = createRateLimiter(now);
  const captchaBox = captcha || createCaptcha({ store, pepper, now });
  // AI Key 单独一把密钥（未配置时由 pepper 派生）；换掉等于让所有人重填
  const vault = createKeyVault({ secret: aiKey.secret || `${pepper}|ai-key|v1` });

  const oauthConfigs = (oauth && oauth.providers) || {};
  const oauthBase = String((oauth && oauth.redirectBase) || '').replace(/\/+$/, '');
  const mpSecret = String((mp && mp.sharedSecret) || '');

  /** 只返回真正配好 clientId / clientSecret 的方式；没配的连入口都不出现 */
  function providerConfig(provider) {
    if (!oauthLib.isKnownProvider(provider) || !oauthBase) return null;
    const item = oauthConfigs[provider];
    if (!item || !item.clientId || !item.clientSecret) return null;
    return { ...item, tenant: item.tenant || oauth.tenant || 'common' };
  }

  function providerRedirectUri(provider) {
    return `${oauthBase}/oauth/${provider}/callback`;
  }

  function enabledProviders() {
    return Object.keys(oauthLib.PROVIDERS).filter((provider) => providerConfig(provider));
  }

  function assertRate(key, limit, windowMs) {
    const result = limiter.hit(key, limit, windowMs);
    if (!result.allowed) throw rateLimited(result.retryAfter);
  }

  async function audit(action, target, ctx, extra = {}) {
    const meta = EVENT_META[action] || {};
    const visible = extra.visibleToUser !== undefined
      ? extra.visibleToUser
      : meta.visibleToUser !== false;

    await store.set('ac_audit_logs', t.randomHex(16), {
      actorUid: ctx.uid || '',
      action,
      target: String(target || '').slice(0, 120),
      scope: extra.scope || meta.scope || 'account',
      source: extra.source || 'account-center',
      platform: extra.platform || 'web',
      productId: String(extra.productId || '').slice(0, 40),
      title: String(extra.title || meta.title || action).slice(0, 60),
      detail: extra.detail || {},
      visibleToUser: visible,
      ipHash: ctx.ipHash || '',
      ua: String(ctx.ua || '').slice(0, 200),
      createdAt: now()
    });
  }

  /** 只保留短文本键值，挡掉业务内容 / Key / Token */
  function sanitizeMeta(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const out = {};
    for (const [key, value] of Object.entries(input)) {
      if (Object.keys(out).length >= 10) break;
      const name = cleanText(key, 20);
      if (!name) continue;
      if (typeof value === 'string') out[name] = cleanText(value, 100);
      else if (typeof value === 'number' || typeof value === 'boolean') out[name] = value;
    }
    return out;
  }

  function cleanText(value, max) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  }

  /** 这个设备码以前登录过吗（判断「新设备登录」用，须在建会话之前调） */
  async function hasSeenDevice(uid, deviceId) {
    const code = v.normalizeAccountCode(deviceId);
    if (!v.isAccountCode(code)) return true;
    const sessions = await store.query('ac_sessions', { uid }, 200);
    return sessions.some((session) => session.deviceId === code);
  }

  async function issueSession(uid, ctx, extras = {}) {
    const token = t.newToken();
    const sid = t.newSid();
    const expiresAt = now() + SESSION_TTL;

    await store.set('ac_sessions', sid, {
      sid,
      uid,
      appId: extras.appId || 'account-center',
      deviceId: extras.deviceId || '',
      tokenHash: t.hashToken(token, pepper),
      createdAt: now(),
      lastSeenAt: now(),
      expiresAt,
      revoked: false,
      ipHash: ctx.ipHash || '',
      ua: String(ctx.ua || '').slice(0, 200)
    });

    // 同一 uid 最多保留 10 条有效会话，超出踢最早的
    const sessions = await store.query('ac_sessions', { uid }, 200);
    const alive = sessions
      .filter((s) => !s.revoked && s.expiresAt > now())
      .sort((a, b) => a.createdAt - b.createdAt);
    if (alive.length > MAX_SESSIONS_PER_USER) {
      for (const stale of alive.slice(0, alive.length - MAX_SESSIONS_PER_USER)) {
        await store.update('ac_sessions', stale.sid, { revoked: true });
      }
    }

    return { token, uid, expiresAt };
  }

  /** 校验 Token；顺带续期与心跳（写入节流，避免每次请求都写库） */
  async function requireUser(ctx) {
    if (!ctx.token) throw unauthorized();

    const tokenHash = t.hashToken(ctx.token, pepper);
    const rows = await store.query('ac_sessions', { tokenHash }, 1);
    const session = rows[0];
    if (!session || session.revoked) throw unauthorized();
    if (session.expiresAt <= now()) throw unauthorized();

    const user = await store.get('ac_users', session.uid);
    if (!user) throw unauthorized();
    if (user.status === 'deleted') throw new AppError('ACCOUNT_DELETED', '账号已注销', 403);

    const patch = {};
    if (session.expiresAt - now() < SESSION_RENEW_BEFORE) patch.expiresAt = now() + SESSION_TTL;
    if (!session.lastSeenAt || now() - session.lastSeenAt > SESSION_HEARTBEAT) patch.lastSeenAt = now();
    if (Object.keys(patch).length) await store.update('ac_sessions', session.sid, patch);

    return { user, session };
  }

  /** 钥匙 → uid：不存在就新建一个人 */
  async function resolveIdentity(keyId, kind, value, extras = {}) {
    let identity = await store.get('ac_identities', keyId);

    if (identity) {
      const user = await store.get('ac_users', identity.uid);
      if (user && user.status !== 'deleted') {
        await store.update('ac_identities', keyId, { lastUsedAt: now() });
        return { uid: identity.uid, isNew: false };
      }
      // 钥匙指向已注销的人：清掉，按新钥匙处理
      await store.remove('ac_identities', keyId);
    }

    const uid = t.newUid();
    await store.set('ac_users', uid, {
      uid,
      nickname: '',
      avatar: '',
      status: 'active',
      createdAt: now(),
      updatedAt: now()
    });
    await store.set('ac_identities', keyId, {
      uid,
      kind,
      value,
      ...extras,
      createdAt: now(),
      lastUsedAt: now()
    });
    return { uid, isNew: true };
  }

  /** 邮箱登录时顺带把本机账户码绑上；已被占用则按契约忽略，不报错 */
  async function bindDeviceIfFree(uid, deviceId) {
    const code = v.normalizeAccountCode(deviceId);
    if (!v.isAccountCode(code)) return;
    const keyId = `device:${code}`;
    const existing = await store.get('ac_identities', keyId);
    if (existing) return;
    await store.set('ac_identities', keyId, {
      uid,
      kind: 'device',
      value: code,
      createdAt: now(),
      lastUsedAt: now()
    });
  }

  /** 校验 6 位码文档，返回错误或 null */
  function checkCodeDoc(doc, label) {
    if (!doc || doc.used) throw new AppError('CODE_EXPIRED', `${label}已失效，请重新获取`, 400);
    if (doc.expiresAt <= now()) throw new AppError('CODE_EXPIRED', `${label}已过期，请重新获取`, 400);
    if ((doc.attempts || 0) >= 5) {
      throw new AppError('CODE_EXPIRED', `${label}错误次数过多，请重新获取`, 400);
    }
  }

  async function emailSend(input, ctx) {
    const email = v.normalizeEmail(input.email);
    if (!v.isEmail(email)) throw invalid('请输入正确的邮箱地址');

    assertRate(`email.send:email:minute:${email}`, 1, 60 * 1000);
    assertRate(`email.send:email:hour:${email}`, 5, 60 * 60 * 1000);
    assertRate(`email.send:email:day:${email}`, 20, DAY);
    assertRate(`email.send:ip:${ctx.ipHash}`, 20, 60 * 60 * 1000);

    const code = t.newSixDigitCode();
    const codeId = `email:${email}`;
    await store.set('ac_login_codes', codeId, {
      kind: 'email',
      email,
      codeHash: t.hashCode(code, pepper),
      expiresAt: now() + EMAIL_CODE_TTL,
      used: false,
      attempts: 0,
      createdAt: now()
    });

    try {
      await sendMail({ to: email, code, purpose: 'login' });
    } catch (err) {
      await store.remove('ac_login_codes', codeId);
      logger.error('[accountCenter] 邮件发送失败', err && err.message);
      throw new AppError('MAIL_FAILED', '验证码发送失败，请稍后重试或换一个邮箱', 500);
    }

    await audit('email.send', v.maskEmail(email), ctx);
    return { expiresIn: EMAIL_CODE_TTL / 1000, cooldown: 60, masked: v.maskEmail(email) };
  }

  async function emailVerify(input, ctx) {
    const email = v.normalizeEmail(input.email);
    const code = String(input.code || '').trim();
    if (!v.isEmail(email)) throw invalid('请输入正确的邮箱地址');
    if (!v.isSixDigit(code)) throw new AppError('CODE_INVALID', '请输入 6 位数字验证码', 400);

    assertRate(`email.verify:ip:${ctx.ipHash}`, 30, 10 * 60 * 1000);

    const codeId = `email:${email}`;
    const doc = await store.get('ac_login_codes', codeId);
    checkCodeDoc(doc, '验证码');

    if (!t.safeEqual(t.hashCode(code, pepper), doc.codeHash)) {
      const attempts = (doc.attempts || 0) + 1;
      await store.update('ac_login_codes', codeId, { attempts, used: attempts >= 5 });

      // 登录失败 / 锁定：算安全事件，只记类型与时间，不记验证码
      const identity = await store.get('ac_identities', codeId);
      const failCtx = { ...ctx, uid: identity ? identity.uid : '' };
      await audit('auth.login.failed', v.maskEmail(email), failCtx, {
        detail: { method: 'email' },
        platform: 'web'
      });
      if (attempts >= 5) {
        await audit('auth.locked', v.maskEmail(email), failCtx, {
          detail: { method: 'email' },
          platform: 'web'
        });
      }

      const message = attempts >= 5 ? '验证码错误次数过多，请重新获取' : '验证码不正确';
      throw new AppError('CODE_INVALID', message, 400);
    }

    await store.update('ac_login_codes', codeId, { used: true });

    const { uid, isNew } = await resolveIdentity(`email:${email}`, 'email', email);
    await bindDeviceIfFree(uid, input.deviceId);
    const newDevice = !isNew && !(await hasSeenDevice(uid, input.deviceId));
    const session = await issueSession(uid, ctx, { deviceId: input.deviceId });

    const actorCtx = { ...ctx, uid };
    await audit(isNew ? 'account.create' : 'auth.login', uid, actorCtx, {
      title: isNew ? '创建账户' : LOGIN_TITLES.email,
      detail: { method: 'email' },
      platform: 'web'
    });
    if (newDevice) {
      await audit('auth.login.newDevice', uid, actorCtx, {
        detail: { method: 'email' },
        platform: 'web'
      });
    }

    return { ...session, isNew };
  }

  /** 登录页可用的登录方式：没配短信通道时前端不显示手机号入口 */
  async function authMethods() {
    return { sms: Boolean(sms), smsProvider: sms ? String(sms.provider || '') : '' };
  }

  /** 图形验证码：只是一道减速带，答案在本机存哈希、2 分钟一次性 */
  async function captchaIssue(input, ctx) {
    assertRate(`captcha:ip:${ctx.ipHash}`, 60, 10 * 60 * 1000);
    return captchaBox.issue();
  }

  async function smsSend(input, ctx) {
    if (!sms) throw new AppError('SMS_DISABLED', '手机号登录暂未开放', 400);

    const phone = v.normalizePhone(input.phone);
    if (!v.isChinaPhone(phone)) throw invalid('请输入正确的中国大陆手机号');

    assertRate(`sms.captcha:ip:${ctx.ipHash}`, 20, 10 * 60 * 1000);
    const passed = await captchaBox.consume(input.captchaId, input.captchaCode);
    if (!passed) throw new AppError('CAPTCHA_INVALID', '图形验证码不正确或已过期，请刷新后重试', 400);

    assertRate(`sms.send:phone:minute:${phone}`, 1, 60 * 1000);
    assertRate(`sms.send:phone:hour:${phone}`, 5, 60 * 60 * 1000);
    assertRate(`sms.send:phone:day:${phone}`, 10, DAY);
    assertRate(`sms.send:ip:hour:${ctx.ipHash}`, 20, 60 * 60 * 1000);
    assertRate(`sms.send:ip:day:${ctx.ipHash}`, 50, DAY);

    try {
      await sms.send(phone);
    } catch (err) {
      logger.error('[accountCenter] 短信发送失败', err && err.message);
      throw new AppError('SMS_FAILED', '验证码发送失败，请稍后重试', 500);
    }

    await audit('sms.send', v.maskPhone(phone), ctx);
    return { expiresIn: SMS_CODE_TTL / 1000, cooldown: 60, masked: v.maskPhone(phone) };
  }

  /**
   * 手机号验证码：默认按登录处理（没有就建号）；
   * 带 bind: true 且带 Token 时，把手机号绑定到当前账户。
   */
  async function smsVerify(input, ctx) {
    if (!sms) throw new AppError('SMS_DISABLED', '手机号登录暂未开放', 400);

    const phone = v.normalizePhone(input.phone);
    const code = String(input.code || '').trim();
    if (!v.isChinaPhone(phone)) throw invalid('请输入正确的中国大陆手机号');
    if (!v.isSixDigit(code)) throw new AppError('CODE_INVALID', '请输入 6 位数字验证码', 400);

    assertRate(`sms.verify:ip:${ctx.ipHash}`, 30, 10 * 60 * 1000);
    assertRate(`sms.verify:phone:${phone}`, 10, 10 * 60 * 1000);

    let passed = false;
    try {
      passed = await sms.check(phone, code);
    } catch (err) {
      logger.error('[accountCenter] 短信校验失败', err && err.message);
      throw new AppError('SMS_FAILED', '验证码校验失败，请稍后重试', 500);
    }

    const keyId = `phone:${phone}`;
    const identity = await store.get('ac_identities', keyId);

    if (!passed) {
      await audit('auth.login.failed', v.maskPhone(phone), {
        ...ctx,
        uid: identity ? identity.uid : ''
      }, { detail: { method: 'phone' }, platform: 'web' });
      throw new AppError('CODE_INVALID', '验证码不正确或已过期', 400);
    }

    if (input.bind === true) {
      const { user } = await requireUser(ctx);

      // 钥匙指向已注销的人：当作没绑定过
      let existing = identity;
      if (existing) {
        const owner = await store.get('ac_users', existing.uid);
        if (!owner || owner.status === 'deleted') {
          await store.remove('ac_identities', keyId);
          existing = null;
        }
      }

      if (existing && existing.uid !== user.uid) {
        throw new AppError('PHONE_TAKEN', '这个手机号已绑定到另一个账户', 409);
      }

      if (!existing) {
        await store.set('ac_identities', keyId, {
          uid: user.uid,
          kind: 'phone',
          value: phone,
          createdAt: now(),
          lastUsedAt: now()
        });
        await audit('account.bind', '手机号', { ...ctx, uid: user.uid }, {
          detail: { method: 'phone' },
          platform: 'web'
        });
      } else {
        await store.update('ac_identities', keyId, { lastUsedAt: now() });
      }

      return { bound: true, already: Boolean(existing), masked: v.maskPhone(phone) };
    }

    const { uid, isNew } = await resolveIdentity(keyId, 'phone', phone);
    await bindDeviceIfFree(uid, input.deviceId);
    const newDevice = !isNew && !(await hasSeenDevice(uid, input.deviceId));
    const session = await issueSession(uid, ctx, { deviceId: input.deviceId });

    const actorCtx = { ...ctx, uid };
    await audit(isNew ? 'account.create' : 'auth.login', uid, actorCtx, {
      title: isNew ? '创建账户' : LOGIN_TITLES.phone,
      detail: { method: 'phone' },
      platform: 'web'
    });
    if (newDevice) {
      await audit('auth.login.newDevice', uid, actorCtx, {
        detail: { method: 'phone' },
        platform: 'web'
      });
    }

    return { ...session, isNew };
  }

  async function accountCodeLogin(input, ctx) {
    const code = v.normalizeAccountCode(input.accountCode);
    if (!v.isAccountCode(code)) throw invalid('账户码格式不对：应为 32 位十六进制');

    assertRate(`accountCode:ip:${ctx.ipHash}`, 10, 10 * 60 * 1000);
    assertRate(`accountCode:ip:day:${ctx.ipHash}`, 50, DAY);

    const { uid, isNew } = await resolveIdentity(`device:${code}`, 'device', code);
    const newDevice = !isNew && !(await hasSeenDevice(uid, code));
    const session = await issueSession(uid, ctx, { deviceId: code });

    const actorCtx = { ...ctx, uid };
    await audit(isNew ? 'account.create' : 'auth.login', uid, actorCtx, {
      title: isNew ? '创建账户' : LOGIN_TITLES.accountCode,
      detail: { method: 'accountCode' },
      platform: 'web'
    });
    if (newDevice) {
      await audit('auth.login.newDevice', uid, actorCtx, {
        detail: { method: 'accountCode' },
        platform: 'web'
      });
    }

    return { ...session, isNew };
  }

  async function codeStart(input, ctx) {
    const { user } = await requireUser(ctx);

    // 同一人旧的未用 6 位码立即作废
    const old = await store.query('ac_login_codes', { kind: 'transfer', uid: user.uid, used: false }, 50);
    for (const doc of old) {
      await store.update('ac_login_codes', doc._id, { used: true });
    }

    const code = t.newSixDigitCode();
    const codeHash = t.hashCode(code, pepper);
    await store.set('ac_login_codes', `transfer:${codeHash}`, {
      kind: 'transfer',
      uid: user.uid,
      codeHash,
      expiresAt: now() + TRANSFER_CODE_TTL,
      used: false,
      attempts: 0,
      createdAt: now()
    });

    await audit('code.start', user.uid, { ...ctx, uid: user.uid });
    return { code, expiresIn: TRANSFER_CODE_TTL / 1000 };
  }

  async function codeRedeem(input, ctx) {
    const code = String(input.code || '').trim();
    if (!v.isSixDigit(code)) throw new AppError('CODE_INVALID', '请输入 6 位数字', 400);

    assertRate(`code.redeem:ip:${ctx.ipHash}`, 10, 10 * 60 * 1000);

    const codeHash = t.hashCode(code, pepper);
    const candidates = await store.query('ac_login_codes', { kind: 'transfer', used: false }, 200);
    const doc = candidates.find((item) => t.safeEqual(codeHash, item.codeHash));
    if (!doc) throw new AppError('CODE_INVALID', '登录码不正确或已失效，请重新生成', 400);

    checkCodeDoc(doc, '登录码');

    await store.update('ac_login_codes', doc._id, { used: true });

    const user = await store.get('ac_users', doc.uid);
    if (!user || user.status === 'deleted') throw new AppError('ACCOUNT_DELETED', '账号已注销', 403);

    await bindDeviceIfFree(doc.uid, input.deviceId);
    const newDevice = !(await hasSeenDevice(doc.uid, input.deviceId));
    const session = await issueSession(doc.uid, ctx, { deviceId: input.deviceId });
    const actorCtx = { ...ctx, uid: doc.uid };
    await audit('auth.login', doc.uid, actorCtx, {
      title: LOGIN_TITLES.transferCode,
      detail: { method: 'transferCode' },
      platform: 'web'
    });
    if (newDevice) {
      await audit('auth.login.newDevice', doc.uid, actorCtx, {
        detail: { method: 'transferCode' },
        platform: 'web'
      });
    }

    return { ...session, isNew: false };
  }

  /* ---------- 扫码登录（已登录手机 → 新设备免验证码） ---------- */

  const QR_ID_PATTERN = /^[a-f0-9]{32}$/;

  /** 电脑端取一张待确认的登录码；二维码内容由前端用本站地址拼 */
  async function qrStart(input, ctx) {
    assertRate(`qr.start:ip:${ctx.ipHash}`, 10, 10 * 60 * 1000);

    // 顺手清掉过期的，避免集合无限增长
    const rows = await store.query('ac_qr_codes', {}, 200);
    for (const doc of rows) {
      if (doc.expiresAt <= now()) await store.remove('ac_qr_codes', doc._id);
    }

    const qrId = t.randomHex(16);
    await store.set('ac_qr_codes', qrId, {
      qrId,
      uid: '',
      decision: '',
      claimed: false,
      expiresAt: now() + QR_TTL,
      createdAt: now()
    });

    return { qrId, expiresIn: QR_TTL / 1000 };
  }

  /** 手机端确认（需登录）：把这次扫码绑定到当前账户 */
  async function qrConfirm(input, ctx) {
    const { user } = await requireUser(ctx);
    const qrId = String(input.qrId || '').trim();
    if (!QR_ID_PATTERN.test(qrId)) throw invalid('登录码不正确');

    assertRate(`qr.confirm:uid:${user.uid}`, 20, 10 * 60 * 1000);

    const doc = await store.get('ac_qr_codes', qrId);
    if (!doc || doc.expiresAt <= now()) {
      throw new AppError('QR_EXPIRED', '二维码已过期，请回到电脑上刷新', 400);
    }
    if (doc.uid) throw new AppError('QR_USED', '这个二维码已经确认过了', 409);

    const approve = input.approve !== false;
    await store.update('ac_qr_codes', qrId, {
      uid: user.uid,
      decision: approve ? 'approved' : 'denied',
      confirmedAt: now()
    });

    await audit('auth.qr.confirm', user.uid, { ...ctx, uid: user.uid }, {
      detail: { decision: approve ? 'approved' : 'denied' }
    });

    return { decision: approve ? 'approved' : 'denied' };
  }

  /** 电脑端轮询；手机确认后签发会话（一次一用） */
  async function qrPoll(input, ctx) {
    const qrId = String(input.qrId || '').trim();
    if (!QR_ID_PATTERN.test(qrId)) throw invalid('登录码不正确');

    assertRate(`qr.poll:ip:${ctx.ipHash}`, 600, 10 * 60 * 1000);

    const doc = await store.get('ac_qr_codes', qrId);
    if (!doc || doc.expiresAt <= now()) return { status: 'expired' };
    if (doc.claimed) return { status: 'used' };
    if (!doc.uid) return { status: 'pending' };

    if (doc.decision !== 'approved') {
      await store.update('ac_qr_codes', qrId, { claimed: true });
      return { status: 'denied' };
    }

    const user = await store.get('ac_users', doc.uid);
    if (!user || user.status === 'deleted') {
      await store.update('ac_qr_codes', qrId, { claimed: true });
      return { status: 'denied' };
    }

    await store.update('ac_qr_codes', qrId, { claimed: true });

    await bindDeviceIfFree(doc.uid, input.deviceId);
    const newDevice = !(await hasSeenDevice(doc.uid, input.deviceId));
    const session = await issueSession(doc.uid, ctx, { deviceId: input.deviceId });
    const actorCtx = { ...ctx, uid: doc.uid };

    await audit('auth.qr.login', doc.uid, actorCtx, {
      detail: { method: 'qr' },
      platform: 'web'
    });
    if (newDevice) {
      await audit('auth.login.newDevice', doc.uid, actorCtx, {
        detail: { method: 'qr' },
        platform: 'web'
      });
    }

    return {
      status: 'approved',
      token: session.token,
      expiresAt: session.expiresAt,
      uid: user.uid,
      nickname: user.nickname || '',
      avatar: user.avatar || ''
    };
  }

  /* ---------- 跨域登录票据 ---------- */

  /** 只接受 http(s) 且不带账号密码的地址，挡掉 javascript: / data: 等 */
  function parseReturnUrl(value) {
    let url;
    try {
      url = new URL(String(value || '').trim());
    } catch (err) {
      throw invalid('returnUrl 不是合法网址');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalid('returnUrl 只支持 http(s)');
    if (url.username || url.password) throw invalid('returnUrl 不能带账号密码');
    return url;
  }

  /** 作品登记域名允许 www 与裸域互为别名，其余必须完全一致 */
  function isSameSiteOrigin(a, b) {
    if (a.origin === b.origin) return true;
    if (a.protocol !== 'https:' || b.protocol !== 'https:') return false;
    if (a.port !== b.port) return false;
    const strip = (host) => host.replace(/^www\./, '');
    return strip(a.hostname) === strip(b.hostname);
  }

  /** 白名单为 * 时只放行本机，避免开发配置把任意站点变成可换票地址 */
  function isTrustedOrigin(origin) {
    const list = (Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins])
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    if (!origin) return false;
    if (list.includes('*')) {
      try {
        const { hostname } = new URL(origin);
        return hostname === 'localhost' || hostname === '127.0.0.1';
      } catch (err) {
        return false;
      }
    }
    return list.includes(origin);
  }

  /**
   * 已登录时签发一次性跨域票据（5 分钟）。
   * returnUrl 必须落在已登记作品域名或 ALLOWED_ORIGINS 内，防止被当成开放跳转。
   */
  async function ticketIssue(input, ctx) {
    const { user } = await requireUser(ctx);
    assertRate(`ticket.issue:uid:${user.uid}`, 10, 10 * 60 * 1000);

    const productId = cleanText(input.productId, 40);
    if (!productId) throw invalid('缺少 productId');

    const product = await store.get('ac_products', productId);
    if (product && product.status && product.status !== 'active') throw invalid('该作品已下线');

    const requested = input.returnUrl ? parseReturnUrl(input.returnUrl) : null;
    const registered = product && product.url ? parseReturnUrl(product.url) : null;
    const target = requested || registered;
    if (!target) throw invalid('缺少 returnUrl');

    if (registered) {
      if (!isSameSiteOrigin(target, registered)) throw invalid('returnUrl 与作品登记域名不一致');
    } else if (!isTrustedOrigin(target.origin)) {
      throw invalid('该域名未登记，不能用于跨域登录');
    }

    const ticket = t.newTicket();
    const codeHash = t.hashTicket(ticket, pepper);
    await store.set('ac_login_codes', `ticket:${codeHash}`, {
      kind: 'ticket',
      uid: user.uid,
      appId: productId,
      origin: target.origin,
      codeHash,
      expiresAt: now() + TICKET_TTL,
      used: false,
      attempts: 0,
      createdAt: now()
    });

    const redirect = new URL(target.toString());
    redirect.searchParams.set('ps_ticket', ticket);

    await audit('auth.ticket.issue', productId, { ...ctx, uid: user.uid }, {
      detail: { productId, origin: target.origin }
    });

    return { ticket, expiresIn: TICKET_TTL / 1000, redirectUrl: redirect.toString() };
  }

  /** 作品侧拿票据换 Token；票据一次一用，换完立即作废 */
  async function ticketRedeem(input, ctx) {
    const ticket = String(input.ticket || '').trim();
    assertRate(`ticket.redeem:ip:${ctx.ipHash}`, 30, 10 * 60 * 1000);
    if (!/^[0-9a-f]{32}$/.test(ticket)) {
      throw new AppError('CODE_INVALID', '授权码不正确或已失效', 400);
    }

    const doc = await store.get('ac_login_codes', `ticket:${t.hashTicket(ticket, pepper)}`);
    checkCodeDoc(doc, '授权码');

    await store.update('ac_login_codes', doc._id, { used: true });

    const user = await store.get('ac_users', doc.uid);
    if (!user || user.status === 'deleted') throw new AppError('ACCOUNT_DELETED', '账号已注销', 403);

    const session = await issueSession(doc.uid, ctx, { appId: doc.appId || 'account-center' });
    const actorCtx = { ...ctx, uid: doc.uid };
    await audit('auth.login', doc.appId, actorCtx, {
      title: LOGIN_TITLES.ticket,
      source: 'product',
      productId: doc.appId,
      platform: 'web',
      detail: { method: 'ticket' }
    });

    return { ...session, isNew: false };
  }

  /* ---------- 第三方登录（GitHub / Gitee / Microsoft） ---------- */

  function oauthProviders() {
    return {
      providers: enabledProviders().map((provider) => ({
        id: provider,
        name: oauthLib.providerName(provider)
      }))
    };
  }

  /** 只允许回到登录页 / 账户页，且域名必须是本站页面域名（防开放跳转） */
  function parsePageReturnUrl(value) {
    let url;
    try {
      url = new URL(String(value || '').trim());
    } catch (err) {
      throw invalid('returnUrl 不是合法网址');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalid('returnUrl 只支持 http(s)');
    if (url.username || url.password) throw invalid('returnUrl 不能带账号密码');
    if (!isTrustedOrigin(url.origin)) throw invalid('returnUrl 不在允许的页面域名内');
    if (!/\/(login|account)\.html$/.test(url.pathname)) throw invalid('returnUrl 必须是登录页或账户页');
    // 回调结果参数由服务端重新写，别的一律抹掉，避免二次拼接
    ['oauth_code', 'oauth_error', 'oauth_bound'].forEach((key) => url.searchParams.delete(key));
    return url;
  }

  function pageWithParam(target, key, value) {
    const url = new URL(target);
    url.searchParams.set(key, value);
    return url.toString();
  }

  /** 未登录：发起第三方登录；已登录且 mode=bind：发起绑定 */
  async function oauthStart(input, ctx) {
    const provider = String(input.provider || '');
    const config = providerConfig(provider);
    if (!config) throw invalid('该登录方式暂未开放');

    const mode = input.mode === 'bind' ? 'bind' : 'login';
    let uid = '';
    if (mode === 'bind') {
      const { user } = await requireUser(ctx);
      uid = user.uid;
    }

    assertRate(`oauth.start:ip:${ctx.ipHash}`, 20, 10 * 60 * 1000);

    const returnUrl = parsePageReturnUrl(input.returnUrl);
    const state = t.newTicket();
    await store.set('ac_login_codes', `oauthstate:${t.hashTicket(state, pepper)}`, {
      kind: 'oauth_state',
      provider,
      mode,
      uid,
      returnUrl: returnUrl.toString(),
      expiresAt: now() + OAUTH_STATE_TTL,
      used: false,
      createdAt: now()
    });

    return {
      provider,
      url: oauthLib.authorizeUrl(provider, {
        clientId: config.clientId,
        redirectUri: providerRedirectUri(provider),
        state,
        tenant: config.tenant
      })
    };
  }

  function redirectResponse(url) {
    return {
      statusCode: 302,
      headers: { Location: url, 'Cache-Control': 'no-store' },
      body: ''
    };
  }

  function oauthFail(returnUrl, code) {
    const target = returnUrl || (oauthBase ? `${oauthBase}/login.html` : '');
    if (!target) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: '第三方登录暂未配置'
      };
    }
    return redirectResponse(pageWithParam(target, 'oauth_error', code));
  }

  /** 第三方资料补进账户：只在原值为空时写入，不覆盖用户自己设的昵称 */
  async function fillProfile(uid, profile) {
    const user = await store.get('ac_users', uid);
    if (!user) return;
    const patch = {};
    if (!user.nickname && profile.name) patch.nickname = cleanText(profile.name, 40);
    if (!user.avatar && profile.avatar) patch.avatar = cleanText(profile.avatar, 300);
    if (!Object.keys(patch).length) return;
    patch.updatedAt = now();
    await store.update('ac_users', uid, patch);
  }

  /** 昵称 / 头像为空时补一套系统生成的默认值；已有值（含用户自己设的）一律不动 */
  async function ensurePersona(user) {
    if (user.nickname && user.avatar) return user;
    const patch = {};
    if (!user.nickname) patch.nickname = persona.generateNickname(user.uid);
    if (!user.avatar) patch.avatar = persona.generateAvatar(user.uid);
    patch.updatedAt = now();
    await store.update('ac_users', user.uid, patch);
    return Object.assign(user, patch);
  }

  /** 浏览器 GET 回调：校验 state → code 换资料 → 写钥匙 → 带一次性 code 回页面 */
  async function handleOAuthCallback(provider, query = {}, ctx = {}) {
    const headers = normalizeHeaders(ctx.headers || {});
    const clientIp = String(headers['x-forwarded-for'] || '').split(',')[0].trim() || ctx.ip || '';
    const callbackCtx = {
      ...ctx,
      ua: headers['user-agent'] || ctx.ua || '',
      ipHash: t.sha256(`${pepper}|ip|${clientIp}`)
    };

    try {
      const config = providerConfig(provider);
      if (!config) return oauthFail('', 'not_configured');

      const state = String(query.state || '');
      const code = String(query.code || '');
      if (!/^[0-9a-f]{32}$/.test(state)) return oauthFail('', 'state');

      const stateDoc = await store.get('ac_login_codes', `oauthstate:${t.hashTicket(state, pepper)}`);
      if (!stateDoc || stateDoc.used || stateDoc.expiresAt <= now() || stateDoc.provider !== provider) {
        logger.warn(
          `[accountCenter] oauth 回调 state 无效 provider=${provider} len=${state.length} found=${Boolean(stateDoc)}` +
            (stateDoc
              ? ` used=${stateDoc.used} expired=${stateDoc.expiresAt <= now()} mismatch=${stateDoc.provider !== provider}`
              : '')
        );
        return oauthFail('', 'state');
      }
      await store.update('ac_login_codes', stateDoc._id, { used: true });

      const returnUrl = stateDoc.returnUrl;
      if (query.error) return oauthFail(returnUrl, 'denied');
      if (!code) return oauthFail(returnUrl, 'provider');

      const profile = await oauthLib.fetchProfile(provider, {
        code,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: providerRedirectUri(provider),
        tenant: config.tenant,
        fetchImpl
      });

      const keyId = `oauth:${provider}:${profile.id}`;
      const existing = await store.get('ac_identities', keyId);

      /* 已登录状态下的绑定 */
      if (stateDoc.mode === 'bind') {
        if (existing) {
          const owner = await store.get('ac_users', existing.uid);
          if (!owner || owner.status === 'deleted') {
            await store.remove('ac_identities', keyId);
          } else if (existing.uid === stateDoc.uid) {
            return redirectResponse(pageWithParam(returnUrl, 'oauth_bound', 'already'));
          } else {
            return oauthFail(returnUrl, 'key_taken');
          }
        }

        await store.set('ac_identities', keyId, {
          uid: stateDoc.uid,
          kind: 'oauth',
          provider,
          value: profile.login || profile.id,
          createdAt: now(),
          lastUsedAt: now()
        });
        await fillProfile(stateDoc.uid, profile);
        await audit('account.bind', provider, { ...callbackCtx, uid: stateDoc.uid }, {
          title: `绑定 ${oauthLib.providerName(provider)}`,
          detail: { provider }
        });
        return redirectResponse(pageWithParam(returnUrl, 'oauth_bound', provider));
      }

      /* 登录：能认出老账户就登录，认不出则建新账户 */
      let uid = '';
      let isNew = false;
      if (existing) {
        const owner = await store.get('ac_users', existing.uid);
        if (owner && owner.status !== 'deleted') {
          uid = existing.uid;
          await store.update('ac_identities', keyId, { lastUsedAt: now() });
        } else {
          await store.remove('ac_identities', keyId);
        }
      }

      if (!uid) {
        // 防止「同一个人两个账户」：第三方已验证邮箱若已注册，先让他用邮箱登录再绑定
        if (profile.emailVerified && profile.email) {
          const emailKey = await store.get('ac_identities', `email:${profile.email}`);
          if (emailKey) {
            const owner = await store.get('ac_users', emailKey.uid);
            if (owner && owner.status !== 'deleted') return oauthFail(returnUrl, 'email_exists');
          }
        }
        const resolved = await resolveIdentity(keyId, 'oauth', profile.login || profile.id, { provider });
        uid = resolved.uid;
        isNew = resolved.isNew;
      }
      await fillProfile(uid, profile);

      // 回页面只带一次性 code，Token 不在地址栏出现
      const loginCode = t.newTicket();
      await store.set('ac_login_codes', `oauthlogin:${t.hashTicket(loginCode, pepper)}`, {
        kind: 'oauth_login',
        uid,
        provider,
        isNew,
        expiresAt: now() + OAUTH_LOGIN_TTL,
        used: false,
        createdAt: now()
      });

      return redirectResponse(pageWithParam(returnUrl, 'oauth_code', loginCode));
    } catch (err) {
      logger.error('[accountCenter] 第三方登录回调失败', err && err.message);
      return oauthFail('', 'internal');
    }
  }

  /** 页面拿一次性 code 换 Token；一次性，5 分钟有效 */
  async function oauthExchange(input, ctx) {
    const code = String(input.code || '').trim();
    assertRate(`oauth.exchange:ip:${ctx.ipHash}`, 30, 10 * 60 * 1000);
    if (!/^[0-9a-f]{32}$/.test(code)) {
      throw new AppError('CODE_INVALID', '授权码不正确或已失效', 400);
    }

    const doc = await store.get('ac_login_codes', `oauthlogin:${t.hashTicket(code, pepper)}`);
    if (!doc || doc.kind !== 'oauth_login') {
      throw new AppError('CODE_INVALID', '授权码不正确或已失效', 400);
    }
    checkCodeDoc(doc, '授权码');
    await store.update('ac_login_codes', doc._id, { used: true });

    const user = await store.get('ac_users', doc.uid);
    if (!user || user.status === 'deleted') throw new AppError('ACCOUNT_DELETED', '账号已注销', 403);

    const newDevice = !(await hasSeenDevice(doc.uid, input.deviceId));
    const session = await issueSession(doc.uid, ctx, { deviceId: input.deviceId });
    const actorCtx = { ...ctx, uid: doc.uid };
    const name = oauthLib.providerName(doc.provider);

    await audit(doc.isNew ? 'account.create' : 'auth.login', doc.uid, actorCtx, {
      title: doc.isNew ? '创建账户' : `${name} 登录`,
      detail: { method: 'oauth', provider: doc.provider },
      platform: 'web'
    });
    if (!doc.isNew && newDevice) {
      await audit('auth.login.newDevice', doc.uid, actorCtx, {
        detail: { method: 'oauth', provider: doc.provider },
        platform: 'web'
      });
    }

    return { ...session, isNew: Boolean(doc.isNew) };
  }

  async function me(input, ctx) {
    const { user } = await requireUser(ctx);
    await ensurePersona(user);
    const keys = await store.query('ac_identities', { uid: user.uid }, 20);
    const emailKey = keys.find((key) => key.kind === 'email');
    const phoneKey = keys.find((key) => key.kind === 'phone');

    return {
      uid: user.uid,
      nickname: user.nickname || '',
      avatar: user.avatar || '',
      emailMasked: emailKey ? v.maskEmail(emailKey.value) : '',
      phoneMasked: phoneKey ? v.maskPhone(phoneKey.value) : '',
      keys: keys.map((key) => ({
        kind: key.kind,
        provider: key.kind === 'oauth' ? key.provider || '' : '',
        masked: key.kind === 'email'
          ? v.maskEmail(key.value)
          : key.kind === 'oauth'
            ? `${oauthLib.providerName(key.provider)} · ${key.value}`
            : key.kind === 'phone'
              ? v.maskPhone(key.value)
              : v.maskAccountCode(key.value),
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt
      })),
      createdAt: user.createdAt
    };
  }

  /** 个人资料：昵称与头像；邮箱 / uid 是登录钥匙，不作为可改项 */
  async function accountProfile(input, ctx) {
    const { user } = await requireUser(ctx);
    const patch = {};

    if (input.nickname !== undefined) {
      const nickname = cleanText(input.nickname, 40);
      if (!nickname) throw invalid('昵称不能为空');
      if (nickname.length > 20) throw invalid('昵称最多 20 个字');
      patch.nickname = nickname;
    }

    if (input.avatar !== undefined) {
      patch.avatar = normalizeAvatar(input.avatar);
    }

    if (!Object.keys(patch).length) throw invalid('没有要修改的内容');

    patch.updatedAt = now();
    await store.update('ac_users', user.uid, patch);
    await audit('account.profile', user.uid, { ...ctx, uid: user.uid }, {
      detail: Object.keys(patch).filter((key) => key !== 'updatedAt').join(',')
    });

    return {
      nickname: patch.nickname !== undefined ? patch.nickname : user.nickname || '',
      avatar: patch.avatar !== undefined ? patch.avatar : user.avatar || ''
    };
  }

  /** 昵称 / 头像的参考选项：从服务端候选池里抽 12 个，用户选中后再走 account.profile 落库 */
  async function loadPersonaPool() {
    const saved = await store.get('ac_persona_pool', 'default');
    if (saved
      && Array.isArray(saved.nicknames) && saved.nicknames.length >= PERSONA_OPTIONS_COUNT
      && Array.isArray(saved.avatars) && saved.avatars.length >= PERSONA_OPTIONS_COUNT) {
      return saved;
    }

    // 只在第一次（或池子损坏）时生成，之后一直复用库里这一份
    const pool = persona.buildPool(60, 60);
    await store.set('ac_persona_pool', 'default', { ...pool, builtAt: now() });
    return pool;
  }

  function sampleList(list, count) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, count);
  }

  async function accountPersonaOptions(input, ctx) {
    await requireUser(ctx);
    const pool = await loadPersonaPool();

    return {
      nicknames: sampleList(pool.nicknames, PERSONA_OPTIONS_COUNT),
      avatars: sampleList(pool.avatars, PERSONA_OPTIONS_COUNT)
    };
  }

  /** 头像只收图片 dataURL；传空串表示清空 */
  function normalizeAvatar(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(raw)) {
      throw invalid('头像格式不支持，请重新选择图片');
    }
    if (raw.length > AVATAR_MAX_LENGTH) {
      throw new AppError('AVATAR_TOO_LARGE', '头像太大了，换一张小一点的图片', 400);
    }
    return raw;
  }

  /** 解绑登录方式：至少保留一种钥匙，避免账户失联 */
  async function accountUnbind(input, ctx) {
    const { user } = await requireUser(ctx);
    const kind = String(input.kind || '');
    const provider = String(input.provider || '');
    if (!['email', 'phone', 'device', 'oauth'].includes(kind)) throw invalid('不支持的登录方式');
    if (kind === 'oauth' && !oauthLib.isKnownProvider(provider)) throw invalid('不支持的登录方式');

    assertRate(`account.unbind:uid:${user.uid}`, 10, 60 * 1000);

    const keys = await store.query('ac_identities', { uid: user.uid }, 50);
    const targets = keys.filter((key) => key.kind === kind && (kind !== 'oauth' || key.provider === provider));
    const label = kind === 'oauth'
      ? oauthLib.providerName(provider)
      : kind === 'email' ? '邮箱' : kind === 'phone' ? '手机号' : '账户码';

    if (!targets.length) throw invalid(`还没有绑定${label}`);
    if (keys.length <= targets.length) {
      throw new AppError('LAST_KEY', '至少要保留一种登录方式，否则账户将无法登录', 400);
    }

    for (const key of targets) await store.remove('ac_identities', key._id);
    await audit('account.unbind', provider || kind, { ...ctx, uid: user.uid }, {
      title: `解绑 ${label}`,
      detail: { kind, provider }
    });
    return { ok: true, removed: targets.length };
  }

  /** 生成 / 重置本账户的账户码：完整值只在这次返回，之后页面只看得到掩码 */
  async function accountCodeGenerate(input, ctx) {
    const { user } = await requireUser(ctx);
    assertRate(`account.code:uid:${user.uid}`, 5, 10 * 60 * 1000);

    const keys = await store.query('ac_identities', { uid: user.uid }, 50);
    const olds = keys.filter((key) => key.kind === 'device');

    let code = t.randomHex(16);
    for (let i = 0; i < 3; i += 1) {
      const taken = await store.get('ac_identities', `device:${code}`);
      if (!taken) break;
      code = t.randomHex(16);
    }

    for (const key of olds) await store.remove('ac_identities', key._id);
    await store.set('ac_identities', `device:${code}`, {
      uid: user.uid,
      kind: 'device',
      value: code,
      createdAt: now(),
      lastUsedAt: now()
    });

    await audit('account.code', user.uid, { ...ctx, uid: user.uid }, {
      detail: { reset: olds.length > 0 }
    });
    return { accountCode: code };
  }

  async function meProducts(input, ctx) {
    const { user } = await requireUser(ctx);
    const entitlements = await store.query('ac_entitlements', { uid: user.uid }, 100);
    const products = await store.query('ac_products', { status: 'active' }, 100);
    const granted = new Map(entitlements.map((item) => [item.appId, item]));

    return {
      products: products.map((product) => ({
        appId: product.appId,
        name: product.name,
        url: product.url,
        // 首期规则：没有单独记录 = 登录即可用
        status: (granted.get(product.appId) || {}).status || 'active'
      }))
    };
  }

  /** 登录页按作品取配色（公开、无鉴权）：只回主题与强调色，未登记 / 已下线一律浅色 */
  async function productTheme(input, ctx) {
    const productId = cleanText(input.productId, 40);
    if (!productId) throw invalid('缺少 productId');
    assertRate(`product.theme:${ctx.ipHash}`, 60, 60 * 1000);

    const product = await store.get('ac_products', productId);
    const active = product && (!product.status || product.status === 'active');
    const accent = active ? String(product.accent || '') : '';

    return {
      theme: active && product.theme === 'dark' ? 'dark' : 'light',
      accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : ''
    };
  }

  /** 账户凭证卡：只给本人存相册，故回完整邮箱；账户码仍不回完整值 */
  async function accountCredential(input, ctx) {
    const { user } = await requireUser(ctx);
    const keys = await store.query('ac_identities', { uid: user.uid }, 20);
    const emailKey = keys.find((key) => key.kind === 'email');

    await audit('account.credential', user.uid, { ...ctx, uid: user.uid });

    return {
      uid: user.uid,
      nickname: user.nickname || '',
      email: emailKey ? emailKey.value : '',
      createdAt: user.createdAt
    };
  }

  async function logout(input, ctx) {
    const { session } = await requireUser(ctx);
    await store.update('ac_sessions', session.sid, { revoked: true });
    await audit('auth.logout', session.uid, { ...ctx, uid: session.uid });
    return { ok: true };
  }

  async function logoutAll(input, ctx) {
    const { user } = await requireUser(ctx);
    const sessions = await store.query('ac_sessions', { uid: user.uid }, 200);
    let revoked = 0;
    for (const session of sessions) {
      if (session.revoked) continue;
      await store.update('ac_sessions', session.sid, { revoked: true });
      revoked += 1;
    }
    await audit('auth.logoutAll', user.uid, { ...ctx, uid: user.uid }, { revoked });
    return { revoked };
  }

  async function accountDelete(input, ctx) {
    if (String(input.confirm || '') !== '注销') throw invalid('请输入「注销」两个字确认');
    const { user } = await requireUser(ctx);

    const keys = await store.query('ac_identities', { uid: user.uid }, 50);
    for (const key of keys) await store.remove('ac_identities', key._id);

    const sessions = await store.query('ac_sessions', { uid: user.uid }, 200);
    for (const session of sessions) {
      await store.update('ac_sessions', session.sid, { revoked: true });
    }

    // 注销即销毁用户自填的 AI Key，不留残余
    await store.remove('ac_ai_keys', user.uid);

    await store.update('ac_users', user.uid, { status: 'deleted', updatedAt: now() });
    await audit('account.delete', user.uid, { ...ctx, uid: user.uid });

    return { deleted: true };
  }

  /* ---------- AI Key 托管（按 uid 加密存放，所有作品共用一份） ---------- */

  /** 只收 https；去掉末尾斜杠，拒绝带账号密码的地址 */
  function normalizeAiBaseUrl(value) {
    const raw = String(value || '').trim().replace(/\/+$/, '');
    if (!raw) throw invalid('缺少服务地址');
    if (raw.length > 300) throw invalid('服务地址过长');

    let url;
    try {
      url = new URL(raw);
    } catch (err) {
      throw invalid('服务地址不是合法网址');
    }
    if (url.protocol !== 'https:') throw invalid('服务地址必须是 https://');
    if (url.username || url.password) throw invalid('服务地址不能带账号密码');
    return raw;
  }

  function aiHost(baseUrl) {
    try {
      return new URL(baseUrl).host;
    } catch (err) {
      return '';
    }
  }

  /** 读状态：只回掩码与地址 / 模型，任何情况下都不回明文 */
  async function aiKeyGet(input, ctx) {
    const { user } = await requireUser(ctx);
    const doc = await store.get('ac_ai_keys', user.uid);

    return {
      hasKey: Boolean(doc && doc.enc),
      masked: (doc && doc.masked) || '',
      baseUrl: (doc && doc.baseUrl) || '',
      model: (doc && doc.model) || '',
      updatedAt: (doc && doc.updatedAt) || 0
    };
  }

  /** 保存：api_key 留空表示沿用已托管的 Key，只改地址 / 模型 */
  async function aiKeySave(input, ctx) {
    const { user } = await requireUser(ctx);
    assertRate(`aikey.save:uid:${user.uid}`, 20, 10 * 60 * 1000);

    const baseUrl = normalizeAiBaseUrl(input.base_url || input.baseUrl);
    const model = cleanText(input.model, 120);
    if (!model) throw invalid('模型名不能为空');

    const existing = await store.get('ac_ai_keys', user.uid);
    let apiKey = String(input.api_key || input.apiKey || '').trim();
    if (!apiKey && existing && existing.enc) apiKey = vault.open(existing.enc);
    if (!apiKey) throw invalid('请填写 API Key');
    if (apiKey.length > 500) throw invalid('API Key 过长');
    if (/\s/.test(apiKey)) throw invalid('API Key 不能包含空格或换行');

    const doc = {
      uid: user.uid,
      enc: vault.seal(apiKey),
      masked: vault.mask(apiKey),
      baseUrl,
      model,
      createdAt: (existing && existing.createdAt) || now(),
      updatedAt: now()
    };
    await store.set('ac_ai_keys', user.uid, doc);

    await audit('aikey.save', user.uid, { ...ctx, uid: user.uid }, {
      detail: { host: aiHost(baseUrl), model }
    });

    return { hasKey: true, masked: doc.masked, baseUrl, model };
  }

  /** 清除：只删这份 Key，账户与业务数据不受影响 */
  async function aiKeyClear(input, ctx) {
    const { user } = await requireUser(ctx);
    assertRate(`aikey.clear:uid:${user.uid}`, 20, 10 * 60 * 1000);

    const removed = await store.remove('ac_ai_keys', user.uid);
    await audit('aikey.clear', user.uid, { ...ctx, uid: user.uid }, {
      detail: { removed: Boolean(removed) }
    });
    return { ok: true };
  }

  /** 用户点「显示」时才解一次明文；单用户限流兜底 */
  async function aiKeyReveal(input, ctx) {
    const { user } = await requireUser(ctx);
    assertRate(`aikey.reveal:uid:${user.uid}`, 10, 10 * 60 * 1000);

    const doc = await store.get('ac_ai_keys', user.uid);
    if (!doc || !doc.enc) throw invalid('还没有保存 Key');
    const key = vault.open(doc.enc);
    if (!key) throw new AppError('KEY_UNREADABLE', 'Key 无法解密，请重新填写', 400);

    await audit('aikey.reveal', user.uid, { ...ctx, uid: user.uid });
    return { key };
  }

  /** 调一次上游 /chat/completions（非流式）；测试连接与统一网关共用 */
  async function callChat(cfg, apiKey, opts) {
    if (typeof fetchImpl !== 'function') {
      throw new AppError('AI_UNAVAILABLE', '服务端未启用网络请求，暂时无法调用模型', 500);
    }

    const body = {
      model: cfg.model,
      messages: opts.messages,
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.7,
      stream: false
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    // DeepSeek 必须显式关思考模式，否则 token 翻数倍、大半时间在思考
    if (/deepseek\.com/i.test(cfg.baseUrl)) body.thinking = { type: 'disabled' };

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), opts.timeout || AIKEY_TIMEOUT) : null;

    try {
      const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined
      });
      const text = await res.text();

      let json = null;
      try {
        json = JSON.parse(text);
      } catch (err) {
        /* 非 JSON：上游异常页 */
      }

      if (!res.ok) {
        const msg = (json && json.error && (json.error.message || json.error.code)) || `HTTP ${res.status}`;
        throw new AppError('AI_UPSTREAM', `模型服务返回错误：${String(msg).slice(0, 160)}`, 502);
      }

      const choice = (json && json.choices && json.choices[0]) || {};
      const reply = String((choice.message && choice.message.content) || '').trim();
      if (!reply) throw new AppError('AI_UPSTREAM', '模型没有返回内容，请检查模型名是否可用', 502);
      return { text: reply, usage: (json && json.usage) || null };
    } catch (err) {
      if (err instanceof AppError) throw err;
      const aborted = err && err.name === 'AbortError';
      const message = aborted ? '模型响应超时，请稍后重试' : `连接模型服务失败：${(err && err.message) || err}`;
      throw new AppError('AI_UPSTREAM', message, 502);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 用一次最小对话验通 */
  async function pingProvider(cfg, apiKey) {
    const out = await callChat(cfg, apiKey, {
      messages: [
        { role: 'system', content: '你是连通性测试助手。' },
        { role: 'user', content: '请只回复四个字：连接正常' }
      ],
      temperature: 0,
      maxTokens: 24
    });
    return out.text.slice(0, AIKEY_REPLY_MAX);
  }

  /** 对话入参：只收 system / user / assistant，超长直接拒（不截断，避免悄悄丢上下文） */
  function normalizeChatMessages(raw) {
    if (!Array.isArray(raw) || !raw.length) throw invalid('缺少对话内容');
    if (raw.length > AIKEY_CHAT_MAX_MSG) throw invalid(`对话轮次过多（最多 ${AIKEY_CHAT_MAX_MSG} 条）`);

    const allowed = ['system', 'user', 'assistant'];
    let total = 0;
    const messages = raw.map((item) => {
      const role = String((item && item.role) || '').toLowerCase();
      if (allowed.indexOf(role) < 0) throw invalid('对话角色只能是 system / user / assistant');
      const content = String((item && item.content) || '').trim();
      if (!content) throw invalid('对话内容不能为空');
      total += content.length;
      return { role, content };
    });

    if (total > AIKEY_CHAT_MAX_CHARS) throw invalid(`对话内容过长（最多 ${AIKEY_CHAT_MAX_CHARS} 字）`);
    return messages;
  }

  function clampNumber(value, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.min(max, Math.max(min, num));
  }

  /**
   * 统一 AI 网关：各作品只发对话，Key 由这里读、由这里用，任何作品都拿不到明文。
   * 模型与地址一律用已托管的配置，不接受请求指定（避免被当成任意地址的转发器）。
   */
  async function aiKeyChat(input, ctx) {
    const { user } = await requireUser(ctx);
    assertRate(`aikey.chat:uid:${user.uid}`, 60, 10 * 60 * 1000);

    const messages = normalizeChatMessages(input.messages);

    const doc = await store.get('ac_ai_keys', user.uid);
    if (!doc || !doc.enc) throw new AppError('AI_NO_KEY', '还没有保存 AI Key', 400);
    const apiKey = vault.open(doc.enc);
    if (!apiKey) throw new AppError('KEY_UNREADABLE', 'Key 无法解密，请重新填写', 400);

    const maxTokens = clampNumber(input.max_tokens || input.maxTokens, 1, AIKEY_CHAT_MAX_TOKENS);
    const temperature = clampNumber(input.temperature, 0, 1.5);
    const started = now();

    const out = await callChat(
      { baseUrl: doc.baseUrl, model: doc.model },
      apiKey,
      {
        messages,
        temperature: temperature === null ? 0.7 : temperature,
        maxTokens: maxTokens === null ? 0 : Math.round(maxTokens),
        timeout: AIKEY_CHAT_TIMEOUT
      }
    );

    await audit('aikey.chat', user.uid, { ...ctx, uid: user.uid }, {
      detail: {
        host: aiHost(doc.baseUrl),
        model: doc.model,
        feature: cleanText(input.feature, 40),
        inChars: messages.reduce((sum, m) => sum + m.content.length, 0),
        outChars: out.text.length,
        tokens: (out.usage && (out.usage.total_tokens || 0)) || 0,
        ms: now() - started
      }
    });

    return { text: out.text, model: doc.model, usage: out.usage };
  }

  /** 测试连接：可以用输入框里的 Key，也可以用已托管的那把 */
  async function aiKeyTest(input, ctx) {
    const { user } = await requireUser(ctx);
    assertRate(`aikey.test:uid:${user.uid}`, 20, 10 * 60 * 1000);

    const existing = (await store.get('ac_ai_keys', user.uid)) || {};
    const rawBase = String(input.base_url || input.baseUrl || existing.baseUrl || '').trim();
    const cfg = {
      baseUrl: rawBase ? normalizeAiBaseUrl(rawBase) : '',
      model: cleanText(input.model, 120) || existing.model || ''
    };
    let apiKey = String(input.api_key || input.apiKey || '').trim();
    if (!apiKey && existing.enc) apiKey = vault.open(existing.enc);

    if (!cfg.baseUrl || !cfg.model || !apiKey) {
      throw invalid('请先填完整的服务地址、模型名与 API Key');
    }

    const reply = await pingProvider(cfg, apiKey);
    await audit('aikey.test', user.uid, { ...ctx, uid: user.uid }, {
      detail: { host: aiHost(cfg.baseUrl), model: cfg.model }
    });
    return { reply };
  }

  /* ---------- 我的足迹 ---------- */

  /** 作品侧上报：只记「做了什么」，不接收业务内容与密钥 */
  async function track(input, ctx) {
    const { user } = await requireUser(ctx);
    assertRate(`track:uid:${user.uid}`, 60, 60 * 1000);

    const productId = cleanText(input.productId, 40);
    if (!productId) throw invalid('缺少 productId');

    // 注意：`action` 已被用来选路由（固定为 track），行为类型走 `event`
    const kind = String(input.event || '');
    const scope = TRACK_SCOPES[kind];
    // 未知动作按契约直接忽略，仍回 recorded:true，不打断作品主流程
    if (!scope) return { recorded: true };

    const platform = TRACK_PLATFORMS.includes(input.platform) ? input.platform : 'web';
    const title = cleanText(input.title, 40) || EVENT_META[`product.${kind}`].title;

    // 同 uid + 同作品 + 同标题，30 分钟内只落 1 条
    const recent = await store.query('ac_audit_logs', { actorUid: user.uid, productId }, 500);
    const duplicated = recent.some(
      (event) => event.title === title && now() - event.createdAt < TRACK_DEDUPE
    );
    if (duplicated) return { recorded: true, deduped: true };

    await audit(`product.${kind}`, productId, { ...ctx, uid: user.uid }, {
      scope,
      source: 'product',
      platform,
      productId,
      title,
      detail: sanitizeMeta(input.meta)
    });
    return { recorded: true };
  }

  /** 我的足迹：只回本人事件，security 类不暴露细节 */
  async function meActivity(input, ctx) {
    const { user } = await requireUser(ctx);

    const range = ['7d', '30d', '90d'].includes(input.range) ? input.range : '30d';
    const days = Number.parseInt(range, 10);
    const scope = ACTIVITY_SCOPES.includes(input.scope) ? input.scope : 'all';
    const limit = Math.min(Math.max(Number.parseInt(input.limit, 10) || 10, 1), ACTIVITY_PAGE_MAX);
    const cursor = Number(input.cursor) || 0;

    const rows = await store.query('ac_audit_logs', { actorUid: user.uid }, 2000);
    const since = now() - days * DAY;

    let list = rows.filter((event) => event.visibleToUser !== false && event.createdAt >= since);
    if (scope === 'login') {
      list = list.filter((event) => event.scope === 'account' || event.scope === 'security');
    } else if (scope !== 'all') {
      list = list.filter((event) => event.scope === scope);
    }
    list.sort((a, b) => b.createdAt - a.createdAt || (a._id < b._id ? 1 : -1));
    if (cursor) list = list.filter((event) => event.createdAt < cursor);

    const page = list.slice(0, limit);
    return {
      items: page.map((event) => {
        const item = {
          id: event._id,
          scope: event.scope || 'account',
          action: event.action,
          title: event.title || event.action,
          productId: event.productId || '',
          platform: event.platform || '',
          createdAt: event.createdAt
        };
        if (item.scope !== 'security' && event.detail && event.detail.method) {
          item.method = event.detail.method;
        }
        return item;
      }),
      nextCursor: list.length > page.length ? page[page.length - 1].createdAt : 0
    };
  }

  /** 只清作品 / 浏览两类；账户与安全留痕，不可清 */
  async function meActivityClear(input, ctx) {
    const { user } = await requireUser(ctx);
    const scope = String(input.scope || '');
    if (!['product', 'browse', 'all'].includes(scope)) {
      throw invalid('只能清除作品或浏览记录');
    }

    const rows = await store.query('ac_audit_logs', { actorUid: user.uid }, 2000);
    let removed = 0;
    for (const event of rows) {
      const clearable = event.scope === 'product' || event.scope === 'browse';
      if (!clearable) continue;
      if (scope !== 'all' && event.scope !== scope) continue;
      await store.remove('ac_audit_logs', event._id);
      removed += 1;
    }

    const title = scope === 'browse'
      ? '清除浏览记录'
      : scope === 'product' ? '清除作品记录' : '清除作品与浏览记录';
    await audit('activity.clear', scope, { ...ctx, uid: user.uid }, {
      title,
      detail: { scope, removed }
    });
    return { removed };
  }

  /** 90 天前的审计 / 足迹一起清理（启动时 + 每日各跑一次） */
  async function cleanup() {
    const cutoff = now() - ACTIVITY_TTL;
    const rows = await store.query('ac_audit_logs', {}, 100000);
    let removed = 0;
    for (const event of rows) {
      if (event.createdAt < cutoff) {
        await store.remove('ac_audit_logs', event._id);
        removed += 1;
      }
    }
    if (removed) logger.info(`[accountCenter] 清理过期记录 ${removed} 条`);

    // 过期的扫码登录码一并清掉
    const qrRows = await store.query('ac_qr_codes', {}, 1000);
    for (const doc of qrRows) {
      if (doc.expiresAt <= now()) await store.remove('ac_qr_codes', doc._id);
    }

    return { removed };
  }

  /* ---------- 微信小程序登录（openid 由云函数代持） ---------- */

  /**
   * 校验小程序服务端调用：作品已登记 + 时间戳未过期 + 共享密钥签名正确。
   * 返回 { productId, openid }；任何一项不满足就抛错。
   */
  async function verifyMpCall(input) {
    if (!mpSecret) throw new AppError('MP_DISABLED', '小程序登录尚未开启', 403);

    const productId = cleanText(input.productId, 40);
    if (!productId) throw invalid('缺少 productId');
    const product = await store.get('ac_products', productId);
    if (!product) throw invalid('该作品未登记');
    if (product.status && product.status !== 'active') throw invalid('该作品已下线');

    const openid = cleanText(input.openid, 64);
    if (!openid) throw invalid('缺少 openid');

    const ts = Number(input.ts);
    if (!Number.isFinite(ts) || Math.abs(now() - ts) > MP_SIGN_TTL) {
      throw new AppError('CODE_EXPIRED', '请求已过期，请重新登录', 400);
    }
    const signature = String(input.sign || '');
    const expected = t.hmac(`${productId}|${openid}|${ts}`, mpSecret);
    if (!signature || !t.safeEqual(signature, expected)) throw unauthorized();

    return { productId, openid };
  }

  /**
   * 小程序没有浏览器环境，也不能让前端直接传 openid（那等于谁都能冒充谁）。
   * 流程：wereadProxy 云函数从调用上下文取 openid → 用共享密钥对
   * `productId|openid|ts` 签名 → 这里验签后按 `wx:<openid>` 查/建钥匙并建会话。
   * 与邮箱 / 账户码同 uid 体系；不自动合并任何老账户。
   */
  async function mpLogin(input, ctx) {
    const { productId, openid } = await verifyMpCall(input);

    assertRate(`mp.login:openid:${openid}`, 10, 10 * 60 * 1000);
    assertRate(`mp.login:ip:${ctx.ipHash}`, 60, 10 * 60 * 1000);

    const { uid, isNew } = await resolveIdentity(`wx:${openid}`, 'wx', openid);
    const session = await issueSession(uid, ctx, { appId: productId });
    const user = await store.get('ac_users', uid);

    const actorCtx = { ...ctx, uid };
    await audit(isNew ? 'account.create' : 'auth.login', productId, actorCtx, {
      title: isNew ? '创建账户' : LOGIN_TITLES.mp,
      source: 'product',
      productId,
      platform: 'miniprogram',
      detail: { method: 'mp' }
    });

    return {
      ...session,
      isNew,
      nickname: (user && user.nickname) || '',
      avatar: (user && user.avatar) || ''
    };
  }

  /**
   * 「空壳临时账户」：小程序第一次点「微信一键登录」时自动建出来的账户，
   * 里面只有这一把 wx 钥匙，没改过昵称、没托管 Key、没领过任何权益。
   * 这种账户在用户拿老账户的 6 位码来绑定时可以安全接管（用户明确操作，不是自动合并）。
   */
  async function isEmptyShell(uid) {
    const user = await store.get('ac_users', uid);
    if (!user || user.status === 'deleted') return false;

    const keys = await store.query('ac_identities', { uid }, 10);
    if (keys.length !== 1 || keys[0].kind !== 'wx') return false;

    if (await store.get('ac_ai_keys', uid)) return false;
    const entitlements = await store.query('ac_entitlements', { uid }, 1);
    if (entitlements.length) return false;

    return true;
  }

  /** 退役空壳账户：撤销其会话并标记注销，钥匙由调用方转移 */
  async function retireShell(uid) {
    const sessions = await store.query('ac_sessions', { uid }, 200);
    for (const session of sessions) {
      await store.update('ac_sessions', session.sid, { revoked: true });
    }
    await store.update('ac_users', uid, { status: 'deleted', deletedAt: now() });
  }

  /**
   * 小程序绑定已有账户（6 位登录码）
   *
   * 场景：用户早先用邮箱 / 手机号注册过，小程序一键登录会新建 uid；
   * 这里让他在网页端「生成 6 位登录码」→ 小程序里输入 → 把这把 `wx:<openid>`
   * 挂到那个已有账户上，以后一键登录直接进同一个 uid。
   * 钥匙已被别的账户占用时直接拒绝（一钥匙一 uid，不自动合并）。
   */
  async function mpBind(input, ctx) {
    const { productId, openid } = await verifyMpCall(input);

    const code = String(input.code || '').trim();
    if (!v.isSixDigit(code)) throw new AppError('CODE_INVALID', '请输入 6 位数字', 400);

    assertRate(`mp.bind:openid:${openid}`, 10, 10 * 60 * 1000);
    assertRate(`mp.bind:ip:${ctx.ipHash}`, 30, 10 * 60 * 1000);

    const codeHash = t.hashCode(code, pepper);
    const candidates = await store.query('ac_login_codes', { kind: 'transfer', used: false }, 200);
    const doc = candidates.find((item) => t.safeEqual(codeHash, item.codeHash));
    if (!doc) throw new AppError('CODE_INVALID', '登录码不正确或已失效，请重新生成', 400);
    checkCodeDoc(doc, '登录码');

    const user = await store.get('ac_users', doc.uid);
    if (!user || user.status === 'deleted') throw new AppError('ACCOUNT_DELETED', '账号已注销', 403);

    const keyId = `wx:${openid}`;
    let existing = await store.get('ac_identities', keyId);
    let tookOver = false;
    let shellUid = '';
    if (existing && existing.uid !== doc.uid) {
      if (await isEmptyShell(existing.uid)) {
        // 老用户踩过的坑：先点了一键登录，系统给他建了个空壳账户；这里把他这唯一一把 wx 钥匙转过来
        shellUid = existing.uid;
        await retireShell(shellUid);
        await store.remove('ac_identities', keyId);
        existing = null;
        tookOver = true;
      } else {
        throw new AppError('KEY_TAKEN', '这个微信已绑定到另一个账户，请先在该账户里解绑', 409);
      }
    }

    await store.update('ac_login_codes', doc._id, { used: true });
    if (existing) {
      await store.update('ac_identities', keyId, { lastUsedAt: now() });
    } else {
      await store.set('ac_identities', keyId, {
        uid: doc.uid,
        kind: 'wx',
        value: openid,
        createdAt: now(),
        lastUsedAt: now()
      });
    }

    const session = await issueSession(doc.uid, ctx, { appId: productId });
    const actorCtx = { ...ctx, uid: doc.uid };
    await audit('account.bind', productId, actorCtx, {
      title: '绑定微信小程序',
      source: 'product',
      productId,
      platform: 'miniprogram',
      detail: { method: 'mpBind', key: 'wx', tookOver, shellUid: shellUid || undefined }
    });
    await audit('auth.login', productId, actorCtx, {
      title: LOGIN_TITLES.mp,
      source: 'product',
      productId,
      platform: 'miniprogram',
      detail: { method: 'mpBind' }
    });

    return {
      ...session,
      isNew: false,
      bound: true,
      tookOver,
      nickname: (user && user.nickname) || '',
      avatar: (user && user.avatar) || ''
    };
  }

  const routes = {
    'auth.email.send': emailSend,
    'auth.email.verify': emailVerify,
    'auth.methods': authMethods,
    'auth.captcha': captchaIssue,
    'auth.sms.send': smsSend,
    'auth.sms.verify': smsVerify,
    'auth.accountCode.login': accountCodeLogin,
    'auth.mp.login': mpLogin,
    'auth.mp.bind': mpBind,
    'auth.code.start': codeStart,
    'auth.code.redeem': codeRedeem,
    'auth.qr.start': qrStart,
    'auth.qr.confirm': qrConfirm,
    'auth.qr.poll': qrPoll,
    'auth.ticket.issue': ticketIssue,
    'auth.ticket.redeem': ticketRedeem,
    'auth.oauth.providers': oauthProviders,
    'auth.oauth.start': oauthStart,
    'auth.oauth.exchange': oauthExchange,
    me,
    'me.products': meProducts,
    'product.theme': productTheme,
    'account.credential': accountCredential,
    'account.profile': accountProfile,
    'account.persona.options': accountPersonaOptions,
    'account.unbind': accountUnbind,
    'account.code.generate': accountCodeGenerate,
    'aikey.get': aiKeyGet,
    'aikey.save': aiKeySave,
    'aikey.clear': aiKeyClear,
    'aikey.reveal': aiKeyReveal,
    'aikey.test': aiKeyTest,
    'aikey.chat': aiKeyChat,
    'auth.logout': logout,
    'auth.logoutAll': logoutAll,
    'account.delete': accountDelete,
    track,
    'me.activity': meActivity,
    'me.activity.clear': meActivityClear
  };

  function parseBody(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw invalid('请求体不是合法 JSON');
    }
  }

  function normalizeHeaders(headers) {
    const result = {};
    for (const [key, value] of Object.entries(headers || {})) {
      result[String(key).toLowerCase()] = value;
    }
    return result;
  }

  function respond(http, status, payload, origin) {
    if (!http) return payload;

    const headers = { ...corsHeaders(origin) };
    if (payload !== null) headers['Content-Type'] = 'application/json; charset=utf-8';

    return {
      statusCode: status,
      headers,
      body: payload === null ? '' : JSON.stringify(payload)
    };
  }

  /** 页面与接口不同域时（CloudBase 静态托管 vs HTTP 访问服务）必须带 CORS */
  function corsHeaders(origin) {
    const list = Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins];
    const allowAll = list.includes('*');
    const allowed = allowAll ? '*' : list.includes(origin) ? origin : '';
    if (!allowed) return {};

    const headers = {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    };
    if (!allowAll) headers.Vary = 'Origin';
    return headers;
  }

  async function handle(event = {}, meta = {}) {
    const isHttp = Boolean(event.httpMethod);
    const method = String(event.httpMethod || 'POST').toUpperCase();
    const headers = normalizeHeaders(event.headers || meta.headers || {});
    const origin = String(headers.origin || '');

    if (isHttp && method === 'OPTIONS') {
      return respond(true, 204, null, origin);
    }
    if (isHttp && method !== 'POST') {
      return respond(true, 405, { ok: false, code: 'INVALID_PARAM', message: '只支持 POST' }, origin);
    }

    const authHeader = String(headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const clientIp = String(headers['x-forwarded-for'] || '').split(',')[0].trim() || meta.ip || '';

    const ctx = {
      token,
      uid: '',
      ua: headers['user-agent'] || '',
      ipHash: t.sha256(`${pepper}|ip|${clientIp}`)
    };

    try {
      const rawBody = event.isBase64Encoded && typeof event.body === 'string'
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;
      const body = isHttp ? parseBody(rawBody) : event;

      const action = String(body.action || '');
      const route = routes[action];
      if (!route) throw invalid(`不支持的 action：${action || '(空)'}`);

      const data = await route(body, ctx);
      return respond(isHttp, 200, { ok: true, data }, origin);
    } catch (err) {
      if (err instanceof AppError) {
        const payload = { ok: false, code: err.code, message: err.message };
        if (err.retryAfter) payload.retryAfter = err.retryAfter;
        return respond(isHttp, err.status, payload, origin);
      }
      logger.error('[accountCenter] 未处理异常', err);
      return respond(isHttp, 500, { ok: false, code: 'INTERNAL', message: '服务开小差了，请稍后再试' }, origin);
    }
  }

  return { handle, handleOAuthCallback, routes, cleanup };
}

module.exports = { createApp };
