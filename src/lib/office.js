'use strict';
/**
 * Office 文件读写工具库（零第三方依赖，仅用 Node 内置模块）
 * ============================================================================
 * 面向质量平台：
 *   - 把质量问题数据导出成**真正的 Excel**（.xlsx，OOXML SpreadsheetML）
 *   - 把 8D / 根因分析报告导出成**真正的 Word**（.docx，OOXML WordprocessingML）
 *   - 导入用户上传的 Excel / CSV
 *
 * 自实现内容：CRC32 + ZIP（deflate/stored，UTF-8 文件名，EFS 标志 0x0800）、
 * 迷你 XML 解析器、xlsx 读写、docx 写出、CSV 读写。无任何 npm 依赖。
 *
 * ---------------------------------------------------------------------------
 * 用法速览
 * ---------------------------------------------------------------------------
 *   const office = require('./lib/office');
 *
 *   // 1) Excel 导出（Buffer 可直接 res.end() / fs.writeFileSync）
 *   const xlsx = office.xlsxWrite([{
 *     name: '质量问题台账',
 *     headerRow: true,                       // 默认 true：首行加粗+底色+冻结
 *     colWidths: [14, 22, 40],
 *     rows: [
 *       ['编号', '发生日期', '问题描述'],
 *       ['QI-2026-0001', new Date(2026, 7, 12), '车门内板间隙超差'],
 *       [{ v: '高', bold: true, bg: 'FFE0E0', align: 'center' }, null, '含,逗号与"引号"'],
 *       ['=SUM(A2:A3)'],                     // 以 = 开头 => 公式
 *     ],
 *   }]);
 *
 *   // 2) Excel 导入
 *   const { sheets } = office.xlsxRead(fs.readFileSync('上传.xlsx'));
 *   sheets[0].rows.forEach((row) => console.log(row.join(' | ')));
 *
 *   // 3) Word 报告
 *   const docx = office.docxWrite([
 *     { type: 'title', text: '8D 问题解决报告' },
 *     { type: 'subtitle', text: '质量平台 · 2026-08-12' },
 *     { type: 'h1', text: 'D1 小组成员' },
 *     { type: 'kv', items: [['组长', '张三'], ['成员', '李四、王五']] },
 *     { type: 'p', text: '问题描述：**间隙超差 0.8mm**，详见 `测量报告`。' },
 *     { type: 'bullet', text: '夹具定位销磨损' },
 *     { type: 'table', header: ['序号', '措施'], rows: [[1, '更换定位销']], widths: [1, 4] },
 *     { type: 'pagebreak' },
 *   ]);
 *
 *   // 4) CSV
 *   const csv = office.csvWrite([['姓名', '备注'], ['张三', '含,逗号\n与换行']]);
 *   const rows = office.csvRead(csv);
 *
 *   // 5) 直接操作 ZIP（调试用）
 *   const z = office.zipWrite([{ name: '中文目录/说明.txt', data: '你好' }]);
 *   const files = office.zipRead(z);        // { '中文目录/说明.txt': <Buffer> }
 *
 * ---------------------------------------------------------------------------
 * 约定与限制
 * ---------------------------------------------------------------------------
 *   - xlsxRead 返回的全部是字符串（布尔为 'TRUE'/'FALSE'，日期为
 *     'YYYY-MM-DD' / 'YYYY-MM-DD HH:mm:ss'，纯时间格式为 'HH:mm:ss'），
 *     空单元格为 ''，按 r 属性回填到正确列，不会因跳格而错位。
 *   - 公式单元格返回 '=' + 公式本体（取的是公式，不是缓存值），可直接回写。
 *   - 行内空洞补 ''；行尾没有数据的列不补齐（Excel 里本就不存在这些单元格），
 *     所以读回来的行宽度可能不一致，取用前请按需自行补齐。
 *   - 单元格文本超过 Excel 上限 32767 字符时截断。
 *   - 写出统一使用 inlineStr（不生成 sharedStrings），读取时两者都支持。
 *   - xlsxWrite 的 headerRow 默认 true（首行加粗+底色+整表细边框+冻结+筛选）；
 *     数据量过大（行×列 > 20 万）时自动退化为稀疏输出，不再画满格边框。
 *   - docx 表格的 widths 视为相对权重，按 A4 可用宽度等比分配。
 *   - 所有 XML 均为 UTF-8，非法控制字符会被剔除，防止 Office 报「文件已损坏」。
 *   - 不支持 ZIP64（单包 >4GB / 条目 >65535）。
 * ============================================================================
 */

const zlib = require('zlib');

/* ==========================================================================
 * 一、CRC32
 * ========================================================================== */

/** CRC32 查表（多项式 0xEDB88320，ZIP 标准） */
const CRC32_TABLE = (function buildCrcTable() {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/**
 * 计算 Buffer 的 CRC32
 * @param {Buffer} buf
 * @returns {number} 无符号 32 位整数
 */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ==========================================================================
 * 二、ZIP 写入
 * ========================================================================== */

/**
 * 把若干内存文件打包成 ZIP。
 * - 条目名统一 UTF-8 编码并设置 general purpose bit 11（EFS=0x0800），
 *   否则中文名在 Windows 资源管理器 / Excel 里可能乱码。
 * - 数据量小或压缩后反而变大时自动退化为 stored(method 0)。
 * - 因为所有内容都在内存里，压缩后大小已知，因此**不需要数据描述符**。
 *
 * @param {Array<{name:string, data:(Buffer|Uint8Array|string)}>} files
 * @returns {Buffer}
 */
function zipWrite(files) {
  if (!Array.isArray(files)) throw new TypeError('zipWrite(files)：files 必须是数组');
  if (files.length > 0xffff) throw new Error('zipWrite：条目数超过 65535，暂不支持 ZIP64');

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  // MS-DOS 时间戳（ZIP 头里只有这个精度）
  const now = new Date();
  const year = Math.max(1980, now.getFullYear());
  const dosTime = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((now.getSeconds() >> 1) & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0x0f) << 5) | (now.getDate() & 0x1f);

  for (const entry of files) {
    const name = String(entry && entry.name != null ? entry.name : '').replace(/\\/g, '/');
    if (!name) throw new Error('zipWrite：条目名不能为空');
    const nameBuf = Buffer.from(name, 'utf8');

    const raw = toBuffer(entry && entry.data);

    // 先尝试 deflate，压不动就用 stored
    let method = 8;
    let body = raw.length ? zlib.deflateRawSync(raw, { level: 9 }) : Buffer.alloc(0);
    if (raw.length === 0 || body.length >= raw.length) {
      method = 0;
      body = raw;
    }

    const crc = crc32(raw);
    const flags = 0x0800; // bit 11：文件名与注释为 UTF-8

    // ---- 本地文件头 ----
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28); // extra length
    localParts.push(lh, nameBuf, body);

    // ---- 中央目录项 ----
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // version made by（0 = MS-DOS）
    ch.writeUInt16LE(20, 6); // version needed
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30); // extra
    ch.writeUInt16LE(0, 32); // comment
    ch.writeUInt16LE(0, 34); // disk number start
    ch.writeUInt16LE(0, 36); // internal attrs
    ch.writeUInt32LE(0, 38); // external attrs
    ch.writeUInt32LE(offset, 42);
    centralParts.push(ch, nameBuf);

    offset += 30 + nameBuf.length + body.length;
  }

  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(centralParts);

  if (localBuf.length + centralBuf.length > 0xffffffff) {
    throw new Error('zipWrite：总长度超过 4GB，暂不支持 ZIP64');
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // 当前磁盘号
  eocd.writeUInt16LE(0, 6); // 中央目录起始磁盘号
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20); // 注释长度

  return Buffer.concat([localBuf, centralBuf, eocd]);
}

/* ==========================================================================
 * 三、ZIP 读取（以中央目录为准，兼容数据描述符）
 * ========================================================================== */

/**
 * 定位 EOCD（从尾部往前找，注释最长 65535 字节）。
 * @param {Buffer} buf
 * @returns {number} EOCD 偏移，找不到返回 -1
 */
function findEOCD(buf) {
  const minPos = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/**
 * 解析 ZIP。以中央目录为权威来源（对带数据描述符的流式 ZIP 也稳健），
 * 再回到本地文件头计算数据起始位置。
 *
 * @param {Buffer} buf
 * @returns {Record<string, Buffer>} 键为 zip 内条目名（正斜杠分隔）
 */
function zipRead(buf) {
  if (!Buffer.isBuffer(buf)) buf = toBuffer(buf);
  const eocd = findEOCD(buf);
  if (eocd < 0) throw new Error('zipRead：找不到 ZIP 结束标记（不是合法的 ZIP 数据）');

  let entryCount = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  let cdSize = buf.readUInt32LE(eocd + 12);

  // ---- ZIP64（>4GB 或 >65535 条目）----
  if (entryCount === 0xffff || cdOffset === 0xffffffff) {
    const locPos = eocd - 20;
    if (locPos >= 0 && buf.readUInt32LE(locPos) === 0x07064b50) {
      const z64 = Number(buf.readBigUInt64LE(locPos + 8));
      if (z64 >= 0 && buf.readUInt32LE(z64) === 0x06064b50) {
        entryCount = Number(buf.readBigUInt64LE(z64 + 32));
        cdSize = Number(buf.readBigUInt64LE(z64 + 40));
        cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
      }
    }
  }
  if (cdOffset + cdSize > buf.length) {
    // 少数实现会把偏移写成相对值，这里做一次兜底重算
    cdOffset = buf.length - cdSize - 22;
    if (cdOffset < 0) throw new Error('zipRead：中央目录偏移越界，文件可能被截断');
  }

  const out = {};
  let p = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;

    const method = buf.readUInt16LE(p + 10);
    let compSize = buf.readUInt32LE(p + 20);
    let rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localOffset = buf.readUInt32LE(p + 42);

    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    // ZIP64 扩展字段（头里写 0xFFFFFFFF 时真实值在这里）
    if (compSize === 0xffffffff || rawSize === 0xffffffff || localOffset === 0xffffffff) {
      const ex = p + 46 + nameLen;
      let q = ex;
      const exEnd = ex + extraLen;
      while (q + 4 <= exEnd) {
        const hid = buf.readUInt16LE(q);
        const hsz = buf.readUInt16LE(q + 2);
        if (hid === 0x0001) {
          let r = q + 4;
          if (rawSize === 0xffffffff) { rawSize = Number(buf.readBigUInt64LE(r)); r += 8; }
          if (compSize === 0xffffffff) { compSize = Number(buf.readBigUInt64LE(r)); r += 8; }
          if (localOffset === 0xffffffff) { localOffset = Number(buf.readBigUInt64LE(r)); r += 8; }
          break;
        }
        q += 4 + hsz;
      }
    }

    p += 46 + nameLen + extraLen + commentLen;

    if (!name || name.endsWith('/')) continue; // 目录项
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) continue;

    // 以本地文件头里的 name/extra 长度推算数据起点（本地头与中央目录的 extra 可能不同）
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const dataEnd = dataStart + compSize;
    if (dataStart > buf.length) continue;

    const raw = buf.slice(dataStart, Math.min(dataEnd, buf.length));
    let content;
    if (method === 0) {
      content = Buffer.from(raw); // stored
    } else if (method === 8) {
      content = zlib.inflateRawSync(raw); // deflate
    } else {
      throw new Error('zipRead：不支持的压缩方式 method=' + method + '（条目 ' + name + '）');
    }
    // 大小已知时按声明值裁剪（防御性）
    if (rawSize > 0 && content.length > rawSize) content = content.slice(0, rawSize);

    const key = name.replace(/\\/g, '/');
    if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = content;
  }
  return out;
}

/**
 * 把任意值转成 Buffer（字符串按 UTF-8）。
 * @param {any} data
 * @returns {Buffer}
 */
function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (data === null || data === undefined) return Buffer.alloc(0);
  return Buffer.from(String(data), 'utf8');
}

/* ==========================================================================
 * 四、XML 工具：转义、清洗、迷你解析器
 * ========================================================================== */

/**
 * 剔除 XML 1.0 非法字符（控制字符、孤立代理项、0xFFFE/0xFFFF）。
 * 这一步非常关键：残留会让 Word/Excel 直接报「文件已损坏」。
 * @param {any} s
 * @returns {string}
 */
function sanitizeXmlText(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u0084\u0086-\u009F]/g, '')
    .replace(/[\uFFFE\uFFFF]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '') // 高位代理项落单
    .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1'); // 低位代理项落单
}

/**
 * XML 文本节点转义（& < > " ' 全转，保证任何上下文都安全）
 * @param {any} s
 * @returns {string}
 */
function escapeXml(s) {
  return sanitizeXmlText(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 属性值转义（与文本一致） */
const escapeAttr = escapeXml;

/** XML 实体解码 */
function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, g) => {
    if (g[0] === '#') {
      const code = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
      try {
        return String.fromCodePoint(code);
      } catch (_) {
        return '';
      }
    }
    switch (g) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      case 'nbsp': return '\u00A0';
      default: return m;
    }
  });
}

/** 从标签起始位置找到 '>'（跳过引号内的 '>'） */
function findTagEnd(src, from) {
  let quote = 0;
  for (let i = from + 1; i < src.length; i++) {
    const ch = src.charCodeAt(i);
    if (quote) {
      if (ch === quote) quote = 0;
    } else if (ch === 34 || ch === 39) {
      quote = ch;
    } else if (ch === 62) {
      return i;
    }
  }
  return src.length;
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/**
 * 极简 XML 解析器（够用即止）：返回节点树。
 * 节点结构：{ name, local, attrs, children, text, parent }
 *  - name  ：原始标签名（含命名空间前缀）
 *  - local ：去掉前缀的本地名（用于忽略 ns 前缀差异）
 *  - text  ：直属文本（已做实体解码，不含子节点文本）
 * 容错：自动跳过声明/注释/DOCTYPE，未闭合标签不抛错。
 *
 * @param {string} src
 * @returns {object} 根节点（#root），真正的文档元素是它的第一个子节点
 */
function parseXml(src) {
  const root = { name: '#root', local: '#root', attrs: Object.create(null), children: [], text: '', parent: null };
  const stack = [root];
  const s = String(src == null ? '' : src);
  const n = s.length;
  let i = 0;

  const appendText = (node, chunk) => {
    if (chunk) node.text += decodeEntities(chunk);
  };

  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) {
      appendText(stack[stack.length - 1], s.slice(i));
      break;
    }
    if (lt > i) appendText(stack[stack.length - 1], s.slice(i, lt));

    if (s.startsWith('<?', lt)) {
      const e = s.indexOf('?>', lt);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (s.startsWith('<!--', lt)) {
      const e = s.indexOf('-->', lt);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', lt)) {
      const e = s.indexOf(']]>', lt);
      stack[stack.length - 1].text += s.slice(lt + 9, e < 0 ? n : e);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (s.startsWith('<!', lt)) {
      const e = s.indexOf('>', lt);
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (s.startsWith('</', lt)) {
      const e = s.indexOf('>', lt);
      const nm = s.slice(lt + 2, e < 0 ? n : e).trim();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === nm) {
          stack.length = k;
          break;
        }
      }
      i = (e < 0 ? n : e) + 1;
      continue;
    }

    // 起始标签
    const e = findTagEnd(s, lt);
    const raw = s.slice(lt + 1, e);
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;

    let nameEnd = 0;
    while (nameEnd < body.length && !/\s/.test(body[nameEnd])) nameEnd++;
    const name = body.slice(0, nameEnd);
    const attrs = Object.create(null);
    ATTR_RE.lastIndex = nameEnd;
    let m;
    while ((m = ATTR_RE.exec(body)) !== null) attrs[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4]);

    const colon = name.indexOf(':');
    const node = {
      name,
      local: colon >= 0 ? name.slice(colon + 1) : name,
      attrs,
      children: [],
      text: '',
      parent: stack[stack.length - 1],
    };
    node.parent.children.push(node);
    if (!selfClosing) stack.push(node);
    i = e + 1;
  }
  return root;
}

/** 取文档根元素（跳过 #root 包装） */
function xmlRoot(node) {
  return node && node.children.length ? node.children[0] : node;
}

/** 按本地名筛选直接子节点 */
function childNodes(node, localName) {
  const out = [];
  if (!node) return out;
  for (const c of node.children) if (c.local === localName) out.push(c);
  return out;
}

/** 取第一个指定本地名的直接子节点 */
function firstChild(node, localName) {
  if (!node) return null;
  for (const c of node.children) if (c.local === localName) return c;
  return null;
}

/** 深度优先取第一个指定本地名的后代节点 */
function findDescendant(node, localName) {
  if (!node) return null;
  for (const c of node.children) {
    if (c.local === localName) return c;
    const r = findDescendant(c, localName);
    if (r) return r;
  }
  return null;
}

/**
 * 读属性：优先精确名，再按本地名匹配（兼容 ns 前缀差异）。
 * @param {object} node
 * @param {string} name
 * @returns {string|null}
 */
function attr(node, name) {
  if (!node) return null;
  const a = node.attrs;
  if (a[name] !== undefined) return a[name];
  for (const k in a) {
    const colon = k.indexOf(':');
    const local = colon >= 0 ? k.slice(colon + 1) : k;
    if (local === name) return a[k];
  }
  return null;
}

/**
 * 汇总节点内所有 t 文本（用于 sharedStrings 的 <si>，兼容 <r><t> 富文本），
 * 跳过日文注音 rPh / phoneticPr。
 * @param {object} node
 * @returns {string}
 */
function collectText(node) {
  let out = '';
  const walk = (nd) => {
    for (const c of nd.children) {
      if (c.local === 'rPh' || c.local === 'phoneticPr') continue;
      if (c.local === 't') out += c.text;
      else walk(c);
    }
  };
  walk(node);
  return out;
}

/* ==========================================================================
 * 五、通用小工具
 * ========================================================================== */

const EXCEL_MAX_CELL_CHARS = 32767; // Excel 单元格文本硬上限

/** 列序号(0基) -> 列名 A/B/.../AA */
function colLetter(index) {
  let i = index + 1;
  let s = '';
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

/** 列名 -> 列序号(0基)，非法返回 -1 */
function colIndex(letters) {
  if (!letters) return -1;
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    const c = letters.charCodeAt(i);
    if (c >= 65 && c <= 90) idx = idx * 26 + (c - 64);
    else if (c >= 97 && c <= 122) idx = idx * 26 + (c - 96);
    else return -1;
  }
  return idx - 1;
}

/** "A1" -> {col:0,row:0}；无 row 时报 -1 */
function parseCellRef(ref) {
  if (!ref) return { col: -1, row: -1 };
  const m = /^([A-Za-z]+)(\d+)$/.exec(String(ref).trim());
  if (!m) return { col: -1, row: -1 };
  return { col: colIndex(m[1]), row: parseInt(m[2], 10) - 1 };
}

/** 补零 */
function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/** 把 Date 按本地时间格式化为 'YYYY-MM-DD HH:mm:ss'（dateOnly 时只到日） */
function formatDate(d, withTime) {
  const s =
    d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    (withTime ? ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) : '');
  return s;
}

/* ==========================================================================
 * 六、XLSX 写入（OOXML SpreadsheetML）
 * ========================================================================== */

/** 常用颜色的名字 -> ARGB */
const NAMED_COLORS = {
  black: 'FF000000', white: 'FFFFFFFF', red: 'FFFF0000', darkred: 'FF8B0000',
  green: 'FF008000', darkgreen: 'FF006400', blue: 'FF0000FF', darkblue: 'FF00008B',
  yellow: 'FFFFFF00', orange: 'FFFF8C00', purple: 'FF800080', gray: 'FF808080',
  grey: 'FF808080', darkgray: 'FF404040', darkgrey: 'FF404040', lightgray: 'FFD3D3D3',
  lightgrey: 'FFD3D3D3', silver: 'FFC0C0C0', navy: 'FF000080', teal: 'FF008080',
};

/** 常见内置数字格式（用于反查内置 id，避免重复注册自定义格式） */
const BUILTIN_NUMFMT_IDS = {
  General: 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4,
  '0%': 9, '0.00%': 10, '0.00E+00': 11, '# ?/?': 12, '# ??/??': 13,
  'mm-dd-yy': 14, 'd-mmm-yy': 15, 'd-mmm': 16, 'mmm-yy': 17,
  'h:mm AM/PM': 18, 'h:mm:ss AM/PM': 19, 'h:mm': 20, 'h:mm:ss': 21, 'm/d/yy h:mm': 22,
  '@': 49,
};

/** 颜色字符串（#RGB / #RRGGBB / #AARRGGBB / 英文名）-> ARGB，非法返回 null */
function normalizeColor(color) {
  if (!color) return null;
  const s = String(color).trim();
  if (/^#?[0-9a-fA-F]{8}$/.test(s)) return s.replace('#', '').toUpperCase();
  if (/^#?[0-9a-fA-F]{6}$/.test(s)) return 'FF' + s.replace('#', '').toUpperCase();
  if (/^#?[0-9a-fA-F]{3}$/.test(s)) {
    const h = s.replace('#', '');
    return ('FF' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2]).toUpperCase();
  }
  const named = NAMED_COLORS[s.toLowerCase()];
  return named || null;
}

/**
 * 样式注册表：按需去重生成 fonts / fills / borders / numFmts / cellXfs。
 * 这是 xlsx 写出最核心的部分——Excel 对 styles.xml 的引用非常挑剔。
 */
function createStyleSet() {
  const set = {
    fonts: [{ size: 11, name: '等线', bold: false, italic: false, color: null }],
    fills: [{ kind: 'none' }, { kind: 'gray125' }],
    borders: [{ key: 'none' }],
    numFmts: [],
    xfs: [],
    _fontKeys: new Map([['default', 0]]),
    _fillKeys: new Map([['none', 0], ['gray125', 1]]),
    _borderKeys: new Map([['none', 0]]),
    _numFmtKeys: new Map(),
    _xfKeys: new Map(),
  };

  /** 注册字体，返回 fontId */
  set.fontId = function fontId(spec) {
    const key = JSON.stringify([spec.bold ? 1 : 0, spec.italic ? 1 : 0, spec.color || '', spec.size || 11, spec.name || '等线']);
    if (set._fontKeys.has(key)) return set._fontKeys.get(key);
    const id = set.fonts.length;
    set.fonts.push({
      size: spec.size || 11,
      name: spec.name || '等线',
      bold: !!spec.bold,
      italic: !!spec.italic,
      color: spec.color || null,
    });
    set._fontKeys.set(key, id);
    return id;
  };

  /** 注册填充色，返回 fillId */
  set.fillId = function fillId(argb) {
    if (!argb) return 0;
    const key = 'solid:' + argb;
    if (set._fillKeys.has(key)) return set._fillKeys.get(key);
    const id = set.fills.length;
    set.fills.push({ kind: 'solid', color: argb });
    set._fillKeys.set(key, id);
    return id;
  };

  /** 注册边框（默认细线），返回 borderId */
  set.borderId = function borderId(spec) {
    if (!spec) return 0;
    const color = spec.color || 'FFBFBFBF';
    const style = spec.style || 'thin';
    const key = style + ':' + color;
    if (set._borderKeys.has(key)) return set._borderKeys.get(key);
    const id = set.borders.length;
    set.borders.push({ key, style, color });
    set._borderKeys.set(key, id);
    return id;
  };

  /** 注册数字格式，返回 numFmtId */
  set.numFmtId = function numFmtIdOf(code) {
    if (!code) return 0;
    const text = String(code);
    if (BUILTIN_NUMFMT_IDS[text] !== undefined) return BUILTIN_NUMFMT_IDS[text];
    if (set._numFmtKeys.has(text)) return set._numFmtKeys.get(text);
    const id = 164 + set.numFmts.length; // 自定义格式从 164 起
    set.numFmts.push({ id, code: text });
    set._numFmtKeys.set(text, id);
    return id;
  };

  /** 注册完整单元格样式，返回 s 索引 */
  set.xfId = function xfIdOf(spec) {
    const fontId = set.fontId(spec);
    const fillId = set.fillId(spec.bg || null);
    const borderId = set.borderId(spec.border || null);
    const fmtId = set.numFmtId(spec.numFmt || null);
    const align = spec.align || null;
    const valign = spec.valign || null;
    const wrap = !!spec.wrap;
    const key = [fontId, fillId, borderId, fmtId, align || '', valign || '', wrap ? 1 : 0].join('|');
    if (set._xfKeys.has(key)) return set._xfKeys.get(key);
    const id = set.xfs.length;
    set.xfs.push({ fontId, fillId, borderId, numFmtId: fmtId, align, valign, wrap });
    set._xfKeys.set(key, id);
    return id;
  };

  return set;
}

/** 生成 styles.xml */
function stylesXml(set) {
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  parts.push('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');

  if (set.numFmts.length) {
    parts.push('<numFmts count="' + set.numFmts.length + '">');
    for (const f of set.numFmts) parts.push('<numFmt numFmtId="' + f.id + '" formatCode="' + escapeAttr(f.code) + '"/>');
    parts.push('</numFmts>');
  }

  parts.push('<fonts count="' + set.fonts.length + '">');
  for (const f of set.fonts) {
    parts.push('<font>');
    if (f.bold) parts.push('<b/>');
    if (f.italic) parts.push('<i/>');
    parts.push('<sz val="' + f.size + '"/>');
    if (f.color) parts.push('<color rgb="' + f.color + '"/>');
    parts.push('<name val="' + escapeAttr(f.name) + '"/>');
    parts.push('<family val="2"/><charset val="134"/>');
    parts.push('</font>');
  }
  parts.push('</fonts>');

  parts.push('<fills count="' + set.fills.length + '">');
  for (const f of set.fills) {
    if (f.kind === 'solid') {
      parts.push('<fill><patternFill patternType="solid"><fgColor rgb="' + f.color + '"/><bgColor indexed="64"/></patternFill></fill>');
    } else if (f.kind === 'gray125') {
      parts.push('<fill><patternFill patternType="gray125"/></fill>');
    } else {
      parts.push('<fill><patternFill patternType="none"/></fill>');
    }
  }
  parts.push('</fills>');

  parts.push('<borders count="' + set.borders.length + '">');
  for (const b of set.borders) {
    if (b.key === 'none') {
      parts.push('<border><left/><right/><top/><bottom/><diagonal/></border>');
    } else {
      const side = (tag) => '<' + tag + ' style="' + b.style + '"><color rgb="' + b.color + '"/></' + tag + '>';
      parts.push('<border>' + side('left') + side('right') + side('top') + side('bottom') + '<diagonal/></border>');
    }
  }
  parts.push('</borders>');

  parts.push('<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>');

  parts.push('<cellXfs count="' + set.xfs.length + '">');
  for (const x of set.xfs) {
    let a = '<xf numFmtId="' + x.numFmtId + '" fontId="' + x.fontId + '" fillId="' + x.fillId + '" borderId="' + x.borderId + '" xfId="0"';
    if (x.numFmtId) a += ' applyNumberFormat="1"';
    if (x.fontId) a += ' applyFont="1"';
    if (x.fillId) a += ' applyFill="1"';
    if (x.borderId) a += ' applyBorder="1"';
    if (x.align || x.valign || x.wrap) {
      a += ' applyAlignment="1"><alignment';
      if (x.align) a += ' horizontal="' + x.align + '"';
      if (x.valign) a += ' vertical="' + x.valign + '"';
      if (x.wrap) a += ' wrapText="1"';
      a += '/></xf>';
    } else {
      a += '/>';
    }
    parts.push(a);
  }
  parts.push('</cellXfs>');

  parts.push('<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>');
  parts.push('<dxfs count="0"/>');
  parts.push('<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>');
  parts.push('</styleSheet>');
  return parts.join('');
}

/** Excel 序列号 <-> Date（1900 日期系统，含 1900 闰年 bug 的常规处理） */
const EXCEL_EPOCH_1900 = Date.UTC(1899, 11, 30);
const EXCEL_EPOCH_1904 = Date.UTC(1904, 0, 1);

/** Date -> Excel 序列号（按本地墙上时间） */
function dateToSerial(d) {
  const wall = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  return Math.round(((wall - EXCEL_EPOCH_1900) / 86400000) * 1e8) / 1e8;
}

/** Excel 序列号 -> Date（UTC 语义，配合 getUTC* 使用） */
function serialToUtcDate(serial, date1904) {
  const epoch = date1904 ? EXCEL_EPOCH_1904 : EXCEL_EPOCH_1900;
  return new Date(epoch + Math.round(serial * 86400000));
}

/** sheet 名合法化 + 去重（去掉 []:*?/\ ，≤31 字符） */
function legalSheetName(name, used) {
  let n = sanitizeXmlText(name == null ? '' : name)
    .replace(/[\[\]:*?/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  n = n.replace(/^'+|'+$/g, ''); // Excel 不允许首尾单引号
  if (!n) n = 'Sheet' + (used.size + 1);
  if (n.length > 31) n = Array.from(n).slice(0, 31).join('');
  let out = n;
  let k = 1;
  while (used.has(out.toLowerCase())) {
    const suffix = '(' + ++k + ')';
    out = Array.from(n).slice(0, Math.max(1, 31 - suffix.length)).join('') + suffix;
  }
  used.add(out.toLowerCase());
  return out;
}

/** 单个单元格 -> XML（返回 null 表示空单元格且无需输出） */
function sheetCellXml(ref, value, styleIndex) {
  const sAttr = styleIndex ? ' s="' + styleIndex + '"' : '';
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) return null; // Date 在上层已转成序列号，防御性忽略

  if (typeof value === 'boolean') {
    return '<c r="' + ref + '"' + sAttr + ' t="b"><v>' + (value ? 1 : 0) + '</v></c>';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return '<c r="' + ref + '"' + sAttr + '><v>' + value + '</v></c>';
  }

  const text = String(value);
  if (text === '') return null;
  // 公式（'=' 后面必须真的有内容，否则退化成空单元格）
  if (text.charCodeAt(0) === 61 /* = */) {
    const f = sanitizeXmlText(text.slice(1)).slice(0, EXCEL_MAX_CELL_CHARS);
    if (!f.trim()) return null;
    return '<c r="' + ref + '"' + sAttr + '><f>' + escapeXml(f) + '</f></c>';
  }
  // 普通文本：inlineStr，超长截断
  const clipped = Array.from(sanitizeXmlText(text)).slice(0, EXCEL_MAX_CELL_CHARS).join('');
  return '<c r="' + ref + '"' + sAttr + ' t="inlineStr"><is><t xml:space="preserve">' + escapeXml(clipped) + '</t></is></c>';
}

/** 生成一个 worksheet 的 XML */
function worksheetXml(sheet, set, isFirst) {
  const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
  const headerRow = sheet.headerRow !== false; // 默认首行是表头
  const colWidths = Array.isArray(sheet.colWidths) ? sheet.colWidths : null;

  // 表宽
  let maxCols = 0;
  for (const r of rows) if (Array.isArray(r) && r.length > maxCols) maxCols = r.length;

  // 是否铺满整张网格（用于画边框；数据量过大时退化为稀疏输出，避免文件爆炸）
  const dense = headerRow && maxCols > 0 && rows.length * maxCols <= 200000;

  const headerStyle = set.xfId({ bold: true, bg: 'FFD9E1F2', align: 'center', valign: 'center', wrap: true, border: { style: 'thin', color: 'FFBFBFBF' } });
  const emptyBorderStyle = set.xfId({ border: { style: 'thin', color: 'FFBFBFBF' } });

  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
  out.push('<dimension ref="A1:' + colLetter(Math.max(0, maxCols - 1)) + Math.max(1, rows.length) + '"/>');
  out.push('<sheetViews><sheetView' + (isFirst ? ' tabSelected="1"' : '') + ' workbookViewId="0">');
  if (headerRow) out.push('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>');
  out.push('</sheetView></sheetViews>');
  out.push('<sheetFormatPr defaultRowHeight="16.5"/>');

  if (colWidths && colWidths.length) {
    out.push('<cols>');
    for (let i = 0; i < colWidths.length; i++) {
      const w = Number(colWidths[i]);
      if (!Number.isFinite(w) || w <= 0) continue;
      out.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + Math.min(255, w) + '" customWidth="1"/>');
    }
    out.push('</cols>');
  }

  out.push('<sheetData>');
  for (let ri = 0; ri < rows.length; ri++) {
    const row = Array.isArray(rows[ri]) ? rows[ri] : [];
    const cells = [];
    const limit = dense ? Math.max(maxCols, row.length) : row.length;
    for (let ci = 0; ci < limit; ci++) {
      const ref = colLetter(ci) + (ri + 1);
      let value = ci < row.length ? row[ci] : null;
      let spec = null;

      // 单元格对象形式：{v, bold, color, bg, align, numFmt}
      if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof Buffer)) {
        spec = value;
        value = value.v;
      }

      const styleSpec = {};
      if (headerRow && ri === 0) Object.assign(styleSpec, { bold: true, bg: 'FFD9E1F2', align: 'center', valign: 'center', wrap: true, border: { style: 'thin', color: 'FFBFBFBF' } });

      if (spec) {
        if (spec.bold) styleSpec.bold = true;
        if (spec.color) { const c = normalizeColor(spec.color); if (c) styleSpec.color = c; }
        if (spec.bg) { const c = normalizeColor(spec.bg); if (c) styleSpec.bg = c; }
        if (spec.align) styleSpec.align = spec.align;
        if (spec.numFmt) styleSpec.numFmt = spec.numFmt;
      }

      // 日期 -> 序列号 + 日期格式
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const hasTime = value.getHours() || value.getMinutes() || value.getSeconds() || value.getMilliseconds();
        value = dateToSerial(value);
        if (!styleSpec.numFmt) styleSpec.numFmt = hasTime ? 'yyyy-mm-dd hh:mm:ss' : 'yyyy-mm-dd';
      } else if (typeof value === 'string' && value.indexOf('\n') >= 0) {
        styleSpec.wrap = true; // 多行文本自动换行
      }

      if (dense) styleSpec.border = styleSpec.border || { style: 'thin', color: 'FFBFBFBF' };

      let styleIndex = 0;
      if (Object.keys(styleSpec).length) styleIndex = set.xfId(styleSpec);
      else if (dense && ri === 0) styleIndex = headerStyle;
      else if (dense) styleIndex = emptyBorderStyle;

      const xml = sheetCellXml(ref, value, styleIndex);
      if (xml) cells.push(xml);
      else if (dense && ri > 0) cells.push('<c r="' + ref + '" s="' + styleIndex + '"/>');
    }
    out.push('<row r="' + (ri + 1) + '"' + (maxCols ? ' spans="1:' + Math.max(1, maxCols) + '"' : '') + '>' + cells.join('') + '</row>');
  }
  out.push('</sheetData>');

  if (dense) {
    // 表头自动筛选，导出后可直接筛选
    out.push('<autoFilter ref="A1:' + colLetter(Math.max(0, maxCols - 1)) + Math.max(1, rows.length) + '"/>');
  }
  out.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
  out.push('</worksheet>');
  return out.join('');
}

/**
 * 写出真正的 .xlsx（OOXML SpreadsheetML）。
 *
 * @param {Array<{name:string, rows:any[][], colWidths?:number[], headerRow?:boolean}>} sheets
 *   rows 单元格支持 string | number | boolean | null | undefined | Date |
 *   {v, bold?, color?, bg?, align?, numFmt?}；字符串以 '=' 开头视为公式。
 *   headerRow 默认 true（首行加粗+底色+冻结首行）；sheet 名自动合法化。
 * @returns {Buffer}
 */
function xlsxWrite(sheets) {
  let list = Array.isArray(sheets) ? sheets.slice() : [];
  if (!list.length) list = [{ name: 'Sheet1', rows: [] }];

  const used = new Set();
  const norm = list.map((s, i) => ({
    name: legalSheetName(s && s.name ? s.name : 'Sheet' + (i + 1), used),
    rows: s && Array.isArray(s.rows) ? s.rows : [],
    colWidths: s && s.colWidths,
    headerRow: !(s && s.headerRow === false),
  }));

  const set = createStyleSet();
  // 先注册一次默认 xf，保证索引 0 存在且为默认样式
  set.xfId({});

  const files = [];
  const ct = [];
  ct.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  ct.push('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">');
  ct.push('<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>');
  ct.push('<Default Extension="xml" ContentType="application/xml"/>');
  ct.push('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>');
  ct.push('<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>');
  for (let i = 0; i < norm.length; i++) {
    ct.push('<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
  }
  ct.push('<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>');
  ct.push('<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>');
  ct.push('</Types>');
  files.push({ name: '[Content_Types].xml', data: ct.join('') });

  files.push({
    name: '_rels/.rels',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>',
  });

  // workbook.xml + 关系
  const wbSheets = [];
  const wbRels = [];
  for (let i = 0; i < norm.length; i++) {
    wbSheets.push('<sheet name="' + escapeAttr(norm[i].name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>');
    wbRels.push('<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>');
  }
  wbRels.push('<Relationship Id="rId' + (norm.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>');

  files.push({
    name: 'xl/workbook.xml',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="9303"/>' +
      '<workbookPr/>' +
      '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>' +
      '<sheets>' + wbSheets.join('') + '</sheets>' +
      '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
      '</workbook>',
  });
  files.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + wbRels.join('') + '</Relationships>',
  });

  // 各 worksheet（注意：styleSet 必须在生成 sheet 前收集完所有样式）
  const sheetXmlList = norm.map((s, i) => worksheetXml(s, set, i === 0));
  // styles.xml 要在所有 sheet 处理完之后生成（样式是惰性注册的）
  files.push({ name: 'xl/styles.xml', data: stylesXml(set) });
  for (let i = 0; i < sheetXmlList.length; i++) {
    files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXmlList[i] });
  }

  // 文档属性
  const nowIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files.push({
    name: 'docProps/core.xml',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>数据导出</dc:title>' +
      '<dc:creator>QIP Agent</dc:creator><cp:lastModifiedBy>QIP Agent</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + nowIso + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + nowIso + '</dcterms:modified>' +
      '</cp:coreProperties>',
  });
  files.push({
    name: 'docProps/app.xml',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>QIP Office</Application><AppVersion>1.0</AppVersion></Properties>',
  });

  return zipWrite(files);
}

/* ==========================================================================
 * 七、XLSX 读取
 * ========================================================================== */

/** 内置日期/时间数字格式 id */
const BUILTIN_DATE_FMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
/** 内置纯时间格式 id */
const BUILTIN_TIME_FMT_IDS = new Set([18, 19, 20, 21, 45, 46, 47]);

/** 去掉数字格式里的字面量/转义，只留下占位符（用于判断是不是日期格式） */
function stripFmtLiterals(code) {
  return String(code)
    .replace(/"[^"]*"/g, '')      // 引号字面量
    .replace(/\[[^\]]*\]/g, '')   // [Red] / [$-409] / [h] 等
    .replace(/\\./g, '')          // \m 之类转义
    .replace(/_.|\*./g, '');      // 占位/填充字符
}

/** 自定义数字格式是否像日期/时间 */
function looksLikeDateFormat(code) {
  if (!code) return false;
  if (/^(general|@)$/i.test(String(code).trim())) return false;
  const cleaned = stripFmtLiterals(code);
  return /[ymdhs]/i.test(cleaned);
}

/**
 * 判断数字格式 id 属于哪种类型。
 * @returns {'date'|'time'|null}
 */
function classifyNumFmt(id, customFmts) {
  if (BUILTIN_DATE_FMT_IDS.has(id)) return BUILTIN_TIME_FMT_IDS.has(id) ? 'time' : 'date';
  const code = customFmts.get(id);
  if (code && looksLikeDateFormat(code)) {
    if (/[ymd]/i.test(stripFmtLiterals(code))) return 'date';
    return 'time';
  }
  return null;
}

/** Excel 序列号 -> 显示字符串 */
function serialToDisplay(serial, kind, date1904) {
  const d = serialToUtcDate(serial, date1904);
  const hh = pad2(d.getUTCHours());
  const mm = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  if (kind === 'time') return hh + ':' + mm + ':' + ss;
  const datePart = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  const frac = Math.abs(serial - Math.floor(serial));
  if (frac < 1e-9) return datePart;
  return datePart + ' ' + hh + ':' + mm + ':' + ss;
}

/** 解析 rels 文件 -> Map<Id, 已解析的绝对部件路径> */
function parseRels(xmlText, baseDir) {
  const map = new Map();
  if (!xmlText) return map;
  const root = xmlRoot(parseXml(xmlText));
  for (const rel of childNodes(root, 'Relationship')) {
    const id = attr(rel, 'Id');
    let target = attr(rel, 'Target') || '';
    if (!id || !target) continue;
    if (attr(rel, 'TargetMode') === 'External') continue;
    map.set(id, resolvePartPath(baseDir, target));
  }
  return map;
}

/** 把相对 Target 解析成包内绝对路径（不含前导斜杠） */
function resolvePartPath(baseDir, target) {
  let t = String(target).replace(/\\/g, '/');
  if (t.startsWith('/')) return t.slice(1);
  const segs = (baseDir ? baseDir.split('/') : []).concat(t.split('/'));
  const out = [];
  for (const s of segs) {
    if (!s || s === '.') continue;
    if (s === '..') out.pop();
    else out.push(s);
  }
  return out.join('/');
}

/**
 * 解析 .xlsx。
 * 全部单元格以字符串返回：
 *   - 字符串原样；数字原样（不做四舍五入）
 *   - 布尔 'TRUE' / 'FALSE'
 *   - 日期 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:mm:ss'（纯时间格式为 'HH:mm:ss'）
 *   - 公式 '=SUM(A1:A2)'
 *   - 空单元格 ''（按 r 属性回填正确列，缺行补空行，不会错位）
 *
 * @param {Buffer} buf
 * @returns {{sheets: Array<{name:string, rows:string[][]}>}}
 */
function xlsxRead(buf) {
  const files = zipRead(buf);
  // 大小写不敏感 + 去掉前导斜杠的查表
  const index = new Map();
  for (const k of Object.keys(files)) index.set(k.replace(/^\/+/, '').toLowerCase(), files[k]);
  const readText = (p) => {
    const b = index.get(String(p).replace(/^\/+/, '').toLowerCase());
    return b ? b.toString('utf8') : null;
  };

  const wbText = readText('xl/workbook.xml') || readText('workbook.xml');
  if (!wbText) throw new Error('xlsxRead：找不到 xl/workbook.xml，不是有效的 .xlsx 文件');
  const wbRoot = xmlRoot(parseXml(wbText));

  // 1904 日期系统
  const wbPr = firstChild(wbRoot, 'workbookPr');
  const date1904 = /^(1|true)$/i.test(attr(wbPr, 'date1904') || '');

  const rels = parseRels(readText('xl/_rels/workbook.xml.rels'), 'xl');
  const relsFallback = parseRels(readText('_rels/workbook.xml.rels'), '');

  // 共享字符串
  const shared = [];
  const sstText = readText('xl/sharedStrings.xml');
  if (sstText) {
    const sstRoot = xmlRoot(parseXml(sstText));
    for (const si of childNodes(sstRoot, 'si')) shared.push(collectText(si));
  }

  // 样式：numFmtId -> 类型
  const customFmts = new Map();
  const cellXfs = [];
  const stylesText = readText('xl/styles.xml');
  if (stylesText) {
    const stRoot = xmlRoot(parseXml(stylesText));
    const numFmtsNode = firstChild(stRoot, 'numFmts');
    for (const nf of childNodes(numFmtsNode, 'numFmt')) {
      const id = parseInt(attr(nf, 'numFmtId'), 10);
      if (Number.isFinite(id)) customFmts.set(id, attr(nf, 'formatCode') || '');
    }
    const xfsNode = firstChild(stRoot, 'cellXfs');
    for (const xf of childNodes(xfsNode, 'xf')) {
      const id = parseInt(attr(xf, 'numFmtId'), 10);
      cellXfs.push(Number.isFinite(id) ? classifyNumFmt(id, customFmts) : null);
    }
  }

  // 工作表清单（顺序 = workbook.xml 中的顺序）
  const sheetsNode = firstChild(wbRoot, 'sheets');
  const sheetDefs = [];
  for (const sh of childNodes(sheetsNode, 'sheet')) {
    const name = attr(sh, 'name') || 'Sheet' + (sheetDefs.length + 1);
    const rid = attr(sh, 'r:id') || attr(sh, 'id');
    let part = rels.get(rid) || relsFallback.get(rid) || null;
    if (!part) part = 'xl/worksheets/sheet' + (sheetDefs.length + 1) + '.xml';
    sheetDefs.push({ name, part });
  }
  if (!sheetDefs.length) throw new Error('xlsxRead：workbook.xml 中没有工作表');

  const result = [];
  for (const def of sheetDefs) {
    const text = readText(def.part);
    result.push({ name: def.name, rows: text ? parseWorksheet(text, shared, cellXfs, date1904) : [] });
  }
  return { sheets: result };
}

/**
 * 解析单个 worksheet XML。
 * 关键点：单元格的列位置以 r 属性为准（稀疏/跳格引用必须回填到正确列）。
 */
function parseWorksheet(text, shared, cellXfs, date1904) {
  const root = xmlRoot(parseXml(text));
  const data = firstChild(root, 'sheetData');
  const rows = [];
  if (!data) return rows;

  let autoRow = 0;
  for (const rowNode of childNodes(data, 'row')) {
    const rAttr = parseInt(attr(rowNode, 'r'), 10);
    const rowIdx = Number.isFinite(rAttr) && rAttr > 0 ? rAttr - 1 : autoRow;
    autoRow = rowIdx + 1;

    const arr = rows[rowIdx] || (rows[rowIdx] = []);
    let autoCol = 0;
    for (const c of childNodes(rowNode, 'c')) {
      const ref = attr(c, 'r');
      const pos = parseCellRef(ref);
      const colIdx = pos.col >= 0 ? pos.col : autoCol;
      autoCol = colIdx + 1;

      const t = attr(c, 't') || 'n';
      const sIdx = parseInt(attr(c, 's'), 10);
      const kind = Number.isFinite(sIdx) && sIdx >= 0 ? cellXfs[sIdx] || null : null;

      let value = '';
      const fNode = firstChild(c, 'f');
      if (fNode) {
        // 公式单元格：返回公式本体，便于平台原样回写
        const fText = fNode.text || '';
        value = fText ? '=' + fText : cellRawValue(c, t, shared, kind, date1904);
      } else {
        value = cellRawValue(c, t, shared, kind, date1904);
      }
      arr[colIdx] = value;
    }
    // 行内空洞补空串，保证是稠密数组
    for (let i = 0; i < arr.length; i++) if (arr[i] === undefined) arr[i] = '';
  }
  // 缺行补空行
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

/** 取单元格的原始值并按类型转换成字符串 */
function cellRawValue(c, t, shared, kind, date1904) {
  if (t === 'inlineStr') {
    const is = firstChild(c, 'is');
    return is ? collectText(is) : '';
  }
  const vNode = firstChild(c, 'v');
  const raw = vNode ? vNode.text : '';

  if (t === 's') {
    const i = parseInt(raw, 10);
    return Number.isFinite(i) && shared[i] !== undefined ? shared[i] : '';
  }
  if (t === 'str') return raw;
  if (t === 'b') return raw === '1' || /^true$/i.test(raw) ? 'TRUE' : 'FALSE';
  if (t === 'e') return raw;
  if (t === 'd') {
    // 少数实现直接写 ISO 日期
    const s = String(raw).replace('T', ' ').replace(/Z$/, '').replace(/\.\d+$/, '');
    return s;
  }
  // 数值型：若样式是日期则转成日期字符串
  if (kind && raw !== '') {
    const num = Number(raw);
    if (Number.isFinite(num)) return serialToDisplay(num, kind, date1904);
  }
  return raw;
}

/* ==========================================================================
 * 八、CSV 读写（UTF-8 with BOM）
 * ========================================================================== */

/** 单个 CSV 字段的文本化 */
function csvFieldText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const hasTime = v.getHours() || v.getMinutes() || v.getSeconds();
    return formatDate(v, !!hasTime);
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object' && !(v instanceof Buffer) && v.v !== undefined) return csvFieldText(v.v);
  return String(v);
}

/** 按 RFC4180 转义一个 CSV 字段 */
function csvEscape(text) {
  const s = sanitizeXmlText(text); // 顺带剔除控制字符，避免 Excel 报错
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/**
 * 写出 CSV（UTF-8 + BOM，CRLF 换行，Excel 打开中文不乱码）。
 * @param {any[][]} rows
 * @returns {Buffer}
 */
function csvWrite(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const lines = [];
  for (const row of list) {
    const cells = Array.isArray(row) ? row : [row];
    lines.push(cells.map((c) => csvEscape(csvFieldText(c))).join(','));
  }
  return Buffer.from('\uFEFF' + lines.join('\r\n'), 'utf8');
}

/**
 * 解析 CSV：支持引号包裹、逗号/换行/双引号转义、CRLF / LF / CR，
 * 自动识别并剥离 UTF-8 BOM。
 * @param {Buffer|string} buf
 * @returns {string[][]}
 */
function csvRead(buf) {
  let s = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf == null ? '' : buf);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const rows = [];
  if (s === '') return rows;

  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\r') {
      if (s[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* ==========================================================================
 * 九、DOCX 写入（OOXML WordprocessingML）
 * ========================================================================== */

const DOCX_USABLE_TWIPS = 9026; // A4 宽 11906 - 左右页边距 1440*2
const EMU_PER_PT = 12700;
const EMU_PER_PX = 9525; // 96 DPI

/** 颜色归一化为 6 位大写十六进制（docx 不带 alpha） */
function docxColor(color) {
  if (!color) return null;
  const argb = normalizeColor(color);
  if (!argb) return null;
  return argb.length === 8 ? argb.slice(2) : argb;
}

/** 生成 w:rPr */
function rPrXml(o) {
  const p = [];
  if (o.font) {
    const f = escapeAttr(o.font);
    p.push('<w:rFonts w:ascii="' + f + '" w:eastAsia="' + f + '" w:hAnsi="' + f + '" w:cs="' + f + '"/>');
  }
  if (o.bold) p.push('<w:b/><w:bCs/>');
  if (o.italic) p.push('<w:i/><w:iCs/>');
  if (o.color) p.push('<w:color w:val="' + o.color + '"/>');
  if (o.size) {
    const half = Math.max(2, Math.round(o.size * 2));
    p.push('<w:sz w:val="' + half + '"/><w:szCs w:val="' + half + '"/>');
  }
  if (o.shd) p.push('<w:shd w:val="clear" w:color="auto" w:fill="' + o.shd + '"/>');
  return p.length ? '<w:rPr>' + p.join('') + '</w:rPr>' : '';
}

/** 生成 w:pPr（顺序必须符合 schema） */
function pPrXml(o) {
  const p = [];
  if (o.style) p.push('<w:pStyle w:val="' + escapeAttr(o.style) + '"/>');
  if (o.numId) p.push('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="' + o.numId + '"/></w:numPr>');
  if (o.border) {
    p.push('<w:pBdr>' + o.border + '</w:pBdr>');
  }
  if (o.shd) p.push('<w:shd w:val="clear" w:color="auto" w:fill="' + o.shd + '"/>');
  const spacing = [];
  if (o.before !== undefined) spacing.push('w:before="' + o.before + '"');
  if (o.after !== undefined) spacing.push('w:after="' + o.after + '"');
  if (o.line) spacing.push('w:line="' + o.line + '" w:lineRule="auto"');
  if (spacing.length) p.push('<w:spacing ' + spacing.join(' ') + '/>');
  if (o.indentLeft || o.indentChars) {
    let ind = '<w:ind';
    if (o.indentLeft) ind += ' w:left="' + o.indentLeft + '"';
    if (o.indentChars) ind += ' w:leftChars="' + o.indentChars + '"';
    ind += '/>';
    p.push(ind);
  }
  if (o.align) p.push('<w:jc w:val="' + o.align + '"/>');
  if (o.rPr) p.push(o.rPr);
  return p.length ? '<w:pPr>' + p.join('') + '</w:pPr>' : '';
}

/** 文本 -> 转义后的 w:t 序列（内嵌换行转 <w:br/>） */
function textToRuns(text) {
  const parts = String(text).split(/\r\n|\r|\n/);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) out.push('<w:br/>');
    if (parts[i] !== '') out.push('<w:t xml:space="preserve">' + escapeXml(parts[i]) + '</w:t>');
  }
  return out.join('');
}

/**
 * 把带行内标记的文本切成 run 列表：
 *   **加粗**  ->  加粗 run
 *   `代码`    ->  等宽 + 浅底纹 + 深红字
 * @param {string} text
 * @param {object} base 基础字符格式
 * @returns {string} 多个 <w:r> 拼接
 */
function inlineRunsXml(text, base) {
  const s = String(text == null ? '' : text);
  const out = [];
  const re = /(\*\*[\s\S]+?\*\*|`[^`]+`)/g;
  let last = 0;
  let m;
  const pushPlain = (t) => {
    if (!t) return;
    out.push('<w:r>' + rPrXml(base) + textToRuns(t) + '</w:r>');
  };
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) pushPlain(s.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('**')) {
      const inner = token.slice(2, -2);
      out.push('<w:r>' + rPrXml(Object.assign({}, base, { bold: true })) + textToRuns(inner) + '</w:r>');
    } else {
      const inner = token.slice(1, -1);
      out.push('<w:r>' + rPrXml(Object.assign({}, base, {
        font: 'Consolas', color: 'C7254E', shd: 'F2F2F2', bold: false,
      })) + textToRuns(inner) + '</w:r>');
    }
    last = m.index + token.length;
  }
  if (last < s.length) pushPlain(s.slice(last));
  if (!out.length) out.push('<w:r>' + rPrXml(base) + textToRuns(s) + '</w:r>');
  return out.join('');
}

/** 一个普通段落 */
function paraXml(text, opts) {
  const o = opts || {};
  const pPr = pPrXml(Object.assign({}, o.pPr, o.rPr ? { rPr: rPrXml(o.rPr) } : null));
  return '<w:p>' + pPr + inlineRunsXml(text, o.rPr || {}) + '</w:p>';
}

/** 空段落（用于 hr、spacer） */
function emptyParaXml(pPrObj) {
  return '<w:p>' + pPrXml(pPrObj || {}) + '</w:p>';
}

/** 从图片二进制里读取像素尺寸（PNG / JPEG） */
function imagePixelSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), ext: 'png' };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), ext: 'jpg' };
      }
      const len = buf.readUInt16BE(i + 2);
      i += 2 + (len >= 2 ? len : 2);
    }
    return { w: 0, h: 0, ext: 'jpg' };
  }
  return { w: 0, h: 0, ext: 'png' };
}

/** 生成内嵌图片段落 */
function imageParaXml(block, ctx) {
  const data = toBuffer(block.data);
  if (!data.length) return '';
  const meta = imagePixelSize(data);
  let ext = (block.ext || meta.ext || 'png').toLowerCase();
  if (ext === 'jpeg') ext = 'jpg';
  if (ext !== 'png' && ext !== 'jpg' && ext !== 'gif' && ext !== 'bmp') ext = meta.ext;
  const contentType = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;

  // rId1 = styles.xml、rId2 = numbering.xml 已被占用，图片从 rId3 开始
  const relId = 'rId' + (ctx.rels.length + 3);
  const fileName = 'image' + (ctx.media.length + 1) + '.' + ext;
  ctx.rels.push({ id: relId, type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', target: 'media/' + fileName });
  ctx.media.push({ name: 'word/media/' + fileName, data, contentType, ext });

  // 尺寸：pt 优先，其次按像素(96dpi)换算，最后按 A4 可用宽度等比缩放
  let cx = block.widthPt ? block.widthPt * EMU_PER_PT : (meta.w ? meta.w * EMU_PER_PX : 400 * EMU_PER_PX);
  let cy = block.heightPt ? block.heightPt * EMU_PER_PT : (meta.h ? meta.h * EMU_PER_PX : 300 * EMU_PER_PX);
  if (block.widthPt && !block.heightPt && meta.w && meta.h) cy = (block.widthPt * EMU_PER_PT) * (meta.h / meta.w);
  if (block.heightPt && !block.widthPt && meta.w && meta.h) cx = (block.heightPt * EMU_PER_PT) * (meta.w / meta.h);
  const maxCx = DOCX_USABLE_TWIPS * 635;
  if (cx > maxCx) {
    const k = maxCx / cx;
    cx = maxCx;
    cy = Math.round(cy * k);
  }
  cx = Math.max(1, Math.round(cx));
  cy = Math.max(1, Math.round(cy));

  const id = ctx.docPrId++;
  const drawing =
    '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:docPr id="' + id + '" name="图片 ' + id + '" descr="' + escapeAttr(fileName) + '"/>' +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + escapeAttr(fileName) + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="' + relId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';

  return '<w:p>' + pPrXml({ align: 'center' }) + '<w:r>' + drawing + '</w:r></w:p>';
}

/** 表格单元格中的内容（支持多段落 + 行内标记） */
function cellContentXml(value, rPr, align) {
  const lines = String(value == null ? '' : value).split(/\r\n|\r|\n/);
  const out = [];
  for (const line of lines) {
    out.push('<w:p>' + pPrXml({ align: align || 'left' }) + inlineRunsXml(line, rPr || {}) + '</w:p>');
  }
  if (!out.length) out.push(emptyParaXml({}));
  return out.join('');
}

/** 计算各列宽度（twips）：widths 视为相对权重，等比缩放到 A4 可用宽度 */
function computeColWidths(count, widths) {
  const total = DOCX_USABLE_TWIPS;
  const ws = [];
  for (let i = 0; i < count; i++) {
    const w = widths && Number(widths[i]) > 0 ? Number(widths[i]) : 1;
    ws.push(w);
  }
  const sum = ws.reduce((a, b) => a + b, 0) || 1;
  let used = 0;
  return ws.map((w, i) => {
    let v = i === count - 1 ? total - used : Math.round((w / sum) * total);
    if (v < 100) v = 100;
    used += v;
    return v;
  });
}

const TBL_BORDERS_XML =
  '<w:tblBorders>' +
  '<w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>' +
  '<w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>' +
  '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>' +
  '<w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>' +
  '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>' +
  '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>' +
  '</w:tblBorders>';

/** 生成一个完整表格 */
function tableXml(header, rows, widths, ctx) {
  const bodyRows = Array.isArray(rows) ? rows : [];
  let colCount = header ? header.length : 0;
  for (const r of bodyRows) if (Array.isArray(r) && r.length > colCount) colCount = r.length;
  if (colCount === 0) colCount = 1;

  const cols = computeColWidths(colCount, widths);
  const out = [];
  out.push('<w:tbl>');
  out.push('<w:tblPr><w:tblW w:w="' + DOCX_USABLE_TWIPS + '" w:type="dxa"/><w:jc w:val="center"/>' + TBL_BORDERS_XML +
    '<w:tblLayout w:type="fixed"/>' +
    '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>' +
    '</w:tblPr>');
  out.push('<w:tblGrid>' + cols.map((w) => '<w:gridCol w:w="' + w + '"/>').join('') + '</w:tblGrid>');

  const buildRow = (cells, isHeader) => {
    const tcs = [];
    for (let i = 0; i < colCount; i++) {
      const val = i < cells.length ? cells[i] : '';
      const rPr = isHeader ? { bold: true, size: 10.5 } : { size: 10.5 };
      const tcPr = '<w:tcPr><w:tcW w:w="' + cols[i] + '" w:type="dxa"/>' +
        (isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="D9E1F2"/>' : '') +
        '<w:vAlign w:val="center"/></w:tcPr>';
      tcs.push('<w:tc>' + tcPr + cellContentXml(val, rPr, isHeader ? 'center' : null) + '</w:tc>');
    }
    return '<w:tr>' + (isHeader ? '<w:trPr><w:tblHeader/></w:trPr>' : '') + tcs.join('') + '</w:tr>';
  };

  if (header && header.length) out.push(buildRow(header, true));
  for (const r of bodyRows) out.push(buildRow(Array.isArray(r) ? r : [r], false));
  out.push('</w:tbl>');
  return out.join('');
}

/** 键值表格（label 灰底加粗） */
function kvXml(items, ctx) {
  const list = Array.isArray(items) ? items : [];
  const cols = [2300, DOCX_USABLE_TWIPS - 2300];
  const out = [];
  out.push('<w:tbl>');
  out.push('<w:tblPr><w:tblW w:w="' + DOCX_USABLE_TWIPS + '" w:type="dxa"/><w:jc w:val="center"/>' + TBL_BORDERS_XML +
    '<w:tblLayout w:type="fixed"/>' +
    '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>' +
    '</w:tblPr>');
  out.push('<w:tblGrid>' + cols.map((w) => '<w:gridCol w:w="' + w + '"/>').join('') + '</w:tblGrid>');
  for (const item of list) {
    const label = Array.isArray(item) ? item[0] : item;
    const value = Array.isArray(item) ? item[1] : '';
    out.push(
      '<w:tr>' +
      '<w:tc><w:tcPr><w:tcW w:w="' + cols[0] + '" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/><w:vAlign w:val="center"/></w:tcPr>' +
      cellContentXml(label, { bold: true, size: 10.5 }, 'left') + '</w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="' + cols[1] + '" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>' +
      cellContentXml(value, { size: 10.5 }, 'left') + '</w:tc>' +
      '</w:tr>'
    );
  }
  out.push('</w:tbl>');
  return out.join('');
}

/** 生成 numbering.xml（1 = 项目符号，2 = 编号，其余为编号重启实例） */
function numberingXml(numbers) {
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  out.push('<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">');
  out.push('<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' +
    '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>' +
    '<w:pPr><w:ind w:left="420" w:hanging="420"/></w:pPr>' +
    '<w:rPr><w:rFonts w:ascii="等线" w:eastAsia="等线" w:hAnsi="等线" w:hint="eastAsia"/></w:rPr></w:lvl></w:abstractNum>');
  out.push('<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' +
    '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>' +
    '<w:pPr><w:ind w:left="420" w:hanging="420"/></w:pPr>' +
    '<w:rPr><w:rFonts w:ascii="等线" w:eastAsia="等线" w:hAnsi="等线" w:hint="eastAsia"/></w:rPr></w:lvl></w:abstractNum>');
  out.push('<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>');
  out.push('<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>');
  for (let i = 0; i < numbers.length; i++) {
    // 每组编号列表用独立 numId + startOverride，保证每组都从 1 开始
    out.push('<w:num w:numId="' + numbers[i] + '"><w:abstractNumId w:val="1"/>' +
      '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>');
  }
  out.push('</w:numbering>');
  return out.join('');
}

/** docx 的 styles.xml（中文用 w:eastAsia 指定字体） */
function docxStylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults>' +
    '<w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="等线" w:eastAsia="等线" w:hAnsi="等线" w:cs="等线"/>' +
    '<w:sz w:val="21"/><w:szCs w:val="21"/>' +
    '<w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA"/>' +
    '</w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
    '</w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/>' +
    '<w:pPr><w:contextualSpacing/></w:pPr></w:style>' +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>' +
    '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
    '</w:styles>';
}

const DOCX_FONT_HEAD = '微软雅黑';
const DOCX_FONT_BODY = '等线';

/** 渲染单个块 -> document.xml 里的 XML 片段 */
function renderDocxBlock(block, ctx) {
  if (!block || typeof block !== 'object') return '';
  switch (block.type) {
    case 'title':
      return paraXml(block.text, {
        pPr: { align: 'center', before: 0, after: 240, line: 300 },
        rPr: { bold: true, size: 22, font: DOCX_FONT_HEAD, color: '1F2937' },
      });
    case 'subtitle':
      return paraXml(block.text, {
        pPr: { align: 'center', after: 360, line: 260 },
        rPr: { size: 9, color: '6B7280', font: DOCX_FONT_BODY },
      });
    case 'h1':
      return paraXml(block.text, {
        pPr: { before: 320, after: 160, line: 300 },
        rPr: { bold: true, size: 16, font: DOCX_FONT_HEAD, color: '1F2937' },
      });
    case 'h2':
      return paraXml(block.text, {
        pPr: { before: 260, after: 120, line: 300 },
        rPr: { bold: true, size: 14, font: DOCX_FONT_HEAD, color: '1F2937' },
      });
    case 'h3':
      return paraXml(block.text, {
        pPr: { before: 200, after: 100, line: 300 },
        rPr: { bold: true, size: 12, font: DOCX_FONT_HEAD, color: '374151' },
      });
    case 'p': {
      const rPr = { size: block.size || 10.5, font: DOCX_FONT_BODY };
      if (block.bold) rPr.bold = true;
      const c = docxColor(block.color);
      if (c) rPr.color = c;
      const pPr = { after: 120, line: 320 };
      if (block.align) pPr.align = block.align === 'justify' ? 'both' : block.align;
      if (block.indent) { pPr.indentLeft = Math.round(block.indent * 210); pPr.indentChars = Math.round(block.indent * 100); }
      return paraXml(block.text, { pPr, rPr });
    }
    case 'bullet':
      return paraXml(block.text, {
        pPr: { style: 'ListParagraph', numId: 1, after: 60, line: 300 },
        rPr: { size: 10.5, font: DOCX_FONT_BODY },
      });
    case 'numbered': {
      if (!ctx.currentNumId) {
        ctx.nextNumId += 1;
        ctx.currentNumId = ctx.nextNumId;
        ctx.extraNums.push(ctx.currentNumId);
      }
      return paraXml(block.text, {
        pPr: { style: 'ListParagraph', numId: ctx.currentNumId, after: 60, line: 300 },
        rPr: { size: 10.5, font: DOCX_FONT_BODY },
      });
    }
    case 'kv':
      return kvXml(block.items, ctx);
    case 'table':
      return tableXml(block.header, block.rows, block.widths, ctx);
    case 'image':
      return imageParaXml(block, ctx);
    case 'pagebreak':
      return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    case 'quote':
      return paraXml(block.text, {
        pPr: {
          after: 160, line: 320, indentLeft: 220, indentChars: 100,
          shd: 'F6F8FA',
          border: '<w:left w:val="single" w:sz="18" w:space="8" w:color="1F6FEB"/>',
        },
        rPr: { size: 10.5, color: '4B5563', font: DOCX_FONT_BODY },
      });
    case 'hr':
      return emptyParaXml({
        after: 120,
        border: '<w:bottom w:val="single" w:sz="6" w:space="1" w:color="D0D7DE"/>',
      });
    default:
      // 未知类型：有 text 就当普通段落，否则忽略
      return block.text ? paraXml(block.text, { pPr: { after: 120 }, rPr: { size: 10.5, font: DOCX_FONT_BODY } }) : '';
  }
}

/**
 * 写出真正的 .docx（OOXML WordprocessingML）。
 * A4 页面，正文等线，标题微软雅黑。
 *
 * @param {Array<object>} blocks 见文件头用法说明
 * @returns {Buffer}
 */
function docxWrite(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const ctx = {
    rels: [],
    media: [],
    docPrId: 1,
    nextNumId: 2,     // 1/2 已被 bullet / 首个编号列表占用
    currentNumId: 0,  // 连续编号列表共用一个 numId，中间被其他块打断则重新开始
    extraNums: [],
  };

  const body = [];
  for (const block of list) {
    const t = block && block.type;
    if (t !== 'numbered') ctx.currentNumId = 0; // 编号列表被其他块打断 -> 下一组重新编号
    const xml = renderDocxBlock(block, ctx);
    if (xml) body.push(xml);
  }
  if (!body.length) body.push(emptyParaXml({}));

  // 节属性（A4：11906 x 16838 twips）
  body.push('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/>' +
    '<w:cols w:space="425"/><w:docGrid w:type="lines" w:linePitch="312"/></w:sectPr>');

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<w:body>' + body.join('') + '</w:body></w:document>';

  // 关系：styles / numbering / 图片
  const rels = [
    { id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles', target: 'styles.xml' },
    { id: 'rId2', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering', target: 'numbering.xml' },
  ].concat(ctx.rels);

  const files = [];
  const ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>'];
  const mediaExts = new Set();
  for (const m of ctx.media) {
    if (mediaExts.has(m.ext)) continue;
    mediaExts.add(m.ext);
    ct.push('<Default Extension="' + m.ext + '" ContentType="' + m.contentType + '"/>');
  }
  ct.push('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>');
  ct.push('<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>');
  ct.push('<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>');
  ct.push('<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>');
  ct.push('<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>');
  ct.push('</Types>');
  files.push({ name: '[Content_Types].xml', data: ct.join('') });

  files.push({
    name: '_rels/.rels',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>',
  });

  files.push({
    name: 'word/_rels/document.xml.rels',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels.map((r) => '<Relationship Id="' + r.id + '" Type="' + r.type + '" Target="' + escapeAttr(r.target) + '"/>').join('') +
      '</Relationships>',
  });
  files.push({ name: 'word/document.xml', data: documentXml });
  files.push({ name: 'word/styles.xml', data: docxStylesXml() });
  files.push({ name: 'word/numbering.xml', data: numberingXml(ctx.extraNums) });
  for (const m of ctx.media) files.push({ name: m.name, data: m.data });

  const nowIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files.push({
    name: 'docProps/core.xml',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>质量改进报告</dc:title><dc:creator>QIP Agent</dc:creator><cp:lastModifiedBy>QIP Agent</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + nowIso + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + nowIso + '</dcterms:modified>' +
      '</cp:coreProperties>',
  });
  files.push({
    name: 'docProps/app.xml',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>QIP Office</Application><AppVersion>1.0</AppVersion></Properties>',
  });

  return zipWrite(files);
}

/* ==========================================================================
 * 十、导出
 * ========================================================================== */

module.exports = {
  // ZIP
  zipWrite,
  zipRead,
  // XLSX
  xlsxWrite,
  xlsxRead,
  // CSV
  csvWrite,
  csvRead,
  // DOCX
  docxWrite,
};

// 便于测试/排查的内部工具：定义为不可枚举，保证 module.exports 的键
// 恰好是约定的 7 个公共 API（Object.keys 只看到它们）。
Object.defineProperty(module.exports, '_internals', {
  value: { crc32, parseXml, escapeXml, colLetter, colIndex, parseCellRef, dateToSerial, serialToDisplay },
  enumerable: false,
  writable: false,
  configurable: true,
});



