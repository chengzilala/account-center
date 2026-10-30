'use strict';

/**
 * 系统默认形象：给没设昵称 / 头像的新账户生成一套有趣但不重复的默认值。
 * 规则：同一 uid 永远得到同一套（方便各作品顶栏稳定显示），改了昵称或头像后不再覆盖。
 */

const ADJECTIVES = [
  '好奇的', '不困的', '爱发呆的', '会发光的', '薄荷味的', '橘子味的',
  '半糖的', '听风的', '数星星的', '慢半拍的', '爱跑步的', '爱笑的',
  '会游泳的', '夜行的', '晨跑的', '周末的', '刚睡醒的', '爱喝汤的',
  '会变身的', '住在云里的', '口袋里的', '凌晨四点的', '戴围巾的', '迷路的'
];

const NOUNS = [
  '橘子', '海豚', '云朵', '猫', '鲸鱼', '兔子',
  '小熊', '狐狸', '月亮', '柚子', '蒲公英', '萤火虫',
  '树懒', '水母', '松鼠', '企鹅', '麦子', '风铃',
  '灯塔', '蘑菇', '汤圆', '刺猬', '浣熊', '小鹿'
];

const EMOJIS = [
  '🦊', '🐳', '🐰', '🐻', '🌙', '🍊',
  '🪼', '🦔', '🐧', '🦌', '🐿️', '🌻',
  '🍄', '🦋', '🐢', '🐨', '🌵', '🍉',
  '🪐', '🦉', '🐙', '🌸', '🧋', '🐋'
];

const PALETTES = [
  ['#FFA07A', '#FF6B81'],
  ['#7ED6DF', '#22A6B3'],
  ['#F6D365', '#FDA085'],
  ['#A29BFE', '#6C5CE7'],
  ['#55EFC4', '#00B894'],
  ['#FD79A8', '#E84393'],
  ['#FAB1A0', '#E17055'],
  ['#74B9FF', '#0984E3'],
  ['#FFEAA7', '#FDCB6E'],
  ['#81ECEC', '#00CEC9'],
  ['#B2BEC3', '#636E72'],
  ['#C7ECEE', '#6C5CE7']
];

/** FNV-1a：同一 uid 稳定得到同一组下标 */
function hash(text) {
  let value = 2166136261;
  const str = String(text || '');
  for (let i = 0; i < str.length; i += 1) {
    value ^= str.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function pick(list, seed) {
  return list[seed % list.length];
}

/** 有趣的默认昵称，如「半糖的海豚」「戴围巾的企鹅」，最长 20 字以内 */
function generateNickname(uid) {
  const seed = hash(`${uid}:nickname`);
  const adjective = pick(ADJECTIVES, seed);
  const noun = pick(NOUNS, seed >>> 8);
  return adjective + noun;
}

/** 默认头像：渐变底 + 大 emoji，直接转成 SVG dataURL 存进账户 */
function generateAvatar(uid) {
  const seed = hash(`${uid}:avatar`);
  const emoji = pick(EMOJIS, seed);
  const [from, to] = pick(PALETTES, seed >>> 8);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">'
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`
    + '<rect width="160" height="160" rx="80" fill="url(#g)"/>'
    + '<circle cx="38" cy="36" r="26" fill="#ffffff" fill-opacity="0.16"/>'
    + '<circle cx="126" cy="120" r="34" fill="#ffffff" fill-opacity="0.12"/>'
    + `<text x="80" y="82" font-size="72" text-anchor="middle" dominant-baseline="central">${emoji}</text>`
    + '</svg>';
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

module.exports = { generateNickname, generateAvatar };
