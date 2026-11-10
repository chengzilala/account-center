'use strict';

/**
 * 本地调试入口（不用于生产）：
 *   node cloud/functions/accountCenter/dev-server.js
 * 然后用 curl 或页面 POST http://localhost:8942/accountCenter
 *
 * 开发模式下验证码直接打印在终端；正式环境必须换成真实邮件通道。
 */

const http = require('http');
const path = require('path');
const { createApp } = require('./app');
const { createJsonStore } = require('./lib/store-json');
const { createSmsFromEnv, createConsoleSms } = require('./lib/sms');
const oauthLib = require('./lib/oauth');

const PORT = Number(process.env.PORT || 8942);
const PEPPER = process.env.TOKEN_PEPPER || 'dev-only-pepper';
const DATA_FILE = path.join(__dirname, '.data', 'store.json');

if (!process.env.TOKEN_PEPPER) {
  console.warn('[accountCenter] 未设置 TOKEN_PEPPER，正在使用开发默认值（重启后登录态全部失效）');
}

const store = createJsonStore(DATA_FILE);

// 本地默认走控制台短信（验证码打印在终端）；配了阿里云密钥就走真实短信
const sms = createSmsFromEnv(process.env) || createConsoleSms();

const app = createApp({
  store,
  pepper: PEPPER,
  sendMail: async ({ to, code }) => {
    console.log(`[accountCenter][dev-mail] 发给 ${to} 的验证码：${code}（10 分钟内有效）`);
  },
  sms,
  oauth: oauthLib.configFromEnv(process.env),
  // 本机调试用默认密钥；线上必须走环境变量 MP_SHARED_SECRET
  mp: { sharedSecret: process.env.MP_SHARED_SECRET || 'dev-only-mp-secret' }
});

const OAUTH_CALLBACK = /^\/oauth\/([a-z]+)\/callback$/;

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && requestUrl.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const callback = requestUrl.pathname.match(OAUTH_CALLBACK);
  if (req.method === 'GET' && callback) {
    const query = Object.fromEntries(requestUrl.searchParams.entries());
    const result = await app.handleOAuthCallback(callback[1], query, {
      ip: req.socket.remoteAddress || '',
      headers: req.headers
    });
    res.writeHead(result.statusCode, result.headers);
    res.end(result.body || '');
    return;
  }

  if (requestUrl.pathname !== '/accountCenter' || (req.method !== 'POST' && req.method !== 'OPTIONS')) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND', message: '只支持 POST /accountCenter' }));
    return;
  }

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 100 * 1024) req.destroy();
  });
  req.on('end', async () => {
    const result = await app.handle(
      {
        httpMethod: req.method,
        headers: req.headers,
        body: raw
      },
      { ip: req.socket.remoteAddress || '' }
    );
    res.writeHead(result.statusCode, result.headers);
    res.end(result.body);
  });
});

server.listen(PORT, () => {
  console.log(`[accountCenter] 本地服务已启动：http://localhost:${PORT}/accountCenter`);
  console.log(`[accountCenter] 数据文件：${DATA_FILE}`);
});

// 行为记录留存 90 天：启动清一次，之后每天一次
app.cleanup().catch((err) => console.error('[accountCenter] 启动清理失败', err));
setInterval(() => {
  app.cleanup().catch((err) => console.error('[accountCenter] 定时清理失败', err));
}, 24 * 60 * 60 * 1000).unref();
