'use strict';

/**
 * 系统默认形象：给没设昵称 / 头像的新账户生成一套有趣但不重复的默认值。
 * 规则：同一 uid 永远得到同一套（方便各作品顶栏稳定显示），改了昵称或头像后不再覆盖。
 * 头像统一为「纸底 + 墨线 + 一个色块」的简笔画风格，和站点视觉一致。
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

const INK = '#1c1b19';
const PAPERS = ['#f6f1e6', '#f3ecdf', '#efe9db', '#f7f3ea'];
const ACCENTS = ['#d9482b', '#d95f3b', '#c8452a', '#e0a02c', '#6f5aa8', '#2f6f5e', '#3b6ea5'];

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

/** 随机昵称（用户点「随机形象」时用，不跟 uid 绑定） */
function randomNickname() {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return adjective + noun;
}

/** 简笔画头像：纸底 + 墨线人脸 + 服装色块，同一 seed 恒定 */
function avatarSvg(seed) {
  const paper = pick(PAPERS, seed);
  const accent = pick(ACCENTS, seed >>> 3);
  let second = pick(ACCENTS, seed >>> 7);
  if (second === accent) second = pick(ACCENTS, (seed >>> 7) + 3);

  const hair = (seed >>> 5) % 5;
  const hasGlasses = ((seed >>> 11) % 3) === 0;
  const eyes = hasGlasses ? 0 : (seed >>> 8) % 3;
  const mouth = (seed >>> 13) % 3;

  const parts = [];
  const line = (d, color, width, extra) => parts.push(
    `<path d="${d}" fill="none" stroke="${color || INK}" stroke-width="${width || 3}"`
    + ` stroke-linecap="round" stroke-linejoin="round"${extra || ''}/>`
  );

  parts.push(`<rect width="160" height="160" fill="${paper}"/>`);
  // 背景色块：只露在头肩之外的一角，保持简笔画留白
  parts.push(`<circle cx="${30 + ((seed >>> 17) % 4) * 7}" cy="${36 + ((seed >>> 19) % 4) * 6}"`
    + ` r="${34 + ((seed >>> 21) % 3) * 5}" fill="${second}" fill-opacity="0.9"/>`);

  // 肩与脖子（服装色块）
  parts.push(`<path d="M16 160c4-28 27-44 64-44s60 16 64 44z" fill="${accent}" stroke="${INK}" stroke-width="3"/>`);
  parts.push(`<path d="M70 104v12h20v-12" fill="${paper}" stroke="${INK}" stroke-width="3"/>`);

  // 头与耳朵
  parts.push(`<ellipse cx="80" cy="72" rx="32" ry="37" fill="${paper}" stroke="${INK}" stroke-width="3.2"/>`);
  line('M48 68c-5 1-6 9-1 12', INK, 2.6);
  line('M112 68c5 1 6 9 1 12', INK, 2.6);

  // 发型
  if (hair === 0) {
    parts.push(`<path d="M49 66c-2-25 12-40 31-40s33 15 31 40c-5-13-16-20-31-20s-26 7-31 20z" fill="${INK}"/>`);
  } else if (hair === 1) {
    parts.push(`<path d="M49 62c0-22 13-34 31-34s31 12 31 34c-8-14-17-21-31-21S57 48 49 62z" fill="${INK}"/>`);
    line('M80 30v16', paper, 2.4);
  } else if (hair === 2) {
    parts.push(`<g fill="${INK}"><circle cx="56" cy="50" r="12"/><circle cx="80" cy="38" r="14"/>`
      + `<circle cx="104" cy="50" r="12"/><circle cx="64" cy="34" r="9"/><circle cx="96" cy="34" r="9"/></g>`);
  } else if (hair === 3) {
    parts.push(`<path d="M52 48c0-14 12-24 28-24s28 10 28 24" fill="${accent}" stroke="${INK}" stroke-width="3"/>`);
    line('M46 48h68', INK, 4);
  } else {
    parts.push(`<path d="M48 58c0-19 14-31 32-31s32 12 32 31v40c-6 2-10-4-10-14V62c0-9-9-15-22-15s-22 6-22 15v22c0 10-4 16-10 14z" fill="${INK}"/>`);
  }

  // 眉毛与眼睛
  line('M62 59c3-2 7-2 10 0', INK, 2.4);
  line('M88 59c3-2 7-2 10 0', INK, 2.4);
  if (eyes === 0) {
    parts.push(`<circle cx="68" cy="72" r="2.9" fill="${INK}"/><circle cx="92" cy="72" r="2.9" fill="${INK}"/>`);
  } else if (eyes === 1) {
    line('M63 72h10M87 72h10', INK, 3);
  } else {
    line('M62 72c3 4 9 4 12 0M86 72c3 4 9 4 12 0', INK, 2.6);
  }
  if (hasGlasses) {
    parts.push(`<g fill="none" stroke="${INK}" stroke-width="2.4">`
      + '<rect x="57" y="63" width="22" height="18" rx="7"/><rect x="81" y="63" width="22" height="18" rx="7"/>'
      + '<path d="M79 70h2"/></g>');
  }

  // 腮红、鼻子、嘴
  parts.push(`<circle cx="57" cy="84" r="4.5" fill="${accent}" fill-opacity="0.45"/>`);
  parts.push(`<circle cx="103" cy="84" r="4.5" fill="${accent}" fill-opacity="0.45"/>`);
  line('M80 78v7', INK, 2.4);
  if (mouth === 0) {
    line('M72 92c4 5 12 5 16 0', INK, 2.8);
  } else if (mouth === 1) {
    line('M73 93h14', INK, 2.8);
  } else {
    parts.push(`<circle cx="80" cy="93" r="3.4" fill="${INK}"/>`);
  }

  return '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">'
    + parts.join('') + '</svg>';
}

function toDataUrl(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** 默认头像：跟着 uid 固定，不随刷新变化 */
function generateAvatar(uid) {
  return toDataUrl(avatarSvg(hash(`${uid}:avatar`)));
}

/** 随机头像：不属于某个 uid，需要临时换一个时用 */
function randomAvatar() {
  return toDataUrl(avatarSvg(Math.floor(Math.random() * 4294967296)));
}

/** 生成一批候选（名称尽量不重复），首次调用后由调用方落库复用 */
function buildPool(nameCount, avatarCount) {
  const nicknames = [];
  const seenNames = new Set();
  for (let i = 0; i < nameCount * 20 && nicknames.length < nameCount; i += 1) {
    const name = randomNickname();
    if (seenNames.has(name)) continue;
    seenNames.add(name);
    nicknames.push(name);
  }

  const avatars = [];
  const seenAvatars = new Set();
  for (let i = 0; i < avatarCount * 20 && avatars.length < avatarCount; i += 1) {
    const avatar = randomAvatar();
    if (seenAvatars.has(avatar)) continue;
    seenAvatars.add(avatar);
    avatars.push(avatar);
  }

  return { nicknames, avatars };
}

module.exports = { generateNickname, generateAvatar, randomNickname, randomAvatar, buildPool };
