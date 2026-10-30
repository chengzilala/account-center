'use strict';

/**
 * 图形验证码（发短信前的一道减速带）。
 * 每次 4 位数字，2 分钟内有效、一次性；答案只存哈希。
 * 字形用 5x7 点阵画成 SVG 方块，SVG 里没有文字节点，避免被直接读取。
 */

const t = require('./token');

const WIDTH = 152;
const HEIGHT = 60;
const SCALE = 5;
const CHAR_GAP = 11;
const TTL = 2 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/* 5x7 点阵：1 为实心 */
const FONT = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100']
};

const INK = ['#121212', '#3f3a32', '#5b5247'];

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function renderSvg(answer) {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="图形验证码">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#f7f3ea"/>`
  ];

  // 干扰线
  for (let i = 0; i < 3; i += 1) {
    parts.push(
      `<path d="M${randomInt(0, WIDTH)} ${randomInt(0, HEIGHT)} Q${randomInt(0, WIDTH)} ${randomInt(0, HEIGHT)} ${randomInt(0, WIDTH)} ${randomInt(0, HEIGHT)}" fill="none" stroke="${INK[i % INK.length]}" stroke-opacity="0.25" stroke-width="1"/>`
    );
  }

  // 干扰点
  for (let i = 0; i < 28; i += 1) {
    parts.push(
      `<rect x="${randomInt(0, WIDTH)}" y="${randomInt(0, HEIGHT)}" width="2" height="2" fill="${INK[randomInt(0, INK.length - 1)]}" fill-opacity="0.3"/>`
    );
  }

  // 字符：每个点画成一个方块
  answer.split('').forEach((char, index) => {
    const glyph = FONT[char];
    const x = 12 + index * (5 * SCALE + CHAR_GAP) + randomInt(-2, 2);
    const y = 12 + randomInt(-2, 2);
    const angle = randomInt(-10, 10);
    const ink = INK[randomInt(0, INK.length - 1)];

    parts.push(`<g transform="translate(${x} ${y}) rotate(${angle} ${2.5 * SCALE} ${3.5 * SCALE})" fill="${ink}">`);
    glyph.forEach((row, rowIndex) => {
      row.split('').forEach((bit, colIndex) => {
        if (bit !== '1') return;
        parts.push(
          `<rect x="${colIndex * SCALE}" y="${rowIndex * SCALE}" width="${SCALE - 1}" height="${SCALE - 1}"/>`
        );
      });
    });
    parts.push('</g>');
  });

  parts.push('</svg>');
  return parts.join('');
}

function createCaptcha({ store, pepper, now = Date.now, ttl = TTL }) {
  async function issue() {
    const answer = String(randomInt(0, 9999)).padStart(4, '0');
    const id = t.randomHex(12);

    await store.set('ac_login_codes', `captcha:${id}`, {
      kind: 'captcha',
      answerHash: t.hashCode(answer, pepper),
      expiresAt: now() + ttl,
      used: false,
      attempts: 0,
      createdAt: now()
    });

    return { id, svg: renderSvg(answer), expiresIn: ttl / 1000 };
  }

  /** 一次性消费；答案不对返回 false，错误 5 次作废 */
  async function consume(id, answer) {
    const key = String(id || '').trim();
    if (!/^[0-9a-f]{24}$/.test(key)) return false;

    const docId = `captcha:${key}`;
    const doc = await store.get('ac_login_codes', docId);
    if (!doc || doc.used || doc.expiresAt <= now() || (doc.attempts || 0) >= MAX_ATTEMPTS) return false;

    const value = String(answer || '').trim();
    if (!/^\d{4}$/.test(value) || !t.safeEqual(t.hashCode(value, pepper), doc.answerHash)) {
      const attempts = (doc.attempts || 0) + 1;
      await store.update('ac_login_codes', docId, { attempts, used: attempts >= MAX_ATTEMPTS });
      return false;
    }

    await store.update('ac_login_codes', docId, { used: true });
    return true;
  }

  return { issue, consume };
}

module.exports = { createCaptcha };
