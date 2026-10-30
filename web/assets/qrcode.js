/**
 * 纯本地二维码生成（零依赖 · 无外部库 · 无 CDN）
 *
 * 用途：把「账户中心登录链接」编成二维码，画进账户凭证图片。
 * 手机相机扫码后直接打开登录页并自动填好邮箱，用户不用再手抄。
 *
 * 实现范围（只服务本场景，不追求通用）：ISO/IEC 18004
 *   - 字节模式（Byte mode）
 *   - 纠错级别 M，按内容长度自动选版本 V3–V6
 *     V3 29×29（数据 44 码字）/ V4 33×33（64）/ V5 37×37（86）/ V6 41×41（108）
 *   - 多块时按标准交织数据码字与纠错码字
 *   - 从 8 种掩码里按标准罚分择优
 *   - 输出 0/1 模块矩阵，由调用方自己画（Canvas / SVG）
 *
 * 若将来需要更大容量 / 其它纠错级别，请另开实现，不要在此硬塞。
 */
(function () {
  'use strict';

  var VERSIONS = {
    3: { size: 29, blocks: 1, dataPerBlock: 44, ecPerBlock: 26 },
    4: { size: 33, blocks: 2, dataPerBlock: 32, ecPerBlock: 18 },
    5: { size: 37, blocks: 2, dataPerBlock: 43, ecPerBlock: 24 },
    6: { size: 41, blocks: 4, dataPerBlock: 27, ecPerBlock: 16 }
  };
  var VERSION_LIST = [3, 4, 5, 6];
  var EC_LEVEL_FORMAT_BITS = 0; // 纠错级别 M 的格式信息位
  var PAD_BYTES = [0xec, 0x11];

  function capacityOf(cfg) {
    return cfg.blocks * cfg.dataPerBlock - 2;
  }

  /* ------------------------------------------------------------ GF(256) */

  var GF_EXP = new Uint8Array(512);
  var GF_LOG = new Uint8Array(256);
  (function initGaloisField() {
    var x = 1;
    for (var i = 0; i < 255; i += 1) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j += 1) GF_EXP[j] = GF_EXP[j - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  /** 生成多项式 g(x) = (x-α⁰)(x-α¹)…(x-α^{deg-1}) */
  function rsGenPoly(deg) {
    var poly = [1];
    for (var i = 0; i < deg; i += 1) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j += 1) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  /** Reed-Solomon：对一块数据码字求 deg 个纠错码字 */
  function rsEncode(data, deg) {
    var gen = rsGenPoly(deg);
    var res = new Array(deg).fill(0);
    for (var i = 0; i < data.length; i += 1) {
      var factor = data[i] ^ res[0];
      res.shift();
      res.push(0);
      if (factor !== 0) {
        for (var j = 0; j < deg; j += 1) res[j] ^= gfMul(gen[j + 1], factor);
      }
    }
    return res;
  }

  /* ---------------------------------------------------------- 数据编码 */

  /** UTF-8 字节序列 */
  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i += 1) {
      var cp = str.codePointAt(i);
      if (cp > 0xffff) i += 1; // 跳过代理对低位
      if (cp < 0x80) {
        out.push(cp);
      } else if (cp < 0x800) {
        out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      } else if (cp < 0x10000) {
        out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else {
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 63),
          0x80 | ((cp >> 6) & 63),
          0x80 | (cp & 63)
        );
      }
    }
    return out;
  }

  /** 文本 → 数据码字（字节模式 + 终止符 + 补位），按版本补足总长 */
  function buildDataCodewords(bytes, cfg) {
    var totalData = cfg.blocks * cfg.dataPerBlock;
    var capacityBits = totalData * 8;

    var bits = [];
    function push(value, len) {
      for (var i = len - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
    }

    push(0b0100, 4); // 字节模式
    push(bytes.length, 8); // 字符数（V3–V6 用 8 位）
    for (var i = 0; i < bytes.length; i += 1) push(bytes[i], 8);

    var terminator = Math.min(4, capacityBits - bits.length);
    for (var t = 0; t < terminator; t += 1) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    var out = [];
    for (var b = 0; b < bits.length; b += 8) {
      var value = 0;
      for (var k = 0; k < 8; k += 1) value = (value << 1) | bits[b + k];
      out.push(value);
    }
    for (var p = 0; out.length < totalData; p += 1) out.push(PAD_BYTES[p % 2]);
    return out;
  }

  /** 数据码字分块 → 求纠错码字 → 按标准交织成完整码字序列 */
  function buildCodewords(bytes, cfg) {
    var data = buildDataCodewords(bytes, cfg);
    var blocks = [];
    var ecBlocks = [];
    for (var i = 0; i < cfg.blocks; i += 1) {
      var block = data.slice(i * cfg.dataPerBlock, (i + 1) * cfg.dataPerBlock);
      blocks.push(block);
      ecBlocks.push(rsEncode(block, cfg.ecPerBlock));
    }

    var out = [];
    for (var d = 0; d < cfg.dataPerBlock; d += 1) {
      for (var b = 0; b < cfg.blocks; b += 1) out.push(blocks[b][d]);
    }
    for (var e = 0; e < cfg.ecPerBlock; e += 1) {
      for (var c = 0; c < cfg.blocks; c += 1) out.push(ecBlocks[c][e]);
    }
    return out;
  }

  /* ---------------------------------------------------------- 矩阵绘制 */

  function newGrid(size, fill) {
    var g = [];
    for (var i = 0; i < size; i += 1) g.push(new Array(size).fill(fill));
    return g;
  }

  /** 15 位格式信息（纠错级别 + 掩码），含 BCH(15,5) 与固定异或 0x5412 */
  function formatBits(mask) {
    var data = (EC_LEVEL_FORMAT_BITS << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }

  function drawFormatInfo(modules, setFn, mask, size) {
    var bits = formatBits(mask);
    function bit(i) {
      return (bits >>> i) & 1;
    }

    for (var i = 0; i <= 5; i += 1) setFn(i, 8, bit(i));
    setFn(7, 8, bit(6));
    setFn(8, 8, bit(7));
    setFn(8, 7, bit(8));
    for (var j = 9; j < 15; j += 1) setFn(8, 14 - j, bit(j));

    for (var k = 0; k < 8; k += 1) setFn(8, size - 1 - k, bit(k));
    for (var m = 8; m < 15; m += 1) setFn(size - 15 + m, 8, bit(m));
    setFn(size - 8, 8, 1); // 固定深色模块
  }

  /** 掩码条件：x=列，y=行 */
  function maskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return false;
    }
  }

  function applyMask(modules, isFunc, mask, size) {
    for (var y = 0; y < size; y += 1) {
      for (var x = 0; x < size; x += 1) {
        if (!isFunc[y][x] && maskBit(mask, x, y)) modules[y][x] ^= 1;
      }
    }
  }

  var PATTERN_A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  var PATTERN_B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];

  function lineMatches(line, start, pat) {
    if (start + pat.length > line.length) return false;
    for (var i = 0; i < pat.length; i += 1) if (line[start + i] !== pat[i]) return false;
    return true;
  }

  /** 标准罚分：相邻同色 / 2×2 同色 / 类定位图形 / 深浅比例 */
  function penaltyScore(m, size) {
    var score = 0;
    var x;
    var y;

    for (y = 0; y < size; y += 1) {
      var runColor = m[y][0];
      var runLen = 1;
      for (x = 1; x < size; x += 1) {
        if (m[y][x] === runColor) {
          runLen += 1;
          if (runLen === 5) score += 3;
          else if (runLen > 5) score += 1;
        } else {
          runColor = m[y][x];
          runLen = 1;
        }
      }
    }
    for (x = 0; x < size; x += 1) {
      var colColor = m[0][x];
      var colLen = 1;
      for (y = 1; y < size; y += 1) {
        if (m[y][x] === colColor) {
          colLen += 1;
          if (colLen === 5) score += 3;
          else if (colLen > 5) score += 1;
        } else {
          colColor = m[y][x];
          colLen = 1;
        }
      }
    }

    for (y = 0; y < size - 1; y += 1) {
      for (x = 0; x < size - 1; x += 1) {
        var c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    }

    for (y = 0; y < size; y += 1) {
      for (x = 0; x < size; x += 1) {
        if (lineMatches(m[y], x, PATTERN_A) || lineMatches(m[y], x, PATTERN_B)) score += 40;
      }
    }
    for (x = 0; x < size; x += 1) {
      var col = [];
      for (y = 0; y < size; y += 1) col.push(m[y][x]);
      for (y = 0; y < size; y += 1) {
        if (lineMatches(col, y, PATTERN_A) || lineMatches(col, y, PATTERN_B)) score += 40;
      }
    }

    var dark = 0;
    for (y = 0; y < size; y += 1) for (x = 0; x < size; x += 1) if (m[y][x]) dark += 1;
    var total = size * size;
    score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;

    return score;
  }

  /** 生成未打掩码的基础矩阵：功能图形 + 数据 */
  function buildBaseMatrix(bytes, cfg) {
    var size = cfg.size;
    var modules = newGrid(size, 0);
    var isFunc = newGrid(size, false);

    function setFn(row, col, dark) {
      modules[row][col] = dark ? 1 : 0;
      isFunc[row][col] = true;
    }

    // 定位图形（含分隔符）：切比雪夫距 2/4 为浅色
    function drawFinder(cx, cy) {
      for (var dy = -4; dy <= 4; dy += 1) {
        for (var dx = -4; dx <= 4; dx += 1) {
          var dist = Math.max(Math.abs(dx), Math.abs(dy));
          var xx = cx + dx;
          var yy = cy + dy;
          if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(yy, xx, dist !== 2 && dist !== 4);
        }
      }
    }
    drawFinder(3, 3);
    drawFinder(size - 4, 3);
    drawFinder(3, size - 4);

    // 定时图形
    for (var i = 0; i < size; i += 1) {
      if (!isFunc[6][i]) setFn(6, i, i % 2 === 0);
      if (!isFunc[i][6]) setFn(i, 6, i % 2 === 0);
    }

    // 校正图形（V3–V6 只在中心一处）
    var center = size - 7;
    for (var ay = -2; ay <= 2; ay += 1) {
      for (var ax = -2; ax <= 2; ax += 1) {
        setFn(center + ay, center + ax, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
      }
    }

    // 格式信息区（先用占位值，掩码确定后再覆写）
    drawFormatInfo(modules, setFn, 0, size);

    // 数据位按之字形填入
    var codewords = buildCodewords(bytes, cfg);
    var totalBits = codewords.length * 8;
    var bitIndex = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      var upward = ((right + 1) & 2) === 0;
      for (var vert = 0; vert < size; vert += 1) {
        for (var j = 0; j < 2; j += 1) {
          var col = right - j;
          var row = upward ? size - 1 - vert : vert;
          if (!isFunc[row][col] && bitIndex < totalBits) {
            var bit = (codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
            modules[row][col] = bit;
            bitIndex += 1;
          }
        }
      }
    }

    return { modules: modules, isFunc: isFunc };
  }

  /**
   * 文本 → { matrix, size, version }。
   * matrix 为 0/1 二维数组；内容为空或超过 V6 容量（106 字节）时抛错。
   */
  function qrMatrix(text) {
    var value = String(text == null ? '' : text);
    if (!value) throw new Error('二维码内容不能为空');

    var bytes = utf8Bytes(value);
    var version = 0;
    for (var i = 0; i < VERSION_LIST.length; i += 1) {
      if (bytes.length <= capacityOf(VERSIONS[VERSION_LIST[i]])) {
        version = VERSION_LIST[i];
        break;
      }
    }
    if (!version) throw new Error('二维码内容过长（上限 106 字节）');

    var cfg = VERSIONS[version];
    var base = buildBaseMatrix(bytes, cfg);
    var modules = base.modules;
    var isFunc = base.isFunc;
    var size = cfg.size;

    var bestMask = 0;
    var bestScore = Infinity;
    for (var mask = 0; mask < 8; mask += 1) {
      var clone = modules.map(function (row) {
        return row.slice();
      });
      applyMask(clone, isFunc, mask, size);
      var score = penaltyScore(clone, size);
      if (score < bestScore) {
        bestScore = score;
        bestMask = mask;
      }
    }
    applyMask(modules, isFunc, bestMask, size);

    drawFormatInfo(modules, function (row, col, dark) {
      modules[row][col] = dark ? 1 : 0;
    }, bestMask, size);

    return { matrix: modules, size: size, version: version };
  }

  window.ACQR = {
    matrix: qrMatrix,
    maxBytes: capacityOf(VERSIONS[6])
  };
})();
