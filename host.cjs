'use strict';
/**
 * 质量平台 · 本地服务端（零依赖）
 * ------------------------------------------------------------------
 * 职责：
 *   ① 静态托管前端（public/）
 *   ② 代理大模型请求（解决浏览器跨域 + 密钥不出前端）
 *   ③ 暴露平台 REST API（问题库/项目/SPC/知识库/OA/收益/报表/导入导出）
 *   ④ SSE 流式推送智能体的思考、工具调用链与结果
 *
 * 启动：node server.js  （或双击 start.bat）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const os = require('os');
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
// 指定数据库目录：默认 DSH_HOME/qip-platform/data，可用 QIP_DATA_DIR 覆盖
const DATA_DIR = process.env.QIP_DATA_DIR || path.join(DSH_HOME, 'qip-platform', 'data');
const OUTPUT_DIR = path.join(DATA_DIR, 'reports');
// 版式：大中型企业版（large）/ 中小型企业版（sme），两套数据各存一个库
const SCALE_FILE = path.join(DATA_DIR, 'active-scale.json');
const SCALES = [
  { key: 'large', label: '大中型企业版' },
  { key: 'sme', label: '中小型企业版' },
];
function currentScale() {
  try {
    const raw = JSON.parse(fs.readFileSync(SCALE_FILE, 'utf8'));
    return SCALES.some((s) => s.key === raw.scale) ? raw.scale : 'large';
  } catch (_) {
    return 'large';
  }
}
function writeScale(scale) {
  fs.writeFileSync(SCALE_FILE, JSON.stringify({ scale, at: new Date().toISOString() }, null, 2), 'utf8');
}

const store = require('./src/lib/store');
const qms = require('./src/lib/qms');
const agent = require('./agent-host.cjs');
const registry = require('./src/tools/registry');
require('./src/tools/data');
require('./src/tools/analysis');
require('./src/tools/business');
require('./src/tools/docs');
const docsTools = require('./src/tools/docs');

/* 运行时依赖由 index.js 注入：真实 DeepSeek（Harness 内置 LLM 服务）*/
const runtime = { llm: null, model: null };
function setRuntime(next) { Object.assign(runtime, next || {}); }

const PORT = Number(process.env.PORT || 8760);
const HOST = process.env.HOST || '127.0.0.1';

/* ================================================================== */
/* 工具函数                                                           */
/* ================================================================== */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}
function sendText(res, code, text, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(text);
}
function readBody(req, maxBytes = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { reject(new Error('请求体过大（上限 ' + Math.round(maxBytes / 1048576) + 'MB）')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const b = await readBody(req);
  if (!b.length) return {};
  try { return JSON.parse(b.toString('utf8')); } catch (e) { throw new Error('请求体不是合法 JSON'); }
}
function qs(req) {
  const u = new URL(req.url || '/', 'http://x');
  const out = {};
  u.searchParams.forEach((value, key) => { out[key] = value; });
  return out;
}

/** 对外输出设置时隐藏 API Key 明文 */
function publicSettings() {
  const s = JSON.parse(JSON.stringify(store.db.settings || {}));
  const model = runtime.model || null;
  s.llm = Object.assign({}, s.llm || {}, {
    source: 'deepseek-harness',
    hasApiKey: !!model, // 直接复用 Harness 已登录的 DeepSeek 模型，无需单独填 Key
    provider: model ? model.provider : '',
    model: model ? model.model : '',
    modelLabel: model ? (model.provider + ' / ' + model.model) : '未连接',
    description: model
      ? '插件内所有 AI 能力都通过 DeepSeek Harness 当前模型真实调用（真实模型调用，非预设话术）'
      : 'Harness 当前没有可用模型，请先在 Harness 里完成模型接入',
  });
  delete s.llm.apiKey;
  return s;
}

/* ================================================================== */
/* 路由表                                                             */
/* ================================================================== */
const routes = [];
function route(method, pattern, handler) { routes.push({ method, pattern, handler }); }
function match(method, pathname) {
  for (const r of routes) {
    if (r.method !== method && r.method !== '*') continue;
    const m = pathname.match(r.pattern);
    if (m) return { handler: r.handler, params: m.slice(1).map(decodeURIComponent) };
  }
  return null;
}

/* ---------------- 健康检查与元信息 ---------------- */
route('GET', /^\/api\/health$/, async (req, res) => {
  sendJson(res, 200, {
    ok: true, service: brandName(), version: '2.0.0',
    uptime: Math.round(process.uptime()) + 's',
    dataDir: DATA_DIR, counts: countAll(),
    db: store.persist ? store.persist.info() : { engine: 'json', path: store.file },
    llmConfigured: !!runtime.llm,
    model: runtime.model || null,
  });
});
route('GET', /^\/api\/bootstrap$/, async (req, res) => {
  const snap = docsTools.dashboardSnapshot('');
  sendJson(res, 200, {
    ok: true,
    org: store.getSetting('org', {}),
    brand: brandName(),
    scale: currentScale(),
    scales: SCALES,
    naming: currentNaming(),
    settings: publicSettings(),
    counts: countAll(),
    todos: store.col('todos').find((t) => !t.done).slice(0, 20),
    pendingActions: store.col('pendingActions').find((a) => a.status === 'pending'),
    tools: registry.all().map((t) => ({ name: t.name, label: t.label, plugin: t.plugin, write: t.write, confirm: t.confirm, description: t.description })),
    kpi: snap,
    serverTime: new Date().toISOString(),
  });
});
function countAll() {
  return {
    issues: store.col('issues').count(), projects: store.col('projects').count(),
    measurements: store.col('measurements').count(), spcChars: store.col('spcChars').count(),
    knowledge: store.col('knowledge').count(), defects: store.col('defects').count(),
    members: store.col('members').count(), workflows: store.col('workflows').count(),
    qrqc: store.col('qrqc').count(), benefits: store.col('benefits').count(),
    reports: store.col('reports').count(), audit: store.col('audit').count(),
    chats: store.col('chats').count(),
  };
}

/* ---------------- 设置 ---------------- */
route('GET', /^\/api\/settings$/, async (req, res) => sendJson(res, 200, { ok: true, settings: publicSettings() }));
route('POST', /^\/api\/settings$/, async (req, res) => {
  const body = await readJson(req);
  // 深度合并
  function merge(base, patch) {
    for (const k of Object.keys(patch || {})) {
      if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) { base[k] = merge(base[k] || {}, patch[k]); }
      else base[k] = patch[k];
    }
    return base;
  }
  const cur = store.db.settings || {};
  // apiKey 为空字符串时不覆盖已有值；为 null 时表示清除
  const incoming = JSON.parse(JSON.stringify(body.settings || body));
  if (incoming.llm) {
    if (incoming.llm.apiKey === '' || incoming.llm.apiKey === undefined) delete incoming.llm.apiKey;
    else if (incoming.llm.apiKey === null) incoming.llm.apiKey = '';
  }
  store.db.settings = merge(cur, incoming);
  store.touch(); store.saveSync(); store.emit();
  sendJson(res, 200, { ok: true, settings: publicSettings() });
});
/* ---------------- 版式切换：大中型企业版 / 中小型企业版 ---------------- */
route('GET', /^\/api\/scale$/, async (req, res) => sendJson(res, 200, { ok: true, scale: currentScale(), scales: SCALES }));
route('POST', /^\/api\/scale$/, async (req, res) => {
  const body = await readJson(req);
  const scale = body && body.scale;
  if (!SCALES.some((s) => s.key === scale)) {
    return sendJson(res, 400, { ok: false, error: '未知的版式：' + scale });
  }
  if (scale === currentScale()) {
    return sendJson(res, 200, { ok: true, scale, changed: false, counts: countAll() });
  }
  writeScale(scale);
  // 重新装载对应数据库（另一套数据原样保留，随时切回）
  if (saveTimer) { clearInterval(saveTimer); saveTimer = null; }
  ready = null;
  try {
    const info = await init();
    sendJson(res, 200, { ok: true, scale, changed: true, firstRun: !!info.firstRun, counts: countAll(), brand: brandName(), naming: currentNaming() });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: '切换版式失败：' + e.message });
  }
});
/* ---------------- 初始设置：公司 / 部门 / 车间 / 产品名称 ---------------- */
route('GET', /^\/api\/brand$/, async (req, res) => sendJson(res, 200, { ok: true, brand: brandName() }));
const DEFAULT_NAMING = {
  company: '某制造型企业',
  dept: '质量改进部门',
  workshops: ['一车间', '二车间', '三车间', '四车间', '五车间'],
  products: ['产品A', '产品B', '产品C'],
};
/** 平台显示名：用户在「初始设置」里填了公司名称就显示公司名称，否则用内置名 */
const DEFAULT_BRAND = '质上开源质量平台';
function brandName() {
  const s = store.db.settings || {};
  const b = typeof s.brand === 'string' ? s.brand.trim() : '';
  return b || DEFAULT_BRAND;
}

/** 当前生效的命名：org 里的公司/部门优先，其余回落 settings.naming → 内置默认 */
function currentNaming() {
  const s = store.db.settings || {};
  const n = s.naming || {};
  const org = s.org || {};
  const ws = (Array.isArray(n.workshops) && n.workshops.length) ? n.workshops.slice() : DEFAULT_NAMING.workshops.slice();
  const pd = (Array.isArray(n.products) && n.products.length) ? n.products.slice() : DEFAULT_NAMING.products.slice();
  return {
    company: org.company || n.company || DEFAULT_NAMING.company,
    dept: org.dept || n.dept || DEFAULT_NAMING.dept,
    workshops: ws,
    products: pd,
  };
}

/**
 * 两组名称的对齐：先按「完全同名」配对（这样中间插入、调换顺序都不会误替换），
 * 剩下的按顺序一一对应；多出来的旧名视为「已移除」，数据保留原名不动。
 */
function pairLists(oldList, newList) {
  const usedOld = new Set();
  const matchedNew = new Set();
  newList.forEach((nm, j) => {
    const i = oldList.findIndex((o, k) => o === nm && !usedOld.has(k));
    if (i >= 0) { usedOld.add(i); matchedNew.add(j); }
  });
  const restOld = oldList.filter((_, k) => !usedOld.has(k));
  const restNew = newList.filter((_, j) => !matchedNew.has(j));
  const pairs = [];
  const n = Math.min(restOld.length, restNew.length);
  for (let k = 0; k < n; k++) if (restOld[k] && restNew[k] && restOld[k] !== restNew[k]) pairs.push([restOld[k], restNew[k]]);
  return { pairs, dropped: restOld.slice(n), added: restNew.slice(n) };
}

/** 旧名 → 新名 的替换对（长串优先，避免短词先吃掉长词） */
function buildRenamePairs(oldN, newN) {
  const pairs = [];
  const push = (from, to) => { if (from && to && from !== to && pairs.every((p) => p[0] !== from)) pairs.push([from, to]); };
  const ws = pairLists(oldN.workshops, newN.workshops);
  const pd = pairLists(oldN.products, newN.products);
  ws.pairs.forEach(([f, t]) => push(f, t));
  pd.pairs.forEach(([f, t]) => push(f, t));
  push(oldN.company, newN.company);
  push(oldN.dept, newN.dept);
  pairs.sort((a, b) => b[0].length - a[0].length);
  return { pairs, dropped: ws.dropped.concat(pd.dropped), added: ws.added.concat(pd.added) };
}

/** 递归替换字符串（含数组与对象，就地修改 map 里的值） */
function renameStrings(node, pairs, stat) {
  if (typeof node === 'string') {
    let out = node;
    for (const [from, to] of pairs) if (out.indexOf(from) >= 0) out = out.split(from).join(to);
    if (out !== node && stat) stat.fields++;
    return out;
  }
  if (Array.isArray(node)) { for (let i = 0; i < node.length; i++) node[i] = renameStrings(node[i], pairs, stat); return node; }
  if (node && typeof node === 'object') { Object.keys(node).forEach((k) => { node[k] = renameStrings(node[k], pairs, stat); }); return node; }
  return node;
}
const RENAME_COLLECTIONS = ['issues', 'projects', 'knowledge', 'qrqc', 'todos', 'benefits', 'reports', 'members',
  'spcChars', 'defects', 'workflows', 'measurements', 'chats', 'audit', 'pendingActions'];

route('GET', /^\/api\/naming$/, async (req, res) => sendJson(res, 200, {
  ok: true, naming: currentNaming(), brand: brandName(), defaults: DEFAULT_NAMING,
  note: (store.db.settings || {}).namingNote || null,
  limits: { workshops: 12, products: 10 },
}));
route('POST', /^\/api\/naming$/, async (req, res) => {
  const body = await readJson(req);
  const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 40);
  const pick = (arr, max) => (Array.isArray(arr) ? arr : []).map(clean).filter(Boolean).slice(0, max);
  const workshops = pick(body.workshops, 12);
  const products = pick(body.products, 10);
  const company = clean(body.company) || DEFAULT_NAMING.company;
  const dept = clean(body.dept) || DEFAULT_NAMING.dept;
  if (!workshops.length) return sendJson(res, 400, { ok: false, error: '至少要有 1 个车间' });
  if (!products.length) return sendJson(res, 400, { ok: false, error: '至少要有 1 个产品' });
  if (new Set(workshops).size !== workshops.length) return sendJson(res, 400, { ok: false, error: '车间名称不能重复' });
  if (new Set(products).size !== products.length) return sendJson(res, 400, { ok: false, error: '产品名称不能重复' });
  const oldN = currentNaming();
  const newN = { company, dept, workshops, products };
  const built = buildRenamePairs(oldN, newN);
  const pairs = built.pairs;
  const stat = { fields: 0 };
  if (pairs.length) {
    RENAME_COLLECTIONS.forEach((k) => { if (store.db[k]) renameStrings(store.db[k], pairs, stat); });
  }
  store.db.settings = store.db.settings || {};
  store.db.settings.naming = newN;
  const brandIn = typeof body.brand === 'string' ? clean(body.brand) : '';
  // 公司名称还是内置占位（某制造型企业）时保持平台原名，避免「没填也变」的错觉
  store.db.settings.brand = brandIn || (company === DEFAULT_NAMING.company ? DEFAULT_BRAND : company);
  store.db.settings.org = Object.assign({}, store.db.settings.org || {}, { company, dept });
  const note = clean(body.note);
  if (note) store.db.settings.namingNote = { text: body.note, ts: new Date().toISOString() };
  store.db.meta = store.db.meta || {};
  store.db.meta.namingV = (store.db.meta.namingV || 0) + 1;
  store.touch(); store.saveSync(true); store.emit();
  console.log('[dsh-quality-up] 初始设置已应用：' + company + ' / ' + dept + ' / 车间 ' + workshops.join('、') + ' / 产品 ' + products.join('、') +
    '（替换 ' + pairs.length + ' 组旧名，改动 ' + stat.fields + ' 个字段' + (built.dropped.length ? '，移除 ' + built.dropped.length + ' 个旧名' : '') + '）');
  sendJson(res, 200, { ok: true, naming: Object.assign({}, newN, { brand: store.db.settings.brand }), renamed: { pairs: pairs.length, fields: stat.fields, dropped: built.dropped, added: built.added } });
});

/**
 * 「增加信息」：把用户自由写的需求交给 AI，判断该怎么改平台配置。
 * 只做「建议」，不直接落库；前端确认后再走 /api/naming 应用到数据。
 */
route('POST', /^\/api\/naming\/interpret$/, async (req, res) => {
  const body = await readJson(req);
  const text = String(body.text || '').trim();
  if (!text) return sendJson(res, 400, { ok: false, error: '请先在「增加信息」里写点内容' });
  const cur = currentNaming();
  // 无论有没有模型，先把这段说明存下来，别让用户的输入丢掉
  store.db.settings = store.db.settings || {};
  store.db.settings.namingNote = { text, ts: new Date().toISOString() };
  store.touch();
  if (!runtime.llm) {
    return sendJson(res, 200, {
      ok: false, needModel: true,
      error: '当前没有可用的模型：请先在 Harness 里接入模型，AI 才能判断如何调整。这段说明已经保存下来了。',
      naming: cur,
    });
  }
  const system = [
    '你是「' + brandName() + '」的配置助手。用户会用自然语言补充企业信息（产线、车间、产品、部门、班次等）。',
    '你的任务是判断：为了让平台贴合用户描述，应该把「初始设置」里的名称改成什么。',
    '只输出一个 JSON 对象，不要任何解释文字、不要 markdown 代码块。字段：',
    '{"summary":"一句话说明你打算怎么调整","naming":{"company":"公司名称或空","dept":"部门名称或空","workshops":["按顺序的车间名"],"products":["按顺序的产品名"]},',
    ' "extra":[{"path":"建议调整的设置项","value":"建议值","why":"理由"}],"steps":["给用户的操作提示"]}',
    '规则：workshops 至少 1 个、最多 12 个；products 至少 1 个、最多 10 个；',
    '如果用户没提到的类别，就把该字段留空字符串或空数组（表示保持现状）；不要编造用户没说的车间/产品名称。',
  ].join('\n');
  const user = '【当前配置】\n' + JSON.stringify(cur) + '\n\n【用户补充信息】\n' + text + '\n\n请输出 JSON。';
  try {
    const r = await runtime.llm.complete({ system, user, maxTokens: 1600 });
    const raw = String(r.text || '');
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    let plan = null;
    if (s >= 0 && e > s) { try { plan = JSON.parse(raw.slice(s, e + 1)); } catch (_) { plan = null; } }
    if (!plan) return sendJson(res, 200, { ok: false, error: 'AI 返回的不是可用的 JSON，请再试一次或把需求写得更具体。', raw: raw.slice(0, 800) });
    const nm = plan.naming || {};
    const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 40);
    const ws = (Array.isArray(nm.workshops) ? nm.workshops : []).map(clean).filter(Boolean).slice(0, 12);
    const pd = (Array.isArray(nm.products) ? nm.products : []).map(clean).filter(Boolean).slice(0, 10);
    const suggestion = {
      summary: clean(plan.summary) || '（AI 未给出说明）',
      company: clean(nm.company) || cur.company,
      dept: clean(nm.dept) || cur.dept,
      workshops: ws.length ? ws : cur.workshops.slice(),
      products: pd.length ? pd : cur.products.slice(),
      extra: Array.isArray(plan.extra) ? plan.extra.slice(0, 8) : [],
      steps: (Array.isArray(plan.steps) ? plan.steps : []).map((x) => String(x).slice(0, 200)).slice(0, 8),
    };
    console.log('[dsh-quality-up] AI 已解析「增加信息」：' + suggestion.summary);
    sendJson(res, 200, { ok: true, suggestion, current: cur, model: r.model, provider: r.provider });
  } catch (err) {
    sendJson(res, 200, { ok: false, error: 'AI 判断失败：' + err.message });
  }
});

route('POST', /^\/api\/settings\/test-llm$/, async (req, res) => {
  if (!runtime.llm) {
    return sendJson(res, 200, { ok: false, steps: [{ name: '① 模型接入', ok: false, detail: 'Harness 宿主没有可用的 LLM 服务。', ms: 0 }] });
  }
  try {
    const r = await runtime.llm.ping();
    sendJson(res, 200, r);
  } catch (e) {
    sendJson(res, 200, { ok: false, steps: [{ name: '连通性测试', ok: false, detail: e.message, ms: 0 }] });
  }
});
/* ---------------- 数据集合通用读写 ---------------- */
const WRITABLE = {
  issues: ['title', 'description', 'model', 'workshop', 'station', 'source', 'severity', 'owner', 'status', 'projectId', 'rootCause', 'containment', 'verifyResult', 'quantity', 'tags'],
  projects: ['title', 'description', 'model', 'workshop', 'owner', 'severity', 'stage', 'benefitEstimate', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'],
  knowledge: ['title', 'problem', 'cause', 'action', 'effect', 'tags', 'category', 'model', 'author', 'type', 'status'],
  qrqc: ['topic', 'problem', 'tempAction', 'owner', 'status', 'level', 'attendees'],
  todos: ['title', 'user', 'priority', 'dueAt', 'done', 'link'],
  benefits: ['projectId', 'type', 'amount', 'period', 'note', 'status'],
  members: ['name', 'role', 'dept', 'seniority', 'expert', 'skills', 'phone'],
  spcChars: ['name', 'model', 'workshop', 'station', 'nominal', 'usl', 'lsl', 'unit', 'subgroupSize', 'ctq'],
  defects: ['type', 'workshop', 'station', 'model', 'confidence', 'severity', 'batch'],
  workflows: ['type', 'title', 'content', 'applicant', 'status', 'relatedId'],
  reports: ['type', 'title', 'period', 'status', 'scope'],
  chats: ['title', 'messages'],
};

Object.keys(WRITABLE).forEach((col) => {
  route('GET', new RegExp('^/api/' + col + '$'), async (req, res) => {
    const q = qs(req);
    let rows = store.col(col).all().slice();
    // 通用筛选：任意字段精确匹配 + keyword 模糊 + days 时间窗 + limit/offset + sort
    for (const [k, v] of Object.entries(q)) {
      if (['keyword', 'days', 'limit', 'offset', 'sort', 'order'].includes(k)) continue;
      if (v === '' || v === undefined) continue;
      rows = rows.filter((r) => String(r[k] === undefined ? '' : r[k]) === String(v));
    }
    if (q.keyword) { const k = String(q.keyword); rows = rows.filter((r) => JSON.stringify(r).indexOf(k) >= 0); }
    if (q.days) { const since = new Date(Date.now() - Number(q.days) * 86400000).toISOString(); rows = rows.filter((r) => (r.createdAt || r.ts || '') >= since); }
    if (q.sort) { const f = String(q.sort), dir = q.order === 'asc' ? 1 : -1; rows.sort((a, b) => (a[f] > b[f] ? dir : a[f] < b[f] ? -dir : 0)); }
    const total = rows.length;
    const offset = Number(q.offset || 0), limit = q.limit ? Number(q.limit) : 200;
    sendJson(res, 200, { ok: true, total, rows: rows.slice(offset, offset + limit) });
  });
  route('POST', new RegExp('^/api/' + col + '$'), async (req, res) => {
    const body = await readJson(req);
    const doc = {};
    WRITABLE[col].forEach((k) => { if (body[k] !== undefined) doc[k] = body[k]; });
    const rec = store.col(col).insert(doc);
    res && sendJson(res, 200, { ok: true, row: rec });
  });
  route('GET', new RegExp('^/api/' + col + '/([^/]+)$'), async (req, res, id) => {
    const rec = store.col(col).get(id);
    if (!rec) return sendJson(res, 404, { ok: false, error: '未找到 ' + id });
    sendJson(res, 200, { ok: true, row: rec });
  });
  route('PUT', new RegExp('^/api/' + col + '/([^/]+)$'), async (req, res, id) => {
    const body = await readJson(req);
    const patch = {};
    WRITABLE[col].forEach((k) => { if (body[k] !== undefined) patch[k] = body[k]; });
    const rec = store.col(col).update(id, patch);
    if (!rec) return sendJson(res, 404, { ok: false, error: '未找到 ' + id });
    sendJson(res, 200, { ok: true, row: rec });
  });
  route('DELETE', new RegExp('^/api/' + col + '/([^/]+)$'), async (req, res, id) => {
    const ok = store.col(col).remove(id);
    sendJson(res, 200, { ok, error: ok ? undefined : '未找到 ' + id });
  });
});

/* ---------------- 工具直接调用（供界面按钮用） ---------------- */
route('GET', /^\/api\/tools$/, async (req, res) => {
  sendJson(res, 200, { ok: true, tools: registry.all().map((t) => ({ name: t.name, label: t.label, plugin: t.plugin, description: t.description, write: t.write, confirm: t.confirm, parameters: t.parameters })) });
});
route('POST', /^\/api\/tools\/([^/]+)$/, async (req, res, name) => {
  const tool = registry.get(name);
  if (!tool) return sendJson(res, 404, { ok: false, error: '工具不存在：' + name });
  const args = await readJson(req);
  try {
    const out = await tool.run(args, { outputDir: OUTPUT_DIR });
    store.audit({ user: '当前用户', plugin: tool.plugin, action: tool.label + '（界面直接调用）', params: args, resultSummary: agent.summarize(name, out), purpose: '界面操作' });
    sendJson(res, 200, { ok: out && out.ok !== false, result: out, summary: agent.summarize(name, out) });
  } catch (e) {
    sendJson(res, 200, { ok: false, error: e.message });
  }
});

/* ---------------- 对话（SSE 流式） ---------------- */
route('POST', /^\/api\/chat\/stream$/, async (req, res) => {
  const body = await readJson(req);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (obj) => { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (_) {} };
  send({ type: 'connected' });

  const ac = new AbortController();
  req.on('close', () => ac.abort());

  const sessionId = body.sessionId || 'default';
  const settings = store.db.settings || {};
  const history = Array.isArray(body.history) ? body.history : [];

  try {
    const result = await agent.run({
      text: body.text, sessionId, settings, history, signal: ac.signal, outputDir: OUTPUT_DIR,
    }, send);
    // 保存会话
    if (body.saveHistory !== false && result && result.ok) {
      let chat = store.col('chats').get(sessionId);
      const msgs = (chat ? chat.messages : []).concat([
        { role: 'user', content: body.text, ts: new Date().toISOString() },
        { role: 'assistant', content: result.content, ts: new Date().toISOString(), trace: result.trace, usage: result.usage },
      ]);
      if (chat) store.col('chats').update(sessionId, { messages: msgs, updatedAt: new Date().toISOString() });
      else store.col('chats').insert({ id: sessionId, title: String(body.text).slice(0, 30), messages: msgs });
    }
    send({ type: 'finish', ok: !!(result && result.ok), usage: result && result.usage });
  } catch (e) {
    send({ type: 'error', message: e.message || String(e) });
  }
  res.write('data: [DONE]\n\n');
  res.end();
});
route('POST', /^\/api\/chat\/confirm$/, async (req, res) => {
  const { id } = await readJson(req);
  const r = await agent.executePending(id, OUTPUT_DIR);
  sendJson(res, 200, r);
});
route('POST', /^\/api\/chat\/reject$/, async (req, res) => {
  const { id, reason } = await readJson(req);
  sendJson(res, 200, agent.rejectPending(id, reason));
});
route('GET', /^\/api\/chat\/pending$/, async (req, res) => sendJson(res, 200, { ok: true, rows: store.col('pendingActions').find((a) => a.status === 'pending') }));
route('GET', /^\/api\/chats$/, async (req, res) => sendJson(res, 200, { ok: true, rows: store.col('chats').all().map((c) => ({ id: c.id, title: c.title, count: (c.messages || []).length, updatedAt: c.updatedAt })) }));
route('GET', /^\/api\/chats\/([^/]+)$/, async (req, res, id) => { const c = store.col('chats').get(id); sendJson(res, 200, c ? { ok: true, row: c } : { ok: false, error: '未找到' }); });
route('DELETE', /^\/api\/chats\/([^/]+)$/, async (req, res, id) => sendJson(res, 200, { ok: store.col('chats').remove(id) }));

/* ---------------- 统计与可视化数据 ---------------- */
route('GET', /^\/api\/kpi\/overview$/, async (req, res) => {
  const snap = docsTools.dashboardSnapshot(qs(req).scope || '');
  // 驾驶舱 KPI 由真实统计引擎计算（判异/能力/项目/收益）
  const ov = registry.get('dashboard_overview').run({ days: Number(qs(req).days || 7) });
  const trend = buildTrend();
  const workshopDist = distBy('issues', 'workshop');
  sendJson(res, 200, {
    ok: true,
    kpi: Object.assign({}, snap, { KPI: ov.KPI, 特性状态: ov.特性状态, 高风险特性: ov.高风险特性 }),
    trend, workshopDist, paretoType: distBy('issues', 'type'),
  });
});
function distBy(col, field) {
  const rows = store.col(col).all();
  const m = {};
  rows.forEach((r) => { const k = r[field] || '未分类'; m[k] = (m[k] || 0) + 1; });
  return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}
/** 用测量数据真实构造趋势：按日汇总均值与超差率 */
function buildTrend(days = 14) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = store.col('measurements').all().filter((m) => m.ts >= since);
  const byDay = {};
  for (const r of rows) {
    const d = r.ts.slice(0, 10);
    (byDay[d] = byDay[d] || { day: d, n: 0, sum: 0, oos: 0 });
    byDay[d].n++; byDay[d].sum += r.value;
  }
  const chars = {};
  store.col('spcChars').all().forEach((c) => { chars[c.id] = c; });
  for (const r of rows) {
    const c = chars[r.charId];
    if (c && (r.value > c.usl || r.value < c.lsl)) byDay[r.ts.slice(0, 10)].oos++;
  }
  return Object.values(byDay).sort((a, b) => (a.day < b.day ? -1 : 1)).map((d) => ({
    day: d.day, 合格率: Number((((d.n - d.oos) / d.n) * 100).toFixed(2)), 样本量: d.n, 超差率: Number(((d.oos / d.n) * 100).toFixed(3)),
  }));
}
route('GET', /^\/api\/kpi\/trend$/, async (req, res) => sendJson(res, 200, { ok: true, trend: buildTrend(Number(qs(req).days || 14)) }));
/** 分产品质量健康度（真实计算） */
route('GET', /^\/api\/kpi\/models$/, async (req, res) => {
  const models = ['产品A', '产品B', '产品C'];
  const chars = store.col('spcChars').all();
  const rows = models.map((m) => {
    const mChars = chars.filter((c) => c.model === m);
    let n = 0, oos = 0, cpkSum = 0, cpkN = 0;
    mChars.forEach((c) => {
      const ms = store.col('measurements').find((x) => x.charId === c.id);
      n += ms.length;
      oos += ms.filter((x) => x.value > c.usl || x.value < c.lsl).length;
      try { if (ms.length > 4) { cpkSum += require('./src/lib/stats').capability(ms.map((x) => x.value), c.usl, c.lsl).cpk; cpkN++; } } catch (_) {}
    });
    const defs = store.col('defects').find((d) => d.model === m);
    const issues = store.col('issues').find((i) => i.model === m);
    const openIssues = issues.filter((i) => i.status !== '已关闭');
    const ftt = n ? ((n - oos) / n) * 100 : 0;
    const defectDensity = defs.length ? defs.length : 0;
    const avgCpk = cpkN ? cpkSum / cpkN : 0;
    // 健康度评分：合格率 60% + 过程能力 25% + 问题密度 15%
    const score = Math.max(0, Math.min(100,
      (ftt / 100) * 60 + Math.min(1, avgCpk / 1.67) * 25 + Math.max(0, 1 - openIssues.length / 20) * 15));
    return {
      model: m, 测量点数: n, 超差点: oos, 合格率: Number(ftt.toFixed(2)), 平均Cpk: Number(avgCpk.toFixed(2)),
      AI质检缺陷数: defectDensity, 问题总数: issues.length, 未关闭问题: openIssues.length, A级未关闭: openIssues.filter((i) => i.severity === 'A').length,
      健康度评分: Number(score.toFixed(1)),
      风险提示: (openIssues.filter((i) => i.severity === 'A').slice(0, 1).map((i) => i.title)[0]) || (avgCpk < 1.33 ? '过程能力偏低（Cpk ' + avgCpk.toFixed(2) + '）' : ''),
    };
  });
  sendJson(res, 200, { ok: true, models: rows });
});
route('GET', /^\/api\/kpi\/morning$/, async (req, res) => {
  const r = await agent.morningReport(store.db.settings);
  sendJson(res, 200, { ok: true, markdown: r.markdown, snapshot: r.snapshot, risks: r.risks });
});
route('GET', /^\/api\/spc\/chars$/, async (req, res) => {
  const r = registry.get('spc_list_chars').run({});
  sendJson(res, 200, { ok: true, chars: r.清单 });
});
route('GET', /^\/api\/spc\/detail$/, async (req, res) => {
  const q = qs(req);
  const chart = registry.get('spc_control_chart').run({ charId: q.charId, days: Number(q.days || 7) });
  const cap = registry.get('spc_capability').run({ charId: q.charId, days: Number(q.days || 30) });
  const rules = registry.get('spc_rule_check').run({ charId: q.charId, days: Number(q.days || 7) });
  const hist = registry.get('spc_histogram').run({ charId: q.charId, days: Number(q.days || 30) });
  sendJson(res, 200, { ok: true, chart, capability: cap, rules, histogram: hist });
});
route('GET', /^\/api\/audit$/, async (req, res) => {
  const q = qs(req);
  let rows = store.col('audit').all().slice().reverse();
  if (q.plugin) rows = rows.filter((r) => r.plugin === q.plugin);
  if (q.user) rows = rows.filter((r) => r.user === q.user);
  sendJson(res, 200, { ok: true, total: rows.length, rows: rows.slice(0, Number(q.limit || 100)) });
});

/* ---------------- 导入导出 ---------------- */
route('POST', /^\/api\/import$/, async (req, res) => {
  const body = await readJson(req);
  const { filename, base64, target, mapping } = body;
  if (!filename || !base64) return sendJson(res, 400, { ok: false, error: '缺少 filename / base64' });
  const buf = Buffer.from(base64, 'base64');
  const office = require('./src/lib/office');
  let sheets;
  try {
    if (/\.xlsx$/i.test(filename)) sheets = office.xlsxRead(buf).sheets;
    else if (/\.csv$/i.test(filename)) sheets = [{ name: 'CSV', rows: office.csvRead(buf) }];
    else return sendJson(res, 200, { ok: false, error: '仅支持 .xlsx 与 .csv（如需导入 .xls 请另存为 .xlsx）' });
  } catch (e) {
    return sendJson(res, 200, { ok: false, error: '文件解析失败：' + e.message });
  }
  const result = importSheets(sheets, target || 'measurements', mapping);
  store.audit({ user: '当前用户', plugin: '@MES', action: '导入数据', params: { filename, target, rows: result.imported }, resultSummary: '导入 ' + result.imported + ' 行', purpose: '数据接入' });
  sendJson(res, 200, Object.assign({ ok: true, filename, sheets: sheets.map((s) => ({ name: s.name, rows: s.rows.length })), preview: sheets[0].rows.slice(0, 6) }, result));
});

/** 把表格数据导入指定集合：自动识别表头（中文/英文字段名） */
function importSheets(sheets, target, mapping) {
  const aliases = {
    measurements: {
      charId: ['特性编号', '特性', 'charid', 'char_id', '特性代码'], charName: ['特性名称', '名称', 'charname'],
      model: ['产品', 'model', '产品'], workshop: ['车间', 'workshop'], station: ['工位', 'station', '工序'],
      ts: ['时间', '日期', '测量时间', 'ts', 'datetime', 'time'], value: ['测量值', '值', 'value', '实测值', '数据'],
      unit: ['单位', 'unit'], shift: ['班次', 'shift'], batch: ['批次', 'batch', '批号'], supplier: ['供应商', 'supplier'],
      operator: ['操作者', '操作员', 'operator', '检验员'], vin: ['VIN', 'vin', '车架号'], subgroup: ['子组', 'subgroup'],
    },
    issues: {
      title: ['问题描述', '问题', '标题', 'title'], description: ['详细描述', '描述', 'description'],
      model: ['产品', 'model'], workshop: ['车间', 'workshop'], station: ['工位', 'station'],
      source: ['来源', 'source'], severity: ['等级', 'severity', '级别'], owner: ['责任人', 'owner'],
      status: ['状态', 'status'], createdAt: ['登记时间', '时间', 'createdat'],
    },
    defects: {
      type: ['缺陷类型', '类型', 'type'], workshop: ['车间', 'workshop'], station: ['工位', 'station'],
      model: ['产品', 'model'], confidence: ['置信度', 'confidence'], severity: ['等级', 'severity'],
      batch: ['批次', 'batch'], ts: ['时间', 'ts'],
    },
  };
  const map = mapping || aliases[target] || {};
  const rows = sheets[0].rows;
  if (!rows || rows.length < 2) return { imported: 0, skipped: 0, message: '表格为空或只有表头' };
  const header = rows[0].map((h) => String(h || '').trim());
  // 建立列索引
  const colIndex = {};
  for (const [field, names] of Object.entries(map)) {
    const i = header.findIndex((h) => names.some((n) => h.toLowerCase() === String(n).toLowerCase() || h.indexOf(n) >= 0));
    if (i >= 0) colIndex[field] = i;
  }
  // 平台已有测量数据时，自动推断特性规格
  const chars = {};
  store.col('spcChars').all().forEach((c) => { chars[c.id] = c; });
  let imported = 0, skipped = 0;
  const errors = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => c === '' || c === null || c === undefined)) { skipped++; continue; }
    const obj = {};
    for (const [field, ci] of Object.entries(colIndex)) {
      let v = row[ci];
      if (v === undefined || v === null) continue;
      v = String(v).trim();
      if (!v) continue;
      if (field === 'value' || field === 'confidence') { const n = Number(v); if (!Number.isFinite(n)) continue; obj[field] = n; continue; }
      if (field === 'ts' || field === 'createdAt') {
        let t = v.replace(/\//g, '-');
        if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) t += 'T08:00:00+08:00';
        const d = new Date(t);
        obj[field] = isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
        continue;
      }
      obj[field] = v;
    }
    if (target === 'measurements') {
      if (obj.value === undefined) { skipped++; if (errors.length < 5) errors.push('第 ' + (r + 1) + ' 行缺少测量值'); continue; }
      const ch = obj.charId ? chars[obj.charId] : null;
      const rec = {
        charId: obj.charId || 'IMPORTED-001', charName: obj.charName || (ch ? ch.name : '导入特性'),
        model: obj.model || (ch ? ch.model : ''), workshop: obj.workshop || (ch ? ch.workshop : ''),
        station: obj.station || (ch ? ch.station : ''), ts: obj.ts || new Date().toISOString(),
        value: obj.value, unit: obj.unit || (ch ? ch.unit : ''), shift: obj.shift || '白班',
        batch: obj.batch || '', supplier: obj.supplier || '', operator: obj.operator || '', vin: obj.vin || '',
        subgroup: obj.subgroup ? Number(obj.subgroup) : undefined, source: '导入',
      };
      store.col('measurements').insert(rec, true);
      imported++;
    } else {
      if (!obj.title && target === 'issues') { skipped++; continue; }
      store.col(target).insert(Object.assign({ source: '导入' }, obj), true);
      imported++;
    }
  }
  store.touch(); store.emit();
  return { imported, skipped, target, errors, detectedColumns: Object.keys(colIndex), header };
}

route('GET', /^\/api\/reports$/, async (req, res) => sendJson(res, 200, { ok: true, rows: store.col('reports').all().slice().reverse() }));
route('GET', /^\/api\/reports\/download\/(.+)$/, async (req, res, file) => {
  const safe = path.basename(file);
  const fp = path.join(OUTPUT_DIR, safe);
  if (!fs.existsSync(fp)) return sendText(res, 404, '文件不存在：' + safe);
  const ext = path.extname(safe).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Disposition': 'attachment; filename="' + encodeURIComponent(safe) + '"',
    'Content-Length': fs.statSync(fp).size,
  });
  fs.createReadStream(fp).pipe(res);
});

/* ---------------- 数据管理 ---------------- */
route('POST', /^\/api\/data\/reset$/, async (req, res) => {
  const body = await readJson(req);
  const { seed } = require('./src/data/seed');
  // 保留 LLM 设置
  const keep = (store.db.settings && store.db.settings.llm) || {};
  Object.keys(store.db).forEach((k) => { if (Array.isArray(store.db[k])) store.db[k] = []; });
  store.db.counters = {};
  store.db.settings = {};
  const info = seed(store);
  store.db.settings.llm = Object.assign(store.db.settings.llm || {}, keep);
  store.saveSync();
  sendJson(res, 200, { ok: true, seeded: info, message: '初始数据已重建（模型配置已保留）' });
});
route('POST', /^\/api\/data\/clear$/, async (req, res) => {
  const body = await readJson(req);
  const keep = (store.db.settings && store.db.settings.llm) || {};
  const cols = body.collections || ['issues', 'projects', 'measurements', 'knowledge', 'defects', 'qrqc', 'workflows', 'todos', 'benefits', 'reports', 'audit', 'chats', 'pendingActions'];
  cols.forEach((c) => { store.db[c] = []; });
  store.db.settings = store.db.settings || {};
  store.db.settings.llm = Object.assign(store.db.settings.llm || {}, keep);
  store.saveSync();
  sendJson(res, 200, { ok: true, cleared: cols, message: '已清空 ' + cols.length + ' 个集合' });
});

/* ---------------- 系统状态：真实数据库 / 真实模型 ---------------- */
route('GET', /^\/api\/system\/db$/, async (req, res) => {
  sendJson(res, 200, {
    ok: true,
    dataDir: DATA_DIR,
    outputDir: OUTPUT_DIR,
    counts: countAll(),
    db: store.persist ? store.persist.info() : { engine: 'json', path: store.file },
  });
});
route('GET', /^\/api\/system\/model$/, async (req, res) => {
  sendJson(res, 200, { ok: true, model: runtime.model || null, available: !!runtime.llm, source: 'deepseek-harness' });
});

/* ---------------- 体系文件（中小型企业版）：调研 / 手册 / 程序文件 ---------------- */
function qmsSurveyData() {
  const st = store.db.settings || {};
  return st.qmsSurvey || null;
}
function qmsDocList() {
  const st = store.db.settings || {};
  return Array.isArray(st.qmsDocs) ? st.qmsDocs : [];
}
function qmsSave(partial) {
  store.db.settings = store.db.settings || {};
  store.db.settings.qmsSurvey = Object.assign({}, store.db.settings.qmsSurvey || {}, partial);
  store.touch();
}
function qmsSaveDocs(list) {
  store.db.settings = store.db.settings || {};
  store.db.settings.qmsDocs = list;
  store.touch();
}
const QMS_TEXT_FIELDS = ['company', 'chairman', 'legalRep', 'gm', 'deputyGm', 'mgmtRep', 'teamMembers', 'certOffice', 'auditors',
  'products', 'processFlow', 'geo', 'area', 'building', 'staff', 'techStaff', 'edu', 'equipment', 'customers', 'addr',
  'contactPerson', 'phone', 'tel', 'fax', 'mission', 'policy', 'objective', 'certDate', 'phase1Date', 'weekend', 'design',
  'contactName', 'contactPhone', 'otherCert'];
function cleanSurvey(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  QMS_TEXT_FIELDS.forEach((k) => {
    const v = String(src[k] == null ? '' : src[k]).replace(/[\r\n]+/g, ' ').trim();
    if (v) out[k] = v.slice(0, 400);
  });
  out.certs = (Array.isArray(src.certs) ? src.certs : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6);
  out.orgs = (Array.isArray(src.orgs) ? src.orgs : []).map((o) => ({
    duty: String((o && o.duty) || '').trim().slice(0, 40),
    dept: String((o && o.dept) || '').trim().slice(0, 40),
    owner: String((o && o.owner) || '').trim().slice(0, 30),
  })).filter((o) => o.dept || o.duty).slice(0, 20);
  return out;
}
/** 完成度：必填与关键项各占权重 */
function surveyCompletion(sv) {
  if (!sv) return 0;
  const keys = ['company', 'certs', 'products', 'policy', 'objective', 'mgmtRep', 'gm', 'orgs', 'staff', 'contactName'];
  let hit = 0;
  keys.forEach((k) => {
    const v = sv[k];
    if (Array.isArray(v) ? v.length && (typeof v[0] !== 'object' || Object.keys(v[0] || {}).length) : String(v == null ? '' : v).trim()) hit++;
  });
  return Math.round((hit / keys.length) * 100);
}

route('GET', /^\/api\/qms\/survey$/, async (req, res) => {
  const sv = qmsSurveyData();
  sendJson(res, 200, { ok: true, survey: sv, completion: surveyCompletion(sv) });
});
route('POST', /^\/api\/qms\/survey$/, async (req, res) => {
  const body = await readJson(req);
  const clean = cleanSurvey(body.survey || body);
  clean.completed = !!(body.completed || (body.survey && body.survey.completed));
  clean.updatedAt = new Date().toISOString();
  qmsSave(clean);
  store.saveSync(true);
  sendJson(res, 200, { ok: true, survey: clean, completion: surveyCompletion(clean) });
});
route('GET', /^\/api\/qms\/docs$/, async (req, res) => {
  const q = qs(req);
  const type = q.type || '';
  const rows = qmsDocList()
    .filter((d) => !type || d.type === type)
    .map((d) => ({ id: d.id, type: d.type, title: d.title, code: d.code, source: d.source, model: d.model || null, chars: (d.content || '').length, createdAt: d.createdAt }));
  sendJson(res, 200, { ok: true, rows });
});
route('GET', /^\/api\/qms\/doc\/(.+)$/, async (req, res, id) => {
  const d = qmsDocList().find((x) => x.id === decodeURIComponent(id));
  if (!d) return sendJson(res, 404, { ok: false, error: '文件不存在' });
  sendJson(res, 200, { ok: true, doc: d });
});
route('POST', /^\/api\/qms\/generate$/, async (req, res) => {
  const body = await readJson(req);
  const type = body.type === 'procedure' ? 'procedure' : 'manual';
  const sv = qmsSurveyData();
  if (!sv || !sv.company) return sendJson(res, 400, { ok: false, error: '请先到「填写体系调研」填写公司名称等基本信息，再生成文件。' });
  const b = qms.brief(sv);
  let docs = [];
  let source = 'template';
  let model = null;
  let note = '';
  if (runtime.llm) {
    try {
      const prompt = type === 'manual' ? qms.manualPrompt(b) : qms.procedurePrompt(b);
      const r = await runtime.llm.complete({ system: '你只输出 Markdown 正文，不写解释、不加代码块围栏。', user: prompt, maxTokens: type === 'manual' ? 3600 : 6000 });
      const text = String((r && r.text) || '').replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/, '').trim();
      if (text.length >= (type === 'manual' ? 800 : 1500)) {
        if (type === 'manual') {
          docs = [{ title: b.company + ' 质量手册', code: 'QM-01', content: text }];
        } else {
          docs = qms.splitProcedures(text);
        }
        source = 'ai';
        model = (r && r.model) || (runtime.model && (runtime.model.label || runtime.model.model)) || null;
      } else {
        note = '模型返回内容过短，已改用内置模板生成。';
      }
    } catch (e) {
      note = '模型调用失败（' + e.message + '），已改用内置模板生成。';
    }
  } else {
    note = '当前没有接入模型，以下内容由内置模板按调研表生成（结构可直接用，条文需按实际流程复核）。';
  }
  if (!docs.length) {
    if (type === 'manual') docs = [{ title: b.company + ' 质量手册', code: 'QM-01', content: qms.manualTemplate(b) }];
    else docs = qms.procedureTemplates(b);
  }
  const now = new Date().toISOString();
  const saved = docs.map((d, i) => ({
    id: 'QMS-' + type + '-' + Date.now().toString(36) + i,
    type, title: d.title || (type === 'manual' ? b.company + ' 质量手册' : '程序文件 ' + (i + 1)),
    code: d.code || (type === 'manual' ? 'QM-01' : 'QP-' + String(i + 1).padStart(2, '0')),
    content: d.content, source, model, createdAt: now,
  }));
  // 同类型只保留最近一次生成结果
  const keep = qmsDocList().filter((d) => d.type !== type);
  qmsSaveDocs(keep.concat(saved));
  store.saveSync(true);
  sendJson(res, 200, {
    ok: true, type, source, model, note,
    docs: saved.map((d) => ({ id: d.id, title: d.title, code: d.code, chars: d.content.length, createdAt: d.createdAt })),
  });
});

/* ---------------- 静态文件 ---------------- */
function serveStatic(req, res, pathname) {
  let p = pathname === '/' ? '/index.html' : pathname;
  p = decodeURIComponent(p);
  // 浏览器半（DSH 客户端插件）放在插件根目录、不在 public/ 下：
  // 宿主若按「挂载前缀 + client.js」来取，这里直接给它，别落到单页回退
  if (/^\/(client\.js|client)$/.test(p)) {
    const cf = path.join(ROOT, 'client.js');
    if (fs.existsSync(cf)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(cf).pipe(res);
    }
  }
  const fp = path.join(PUBLIC_DIR, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!fp.startsWith(PUBLIC_DIR)) return sendText(res, 403, '禁止访问');
  fs.stat(fp, (err, st) => {
    if (err || !st.isFile()) {
      // 单页应用回退
      const idx = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(idx)) {
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        return fs.createReadStream(idx).pipe(res);
      }
      return sendText(res, 404, 'Not Found');
    }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(fp).pipe(res);
  });
}

/* ================================================================== */
/* 插件入口：初始化 + 请求分发（由 index.js 挂到 /qip 前缀）            */
/* ================================================================== */
let ready = null;
let saveTimer = null;

/* 旧口径（冲压/焊装/…车间、质量改进科、郑伟老师）+ 演示类用词一次性迁移到新口径。
   幂等：靠 meta.wordingV3 打标；直接改内存 store 再 saveSync，避免运行期被覆盖。 */
const WORDING_RULES = [
  ['不是演示版', '不是空壳'], ['演示样例', '初始'], ['样例演示', '初始'],
  ['演示名称', '初始名称'], ['演示默认', '默认'], ['演示口径', '初始口径'], ['演示数据', '初始数据'], ['演示', '初始'],
  ['样例审计记录', '初始审计记录'], ['样例数据初始化', '初始数据初始化'], ['重建样例数据', '重建初始数据'], ['样例', '初始'],
  ['示例', '算例'], ['样板', ''],
  ['电池 PACK 车间', '五车间'], ['电池PACK车间', '五车间'], ['PACK 车间', '五车间'], ['电池 PACK', '五车间'], ['电池PACK', '五车间'],
  ['PACK 装配线', '五车间装配线'], ['PACK 模组', '五车间模组'], ['PACK 上盖', '五车间上盖'], ['PACK 线', '五车间线'], ['PACK', '五车间'],
  ['总装车间', '四车间'], ['总装三线', '四车间三线'], ['总装二线', '四车间二线'], ['总装一线', '四车间一线'], ['总装线', '四车间线'], ['总装', '四车间'],
  ['焊装车间', '二车间'], ['焊装', '二车间'],
  ['涂装车间', '三车间'], ['涂装', '三车间'],
  ['冲压车间', '一车间'], ['冲压', '一车间'],
  ['质量改进科', '质量改进部门'], ['科室', '部门'],
  ['郑伟老师', '陈老师'], ['郑老师', '陈老师'], ['郑伟', '陈伟'],
];

/**
 * 单次扫描版替换：一次扫描、长词优先，替换结果不会被下一条规则再吃一遍
 * （例如「演示样例」必须先整体换成「初始」，否则会得到「初始初始」）。
 */
function fixWordingOnce(text) {
  if (!text || typeof text !== 'string') return text;
  const map = new Map(WORDING_RULES);
  const keys = WORDING_RULES.map(([f]) => f).sort((a, b) => b.length - a.length);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(keys.map(esc).join('|'), 'g');
  return text.replace(re, (m) => (map.has(m) ? map.get(m) : m));
}

function normalizeWording(node) {
  if (typeof node === 'string') return fixWordingOnce(node);
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = normalizeWording(node[i]);
    return node;
  }
  if (node && typeof node === 'object') {
    Object.keys(node).forEach((k) => { node[k] = normalizeWording(node[k]); });
    return node;
  }
  return node;
}

function init() {
  if (ready) return ready;
  ready = (async () => {
    const scale = currentScale();
    await store.init(DATA_DIR, { scale });
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const firstRun = store.isEmpty();
    if (firstRun) {
      if (scale === 'sme') {
        const { seedSme } = require('./src/data/seed-sme');
        const info = seedSme(store);
        console.log('[dsh-quality-up] 首次启动（中小型企业版），已灌入初始数据集：' + JSON.stringify(info));
      } else {
        const { seed } = require('./src/data/seed');
        const info = seed(store);
        store.saveSync(true);
        console.log('[dsh-quality-up] 首次启动，已灌入初始数据集：' + JSON.stringify(info));
      }
    } else if (scale !== 'sme') {
      // 既有实例：把问题库一次性扩到 10 倍（幂等，靠 meta.dataScaleIssues 打标）
      const { scaleupIssues } = require('./src/data/seed');
      const up = scaleupIssues(store);
      if (up) {
        store.saveSync(true);
        console.log('[dsh-quality-up] 问题库已扩量：新增 ' + up.added + ' 起，合计 ' + up.total + ' 起');
      }
    }
    if (!Array.isArray(store.db.pendingActions)) store.db.pendingActions = [];
    // 历史数据口径迁移（车间编号 / 部门名 / 称谓 / 演示类用词），只做一次；
    // 中小型企业版有自己的一套口径（冲压/装配两车间），不能再按大企业规则改写
    // wordingV4：把「郑伟 / 郑老师」改成「陈伟 / 陈老师」，老库也会被带上
    if (scale !== 'sme' && store.db.meta.wordingV4 !== 1) {
      normalizeWording(store.db);
      store.db.meta.wordingV4 = 1;
      store.db.meta.wordingV3 = 1;
      console.log('[dsh-quality-up] 已把历史数据迁移到「一~五车间 / 质量改进部门 / 陈老师」口径（含演示类用词清理）');
    }
    store.saveSync(true); // 保证库/文件在启动时就是落盘状态
    // 定时强制落盘：插件写操作走 400ms 防抖，这里兜底，避免异常退出丢数据
    const timer = setInterval(() => store.saveSync(), 5000);
    if (timer.unref) timer.unref();
    saveTimer = timer;
    const info = store.persist ? store.persist.info() : null;
    console.log('[dsh-quality-up] 就绪：数据库=' + (info ? info.path : store.file) + '，报告目录=' + OUTPUT_DIR);
    return { firstRun, info };
  })();
  return ready;
}

function handle(req, res) {
  const pathname = new URL(req.url || '/', 'http://x').pathname || '/';
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  init().then(async () => {
    if (pathname.startsWith('/api/')) {
      const m = match(req.method, pathname);
      if (!m) return sendJson(res, 404, { ok: false, error: '接口不存在：' + req.method + ' ' + pathname });
      try {
        await m.handler(req, res, ...m.params);
      } catch (e) {
        console.error('[dsh-quality-up] ' + pathname + ' 出错：', e);
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: e.message });
        else try { res.end(); } catch (_) {}
      }
      return;
    }
    serveStatic(req, res, pathname);
  }).catch((e) => {
    console.error('[dsh-quality-up] 初始化失败：', e);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: '平台初始化失败：' + e.message });
  });
}

module.exports = {
  init, handle, setRuntime, runtime,
  store, registry, agent,
  DATA_DIR, OUTPUT_DIR, PUBLIC_DIR,
  countAll, publicSettings,
};






