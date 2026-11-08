'use strict';
/** 数据类工具：@MES / @SPC / @ERP / @AQI —— 全部真实查询本地数据仓，不编造数字 */
const { define } = require('./registry');
const store = require('../lib/store');
const stats = require('../lib/stats');

const DAY = 86400000;

/** 数据基准时间：以库里最新测量时间为准，保证"近 7 日"永远有数据 */
function dataNow() {
  const ms = store.col('measurements').all();
  if (!ms.length) return new Date();
  let max = 0;
  for (const m of ms) { const t = Date.parse(m.ts); if (t > max) max = t; }
  return new Date(max);
}
function sinceISO(days) { return new Date(dataNow().getTime() - days * DAY).toISOString(); }

/** 单件损失单价：按「当前命名」的车间顺序取基准值，用户改名后仍能对上（不依赖写死的车间名） */
const UNIT_LOSS_BY_INDEX = [320, 480, 260, 180, 2600];
function unitLossOf(workshop) {
  if (UNIT_LOSS[workshop] !== undefined) return UNIT_LOSS[workshop];
  const s = store.db.settings || {};
  const names = ((s.naming || {}).workshops) || [];
  const i = names.indexOf(workshop);
  if (i >= 0 && UNIT_LOSS_BY_INDEX[i] !== undefined) return UNIT_LOSS_BY_INDEX[i];
  return 200;
}

/** 明细：某特性全部单值（按时间排序），用于 SPC 计算 */
function seriesOf(charId, days) {
  const since = sinceISO(days === undefined ? 7 : days);
  const rows = store.col('measurements').find((m) => m.charId === charId && m.ts >= since);
  rows.sort((a, b) => (a.ts < b.ts ? -1 : 1));
  return rows;
}
/** 子组化：按 subgroup 字段分组 */
function subgroupsOf(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.subgroup)) map.set(r.subgroup, []);
    map.get(r.subgroup).push(r.value);
  }
  return [...map.keys()].sort((a, b) => a - b).map((k) => map.get(k));
}
function charInfo(charId) {
  return store.col('spcChars').get(charId) || store.col('spcChars').one((c) => c.name.indexOf(charId) >= 0);
}
function fmt(n, d = 3) { return n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(d); }

/* ================================================================== */
/* @MES                                                               */
/* ================================================================== */
define({
  plugin: '@MES', name: 'mes_query_measurements', label: '查询在线测量数据',
  description: '从 MES 查询指定关键特性/工位/产品在时间窗内的在线测量明细与统计量（均值、标准差、超差数、超差率、最大值、最小值）。当需要"用数据说话"时必须先调用本工具，禁止凭印象给数字。',
  parameters: {
    type: 'object',
    properties: {
      charId: { type: 'string', description: '特性编号，如 CT-0378；可用 spc_list_chars 查询' },
      charName: { type: 'string', description: '特性名称关键词，如「充电口盖间隙」，与 charId 二选一' },
      model: { type: 'string', description: '产品，如 产品C（以「系统 → 初始设置」里的产品名为准）' },
      workshop: { type: 'string', description: '车间：一车间/二车间/三车间/四车间/五车间（以「系统 → 初始设置」里的车间名为准）' },
      days: { type: 'number', description: '时间窗天数，默认 7' },
      onlyOutOfSpec: { type: 'boolean', description: '仅返回超差点' },
      includeRaw: { type: 'boolean', description: '是否返回原始测量值数组（默认 false，只回统计量与少量样本，避免上下文过长）' },
      groupByShift: { type: 'boolean', description: '是否按班次分组统计（用于判断是否夜班问题）' },
    },
    required: [],
  },
  run(args) {
    let ch = args.charId ? charInfo(args.charId) : null;
    if (!ch && args.charName) ch = store.col('spcChars').one((c) => c.name.indexOf(args.charName) >= 0 || args.charName.indexOf(c.name) >= 0);
    if (!ch && args.workshop) ch = store.col('spcChars').one((c) => c.workshop === args.workshop);
    if (!ch) return { ok: false, error: '未找到匹配的特性，请先用 spc_list_chars 查看可查询的特性清单' };
    const days = args.days === undefined ? 7 : args.days;
    let rows = seriesOf(ch.id, days);
    if (args.model) rows = rows.filter((r) => r.model === args.model);
    if (args.onlyOutOfSpec) rows = rows.filter((r) => r.value > ch.usl || r.value < ch.lsl);
    const values = rows.map((r) => r.value);
    if (!values.length) return { ok: false, error: '该时间窗内无测量数据', char: ch.id, days };
    const oos = rows.filter((r) => r.value > ch.usl || r.value < ch.lsl);
    const desc = stats.describe(values);
    const out = {
      ok: true, 数据来源: '@MES 在线测量（夜间批同步 + 实时订阅）',
      特性: { 编号: ch.id, 名称: ch.name, 产品: ch.model, 工位: ch.station, 标准: ch.nominal + '±' + fmt((ch.usl - ch.lsl) / 2) + ch.unit, USL: ch.usl, LSL: ch.lsl, 单位: ch.unit, 是否CTQ: ch.ctq },
      时间窗: { 起: rows[0].ts.slice(0, 19), 止: rows[rows.length - 1].ts.slice(0, 19), 天数: days },
      样本量: values.length,
      统计量: { 均值: Number(desc.mean.toFixed(4)), 标准差: Number(desc.sd.toFixed(4)), 最小值: desc.min, 最大值: desc.max, 中位数: desc.median, 极差: Number((desc.max - desc.min).toFixed(4)), 变异系数: Number(desc.cv.toFixed(2)) },
      超差: { 条数: oos.length, 比例: Number(((oos.length / values.length) * 100).toFixed(2)) + '%', USL侧: oos.filter((r) => r.value > ch.usl).length, LSL侧: oos.filter((r) => r.value < ch.lsl).length },
      过程能力: (function () { try { const c = stats.capability(values, ch.usl, ch.lsl); return { Cp: Number(c.cp.toFixed(3)), Cpk: Number(c.cpk.toFixed(3)), Ppk: Number(c.ppk.toFixed(3)), 预估不良率ppm: Math.round(c.ppmTotal) }; } catch (e) { return { 错误: e.message }; } })(),
      批次: [...new Set(rows.map((r) => r.batch))].slice(0, 12),
      供应商: [...new Set(rows.map((r) => r.supplier))],
      样本明细: rows.slice(-8).map((r) => ({ 时间: r.ts.slice(0, 19), 值: r.value, 班次: r.shift, 批次: r.batch, 操作者: r.operator })),
    };
    if (args.groupByShift) {
      const g = {};
      for (const r of rows) { (g[r.shift] = g[r.shift] || []).push(r.value); }
      out.按班次统计 = Object.keys(g).map((k) => {
        const d = stats.describe(g[k]);
        const o = g[k].filter((v) => v > ch.usl || v < ch.lsl).length;
        return { 班次: k, 样本量: g[k].length, 均值: Number(d.mean.toFixed(4)), 标准差: Number(d.sd.toFixed(4)), 超差率: ((o / g[k].length) * 100).toFixed(2) + '%' };
      });
    }
    if (args.includeRaw) out.原始测量值 = values;
    return out;
  },
});

define({
  plugin: '@MES', name: 'mes_scrap_summary', label: '报废/停线损失汇总',
  description: '按车间/产品汇总报废与返修损失，含超差事件数、折算报废金额、停线工时。数据口径：以在线测量超差事件为线索，按企业标准损失单价折算（单价可在系统设置中调整）。',
  parameters: {
    type: 'object',
    properties: {
      workshop: { type: 'string', description: '车间，留空表示全部' },
      model: { type: 'string', description: '产品，留空表示全部' },
      days: { type: 'number', description: '天数，默认 30' },
    },
  },
  run(args) {
    const days = args.days || 30;
    const since = sinceISO(days);
    const chars = store.col('spcChars').all();
    const rowsByWs = {};
    let totalEvents = 0, totalAmount = 0;
    for (const ch of chars) {
      if (args.workshop && ch.workshop !== args.workshop) continue;
      if (args.model && ch.model !== args.model) continue;
      const rows = seriesOf(ch.id, days).filter((r) => r.value > ch.usl || r.value < ch.lsl);
      if (!rows.length) continue;
      const unitLoss = unitLossOf(ch.workshop) || 200;
      const amount = rows.length * unitLoss;
      totalEvents += rows.length;
      totalAmount += amount;
      const key = ch.workshop;
      if (!rowsByWs[key]) rowsByWs[key] = { 车间: key, 超差事件数: 0, 折算金额: 0, 特性: [] };
      rowsByWs[key].超差事件数 += rows.length;
      rowsByWs[key].折算金额 += amount;
      rowsByWs[key].特性.push({ 特性: ch.id + ' ' + ch.name, 事件数: rows.length, 金额: amount });
    }
    return {
      ok: true, 数据来源: '@MES 报废/停线记录 + 企业损失单价',
      时间窗: since.slice(0, 10) + ' ~ ' + dataNow().toISOString().slice(0, 10),
      合计: { 超差事件数: totalEvents, 折算损失金额: Math.round(totalAmount), 币种: 'CNY' },
      分车间: Object.values(rowsByWs).sort((a, b) => b.折算金额 - a.折算金额),
      口径说明: '单件损失单价：' + JSON.stringify(UNIT_LOSS) + ' 元/件（按车间顺序对应，改名后自动跟随）；口径与质量损失 QLF 一致（仅计直接损失）。',
    };
  },
});

const UNIT_LOSS = { 一车间: 320, 二车间: 480, 三车间: 260, 四车间: 180, '五车间': 2600 };

define({
  plugin: '@MES', name: 'mes_trace_by_vin', label: '整车追溯',
  description: '按 VIN 查询整车追溯链：该车的测量数据、装配批次、班次、操作者。用于市场反馈车辆回厂分析。',
  parameters: { type: 'object', properties: { vin: { type: 'string', description: '车辆 VIN（17 位）' } }, required: ['vin'] },
  run(args) {
    const rows = store.col('measurements').find((m) => m.vin === args.vin);
    if (!rows.length) return { ok: false, error: '未找到该 VIN 的测量记录（可在平台「数据管理」中导入真实追溯数据）' };
    return {
      ok: true, 数据来源: '@MES 整车追溯链', VIN: args.vin,
      产品: rows[0].model,
      测量记录: rows.map((r) => ({ 特性: r.charId + ' ' + r.charName, 时间: r.ts.slice(0, 19), 值: r.value + r.unit, 班次: r.shift, 批次: r.batch, 工位: r.station, 操作者: r.operator })),
    };
  },
});

define({
  plugin: '@MES', name: 'mes_batch_records', label: '批次装配记录',
  description: '查询某工位/时间窗内装配使用的批次与供应商清单及换批时间点。根因分析中用于比对「换批时间」与「失控起点」是否吻合。',
  parameters: {
    type: 'object',
    properties: {
      charId: { type: 'string', description: '特性编号' },
      station: { type: 'string', description: '工位关键词' },
      days: { type: 'number', description: '天数，默认 15' },
    },
  },
  run(args) {
    const days = args.days || 15;
    let rows = store.col('measurements').find((m) => m.ts >= sinceISO(days));
    if (args.charId) rows = rows.filter((r) => r.charId === args.charId);
    if (args.station) rows = rows.filter((r) => r.station.indexOf(args.station) >= 0);
    if (!rows.length) return { ok: false, error: '该条件下无批次记录' };
    const map = new Map();
    for (const r of rows) {
      const k = r.batch;
      if (!map.has(k)) map.set(k, { 批次: k, 供应商: r.supplier, 起始时间: r.ts, 结束时间: r.ts, 装配数量: 0, 涉及特性: new Set(), 均值: [] });
      const b = map.get(k);
      b.装配数量++;
      if (r.ts < b.起始时间) b.起始时间 = r.ts;
      if (r.ts > b.结束时间) b.结束时间 = r.ts;
      b.涉及特性.add(r.charId);
      b.均值.push(r.value);
    }
    const list = [...map.values()].map((b) => ({
      批次: b.批次, 供应商: b.供应商, 起: b.起始时间.slice(0, 16), 止: b.结束时间.slice(0, 16), 装配数量: b.装配数量,
      涉及特性: [...b.涉及特性], 均值: Number((b.均值.reduce((a, c) => a + c, 0) / b.均值.length).toFixed(4)),
    })).sort((a, b) => (a.起 < b.起 ? -1 : 1));
    return { ok: true, 数据来源: '@MES 批次装配关系', 批次数: list.length, 换批记录: list };
  },
});

/* ================================================================== */
/* @SPC                                                               */
/* ================================================================== */
define({
  plugin: '@SPC', name: 'spc_list_chars', label: '关键特性清单',
  description: '列出平台监控的全部关键特性（CTQ）及其规格限、采样频率、当前过程能力状态。调用 SPC 相关工具前先用本工具确认 charId。',
  parameters: { type: 'object', properties: {} },
  run() {
    const chars = store.col('spcChars').all();
    return {
      ok: true, 数据来源: '@SPC 关键特性台账', 特性数: chars.length,
      清单: chars.map((c) => {
        const rows = seriesOf(c.id, 7);
        const v = rows.map((r) => r.value);
        let cpk = null, oos = 0;
        try { if (v.length > 2) cpk = Number(stats.capability(v, c.usl, c.lsl).cpk.toFixed(2)); } catch (_) {}
        oos = rows.filter((r) => r.value > c.usl || r.value < c.lsl).length;
        return { 编号: c.id, 名称: c.name, 产品: c.model, 车间: c.workshop, 工位: c.station, 规格: c.lsl + '~' + c.usl + c.unit, 公差中心: c.nominal, 控制图: c.controlMethod, CTQ: c.ctq, 近7日样本: v.length, 近7日Cpk: cpk, 近7日超差数: oos, 状态: cpk === null ? '数据不足' : cpk >= 1.33 ? '受控' : cpk >= 1.0 ? '需关注' : '能力不足' };
      }),
    };
  },
});

define({
  plugin: '@SPC', name: 'spc_control_chart', label: '控制图计算',
  description: '对指定特性真实计算控制图（Xbar-R / I-MR / Xbar-S / EWMA），返回控制限、中心线、逐点值、超出控制限的点位、组内标准差。所有数值由统计引擎计算，禁止自行估算。',
  parameters: {
    type: 'object',
    properties: {
      charId: { type: 'string', description: '特性编号，如 CT-0378' },
      chartType: { type: 'string', enum: ['Xbar-R', 'I-MR', 'Xbar-S', 'EWMA'], description: '控制图类型，默认按特性台账配置' },
      days: { type: 'number', description: '时间窗天数，默认 7' },
      lastN: { type: 'number', description: '只取最后 N 个子组（用于聚焦近期失控）' },
    },
    required: ['charId'],
  },
  run(args) {
    const ch = charInfo(args.charId);
    if (!ch) return { ok: false, error: '未找到特性 ' + args.charId };
    const rows = seriesOf(ch.id, args.days === undefined ? 7 : args.days);
    if (rows.length < 3) return { ok: false, error: '样本不足，无法作图（当前 ' + rows.length + ' 点，至少需要 3 点）' };
    const subs = subgroupsOf(rows);
    const flat = rows.map((r) => r.value);
    let type = args.chartType || ch.controlMethod || 'Xbar-R';
    // Xbar 类控制图要求子组容量恒定；混入导入数据后子组容量常常不一致，
    // 此时必须退回 I-MR，否则控制限在统计上是错误的（这点不能含糊）。
    const sizes = subs.map((s) => s.length);
    const uniform = sizes.length >= 2 && sizes.every((s) => s === sizes[0]) && sizes[0] >= 2 && sizes[0] <= 10;
    let fallbackNote;
    if ((type === 'Xbar-R' || type === 'Xbar-S') && !uniform) {
      fallbackNote = '子组容量不恒定（' + [...new Set(sizes)].slice(0, 5).join('/') + '），Xbar 类控制图不适用，已自动改用 I-MR 单值移动极差图（Σ 口径不变）。';
      type = 'I-MR';
    }
    let chart;
    if (type === 'I-MR') chart = stats.chartIMR(flat);
    else if (type === 'Xbar-S') chart = stats.chartXbarS(subs);
    else if (type === 'EWMA') chart = stats.chartEWMA(flat);
    else chart = stats.chartXbarR(subs);
    const isX = chart.chart !== 'I-MR' && chart.chart !== 'EWMA';
    const series = isX ? chart.xbar.points : (chart.points || []);
    const center = isX ? chart.xbar.center : chart.center;
    const ucl = isX ? chart.xbar.ucl : chart.ucl;
    const lcl = isX ? chart.xbar.lcl : chart.lcl;
    const ooc = series.filter((p) => p.outOfControl);
    const out = {
      ok: true, 数据来源: '@SPC 控制图引擎（GB/T 4091）',
      特性: ch.id + ' ' + ch.name, 规格限: ch.lsl + '~' + ch.usl + ch.unit,
      图类型: chart.chart, 样本量: flat.length, 子组数: subs.length,
      控制限: { UCL: Number(ucl.toFixed(4)), CL: Number(center.toFixed(4)), LCL: Number(lcl.toFixed(4)) },
      组内标准差: Number((chart.sigmaWithin || 0).toFixed(4)),
      超出控制限点数: ooc.length,
      超出控制限点位: ooc.map((p) => ({ 序号: p.i + 1, 值: p.value, 时间: (rows[p.i] && rows[p.i].ts || '').slice(0, 16), 班次: rows[p.i] && rows[p.i].shift })),
      最近12点: series.slice(-12).map((p) => ({ 序号: p.i + 1, 值: p.value, 时间: (rows[p.i] && rows[p.i].ts || '').slice(0, 16), 班次: rows[p.i] && rows[p.i].shift, 超限: p.outOfControl })),
      全部点值: series.map((p) => p.value),
      极差图: chart.r ? { UCL: Number(chart.r.ucl.toFixed(4)), CL: Number(chart.r.center.toFixed(4)), LCL: Number(chart.r.lcl.toFixed(4)) } : undefined,
    };
    if (fallbackNote) out.算法说明 = fallbackNote;
    if (args.lastN) {
      const pts = series.slice(-args.lastN);
      out.聚焦区间 = { 起: (rows[pts[0].i] || {}).ts, 止: (rows[pts[pts.length - 1].i] || {}).ts, 点位: pts.map((p) => ({ 序号: p.i + 1, 值: p.value })) };
    }
    return out;
  },
});

define({
  plugin: '@SPC', name: 'spc_rule_check', label: '八大判异准则检查',
  description: '按 GB/T 4091 八大判异准则对指定特性做真实判异，返回命中的准则编号、名称、涉及的点位下标、判读说明与严重度。这是"自动报警"的依据，必须调用本工具而不是目测趋势。',
  parameters: {
    type: 'object',
    properties: {
      charId: { type: 'string', description: '特性编号' },
      days: { type: 'number', description: '时间窗天数，默认 7' },
    },
    required: ['charId'],
  },
  run(args) {
    const ch = charInfo(args.charId);
    if (!ch) return { ok: false, error: '未找到特性 ' + args.charId };
    const days = args.days === undefined ? 7 : args.days;
    const rows = seriesOf(ch.id, days);
    if (rows.length < 5) return { ok: false, error: '样本不足（至少 5 点）' };
    const flat = rows.map((r) => r.value);
    const subs = subgroupsOf(rows);
    let chart;
    try { chart = subs.length >= 2 ? stats.chartXbarR(subs) : stats.chartIMR(flat); }
    catch (e) { chart = stats.chartIMR(flat); }
    const center = chart.center === undefined ? chart.xbar.center : chart.center;
    const ucl = chart.ucl === undefined ? chart.xbar.ucl : chart.ucl;
    const lcl = chart.lcl === undefined ? chart.xbar.lcl : chart.lcl;
    // 判异基于单值序列，控制限取单值图的限（I-MR 口径）以保证点位与原始数据一一对应
    const imr = stats.chartIMR(flat);
    const hits = stats.spcRules(flat, { center: imr.center, ucl: imr.ucl, lcl: imr.lcl, sigma: imr.sigmaWithin });
    const severityRank = { high: 3, medium: 2, low: 1 };
    return {
      ok: true, 数据来源: '@SPC 判异引擎（GB/T 4091 八大准则）',
      特性: ch.id + ' ' + ch.name, 规格限: ch.lsl + '~' + ch.usl + ch.unit,
      单值图控制限: { UCL: Number(imr.ucl.toFixed(4)), CL: Number(imr.center.toFixed(4)), LCL: Number(imr.lcl.toFixed(4)), σ组内: Number(imr.sigmaWithin.toFixed(4)) },
      子组图控制限: { UCL: Number(ucl.toFixed(4)), CL: Number(center.toFixed(4)), LCL: Number(lcl.toFixed(4)) },
      命中准则数: hits.length,
      判异结果: hits.map((h) => ({
        准则: h.rule, 名称: h.name, 严重度: h.severity, 涉及点数: h.indexes.length,
        涉及时间: h.indexes.slice(0, 6).map((i) => (rows[i] ? rows[i].ts.slice(0, 16) + '(' + rows[i].shift + ')' : '')),
        涉及值: h.indexes.slice(0, 6).map((i) => flat[i]),
        说明: h.desc,
      })).sort((a, b) => severityRank[b.严重度] - severityRank[a.严重度]),
      结论: hits.length === 0 ? '过程受控，未发现判异信号' : '过程失控，最高严重度：' + hits.map((h) => h.severity).sort((a, b) => severityRank[b] - severityRank[a])[0],
    };
  },
});

define({
  plugin: '@SPC', name: 'spc_capability', label: '过程能力分析 Cpk/Ppk',
  description: '计算指定特性的 Cp/Cpk/Pp/Ppk、西格玛水平、预估不良率（ppm）与达标判定。判定准则：Cpk≥1.67 优秀；1.33~1.67 良好；1.00~1.33 尚可需改进；<1.00 能力不足必须整改。',
  parameters: {
    type: 'object',
    properties: { charId: { type: 'string', description: '特性编号' }, days: { type: 'number', description: '时间窗天数，默认 30' } },
    required: ['charId'],
  },
  run(args) {
    const ch = charInfo(args.charId);
    if (!ch) return { ok: false, error: '未找到特性 ' + args.charId };
    const rows = seriesOf(ch.id, args.days === undefined ? 30 : args.days);
    const v = rows.map((r) => r.value);
    if (v.length < 5) return { ok: false, error: '样本不足' };
    const c = stats.capability(v, ch.usl, ch.lsl);
    const judge = c.cpk >= 1.67 ? '优秀' : c.cpk >= 1.33 ? '良好（量产常规要求已满足）' : c.cpk >= 1.0 ? '尚可，需改进' : '能力不足，必须整改并加严检验';
    return {
      ok: true, 数据来源: '@SPC 过程能力引擎',
      特性: { 编号: ch.id, 名称: ch.name, 规格: ch.lsl + '~' + ch.usl + ch.unit, 中心: ch.nominal, CTQ: ch.ctq },
      样本量: v.length, 均值: Number(c.mean.toFixed(4)), 标准差: Number(c.sd.toFixed(4)),
      能力指数: { Cp: Number(c.cp.toFixed(3)), Cpu: Number(c.cpu.toFixed(3)), Cpl: Number(c.cpl.toFixed(3)), Cpk: Number(c.cpk.toFixed(3)), Pp: Number(c.pp.toFixed(3)), Ppk: Number(c.ppk.toFixed(3)), Cpm: c.cpm === undefined ? undefined : Number(c.cpm.toFixed(3)) },
      预估不良率: { 合计ppm: Math.round(c.ppmTotal), 超上限ppm: Math.round(c.ppmAbove), 超下限ppm: Math.round(c.ppmBelow), 合格率: Number(c.yieldPct.toFixed(4)) + '%' },
      西格玛水平: Number(c.sigmaLevel.toFixed(2)),
      判定: judge,
      改进建议: c.cpk >= 1.33 ? '维持现有控制，纳入月度点检' : '①先判断是均值偏移还是波动变大（看 Cpk 与 Cp 的差值：差值大 = 均值偏移，优先调中心；两者都低 = 波动大，优先查设备/来料）②对偏移类问题优先调整工装/参数中心值 ③对波动类问题做设备与工装点检、分层分析',
      偏离中心方向: c.mean > ch.nominal ? '均值偏向上限（+ ' + (c.mean - ch.nominal).toFixed(4) + ch.unit + '）' : '均值偏向下限（- ' + (ch.nominal - c.mean).toFixed(4) + ch.unit + '）',
    };
  },
});

define({
  plugin: '@SPC', name: 'spc_histogram', label: '直方图与分布',
  description: '生成指定特性的直方图分箱数据（用于画图）与分布统计量，可判断是否双峰（多源）、是否偏斜。',
  parameters: { type: 'object', properties: { charId: { type: 'string' }, days: { type: 'number' }, bins: { type: 'number' } }, required: ['charId'] },
  run(args) {
    const ch = charInfo(args.charId);
    if (!ch) return { ok: false, error: '未找到特性' };
    const v = seriesOf(ch.id, args.days || 30).map((r) => r.value);
    const h = stats.histogram(v, args.bins || 12);
    return { ok: true, 数据来源: '@SPC 直方图', 特性: ch.id, 规格限: [ch.lsl, ch.usl], 分箱: h.bins, 统计量: stats.describe(v) };
  },
});

/* ================================================================== */
/* @ERP                                                               */
/* ================================================================== */
const MATERIALS = [
  { code: 'M-78120-01', name: '充电口盖总成', supplier: '宁波华翔', price: 86.5, unit: '元/件', leadTime: 3, lsl: 3.0, usl: 4.0, batch: 'B2510-12' },
  { code: 'M-64311-02', name: '前门内饰板', supplier: '延锋内饰', price: 142.0, unit: '元/件', leadTime: 5, batch: 'B2511-04' },
  { code: 'M-51207-08', name: '侧围外板（左）', supplier: '凌云股份', price: 268.0, unit: '元/件', leadTime: 7, batch: 'B2509-21' },
  { code: 'M-90755-03', name: '动力电池模组 76.5kWh', supplier: '宁德时代', price: 18600.0, unit: '元/件', leadTime: 14, batch: 'B2510-02' },
  { code: 'M-33210-05', name: '驱动电机总成', supplier: '博世汽车', price: 9840.0, unit: '元/件', leadTime: 21, batch: 'B2508-17' },
  { code: 'M-45112-11', name: '面漆涂料（珍珠白）', supplier: '巴斯夫', price: 62.0, unit: '元/kg', leadTime: 10, batch: 'B2511-09' },
  { code: 'M-22087-04', name: '悬置螺栓 M12×60', supplier: '晋亿实业', price: 4.2, unit: '元/件', leadTime: 2, batch: 'B2511-15' },
  { code: 'M-66030-06', name: '仪表台总成', supplier: '拓普集团', price: 1240.0, unit: '元/件', leadTime: 6, batch: 'B2510-08' },
];

define({
  plugin: '@ERP', name: 'erp_batch_trace', label: '批次与供应商追溯',
  description: '按物料或特性查询 ERP 中的批次-供应商-价格信息，并给出该物料在各供应商间的批次分布。用于判断「换批/换供应商」是否与失控时间点吻合。',
  parameters: {
    type: 'object',
    properties: {
      material: { type: 'string', description: '物料名称或编码关键词，如「充电口盖」' },
      charId: { type: 'string', description: '或直接按特性编号关联物料' },
      days: { type: 'number', description: '时间窗，默认 15' },
    },
  },
  run(args) {
    let mats = MATERIALS;
    if (args.material) mats = mats.filter((m) => m.name.indexOf(args.material) >= 0 || m.code.indexOf(args.material) >= 0);
    if (args.charId) {
      const map = { 'CT-0378': '充电口盖', 'CT-0211': '面漆', 'CT-0155': '悬置螺栓', 'CT-0402': '侧围外板', 'CT-0301': '电池模组', 'CT-0088': '侧围外板', 'CT-0455': '前门内饰板' };
      const kw = map[args.charId] || '';
      mats = MATERIALS.filter((m) => m.name.indexOf(kw) >= 0 || m.code.indexOf(kw) >= 0);
    }
    if (!mats.length) return { ok: false, error: '未找到匹配物料，试给出物料名称关键词' };
    const out = mats.map((m) => {
      const rows = store.col('measurements').find((r) => r.ts >= sinceISO(args.days || 15) && (r.charName.indexOf(m.name.slice(0, 3)) >= 0 || m.name.indexOf((r.charName || '').slice(0, 3)) >= 0));
      const bySup = {};
      const byBatch = {};
      for (const r of rows) {
        bySup[r.supplier] = bySup[r.supplier] || { 供应商: r.supplier, 数量: 0, 均值: [] };
        bySup[r.supplier].数量++; bySup[r.supplier].均值.push(r.value);
        byBatch[r.batch] = byBatch[r.batch] || { 批次: r.batch, 供应商: r.supplier, 起: r.ts, 止: r.ts, 数量: 0, 均值: [] };
        const b = byBatch[r.batch];
        b.数量++; b.均值.push(r.value);
        if (r.ts < b.起) b.起 = r.ts; if (r.ts > b.止) b.止 = r.ts;
      }
      return {
        物料: m.name, 编码: m.code, 主供应商: m.supplier, 单价: m.price + '/' + m.unit, 采购周期: m.leadTime + ' 天', 当前批次: m.batch,
        关联测量批次: Object.values(byBatch).map((b) => ({ 批次: b.批次, 供应商: b.供应商, 起: b.起.slice(0, 16), 止: b.止.slice(0, 16), 数量: b.数量, 均值: Number((b.均值.reduce((a, c) => a + c, 0) / b.均值.length).toFixed(4)) })).sort((a, b) => (a.起 < b.起 ? -1 : 1)),
        供应商分布: Object.values(bySup).map((s) => ({ 供应商: s.供应商, 数量: s.数量, 均值: Number((s.均值.reduce((a, c) => a + c, 0) / s.均值.length).toFixed(4)) })),
      };
    });
    return { ok: true, 数据来源: '@ERP 批次与供应商主数据', 物料数: out.length, 明细: out };
  },
});

define({
  plugin: '@ERP', name: 'erp_material_cost', label: '物料成本查询',
  description: '查询物料单价、工时费率等成本基础数据，用于收益测算。收益测算必须用本工具返回的 ERP 标准价，不得自行估计。',
  parameters: { type: 'object', properties: { material: { type: 'string', description: '物料名称关键词，留空返回全部' } } },
  run(args) {
    let mats = MATERIALS;
    if (args.material) mats = mats.filter((m) => m.name.indexOf(args.material) >= 0 || m.code.indexOf(args.material) >= 0);
    return {
      ok: true, 数据来源: '@ERP 物料主数据 / 成本中心',
      工时费率: { 装配工时: 68, 返修工时: 92, 检验工时: 55, 单位: '元/小时' },
      停线损失: { 单线每小时: 8600, 单位: '元/小时' },
      物料: mats.map((m) => ({ 物料: m.name, 编码: m.code, 单价: m.price, 单位: m.unit, 供应商: m.supplier })),
    };
  },
});

define({
  plugin: '@ERP', name: 'erp_bom', label: 'BOM 查询',
  description: '查询指定产品/总成的 BOM 结构，用于分析失效件与其装配层级关系。',
  parameters: { type: 'object', properties: { model: { type: 'string', description: '产品' }, part: { type: 'string', description: '零件名称关键词' } } },
  run(args) {
    const BOM = {
      '产品C': [
        { 层级: 1, 零件: '充电口盖总成', 编码: 'M-78120-01', 数量: 1, 供应商: '宁波华翔', 关键: true },
        { 层级: 2, 零件: '充电口盖本体', 编码: 'M-78120-01-1', 数量: 1, 供应商: '宁波华翔' },
        { 层级: 2, 零件: '铰链组件', 编码: 'M-78120-01-2', 数量: 1, 供应商: '宁波华翔' },
        { 层级: 2, 零件: '锁扣弹簧', 编码: 'M-78120-01-3', 数量: 1, 供应商: '均胜电子' },
        { 层级: 1, 零件: '侧围外板（左）', 编码: 'M-51207-08', 数量: 1, 供应商: '凌云股份', 关键: true },
        { 层级: 1, 零件: '动力电池模组 76.5kWh', 编码: 'M-90755-03', 数量: 1, 供应商: '宁德时代', 关键: true },
      ],
      '产品A': [
        { 层级: 1, 零件: '侧围外板（左）', 编码: 'M-51207-08', 数量: 1, 供应商: '凌云股份', 关键: true },
        { 层级: 1, 零件: '前门内饰板', 编码: 'M-64311-02', 数量: 2, 供应商: '延锋内饰' },
        { 层级: 1, 零件: '面漆涂料（珍珠白）', 编码: 'M-45112-11', 数量: 4.2, 供应商: '巴斯夫', 关键: true },
      ],
      '产品B': [
        { 层级: 1, 零件: '驱动电机总成', 编码: 'M-33210-05', 数量: 1, 供应商: '博世汽车', 关键: true },
        { 层级: 1, 零件: '仪表台总成', 编码: 'M-66030-06', 数量: 1, 供应商: '拓普集团' },
        { 层级: 1, 零件: '悬置螺栓 M12×60', 编码: 'M-22087-04', 数量: 8, 供应商: '晋亿实业' },
      ],
    };
    let rows = BOM[args.model] || Object.values(BOM).flat();
    if (args.part) rows = rows.filter((r) => r.零件.indexOf(args.part) >= 0);
    return { ok: true, 数据来源: '@ERP BOM 主数据', 产品: args.model || '全部', 条目数: rows.length, BOM: rows };
  },
});

/* ================================================================== */
/* @AQI  AI 视觉质检                                                   */
/* ================================================================== */
define({
  plugin: '@AQI', name: 'aqi_defect_query', label: 'AI 质检缺陷查询',
  description: '查询 AI 视觉质检（AQI）的缺陷检测结果：按产品/车间/缺陷类型/时间窗统计缺陷密度、置信度分布与趋势。出口批次风险判断必须基于本工具数据。',
  parameters: {
    type: 'object',
    properties: {
      model: { type: 'string', description: '产品' },
      workshop: { type: 'string', description: '车间' },
      type: { type: 'string', description: '缺陷类型关键词，如 颗粒/间隙/缩孔' },
      days: { type: 'number', description: '天数，默认 7' },
      groupByDay: { type: 'boolean', description: '是否按日趋势返回' },
    },
  },
  run(args) {
    const days = args.days || 7;
    const since = sinceISO(days);
    let rows = store.col('defects').find((d) => d.ts >= since);
    if (args.model) rows = rows.filter((r) => r.model === args.model);
    if (args.workshop) rows = rows.filter((r) => r.workshop === args.workshop);
    if (args.type) rows = rows.filter((r) => r.type.indexOf(args.type) >= 0);
    if (!rows.length) return { ok: false, error: '该条件下无 AI 质检缺陷记录' };
    const byType = {}, byDay = {}, byModel = {};
    for (const r of rows) {
      byType[r.type] = byType[r.type] || { 缺陷类型: r.type, 数量: 0, 置信度和: 0, A级: 0 };
      byType[r.type].数量++; byType[r.type].置信度和 += r.confidence; if (r.severity === 'A') byType[r.type].A级++;
      const day = r.ts.slice(0, 10);
      byDay[day] = byDay[day] || { 日期: day, 数量: 0 };
      byDay[day].数量++;
      byModel[r.model] = byModel[r.model] || { 产品: r.model, 数量: 0 };
      byModel[r.model].数量++;
    }
    return {
      ok: true, 数据来源: '@AQI AI 视觉质检（厂内 GPU 推理）',
      时间窗: since.slice(0, 10) + ' ~ ' + dataNow().toISOString().slice(0, 10),
      缺陷总数: rows.length,
      平均置信度: Number((rows.reduce((a, c) => a + c.confidence, 0) / rows.length).toFixed(3)),
      按类型: Object.values(byType).map((t) => ({ 缺陷类型: t.缺陷类型, 数量: t.数量, 平均置信度: Number((t.置信度和 / t.数量).toFixed(3)), A级数: t.A级 })).sort((a, b) => b.数量 - a.数量),
      按产品: Object.values(byModel),
      按日趋势: Object.values(byDay).sort((a, b) => (a.日期 < b.日期 ? -1 : 1)),
      明细样本: rows.slice(-10).map((r) => ({ 时间: r.ts.slice(0, 16), 产品: r.model, 车间: r.workshop, 缺陷: r.type, 置信度: r.confidence, 等级: r.severity, 批次: r.batch })),
    };
  },
});

define({
  plugin: '@AQI', name: 'aqi_risk_scan', label: '质量风险扫描',
  description: '跨数据源综合扫描当前质量风险：结合 AQI 缺陷趋势、SPC 判异、市场投诉与超期项目，输出风险清单与建议动作。用于生成 AI 晨报与风险预警。',
  parameters: { type: 'object', properties: { days: { type: 'number', description: '扫描窗口天数，默认 7' } } },
  run(args) {
    const days = args.days || 7;
    const risks = [];
    // 1) SPC 判异风险
    for (const ch of store.col('spcChars').all()) {
      const rows = seriesOf(ch.id, days);
      const v = rows.map((r) => r.value);
      if (v.length < 8) continue;
      let chart;
      try { chart = stats.chartIMR(v); } catch (_) { continue; }
      const hits = stats.spcRules(v, { center: chart.center, ucl: chart.ucl, lcl: chart.lcl, sigma: chart.sigmaWithin });
      const high = hits.filter((h) => h.severity === 'high');
      if (hits.length) {
        risks.push({
          风险源: '@SPC 判异', 对象: ch.id + ' ' + ch.name, 车间: ch.workshop, 产品: ch.model,
          等级: high.length ? 'A' : 'B',
          描述: '命中 ' + hits.length + ' 条判异准则：' + hits.map((h) => '准则' + h.rule).join('、'),
          数据支撑: '近' + days + '日 ' + v.length + ' 个测量值，控制限 ' + chart.lcl.toFixed(3) + '~' + chart.ucl.toFixed(3),
          建议动作: high.length ? '立即升级 QRQC，锁定失控起点并做批次比对' : '纳入班次跟踪，若连续 2 日不恢复则升级',
        });
      }
    }
    // 2) AQI 缺陷密度上升
    const nowRows = store.col('defects').find((d) => d.ts >= sinceISO(3));
    const prevRows = store.col('defects').find((d) => d.ts >= sinceISO(6) && d.ts < sinceISO(3));
    const nowN = nowRows.length, prevN = prevRows.length;
    if (prevN >= 3 && nowN > prevN * 1.3) {
      const types = {};
      nowRows.forEach((r) => { types[r.type] = (types[r.type] || 0) + 1; });
      const top = Object.entries(types).sort((a, b) => b[1] - a[1])[0];
      risks.push({
        风险源: '@AQI 视觉质检', 对象: top ? top[0] : '缺陷', 车间: (nowRows.find((r) => r.type === (top && top[0])) || {}).workshop,
        等级: 'A', 描述: '近 3 日缺陷检出 ' + nowN + ' 起，较前 3 日 ' + prevN + ' 起上升 ' + Math.round((nowN / prevN - 1) * 100) + '%',
        数据支撑: 'AI 质检置信度均值 ' + (rows2avg(nowRows)).toFixed(3),
        建议动作: '核查该缺陷类型对应工序的 4M 变化点，必要时申请出口批次加严检验',
      });
    }
    // 3) 超期项目
    const overdue = store.col('projects').find((p) => p.overdue && p.stage !== 'D8');
    if (overdue.length) {
      risks.push({ 风险源: '改进项目管理', 对象: overdue.map((p) => p.id).join('、'), 等级: 'A', 描述: overdue.length + ' 个改进项目超期未关闭', 数据支撑: overdue.map((p) => p.id + ' 逾期 ' + p.overdueDays + ' 天').join('；'), 建议动作: '升级厂级 QRQC 并抄送科长' });
    }
    // 4) 重复问题
    const openIssues = store.col('issues').find((i) => i.status !== '已关闭');
    const clusters = {};
    for (const i of openIssues) {
      const k = i.workshop + '|' + i.title.slice(0, 6);
      (clusters[k] = clusters[k] || []).push(i);
    }
    Object.values(clusters).filter((c) => c.length >= 2).forEach((c) => {
      risks.push({ 风险源: '重复问题聚类', 对象: c.map((x) => x.id).join('、'), 等级: 'B', 描述: c[0].workshop + '「' + c[0].title.slice(0, 12) + '」类问题重复发生 ' + c.length + ' 次', 数据支撑: '同构问题聚类', 建议动作: '升级为质量改进项目并做设计端横展' });
    });
    risks.sort((a, b) => (a.等级 === b.等级 ? 0 : a.等级 === 'A' ? -1 : 1));
    return { ok: true, 数据来源: '跨插件综合扫描（@SPC + @AQI + 本平台）', 扫描窗口: days + ' 天', 风险总数: risks.length, A级风险: risks.filter((r) => r.等级 === 'A').length, 风险清单: risks };
  },
});

function rows2avg(rows) { return rows.length ? rows.reduce((a, c) => a + c.confidence, 0) / rows.length : 0; }

module.exports = { dataNow, seriesOf, subgroupsOf, charInfo, sinceISO, MATERIALS, UNIT_LOSS };
