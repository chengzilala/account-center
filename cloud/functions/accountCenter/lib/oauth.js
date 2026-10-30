'use strict';

/**
 * 第三方登录协议实现（GitHub / Gitee / Microsoft）。
 * 只负责「拼授权地址」与「code 换用户资料」，不碰会话与数据存储。
 */

const PROVIDERS = {
  github: {
    name: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    scope: 'read:user user:email'
  },
  gitee: {
    name: 'Gitee',
    authorizeUrl: 'https://gitee.com/oauth/authorize',
    scope: 'user_info'
  },
  microsoft: {
    name: 'Microsoft',
    authorizeUrl: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize',
    scope: 'openid profile email User.Read'
  }
};

const REQUEST_TIMEOUT = 10 * 1000;
const USER_AGENT = 'account-center/1.0';

function isKnownProvider(provider) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, provider);
}

function providerName(provider) {
  return (PROVIDERS[provider] || {}).name || provider;
}

/** 一次 HTTP 请求，统一超时与 JSON 解析；非 2xx 抛错（不把响应正文带进日志） */
async function fetchJson(fetchImpl, url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetchImpl(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (err) {
      data = null;
    }
    if (!res.ok) {
      const error = new Error(`HTTP ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function authorizeUrl(provider, { clientId, redirectUri, state, tenant }) {
  const meta = PROVIDERS[provider];
  const base = meta.authorizeUrl.replace('{tenant}', tenant || 'common');
  const url = new URL(base);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', meta.scope);
  url.searchParams.set('state', state);
  if (provider === 'microsoft') url.searchParams.set('response_mode', 'query');
  return url.toString();
}

async function githubProfile({ code, clientId, clientSecret, redirectUri, fetchImpl }) {
  const token = await fetchJson(fetchImpl, 'https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    })
  });
  if (!token || !token.access_token) throw new Error('github token 获取失败');

  const auth = { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json' };
  const user = await fetchJson(fetchImpl, 'https://api.github.com/user', { headers: auth });
  if (!user || !user.id) throw new Error('github 用户资料获取失败');

  // GitHub 默认不返回邮箱，且 email 可能为私有：单独查一次已验证邮箱
  let email = String(user.email || '').toLowerCase();
  let emailVerified = false;
  try {
    const list = await fetchJson(fetchImpl, 'https://api.github.com/user/emails', { headers: auth });
    if (Array.isArray(list)) {
      const hit = list.find((item) => item.primary && item.verified) || list.find((item) => item.verified);
      if (hit) {
        email = String(hit.email || '').toLowerCase();
        emailVerified = true;
      }
    }
  } catch (err) {
    // 没勾 user:email 或接口失败：不影响登录，只是拿不到邮箱
  }

  return {
    id: String(user.id),
    login: String(user.login || ''),
    name: String(user.name || user.login || ''),
    avatar: String(user.avatar_url || ''),
    email,
    emailVerified
  };
}

async function giteeProfile({ code, clientId, clientSecret, redirectUri, fetchImpl }) {
  const token = await fetchJson(fetchImpl, 'https://gitee.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri
    }).toString()
  });
  if (!token || !token.access_token) throw new Error('gitee token 获取失败');

  const user = await fetchJson(
    fetchImpl,
    `https://gitee.com/api/v5/user?access_token=${encodeURIComponent(token.access_token)}`
  );
  if (!user || !user.id) throw new Error('gitee 用户资料获取失败');

  const email = String(user.email || '').toLowerCase();
  return {
    id: String(user.id),
    login: String(user.login || ''),
    name: String(user.name || user.login || ''),
    avatar: String(user.avatar_url || ''),
    email,
    // Gitee 注册时已要求邮箱激活，返回的邮箱即可信
    emailVerified: Boolean(email)
  };
}

async function microsoftProfile({ code, clientId, clientSecret, redirectUri, tenant, fetchImpl }) {
  const token = await fetchJson(
    fetchImpl,
    `https://login.microsoftonline.com/${tenant || 'common'}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        scope: PROVIDERS.microsoft.scope
      }).toString()
    }
  );
  if (!token || !token.access_token) throw new Error('microsoft token 获取失败');

  const user = await fetchJson(
    fetchImpl,
    'https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName',
    { headers: { Authorization: `Bearer ${token.access_token}` } }
  );
  if (!user || !user.id) throw new Error('microsoft 用户资料获取失败');

  const email = String(user.mail || user.userPrincipalName || '').toLowerCase();
  return {
    id: String(user.id),
    login: String(user.userPrincipalName || ''),
    name: String(user.displayName || user.userPrincipalName || ''),
    avatar: '',
    email,
    // 企业 / 个人账户的邮箱由微软侧验证过
    emailVerified: Boolean(email)
  };
}

const PROFILES = {
  github: githubProfile,
  gitee: giteeProfile,
  microsoft: microsoftProfile
};

/** code 换第三方用户资料；失败抛错，由调用方转成页面提示 */
async function fetchProfile(provider, options) {
  const fn = PROFILES[provider];
  if (!fn) throw new Error('未知的登录方式');
  return fn(options);
}

/** 从环境变量读配置；没填的 provider 自动视为未启用 */
function configFromEnv(env = {}) {
  return {
    redirectBase: String(env.OAUTH_REDIRECT_BASE || '').replace(/\/+$/, ''),
    tenant: String(env.MICROSOFT_TENANT || 'common'),
    providers: {
      github: {
        clientId: String(env.GITHUB_CLIENT_ID || '').trim(),
        clientSecret: String(env.GITHUB_CLIENT_SECRET || '').trim()
      },
      gitee: {
        clientId: String(env.GITEE_CLIENT_ID || '').trim(),
        clientSecret: String(env.GITEE_CLIENT_SECRET || '').trim()
      },
      microsoft: {
        clientId: String(env.MICROSOFT_CLIENT_ID || '').trim(),
        clientSecret: String(env.MICROSOFT_CLIENT_SECRET || '').trim(),
        tenant: String(env.MICROSOFT_TENANT || 'common')
      }
    }
  };
}

module.exports = {
  PROVIDERS,
  isKnownProvider,
  providerName,
  authorizeUrl,
  fetchProfile,
  configFromEnv
};
