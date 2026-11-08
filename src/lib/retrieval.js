'use strict';
/**
 * 中文语义检索（零依赖 BM25 + 字符 bigram）
 * ------------------------------------------------------------------
 * 不需要外部向量服务即可工作：
 *   · 中文按「单字 + 双字组合」切分，英文/数字按词切分；
 *   · BM25 打分（k1=1.5, b=0.75），字段加权（标题 > 标签 > 正文）；
 *   · 同时提供 bigram 余弦相似度，用于问题去重与相似案例匹配。
 * 若企业后续接入向量库（如 bge + Milvus），只需替换 search()，上层不变。
 */

const STOP = new Set(['的', '了', '和', '与', '及', '或', '在', '是', '有', '为', '对', '上', '下', '中', '个', '如何', '怎么', '什么', '请问', '帮我', '一下', '以及', '并且', '这个', '那个', '我们', '他们']);

/** 分词：中文单字 + bigram，英文数字整词，保留单位符号 */
function tokenize(text) {
  const s = String(text || '').toLowerCase();
  const tokens = [];
  const re = /[a-z0-9]+(?:[.\-_/][a-z0-9]+)*|[\u4e00-\u9fa5]+|[a-z]+/g;
  let m;
  while ((m = re.exec(s))) {
    const t = m[0];
    if (/^[\u4e00-\u9fa5]+$/.test(t)) {
      for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (!STOP.has(ch)) tokens.push(ch);
        if (i < t.length - 1) {
          const bg = t.slice(i, i + 2);
          if (!STOP.has(bg)) tokens.push(bg);
        }
      }
    } else {
      if (!STOP.has(t)) tokens.push(t);
    }
  }
  return tokens;
}

function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

/**
 * 构建 BM25 索引
 * @param {Array<object>} docs
 * @param {Array<{field:string, weight:number}>} fields
 */
function buildIndex(docs, fields) {
  const df = new Map();
  const items = [];
  let totalLen = 0;
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const tf = new Map();
    let len = 0;
    for (const f of fields) {
      const raw = resolveField(doc, f.field);
      const vals = Array.isArray(raw) ? raw : [raw];
      const toks = tokenize(vals.filter(Boolean).join(' '));
      len += toks.length * (f.weight || 1);
      const local = termFreq(toks);
      for (const [t, c] of local) tf.set(t, (tf.get(t) || 0) + c * (f.weight || 1));
    }
    const seen = new Set(tf.keys());
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
    items.push({ doc, tf, len });
    totalLen += len;
  }
  return { docs, items, df, avgLen: items.length ? totalLen / items.length : 1, n: items.length, fields };
}

function resolveField(obj, path) {
  return path.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
}

/**
 * BM25 检索
 * @returns {Array<{doc:object, score:number, matched:string[]}>}
 */
function search(index, query, topK = 8, opts = {}) {
  const k1 = 1.5, b = 0.75;
  const qTokens = [...new Set(tokenize(query))];
  if (!qTokens.length) return [];
  const scored = [];
  for (const item of index.items) {
    let score = 0;
    const matched = [];
    for (const t of qTokens) {
      const f = item.tf.get(t);
      if (!f) continue;
      const dfv = index.df.get(t) || 0.5;
      const idf = Math.log(1 + (index.n - dfv + 0.5) / (dfv + 0.5));
      const denom = f + k1 * (1 - b + b * (item.len / index.avgLen));
      score += idf * (f * (k1 + 1)) / denom;
      matched.push(t);
    }
    if (score <= 0) continue;
    // 覆盖率加成：命中不同查询词越多越相关
    score *= 1 + 0.15 * Math.min(matched.length, 6);
    if (opts.filter && !opts.filter(item.doc)) continue;
    scored.push({ doc: item.doc, score: Number(score.toFixed(4)), matched });
  }
  scored.sort((a, b2) => b2.score - a.score);
  return scored.slice(0, topK);
}

/**
 * 字符 bigram 余弦相似度，用于问题去重与相似案例匹配（0~1）
 * 做法：先归一化（去空格/标点/全角半角、统一小写），再在「整个字符串」上取字符 bigram。
 * 这样"左 A 柱线束干涉"与"左A柱线束支架干涉"仍能匹配上，不受空格与字母混排影响。
 */
function similarity(a, b) {
  const va = vec(charBigrams(a)), vb = vec(charBigrams(b));
  let dot = 0, na = 0, nb = 0;
  for (const v of va.values()) na += v * v;
  for (const v of vb.values()) nb += v * v;
  for (const [k, v] of va) { const w = vb.get(k); if (w) dot += v * w; }
  if (!na || !nb) return 0;
  return Number((dot / (Math.sqrt(na) * Math.sqrt(nb))).toFixed(4));
}

/** 归一化 + 字符 bigram（含单字，兼容极短文本） */
function charBigrams(input) {
  const s = String(input || '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、；：！？（）【】《》"'`~!@#$%^&*()_+\-=\[\]{}|\\;:'",.<>/?·…—]/g, '');
  const out = [];
  if (s.length === 1) return [s];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

function vec(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

/** 关键词高亮片段（用于前端展示命中原文） */
function snippet(text, query, len = 120) {
  const s = String(text || '');
  const qs = [...new Set(tokenize(query))].filter((t) => t.length >= 1);
  let best = -1;
  for (const q of qs) {
    const i = s.indexOf(q);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  if (best < 0) return s.slice(0, len) + (s.length > len ? '…' : '');
  const start = Math.max(0, best - Math.floor(len / 3));
  return (start > 0 ? '…' : '') + s.slice(start, start + len) + (start + len < s.length ? '…' : '');
}

module.exports = { tokenize, buildIndex, search, similarity, charBigrams, snippet };
