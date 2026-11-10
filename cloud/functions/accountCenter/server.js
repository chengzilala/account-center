'use strict';

/**
 * 生产入口（单机服务器 / 容器）：
 *   TOKEN_PEPPER=... SMTP_HOST=... SMTP_USER=... SMTP_PASS=... node server.js
 * 前置：npm install（安装 nodemailer）
 *
 * 签发的接口：POST /accountCenter，健康检查：GET /healthz
 */

const http = require('http');
const path = require('path');
const { createApp } = require('./app');
const { createJsonStore } = require('./lib/store-json');
const { createSmtpSender } = require('./lib/mail-smtp');
const { createSmsFromEnv } = require('./lib/sms');
const oauthLib = require('./lib/oauth');

const PORT = Number(process.env.PORT || 8940);
const PEPPER = String(process.env.TOKEN_PEPPER || '');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'store.json');
const MAX_BODY_BYTES = 100 * 1024;

if (!PEPPER) {
  console.error('[accountCenter] 缺少 TOKEN_PEPPER，拒绝启动');
  process.exit(1);
}

const sendMail = createSmtpSender(process.env);
if (!sendMail) {
  console.error('[accountCenter] SMTP 未配置，拒绝启动（检查 SMTP_HOST / SMTP_USER / SMTP_PASS）');
  process.exit(1);
}

// 短信是可选登录方式：没配齐就不显示手机号入口，不影响其他登录
const sms = createSmsFromEnv(process.env);
if (!sms) {
  console.warn('[accountCenter] 短信未配置，手机号登录不会出现在页面上');
}

const app = createApp({
  store: createJsonStore(DATA_FILE),
  pepper: PEPPER,
  sendMail,
  sms,
  allowedOrigins: String(process.env.ALLOWED_ORIGINS || '*')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  oauth: oauthLib.configFromEnv(process.env),
  // 小程序登录：与 wereadProxy 云函数共享的签名密钥；没配就不开放该方式
  mp: { sharedSecret: process.env.MP_SHARED_SECRET || '' },
  // AI Key 加密密钥：不填则由 TOKEN_PEPPER 派生；填了以后不可再改（改了已托管的 Key 全部失效）
  aiKey: { secret: process.env.AI_KEY_SECRET || '' }
});

const OAUTH_CALLBACK = /^\/oauth\/([a-z]+)\/callback$/;

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && requestUrl.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // 第三方登录回调是浏览器 GET 跳转，不走 POST /accountCenter
  const callback = requestUrl.pathname.match(OAUTH_CALLBACK);
  if (req.method === 'GET' && callback) {
    try {
      const query = Object.fromEntries(requestUrl.searchParams.entries());
      const result = await app.handleOAuthCallback(callback[1], query, {
        ip: req.socket.remoteAddress || '',
        headers: req.headers
      });
      res.writeHead(result.statusCode, result.headers);
      res.end(result.body || '');
    } catch (err) {
      console.error('[accountCenter] 第三方回调处理失败', err);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('第三方登录失败，请返回账户中心重试');
    }
    return;
  }

  if (requestUrl.pathname !== '/accountCenter' || (req.method !== 'POST' && req.method !== 'OPTIONS')) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND', message: '只支持 POST /accountCenter' }));
    return;
  }

  let raw = '';
  let tooLarge = false;
  req.on('data', (chunk) => {
    if (tooLarge) return;
    raw += chunk;
    if (raw.length > MAX_BODY_BYTES) {
      tooLarge = true;
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, code: 'INVALID_PARAM', message: '请求内容过长' }));
      req.destroy();
    }
  });
  req.on('end', async () => {
    if (tooLarge) return;
    try {
      const result = await app.handle(
        { httpMethod: req.method, headers: req.headers, body: raw },
        { ip: req.socket.remoteAddress || '' }
      );
      res.writeHead(result.statusCode, result.headers);
      res.end(result.body);
    } catch (err) {
      console.error('[accountCenter] 请求处理失败', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, code: 'INTERNAL', message: '服务开小差了，请稍后再试' }));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[accountCenter] 服务已启动：http://127.0.0.1:${PORT}/accountCenter`);
  console.log(`[accountCenter] 数据文件：${DATA_FILE}`);
});

// 行为记录留存 90 天：启动清一次，之后每天一次
app.cleanup().catch((err) => console.error('[accountCenter] 启动清理失败', err));
setInterval(() => {
  app.cleanup().catch((err) => console.error('[accountCenter] 定时清理失败', err));
}, 24 * 60 * 60 * 1000).unref();

function shutdown(signal) {
  console.log(`[accountCenter] 收到 ${signal}，正在关闭`);
  server.close(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
