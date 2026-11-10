'use strict';

const crypto = require('crypto');

/**
 * AI Key 加密存放：AES-256-GCM。
 *
 * 只在服务端使用：明文 Key 不落盘、不进日志、不回给任何页面（除非用户点「显示」）。
 * secret 默认由 TOKEN_PEPPER 派生；也可用 AI_KEY_SECRET 单独指定。
 * 一旦 secret 变化，已托管的 Key 全部失效（用户需要重新填写），所以不要随意更换。
 */
function createKeyVault({ secret }) {
  const key = crypto.createHash('sha256').update(String(secret || '')).digest();

  return {
    /** 加密成 iv.tag.body 的 base64 串，可直接存 JSON */
    seal(plain) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
      return [
        iv.toString('base64'),
        cipher.getAuthTag().toString('base64'),
        body.toString('base64')
      ].join('.');
    },

    /** 解不开（被篡改 / secret 换过）一律返回空串，由调用方按「没有 Key」处理 */
    open(value) {
      try {
        const [ivB64, tagB64, bodyB64] = String(value || '').split('.');
        if (!ivB64 || !tagB64 || !bodyB64) return '';
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(bodyB64, 'base64')), decipher.final()]).toString('utf8');
      } catch (err) {
        return '';
      }
    },

    /** 只回掩码：前 6 位 + …… + 后 4 位；太短一律 **** */
    mask(value) {
      const k = String(value || '');
      if (!k) return '';
      if (k.length <= 10) return '****';
      return `${k.slice(0, 6)}……${k.slice(-4)}`;
    }
  };
}

module.exports = { createKeyVault };
