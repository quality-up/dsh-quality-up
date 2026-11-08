'use strict';
/**
 * 分析类工具：把 stats.js 统计引擎暴露给智能体
 * ------------------------------------------------------------------
 * 原则：模型只能"读结论"，不能"造数字"。所有 Cpk、p 值、F 值、GR&R 都由此处真实计算。
 * 数据来源有两种：
 *   ① 平台已存数据（给 charId / 或 groupBy）
 *   ② 用户导入或对话中给出的原始数据（给 values）
 */
const { define } = require('./registry');
const store = require('../lib/store');
const stats = require('../lib/stats');
const { seriesOf, sinceISO, dataNow } = require('./data');

/** 解析数值数组：优先 values，其次从平台数据取 */
function resolveValues(args) {
  if (Array.isArray(args.values) && args.values.length) {
    const v = args.values.map(Number).filter((x) => Number.isFinite(x));
    return { values: v, source: '用户提供 / 导入的数据（n=' + v.length + '）' };
  }
  if (args.charId) {
    const rows = seriesOf(args.charId, args.days === undefined ? 30 : args.days);
    if (!rows.length) return { error: '特性 ' + args.charId + ' 在指定时间窗内没有数据' };
    const ch = store.col('spcChars').get(args.charId) || {};
    return { values: rows.map((r) => r.value), source: '@MES 特性 ' + args.charId + ' 近 ' + (args.days || 30) + ' 日数据', char: ch, rows };
  }
  return { error: '请提供 values（原始数据数组）或 charId（平台已有特性）' };
}

define({
  plugin: '@SPC', name: 'stat_describe', label: '描述统计',
  description: '对一组数据或平台某特性做完整描述统计：n、均值、标准差、中位数、四分位、极差、变异系数。',
  parameters: {
    type: 'object',
    properties: {
      values: { type: 'array', items: { type: 'number' }, description: '原始数值数组（与 charId 二选一）' },
      charId: { type: 'string', description: '平台特性编号' },
      days: { type: 'number' },
    },
  },
  run(args) {
    const r = resolveValues(args);
    if (r.error) return { ok: false, error: r.error };
    const d = stats.describe(r.values);
    return {
      ok: true, 数据来源: r.source, n: d.n,
      统计量: { 和: Number(d.sum.toFixed(4)), 均值: Number(d.mean.toFixed(4)), 标准差: Number(d.sd.toFixed(4)), 方差: Number((d.sd * d.sd).toFixed(6)), 最小值: d.min, 最大值: d.max, 中位数: d.median, Q1: Number(d.q1.toFixed(4)), Q3: Number(d.q3.toFixed(4)), 四分位距: Number(d.iqr.toFixed(4)), 极差: Number(d.range.toFixed(4)), 变异系数: Number(d.cv.toFixed(2)) + '%' },
    };
  },
});

define({
  plugin: '@SPC', name: 'stat_capability_calc', label: '过程能力计算（任意数据）',
  description: '对任意一组数据计算 Cp/Cpk/Pp/Ppk/ppm/西格玛水平，用于导入数据（如 Excel 测量数据）的能力分析。',
  parameters: {
    type: 'object',
    properties: {
      values: { type: 'array', items: { type: 'number' }, description: '测量值数组' },
      usl: { type: 'number', description: '规格上限' },
      lsl: { type: 'number', description: '规格下限' },
      charId: { type: 'string', description: '也可指定平台特性以自动取规格限' },
      days: { type: 'number' },
    },
    required: [],
  },
  run(args) {
    let values = null, source = '', usl = args.usl, lsl = args.lsl;
    if (Array.isArray(args.values) && args.values.length) { values = args.values.map(Number).filter(Number.isFinite); source = '用户提供数据'; }
    else if (args.charId) { const r = resolveValues(args); if (r.error) return { ok: false, error: r.error }; values = r.values; source = r.source; if (r.char) { usl = usl === undefined ? r.char.usl : usl; lsl = lsl === undefined ? r.char.lsl : lsl; } }
    if (!values || !values.length) return { ok: false, error: '需提供 values 或 charId' };
    if (usl === undefined && lsl === undefined) return { ok: false, error: '需提供 usl/lsl（或指定带规格限的 charId）' };
    const u = usl === undefined ? Infinity : usl, l = lsl === undefined ? -Infinity : lsl;
    const c = stats.capability(values, u, l);
    return {
      ok: true, 数据来源: source, n: values.length, 规格限: { LSL: lsl, USL: usl },
      均值: Number(c.mean.toFixed(4)), 标准差: Number(c.sd.toFixed(4)),
      能力指数: { Cp: Number(c.cp.toFixed(3)), Cpk: Number(c.cpk.toFixed(3)), Pp: Number(c.pp.toFixed(3)), Ppk: Number(c.ppk.toFixed(3)) },
      预估不良率ppm: Math.round(c.ppmTotal), 西格玛水平: Number(c.sigmaLevel.toFixed(2)),
      判定: c.cpk >= 1.67 ? '优秀' : c.cpk >= 1.33 ? '良好' : c.cpk >= 1.0 ? '尚可，需改进' : '能力不足，必须整改',
    };
  },
});

define({
  plugin: '@SPC', name: 'stat_hypothesis_test', label: '假设检验',
  description: '执行单样本 t 检验、双样本 t 检验（Welch）、配对 t 检验、单因素方差分析（ANOVA）、卡方检验。返回真实的检验统计量与 p 值。用于判断两组数据差异是否显著（如改善前后效果判定、供应商间差异判定）。',
  parameters: {
    type: 'object',
    properties: {
      test: { type: 'string', enum: ['t1', 't2', 'paired', 'anova', 'chi2_gof', 'chi2_ind'], description: 't1=单样本t；t2=双样本t；paired=配对t；anova=单因素方差；chi2_gof=卡方拟合优度；chi2_ind=卡方独立性' },
      sample1: { type: 'array', items: { type: 'number' }, description: '样本1（t1 时为样本数据；chi2 时为观测频数）' },
      sample2: { type: 'array', items: { type: 'number' }, description: '样本2（t2/paired 时为第二组；chi2_gof 时为期望频数）' },
      groups: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'ANOVA 的多组数据' },
      table: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'chi2_ind 的列联表' },
      mu0: { type: 'number', description: 't1 的检验均值（默认 0）' },
      alpha: { type: 'number', description: '显著性水平，默认 0.05' },
      tail: { type: 'string', enum: ['two', 'greater', 'less'], description: '单双侧，默认 two' },
      equalVariance: { type: 'boolean', description: 't2 是否假设等方差（默认 false，用 Welch）' },
    },
    required: ['test'],
  },
  run(args) {
    const alpha = args.alpha || 0.05;
    const nums = (a) => (Array.isArray(a) ? a.map(Number).filter((x) => Number.isFinite(x)) : []);
    try {
      if (args.test === 't1') {
        const s1 = nums(args.sample1);
        if (s1.length < 2) return { ok: false, error: '单样本 t 检验至少需要 2 个数据（当前 ' + s1.length + ' 个）' };
        const r = stats.tTest1(s1, args.mu0 || 0, { alpha, tail: args.tail || 'two' });
        return { ok: true, 检验方法: '单样本 t 检验', 样本量: s1.length, 检验均值: args.mu0 || 0, 统计量t: Number(r.t.toFixed(4)), 自由度: r.df, p值: Number(r.p.toFixed(6)), 显著性水平: alpha, 结论: r.reject ? '拒绝原假设：存在统计显著差异' : '不拒绝原假设：无统计显著差异', 置信区间: r.ci ? [Number(r.ci[0].toFixed(4)), Number(r.ci[1].toFixed(4))] : undefined, 说明: r.reject ? '差异显著（p<alpha），可判定改善/差异真实存在' : '差异不显著（p≥alpha），观察到的差异可能由随机波动引起，不能作为改善有效的证据' };
      }
      if (args.test === 't2' || args.test === 'paired') {
        const s1 = nums(args.sample1), s2 = nums(args.sample2);
        if (s1.length < 2 || s2.length < 2) return { ok: false, error: (args.test === 'paired' ? '配对 t 检验' : '双样本 t 检验') + '两组各至少需要 2 个数据（当前：样本1 ' + s1.length + ' 个，样本2 ' + s2.length + ' 个）' };
        if (args.test === 'paired' && s1.length !== s2.length) return { ok: false, error: '配对 t 检验要求两组数据一一配对，个数必须相同（当前 ' + s1.length + ' vs ' + s2.length + '）' };
        const r = args.test === 'paired' ? stats.pairedT(s1, s2, { alpha, tail: args.tail }) : stats.tTest2(s1, s2, { alpha, tail: args.tail, equalVariance: args.equalVariance });
        return {
          ok: true, 检验方法: args.test === 'paired' ? '配对 t 检验' : (args.equalVariance ? '双样本 t 检验（等方差）' : '双样本 t 检验（Welch）'),
          样本1: { n: s1.length, 均值: Number(stats.mean(s1).toFixed(4)), 标准差: Number(stats.sd(s1).toFixed(4)) },
          样本2: { n: s2.length, 均值: Number(stats.mean(s2).toFixed(4)), 标准差: Number(stats.sd(s2).toFixed(4)) },
          均值差: Number(r.diff.toFixed(4)), 统计量t: Number(r.t.toFixed(4)), 自由度: r.df, p值: Number(r.p.toFixed(6)),
          显著性水平: alpha, 结论: r.reject ? '拒绝原假设：两组存在统计显著差异' : '不拒绝原假设：两组无统计显著差异',
          置信区间: r.ci ? [Number(r.ci[0].toFixed(4)), Number(r.ci[1].toFixed(4))] : undefined,
          说明: r.reject ? '差异显著，说明因子（如改善措施）有效' : '差异不显著，尚不能证明措施有效，建议延长验证或加大样本量',
        };
      }
      if (args.test === 'anova') {
        if (!args.groups || args.groups.length < 2) return { ok: false, error: '方差分析需要至少 2 组数据（groups），当前 ' + ((args.groups || []).length) + ' 组' };
        const gs = args.groups.map(nums);
        const bad = gs.findIndex((g) => g.length < 2);
        if (bad >= 0) return { ok: false, error: '第 ' + (bad + 1) + ' 组有效数据不足 2 个，无法做方差分析' };
        const r = stats.anova1(gs, { alpha });
        return {
          ok: true, 检验方法: '单因素方差分析（One-way ANOVA）', 组数: gs.length,
          组统计: r.groupStats.map((g) => ({ n: g.n, 均值: Number(g.mean.toFixed(4)), 标准差: Number(g.sd.toFixed(4)) })),
          统计量F: Number(r.F.toFixed(4)), 自由度: { 组间: r.dfB, 组内: r.dfW }, p值: Number(r.p.toFixed(6)),
          平方和: { 组间: Number(r.ssB.toFixed(4)), 组内: Number(r.ssW.toFixed(4)) }, 均方: { 组间: Number(r.msB.toFixed(4)), 组内: Number(r.msW.toFixed(4)) },
          显著性水平: alpha, 结论: r.reject ? '拒绝原假设：各组均值存在统计显著差异' : '不拒绝原假设：各组均值无统计显著差异',
        };
      }
      if (args.test === 'chi2_gof') {
        const o = nums(args.sample1), e = nums(args.sample2);
        if (!o.length || o.length !== e.length) return { ok: false, error: '卡方拟合优度检验需要「观测频数」与「期望频数」个数相同且非空' };
        const r = stats.chiSquareGOF(o, e);
        return { ok: true, 检验方法: '卡方拟合优度检验', 卡方值: Number(r.chi2.toFixed(4)), 自由度: r.df, p值: Number(r.p.toFixed(6)), 结论: r.reject ? '观测分布与期望分布显著不同' : '观测分布与期望分布无显著差异' };
      }
      if (args.test === 'chi2_ind') {
        if (!args.table || args.table.length < 2) return { ok: false, error: '卡方独立性检验需要至少 2×2 的列联表（table）' };
        const r = stats.chiSquareIndependence(args.table.map((row) => row.map(Number)));
        return { ok: true, 检验方法: '卡方独立性检验', 卡方值: Number(r.chi2.toFixed(4)), 自由度: r.df, p值: Number(r.p.toFixed(6)), 结论: r.reject ? '两变量相关（不独立）' : '两变量独立（无关联）' };
      }
      return { ok: false, error: '未知检验类型：' + args.test + '。可选：t1（单样本 t）、t2（双样本 t）、paired（配对 t）、anova（方差分析）、chi2_gof、chi2_ind' };
    } catch (e) {
      return { ok: false, error: '统计计算失败：' + e.message + '。请检查样本量是否足够、数据是否为数值。' };
    }
  },
});

define({
  plugin: '@SPC', name: 'stat_regression', label: '相关与回归分析',
  description: '做皮尔逊相关、斯皮尔曼相关、一元线性回归或多元线性回归，返回回归方程、R²、各系数显著性 p 值。用于量化因素与响应之间的关系强度（如温度与尺寸的关系）。',
  parameters: {
    type: 'object',
    properties: {
      x: { type: 'array', description: '自变量：一元时为一维数组；多元时为一维数组的数组（每行一个样本）' },
      y: { type: 'array', items: { type: 'number' }, description: '因变量数组' },
      type: { type: 'string', enum: ['linear', 'multiple', 'correlation'], description: '默认 linear' },
      featureNames: { type: 'array', items: { type: 'string' }, description: '多元回归的自变量名称' },
      predictAt: { type: 'number', description: '可选：给出一个 x 值，返回预测值（仅一元）' },
    },
    required: ['x', 'y'],
  },
  run(args) {
    try {
      const y = args.y.map(Number);
      if (y.length < 3) return { ok: false, error: '回归/相关分析至少需要 3 组数据（当前 ' + y.length + ' 组）' };
      const isMulti = Array.isArray(args.x[0]);
      if (isMulti && args.x.length !== y.length) return { ok: false, error: '自变量样本数（' + args.x.length + '）与因变量（' + y.length + '）不一致' };
      if (!isMulti && args.x.length !== y.length) return { ok: false, error: '自变量 X 与因变量 Y 的数据个数必须相同（当前 X=' + args.x.length + '，Y=' + y.length + '）' };
      if (args.type === 'correlation') {
        const x = args.x.map(Number);
        const r = stats.pearson(x, y);
        const sp = stats.spearman(x, y);
        return { ok: true, 分析类型: '相关分析', n: r.n, 皮尔逊r: Number(r.r.toFixed(4)), R2: Number(r.r2.toFixed(4)), 斯皮尔曼rho: Number(sp.rho.toFixed(4)), t值: Number(r.t.toFixed(4)), p值: Number(r.p.toFixed(6)), 结论: Math.abs(r.r) >= 0.8 ? '强相关' : Math.abs(r.r) >= 0.5 ? '中等相关' : Math.abs(r.r) >= 0.3 ? '弱相关' : '几乎无线性相关', 说明: r.p < 0.05 ? '相关性统计显著' : '相关性不显著，不能据此判定因果关系' };
      }
      if (isMulti) {
        const r = stats.multipleRegression(args.x, y, { featureNames: args.featureNames });
        return {
          ok: true, 分析类型: '多元线性回归', n: r.n, 自变量数: r.k, R2: Number(r.r2.toFixed(4)), 调整R2: Number(r.adjR2.toFixed(4)), 标准误: Number(r.se.toFixed(4)),
          回归方程: 'y = ' + r.coefficients.map((b, i) => (i === 0 ? Number(b.toFixed(4)) : (b >= 0 ? ' + ' : ' - ') + Math.abs(b).toFixed(4) + '×' + (r.featureNames[i - 1] || 'X' + i))).join(''),
          系数表: r.coefficients.map((b, i) => ({ 项: i === 0 ? '截距' : (r.featureNames[i - 1] || 'X' + i), 系数: Number(b.toFixed(4)), 标准误: Number(r.se[i].toFixed(4)), t值: Number(r.t[i].toFixed(4)), p值: Number(r.p[i].toFixed(6)), 显著: r.p[i] < 0.05 })),
          显著因子: r.coefficients.map((b, i) => ({ 项: i === 0 ? '截距' : (r.featureNames[i - 1] || 'X' + i), p: r.p[i] })).filter((f) => f.p < 0.05 && f.项 !== '截距').map((f) => f.项),
        };
      }
      const x = args.x.map(Number);
      const r = stats.linearRegression(x, y);
      const out = {
        ok: true, 分析类型: '一元线性回归', n: r.n, R2: Number(r.r2.toFixed(4)), 调整R2: Number(r.adjR2.toFixed(4)), 相关系数r: Number(r.r.toFixed(4)),
        回归方程: 'y = ' + Number(r.intercept.toFixed(4)) + (r.slope >= 0 ? ' + ' : ' - ') + Math.abs(Number(r.slope.toFixed(4))) + 'x',
        斜率: Number(r.slope.toFixed(4)), 斜率标准误: Number(r.seSlope.toFixed(4)), 斜率t值: Number(r.tSlope.toFixed(4)), 斜率p值: Number(r.pSlope.toFixed(6)),
        截距: Number(r.intercept.toFixed(4)), 回归标准误: Number(r.se.toFixed(4)),
        方差分析: { F: Number(r.anova.F.toFixed(4)), p: Number(r.anova.p.toFixed(6)), 回归平方和: Number(r.anova.ssR.toFixed(4)), 残差平方和: Number(r.anova.ssE.toFixed(4)) },
        结论: r.pSlope < 0.05 ? '斜率统计显著，x 与 y 存在显著线性关系' : '斜率不显著，x 与 y 无显著线性关系',
      };
      if (args.predictAt !== undefined) out['x=' + args.predictAt + ' 的预测值'] = Number(r.predict(args.predictAt).toFixed(4));
      return out;
    } catch (e) {
      return { ok: false, error: '回归分析失败：' + e.message + '。请检查 X/Y 是否为等长数值数组。' };
    }
  },
});

define({
  plugin: '@SPC', name: 'stat_grr', label: 'MSA 量具 GR&R 分析',
  description: '对测量系统做 GR&R 分析（均值极差法或 ANOVA 法），返回 EV/AV/GRR/PV/TV、%GRR、%PV、ndc 与接受判定。AIAG 准则：%GRR<10% 可接受；10~30% 视情况；>30% 不可接受；ndc≥5。',
  parameters: {
    type: 'object',
    properties: {
      data: { type: 'array', description: '三维数组：data[操作者][零件][重复次数]' },
      method: { type: 'string', enum: ['range', 'anova'], description: '默认 range（均值极差法）' },
      tolerance: { type: 'number', description: '公差带宽度（可选，用于 %GRR 对公差）' },
    },
    required: ['data'],
  },
  run(args) {
    const nums = (a) => (Array.isArray(a) ? a.map(Number).filter((x) => Number.isFinite(x)) : []);
    try {
      if (!Array.isArray(args.data) || args.data.length < 2) return { ok: false, error: 'GR&R 至少需要 2 个操作者（data[操作者][零件][重复次数]）' };
      const ops = args.data.length, parts = (args.data[0] || []).length;
      if (parts < 2) return { ok: false, error: 'GR&R 至少需要 2 个零件（当前第 1 个操作者只有 ' + parts + ' 个零件）' };
      const uneven = args.data.findIndex((o) => o.length !== parts);
      if (uneven >= 0) return { ok: false, error: '每个操作者测的零件数必须一致（第 ' + (uneven + 1) + ' 个操作者与其他不一致）' };
      const trials = (args.data[0][0] || []).length;
      if (trials < 2) return { ok: false, error: '每个零件至少需要 2 次重复测量（当前 ' + trials + ' 次）' };
      const r = (args.method === 'anova' ? stats.grrAnova : stats.grrAverageRange)(args.data, { tolerance: args.tolerance });
      return {
        ok: true, 分析方法: (args.method === 'anova' ? 'ANOVA 法' : '均值极差法（AIAG MSA-4）'),
        设计: { 零件数: r.parts, 操作者数: r.operators, 重复次数: r.trials },
        变异分量: { EV重复性: Number(r.ev.toFixed(4)), AV再现性: Number(r.av.toFixed(4)), GRR: Number(r.grr.toFixed(4)), PV零件变异: Number(r.pv.toFixed(4)), TV总变异: Number(r.tv.toFixed(4)) },
        百分比: { '%EV': Number(r.pctEv.toFixed(1)), '%AV': Number(r.pctAv.toFixed(1)), '%GRR': Number(r.pctGrr.toFixed(1)), '%PV': Number(r.pctPv.toFixed(1)) },
        ndc可区分类别数: Number(r.ndc.toFixed(2)),
        判定: r.pctGrr < 10 ? '测量系统可接受' : r.pctGrr <= 30 ? '条件接受（视应用重要性、成本、风险决定），建议改进' : '不可接受，必须改进测量系统',
        结论: r.pctGrr > 30 ? '测量系统变异过大，当前数据不能用于过程能力判定（先解决量具问题，否则 Cpk 结论不可信）' : r.ndc < 5 ? '可区分类别数不足(<5)，分辨力不够，建议提高量具分辨力' : '测量系统满足使用要求',
      };
    } catch (e) { return { ok: false, error: 'GR&R 计算失败：' + e.message + '。请检查数据结构是否为 data[操作者][零件][重复次数]。' }; }
  },
});

define({
  plugin: '@SPC', name: 'stat_control_chart_calc', label: '控制图计算（任意数据）',
  description: '对任意一组数据计算控制限（I-MR / Xbar-R / Xbar-S / EWMA）并判异，用于导入的 Excel 测量数据。',
  parameters: {
    type: 'object',
    properties: {
      values: { type: 'array', items: { type: 'number' }, description: '一维数据（I-MR 用）' },
      subgroups: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: '子组数据（Xbar 图用）' },
      chartType: { type: 'string', enum: ['I-MR', 'Xbar-R', 'Xbar-S', 'EWMA'] },
      charId: { type: 'string', description: '也可直接用平台特性' },
      days: { type: 'number' },
    },
  },
  run(args) {
    let values = args.values, subgroups = args.subgroups, src = '用户提供数据';
    if (!values && !subgroups && args.charId) {
      const rows = seriesOf(args.charId, args.days === undefined ? 7 : args.days);
      if (!rows.length) return { ok: false, error: '无数据' };
      values = rows.map((r) => r.value);
      subgroups = [];
      const m = new Map();
      for (const r of rows) { if (!m.has(r.subgroup)) m.set(r.subgroup, []); m.get(r.subgroup).push(r.value); }
      subgroups = [...m.keys()].sort((a, b) => a - b).map((k) => m.get(k));
      src = '@MES 特性 ' + args.charId;
    }
    if (!values && !subgroups) return { ok: false, error: '请提供 values / subgroups / charId' };
    const type = args.chartType || (subgroups && subgroups.length > 1 ? 'Xbar-R' : 'I-MR');
    let chart;
    try {
      if (type === 'I-MR') chart = stats.chartIMR(values);
      else if (type === 'Xbar-S') chart = stats.chartXbarS(subgroups);
      else if (type === 'EWMA') chart = stats.chartEWMA(values);
      else chart = stats.chartXbarR(subgroups);
    } catch (e) { return { ok: false, error: '控制图计算失败：' + e.message }; }
    const isX = chart.chart !== 'I-MR' && chart.chart !== 'EWMA';
    const center = isX ? chart.xbar.center : chart.center;
    const ucl = isX ? chart.xbar.ucl : chart.ucl;
    const lcl = isX ? chart.xbar.lcl : chart.lcl;
    const flat = values || [].concat(...subgroups);
    const hits = stats.spcRules(flat, { center, ucl, lcl, sigma: chart.sigmaWithin });
    return {
      ok: true, 数据来源: src, 图类型: chart.chart,
      控制限: { UCL: Number(ucl.toFixed(4)), CL: Number(center.toFixed(4)), LCL: Number(lcl.toFixed(4)) },
      组内标准差: Number(chart.sigmaWithin.toFixed(4)),
      超限点数: (chart.points || (isX ? chart.xbar.points : [])).filter((p) => p.outOfControl).length,
      判异: hits.map((h) => ({ 准则: h.rule, 名称: h.name, 严重度: h.severity, 涉及下标: h.indexes, 说明: h.desc })),
      极差图: chart.r ? { UCL: Number(chart.r.ucl.toFixed(4)), CL: Number(chart.r.center.toFixed(4)), LCL: Number(chart.r.lcl.toFixed(4)) } : undefined,
      点位: (chart.points || (isX ? chart.xbar.points : [])).map((p) => p.value),
    };
  },
});

define({
  plugin: '@SPC', name: 'stat_trend_forecast', label: '趋势分析与预测',
  description: '量化一组数据的趋势（最小二乘斜率）、移动平均与指数平滑预测，用于判断过程是"正在恶化"还是"已经稳定"，并给出未来 5 点的预测值。',
  parameters: {
    type: 'object',
    properties: { values: { type: 'array', items: { type: 'number' } }, charId: { type: 'string' }, days: { type: 'number' }, window: { type: 'number', description: '移动平均窗口，默认 5' }, forecast: { type: 'number', description: '预测点数，默认 5' } },
  },
  run(args) {
    const r = resolveValues(args);
    if (r.error) return { ok: false, error: r.error };
    const v = r.values;
    if (v.length < 3) return { ok: false, error: '至少 3 个数据点' };
    const slope = stats.trendSlope(v);
    const win = args.window || 5;
    const ma = stats.movingAverage(v, win);
    const es = stats.exponentialSmooth(v, 0.3);
    const d = stats.describe(v);
    const n = args.forecast || 5;
    const last = v[v.length - 1];
    const forecast = Array.from({ length: n }, (_, i) => Number((last + slope * (i + 1)).toFixed(4)));
    const dir = slope > 0 ? '上升' : slope < 0 ? '下降' : '平稳';
    return {
      ok: true, 数据来源: r.source, n: v.length,
      趋势: { 斜率: Number(slope.toFixed(6)), 方向: dir, 每点平均变化: Number(slope.toFixed(4)), 判定: Math.abs(slope) > d.sd * 0.15 ? '存在明显趋势（斜率超过 0.15σ）' : '趋势不明显，以随机波动为主' },
      最近值: last, 均值: Number(d.mean.toFixed(4)), 标准差: Number(d.sd.toFixed(4)),
      移动平均: ma.slice(-8), 指数平滑: es.slice(-8),
      线性外推预测: forecast,
      预测警示: forecast.some((f) => f > (args.usl || Infinity)) || forecast.some((f) => f < (args.lsl || -Infinity)) ? '按当前趋势外推将超出规格限，建议立即干预' : '按当前趋势外推 5 点内仍在规格内',
    };
  },
});

module.exports = { resolveValues };
