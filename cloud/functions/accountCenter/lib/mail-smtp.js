'use strict';

const nodemailer = require('nodemailer');

/**
 * SMTP 发信（QQ 邮箱 / 163 / 腾讯云邮件推送 都可）。
 * 环境变量：SMTP_HOST、SMTP_PORT、SMTP_SECURE、SMTP_USER、SMTP_PASS、MAIL_FROM
 * 未配置完整时返回 null，由入口决定如何报错。
 */
function createSmtpSender(env = process.env) {
  const host = String(env.SMTP_HOST || '').trim();
  const port = Number(env.SMTP_PORT || 465);
  const user = String(env.SMTP_USER || '').trim();
  const pass = String(env.SMTP_PASS || '');

  if (!host || !user || !pass || !Number.isFinite(port)) return null;

  const secureFlag = String(env.SMTP_SECURE || '');
  const secure = secureFlag ? secureFlag.toLowerCase() === 'true' : port === 465;
  const from = String(env.MAIL_FROM || user).trim();

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });

  return async ({ to, code }) => {
    await transporter.sendMail({
      from,
      to,
      subject: `【账户中心】登录验证码 ${code}`,
      text: `你的登录验证码是 ${code}，10 分钟内有效。\n如果不是你本人操作，请忽略这封邮件。`,
      html: [
        '<p>你的登录验证码是</p>',
        `<p style="font-size:24px;letter-spacing:4px;font-weight:700">${code}</p>`,
        '<p>10 分钟内有效。如果不是你本人操作，请忽略这封邮件。</p>'
      ].join('')
    });
  };
}

module.exports = { createSmtpSender };
