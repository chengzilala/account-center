'use strict';

const crypto = require('crypto');

function randomHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** uid = u_ + 16 位小写十六进制 */
function newUid() {
  return `u_${randomHex(8)}`;
}

/** 对外 Token：32 字节随机数，base64url，不含任何用户信息 */
function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function newSid() {
  return randomHex(16);
}

function newSixDigitCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function hashToken(token, pepper) {
  return sha256(`${pepper}|token|${token}`);
}

function hashCode(code, pepper) {
  return sha256(`${pepper}|code|${code}`);
}

/** 跨域票据：32 位十六进制，一次一用；服务端只存哈希 */
function newTicket() {
  return randomHex(16);
}

function hashTicket(ticket, pepper) {
  return sha256(`${pepper}|ticket|${ticket}`);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

module.exports = {
  randomHex,
  newUid,
  newToken,
  newSid,
  newSixDigitCode,
  sha256,
  hashToken,
  hashCode,
  newTicket,
  hashTicket,
  safeEqual
};
