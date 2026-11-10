'use strict';

const fs = require('fs');
const path = require('path');

const COLLECTIONS = [
  'ac_users',
  'ac_identities',
  'ac_sessions',
  'ac_login_codes',
  'ac_qr_codes',
  'ac_products',
  'ac_entitlements',
  'ac_audit_logs',
  'ac_ai_keys',
  'ac_persona_pool'
];

/**
 * 本地 / 单机用的 JSON 文件存储。
 * 个人规模（几百个用户）足够；每次写入用「临时文件 + 重命名」保证不写坏。
 */
function createJsonStore(filePath) {
  const data = {};
  for (const name of COLLECTIONS) data[name] = {};

  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = raw.trim() ? JSON.parse(raw) : {};
    for (const name of COLLECTIONS) {
      if (parsed[name] && typeof parsed[name] === 'object') data[name] = parsed[name];
    }
  }

  function flush() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  }

  function column(name) {
    if (!data[name]) throw new Error(`未知集合：${name}`);
    return data[name];
  }

  return {
    async get(name, id) {
      return column(name)[id] || null;
    },

    async set(name, id, doc) {
      const next = { ...doc, _id: id };
      column(name)[id] = next;
      flush();
      return next;
    },

    async update(name, id, patch) {
      const current = column(name)[id];
      if (!current) return null;
      const next = { ...current, ...patch, _id: id };
      column(name)[id] = next;
      flush();
      return next;
    },

    async remove(name, id) {
      const existed = Boolean(column(name)[id]);
      delete column(name)[id];
      if (existed) flush();
      return existed;
    },

    /** 只支持等值条件（与云数据库 where 的能力对齐） */
    async query(name, where = {}, limit = 100) {
      const keys = Object.keys(where);
      const rows = Object.values(column(name)).filter((doc) =>
        keys.every((key) => doc[key] === where[key])
      );
      return rows.slice(0, limit);
    }
  };
}

module.exports = { createJsonStore, COLLECTIONS };
