'use strict';

/**
 * 在 ac_products 登记 / 更新一个作品（跨域登录、「我的装置」、登录页配色都靠它）。
 *
 * 用法：
 *   node tools/register-product.js <appId> <名称> [站点地址] [light|dark] [#rrggbb]
 *
 * 例（本机联调）：
 *   node tools/register-product.js personal-site 个人网站 http://localhost:5181
 *
 * 例（深色作品，登录页跟着变深色 + 主色）：
 *   node tools/register-product.js 微信悦读 微信悦读 https://reader.example.com dark '#2b2b2b'
 *
 * 例（上线后）：
 *   DATA_FILE=/var/lib/account-center/store.json \
 *   node tools/register-product.js personal-site 个人网站 https://chesterlee.cn light
 *
 * 不传主题 / 强调色时保留已登记的值；登记后登录页会按 productId 自动取用，作品代码零改动。
 * 注意：dev-server / server.js 会把数据读进内存，登记后需重启服务才生效。
 */

const path = require('path');
const { createJsonStore } = require('../cloud/functions/accountCenter/lib/store-json');

const [appId, name, url, themeArg, accentArg] = process.argv.slice(2);

if (!appId || !name) {
  console.error('用法：node tools/register-product.js <appId> <名称> [站点地址] [light|dark] [#rrggbb]');
  process.exit(1);
}

const theme = String(themeArg || '').toLowerCase();
if (theme && theme !== 'light' && theme !== 'dark') {
  console.error(`主题只能是 light 或 dark：${themeArg}`);
  process.exit(1);
}

const accent = String(accentArg || '').trim();
if (accent && !/^#[0-9a-f]{6}$/i.test(accent)) {
  console.error(`强调色要写成 #rrggbb：${accentArg}`);
  process.exit(1);
}

if (url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    console.error(`站点地址不是合法网址：${url}`);
    process.exit(1);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    console.error('站点地址只支持 http(s)');
    process.exit(1);
  }
}

const dataFile = process.env.DATA_FILE
  || path.join(__dirname, '..', 'cloud', 'functions', 'accountCenter', '.data', 'store.json');

const store = createJsonStore(dataFile);

(async () => {
  const existing = await store.get('ac_products', appId);
  await store.set('ac_products', appId, {
    appId,
    name,
    url: url || (existing && existing.url) || '',
    theme: theme || (existing && existing.theme) || 'light',
    accent: accent || (existing && existing.accent) || '',
    status: 'active',
    createdAt: (existing && existing.createdAt) || Date.now()
  });
  console.log(`[products] ${existing ? '已更新' : '已登记'}：${appId} / ${name}${url ? ' / ' + url : ''}`);
  console.log(`[products] 登录页配色：${theme || (existing && existing.theme) || 'light'}${accent ? ' / ' + accent : ''}`);
  console.log(`[products] 数据文件：${dataFile}`);
})();
