'use strict';

/**
 * 短信通道（发验证码 + 校验验证码）。
 *
 * 默认接阿里云「号码认证服务 → 短信认证」：
 *   - 个人实名账号即可用，无需自建签名与模板（用系统预置的）
 *   - 校验接口免费，发送按运营商回执计费
 *   - 环境变量：ALIYUN_SMS_ACCESS_KEY_ID / ALIYUN_SMS_ACCESS_KEY_SECRET
 *               ALIYUN_SMS_SIGN_NAME / ALIYUN_SMS_TEMPLATE_CODE
 *
 * 对外只暴露 send(phone) / check(phone, code)，换服务商只改这个文件。
 * 未配置完整时 createSmsFromEnv 返回 null，页面入口自动隐藏。
 */

const CODE_TTL_SECONDS = 600;

function createAliyunSms({ accessKeyId, accessKeySecret, signName, templateCode, endpoint }) {
  // 懒加载：没配短信密钥的部署环境不装这几个包，也不能因此启动失败
  const Dypnsapi = require('@alicloud/dypnsapi20170525');
  const { $OpenApiUtil } = require('@alicloud/openapi-core');
  const { RuntimeOptions } = require('@darabonba/typescript');

  const client = new Dypnsapi.default(new $OpenApiUtil.Config({
    accessKeyId,
    accessKeySecret,
    endpoint: endpoint || 'dypnsapi.aliyuncs.com'
  }));
  const runtime = new RuntimeOptions({ connectTimeout: 10000, readTimeout: 15000 });

  return {
    provider: 'aliyun',

    async send(phone) {
      const res = await client.sendSmsVerifyCodeWithOptions(
        new Dypnsapi.SendSmsVerifyCodeRequest({
          phoneNumber: `86${phone}`,
          signName,
          templateCode,
          templateParam: '{"code":"##code##"}',
          codeLength: 6,
          codeType: 1,
          validTime: CODE_TTL_SECONDS,
          interval: 60,
          duplicatePolicy: 1,
          returnVerifyCode: false
        }),
        runtime
      );

      const body = res && res.body;
      if (!body || body.success !== true || body.code !== 'OK') {
        const detail = body ? `${body.code || ''} ${body.message || ''}`.trim() : '空响应';
        throw new Error(`短信发送失败：${detail}`);
      }
    },

    async check(phone, code) {
      const res = await client.checkSmsVerifyCodeWithOptions(
        new Dypnsapi.CheckSmsVerifyCodeRequest({
          phoneNumber: `86${phone}`,
          verifyCode: code,
          countryCode: '86',
          caseAuthPolicy: 1
        }),
        runtime
      );

      const body = res && res.body;
      if (!body || body.success !== true || body.code !== 'OK') {
        const detail = body ? `${body.code || ''} ${body.message || ''}`.trim() : '空响应';
        throw new Error(`验证码校验失败：${detail}`);
      }
      return Boolean(body.model && body.model.verifyResult === 'PASS');
    }
  };
}

/** 本地调试用：验证码打印在终端，存在内存里，重启即失效 */
function createConsoleSms({ logger = console, ttlSeconds = CODE_TTL_SECONDS } = {}) {
  const codes = new Map();

  return {
    provider: 'console',
    async send(phone) {
      const code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
      codes.set(phone, { code, expiresAt: Date.now() + ttlSeconds * 1000 });
      logger.log(`[accountCenter][dev-sms] 发给 ${phone} 的验证码：${code}（10 分钟内有效）`);
    },
    async check(phone, code) {
      const item = codes.get(phone);
      if (!item) return false;
      if (item.expiresAt <= Date.now()) {
        codes.delete(phone);
        return false;
      }
      if (item.code !== code) return false;
      codes.delete(phone);
      return true;
    }
  };
}

function createSmsFromEnv(env = process.env) {
  const accessKeyId = String(env.ALIYUN_SMS_ACCESS_KEY_ID || '').trim();
  const accessKeySecret = String(env.ALIYUN_SMS_ACCESS_KEY_SECRET || '').trim();
  const signName = String(env.ALIYUN_SMS_SIGN_NAME || '').trim();
  const templateCode = String(env.ALIYUN_SMS_TEMPLATE_CODE || '').trim();

  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) return null;

  try {
    return createAliyunSms({
      accessKeyId,
      accessKeySecret,
      signName,
      templateCode,
      endpoint: String(env.ALIYUN_SMS_ENDPOINT || '').trim() || undefined
    });
  } catch (err) {
    console.warn('[accountCenter] 短信通道初始化失败，已跳过（不影响启动）：', err.message);
    return null;
  }
}

module.exports = { createSmsFromEnv, createConsoleSms, CODE_TTL_SECONDS };
