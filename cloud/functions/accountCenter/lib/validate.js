'use strict';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isEmail(value) {
  const email = String(value || '');
  return email.length > 3 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeAccountCode(value) {
  return String(value || '').trim().toLowerCase();
}

/** 账户码 = 32 位十六进制（与微信悦读现有账户码同构） */
function isAccountCode(value) {
  return /^[0-9a-f]{32}$/.test(String(value || ''));
}

function isSixDigit(value) {
  return /^\d{6}$/.test(String(value || ''));
}

/** 手机号统一成 11 位数字（去掉 +86 / 空格 / 横线） */
function normalizePhone(value) {
  return String(value || '').replace(/[\s-]/g, '').replace(/^\+?86/, '');
}

/** 首期只支持中国大陆手机号 */
function isChinaPhone(value) {
  return /^1[3-9]\d{9}$/.test(String(value || ''));
}

function maskPhone(phone) {
  const value = String(phone || '');
  if (value.length !== 11) return '····';
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!domain) return '';
  return `${(name || '').slice(0, 1)}***@${domain}`;
}

function maskAccountCode(code) {
  const value = String(code || '');
  if (value.length <= 8) return '····';
  return `${value.slice(0, 4)}····${value.slice(-4)}`;
}

module.exports = {
  normalizeEmail,
  isEmail,
  normalizeAccountCode,
  isAccountCode,
  isSixDigit,
  normalizePhone,
  isChinaPhone,
  maskPhone,
  maskEmail,
  maskAccountCode
};
