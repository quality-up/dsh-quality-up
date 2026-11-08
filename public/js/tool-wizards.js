/* ==================================================================
   质量工具 skill：三列菜单 + 真实可用的工具向导
   带 ∑ 的工具会真实调用统计/业务引擎并返回计算结果
   ================================================================== */
(function (global) {
  'use strict';
  const { esc, act, modal, closeModal, toast, table, tag, empty, infoGrid, controlChart, histogramChart, paretoChart, lineChart, brand } = UI;

  /* ---------------- 三列菜单定义 ---------------- */
  const QTools = {
    col1: [
      { name: '8D工作法', ai: '请以 8D 工作法为框架，结合平台真实数据，帮我推进当前最紧急的一个质量改进项目：逐阶段给出该做什么、交付物、以及平台能自动完成的部分。' },
      { name: 'FMEA分析', w: 'fmea' },
      { name: '标准条款精准检索', w: 'std' },
      { name: '海龟图生成', ai: '生成一个「过程海龟图」分析框架（输入/输出/方法/人员/设备/环境/绩效指标），并结合平台数据填充一个真实工序。' },
      { name: '质量成本计算', w: 'qualitycost' },
      { name: '甘特图规划', w: 'gantt' },
      { name: '过程能力指数Cpk/Ppk计算', w: 'cpk' },
      { name: '人机料法环分析', ai: '用「人机料法环（4M1E）」对平台当前最严重的质量问题进行系统分析，每个维度给出基于真实数据的排查项。' },
      { name: '变化点识别与风险评估', ai: '做变化点（4M 变更）识别与风险评估：结合平台数据找出可疑的变化点，给出时间对齐方法与风险等级。' },
      { name: '5W2H管理工具', ai: '用 5W2H 结构化描述平台当前最紧急的质量问题，要求包含真实量化数据。' },
      { name: '5Why根因分析', ai: '用 5Why 方法对当前最严重的质量问题进行根因追问，每一层都要有数据或事实支撑，并给出验证方法。' },
      { name: '假设检验', w: 'ttest' },
      { name: '方差分析', w: 'anova' },
      { name: '回归分析', w: 'regression' },
    ],
    col2: [
      { name: '检查表设计', ai: '为该工序设计一份可直接使用的质量检查表（Check Sheet），包含检查项、判定标准、频次、记录方式。' },
      { name: '分层法应用', w: 'stratify' },
      { name: '排列图绘制', w: 'pareto' },
      { name: '因果图根因分析', ai: '生成因果图（鱼骨图）：按人机料法环测六维度展开根因，给出置信度与验证方法。' },
      { name: '直方图绘制', w: 'histogram' },
      { name: '控制图绘制', w: 'controlchart' },
      { name: '散点图分析', w: 'scatter' },
      { name: '关联图梳理', ai: '用关联图（Interrelationship Diagram）梳理多个质量问题之间的因果关系与相互影响，找出根本驱动因素。' },
      { name: '系统图分解', ai: '用系统图（树图）把改进目标逐层分解为可执行的手段与措施，直到可落地为止。' },
      { name: '矩阵图法', ai: '用矩阵图（L 型）分析质量问题与原因之间的关联强度，找出关键交叉点。' },
      { name: '矩阵数据分析', ai: '用矩阵数据分析法（主成分思路）对多变量质量数据做降维分析，识别主要变异方向。' },
      { name: 'PDPC预判', ai: '用 PDPC 法（过程决策程序图）预判改进方案实施中可能出现的障碍，并给出应对预案。' },
      { name: '箭条图管控', ai: '用箭条图（网络计划）为改进项目做工期与关键路径管控分析。' },
      { name: 'KJ法整理', ai: '用 KJ 法把零散的质量问题与现场反馈卡片化、分组归类，提炼出共性主题。' },
    ],
    col3: [
      { name: '六西格玛DMAIC改进', ai: '按 DMAIC 五阶段（定义/测量/分析/改进/控制）为当前重点问题给出完整的六西格玛改进路线，每阶段给出工具与交付物。' },
      { name: 'GR&R量具重复性再现性分析', w: 'grr' },
      { name: 'MSA偏倚线性稳定性分析', ai: '说明 MSA 的偏倚、线性、稳定性分析方法：给出取样与判定步骤、判定准则（t 检验/回归/控制图法），并结合平台量具数据给出建议。' },
      { name: 'GD&T几何尺寸与公差应用', ai: '结合平台的间隙/面差问题，讲解 GD&T 的基准选择与公差累积分析，给出测量方案建议。' },
      { name: 'QFD质量功能展开', ai: '用 QFD（质量屋）把顾客需求（含市场投诉）转换为工程特性与改进优先级，结合平台真实投诉数据。' },
      { name: 'DOE试验设计', w: 'doe' },
    ],
  };

  /* ---------------- 工具向导定义 ---------------- */
  const W = {
    cpk: {
      title: '过程能力指数 Cpk / Ppk 计算', desc: '可选用平台已有特性，或直接粘贴测量数据。规格限可用特性自带的，也可手动填写。',
      fields: [
        { key: 'charId', label: '平台特性', type: 'char' },
        { key: 'values', label: '或粘贴测量数据（逗号/空格/换行分隔）', type: 'textarea', rows: 3, placeholder: '10.1, 10.3, 9.9, 10.2 …' },
        { key: 'usl', label: '规格上限 USL', type: 'number' }, { key: 'lsl', label: '规格下限 LSL', type: 'number' },
      ],
      tool: 'stat_capability_calc',
    },
    histogram: {
      title: '直方图绘制', desc: '对平台特性或粘贴的数据做分箱统计并绘图（默认取第一个平台特性，直接点「▶ 计算」即可）。',
      fields: [{ key: 'charId', label: '平台特性', type: 'char', required: false }, { key: 'values', label: '或粘贴数据', type: 'textarea', rows: 3 }, { key: 'bins', label: '分箱数', type: 'number', def: 12 }],
      tool: 'spc_histogram', custom: 'hist',
    },
    scatter: {
      title: '散点图与相关分析', desc: '粘贴两组数据，画散点图并做线性相关/回归（默认已填入一组示例，可直接算）。',
      fields: [
        { key: 'x', label: 'X 数据（逗号分隔）', type: 'textarea', rows: 2, required: true, def: '10.1,10.3,9.9,10.2,10.0,10.4,9.8,10.1' },
        { key: 'y', label: 'Y 数据（逗号分隔）', type: 'textarea', rows: 2, required: true, def: '2,4,5,4,5,7,3,4' },
      ],
      tool: 'stat_regression', custom: 'scatter',
    },
    controlchart: {
      title: '控制图绘制', desc: '计算控制限并判异（I-MR / Xbar-R / Xbar-S / EWMA）。',
      fields: [{ key: 'charId', label: '平台特性', type: 'char', required: false }, { key: 'values', label: '或粘贴数据（I-MR 用）', type: 'textarea', rows: 3 }, { key: 'chartType', label: '图类型', type: 'select', options: ['I-MR', 'EWMA'] }],
      tool: 'stat_control_chart_calc',
    },
    ttest: {
      title: '假设检验', desc: '单样本 / 双样本 / 配对 t 检验，输出真实 t 值与 p 值（默认给了一组双样本示例，可直接算）。',
      fields: [
        { key: 'test', label: '检验类型', type: 'select', def: 't2', options: [{ value: 't1', label: '单样本 t（与目标值比较）' }, { value: 't2', label: '双样本 t（两组比较，推荐）' }, { value: 'paired', label: '配对 t（改善前后同一对象）' }] },
        { key: 'mu0', label: '单样本目标值', type: 'number' },
        { key: 'sample1', label: '样本 1 数据（逗号分隔）', type: 'textarea', rows: 2, required: true, def: '10.1,10.3,9.9,10.2,10.0,10.4,9.8,10.1' },
        { key: 'sample2', label: '样本 2 数据（双样本/配对时填写）', type: 'textarea', rows: 2, def: '10.6,10.8,10.5,10.9,10.7,11.0,10.4,10.8' },
        { key: 'alpha', label: '显著性水平 α', type: 'number', def: 0.05 },
      ],
      tool: 'stat_hypothesis_test', parse: ['sample1', 'sample2'],
    },
    anova: {
      title: '方差分析（ANOVA）', desc: '比较 3 组及以上均值是否有显著差异（如不同供应商/班次/设备）。',
      fields: [{ key: 'groupsText', label: '各组数据（每组一行，逗号分隔）', type: 'textarea', rows: 4, required: true, def: '10.1,10.2,9.9,10.0,10.3\n10.5,10.6,10.4,10.7,10.5\n9.8,9.7,9.9,9.6,9.85', placeholder: '10.1,10.2,9.9\n10.5,10.6,10.4\n9.8,9.7,9.9' }],
      tool: 'stat_hypothesis_test', custom: 'anova',
    },
    regression: {
      title: '回归与相关分析', desc: '量化两个变量之间的关系（如温度—尺寸、转速—噪声）。',
      fields: [{ key: 'x', label: '自变量 X（逗号分隔）', type: 'textarea', rows: 2, required: true, def: '10.1,10.3,9.9,10.2,10.0,10.4,9.8,10.1' }, { key: 'y', label: '因变量 Y（逗号分隔）', type: 'textarea', rows: 2, required: true, def: '2,4,5,4,5,7,3,4' }, { key: 'predictAt', label: '预测点（可选）', type: 'number' }],
      tool: 'stat_regression', parse: ['x', 'y'],
    },
    grr: {
      title: 'GR&R 量具重复性与再现性分析', desc: '每行格式：操作者,零件,第几次,测量值。默认已填入 AIAG 手册标准算例（3 操作者 × 5 零件 × 3 次）。',
      fields: [{ key: 'rows', label: '数据（每行：操作者,零件,试验次数,测量值）', type: 'textarea', rows: 8, required: true, def: AIAG_SAMPLE() }, { key: 'tolerance', label: '公差带宽度（可选）', type: 'number' }],
      tool: 'stat_grr', custom: 'grr',
    },
    doe: {
      title: 'DOE 试验设计', desc: '每行一个因子：名称,低水平,高水平。',
      fields: [
        { key: 'factorsText', label: '因子（每行：名称,低水平,高水平）', type: 'textarea', rows: 4, required: true, def: '定位销材质,HRC52,HRC60\n点检周期,月度,双周\n夜班产量,低,高' },
        { key: 'design', label: '设计类型', type: 'select', options: [{ value: 'full', label: '全因子 2^k' }, { value: 'frac', label: '部分因子 2^(k-1)' }, { value: 'pb', label: 'Plackett-Burman 筛选' }] },
        { key: 'replicates', label: '重复次数', type: 'number', def: 2 },
        { key: 'response', label: '响应变量名', type: 'text', def: '响应值' },
      ],
      tool: 'doe_design', custom: 'doe',
    },
    qualitycost: {
      title: '质量成本（COPQ）计算', desc: '按 PAF 模型计算四项质量成本与质量成本率。留空则用平台默认口径。',
      fields: [{ key: 'prevention', label: '预防成本（万元）', type: 'number' }, { key: 'appraisal', label: '鉴定成本（万元）', type: 'number' }, { key: 'internalFailure', label: '内部失败成本（万元）', type: 'number' }, { key: 'externalFailure', label: '外部失败成本（万元）', type: 'number' }, { key: 'salesRevenue', label: '销售收入（万元）', type: 'number' }],
      tool: 'quality_cost_calc',
    },
    pareto: {
      title: '排列图（帕累托）绘制', desc: '按维度统计真实数据并绘制帕累托图，自动识别 80% 关键少数。',
      fields: [
        { key: 'dataset', label: '数据集', type: 'select', options: [{ value: 'issues', label: '质量问题库' }, { value: 'defects', label: 'AI 质检缺陷' }, { value: 'projects', label: '改进项目' }, { value: 'measurements_oos', label: 'MES 测量超差事件' }] },
        { key: 'dimension', label: '统计维度', type: 'select', options: [{ value: 'workshop', label: '车间' }, { value: 'model', label: '产品' }, { value: 'type', label: '缺陷类型' }, { value: 'source', label: '问题来源' }, { value: 'severity', label: '问题等级' }, { value: 'owner', label: '责任人' }] },
        { key: 'days', label: '时间窗（天，可空）', type: 'number' },
      ],
      tool: 'pareto_analysis',
    },
    stratify: {
      title: '分层法应用', desc: '按不同维度层层细分数据，找出变异来源（分层是找出真因最快的方法）。',
      fields: [
        { key: 'dataset', label: '数据集', type: 'select', options: [{ value: 'issues', label: '质量问题库' }, { value: 'defects', label: 'AI 质检缺陷' }, { value: 'measurements_oos', label: '测量超差事件' }] },
        { key: 'dimension', label: '第一层维度', type: 'select', options: [{ value: 'workshop', label: '车间' }, { value: 'model', label: '产品' }, { value: 'type', label: '缺陷类型' }, { value: 'severity', label: '等级' }] },
        { key: 'dimension2', label: '第二层维度（可选）', type: 'select', options: [{ value: '', label: '不细分' }, { value: 'model', label: '产品' }, { value: 'workshop', label: '车间' }, { value: 'type', label: '缺陷类型' }] },
      ],
      tool: 'pareto_analysis', custom: 'stratify',
    },
    fmea: {
      title: 'FMEA 风险分析', desc: '每行一个失效模式：失效模式,失效影响,失效原因,S,O,D。',
      fields: [{ key: 'process', label: '过程 / 工序名称', type: 'text', def: '充电口盖装配' }, { key: 'rows', label: '失效模式明细', type: 'textarea', rows: 6, required: true, def: '间隙超差,客户抱怨/漏水,工装定位销磨损,7,5,4\n口盖脱落,安全隐患,锁扣失效,10,2,6\n漆面颗粒,外观不良,送风过滤棉失效,5,4,3' }],
      tool: 'fmea_analyze', custom: 'fmea',
    },
    gantt: {
      title: '甘特图规划', desc: '每行一个任务：任务名,工期天,依赖任务名,责任人。默认已按 8D 节奏填好一版，可直接改。',
      fields: [{ key: 'tasksText', label: '任务清单', type: 'textarea', rows: 5, def: 'D3 围堵措施,3,,李雪\nD4 根因验证,5,D3 围堵措施,王磊\nD5 对策制定,7,D4 根因验证,李雪\nD6 对策实施,10,D5 对策制定,王磊\nD7 效果验证,7,D6 对策实施,张涛' }, { key: 'startDate', label: '开始日期', type: 'text', placeholder: 'YYYY-MM-DD' }],
      tool: 'gantt_plan', custom: 'gantt',
    },
    std: {
      title: '标准条款精准检索', desc: '在企业知识库的标准/规范条款中做语义检索，回答随时给出处（默认查 Cpk 判定准则，可改成你要查的内容）。',
      fields: [{ key: 'query', label: '检索内容', type: 'text', required: true, def: 'Cpk 判定准则', placeholder: '例如：Cpk 判定准则 / 不合格品控制 / 防错要求' }],
      custom: 'std',
    },
  };

  function AIAG_SAMPLE() {
    const parts = [0.65, 1.00, 0.85, 0.85, 0.55, 0.85, 0.75, 0.65, 0.75, 0.75];
    const ops = {
      A: [[0.29, 0.41, 0.64], [0.56, 0.56, 0.62], [0.33, 0.33, 0.34], [0.40, 0.41, 0.42], [0.36, 0.36, 0.38], [0.33, 0.35, 0.34], [0.38, 0.36, 0.37], [0.32, 0.30, 0.33], [0.33, 0.36, 0.34], [0.35, 0.34, 0.36]],
      B: [[0.08, 0.09, 0.10], [0.47, 0.49, 0.48], [0.09, 0.08, 0.10], [0.09, 0.09, 0.09], [0.07, 0.08, 0.08], [0.08, 0.09, 0.08], [0.07, 0.07, 0.08], [0.08, 0.08, 0.09], [0.09, 0.09, 0.08], [0.07, 0.07, 0.07]],
      C: [[0.04, 0.04, 0.04], [0.50, 0.51, 0.50], [0.04, 0.05, 0.04], [0.05, 0.05, 0.05], [0.05, 0.04, 0.05], [0.05, 0.05, 0.05], [0.04, 0.04, 0.05], [0.05, 0.05, 0.05], [0.05, 0.06, 0.05], [0.05, 0.05, 0.05]],
    };
    const lines = [];
    Object.keys(ops).forEach((op) => ops[op].forEach((trials, pi) => trials.forEach((v, ti) => lines.push(op + ',' + (pi + 1) + ',' + (ti + 1) + ',' + v))));
    return lines.join('\n');
  }

  /** 结果区底部的两个动作按钮 */
  function resultTail(tool, args) {
    return `<div style="margin-top:12px;display:flex;gap:8px;">${act('让 AI 解读这个结果', 'wzInterpret', { tool: tool, args: JSON.stringify(args).slice(0, 1500) }, 'btn btn-ai')}${act('⬇ 下载结果 CSV', 'wzExport', {}, 'btn')}</div>`;
  }

  /* ---------------- 结果导出 ---------------- */
  let lastResult = null;
  let lastName = 'tool';

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function flattenRows(obj) {
    const rows = [];
    const walk = (o, prefix) => {
      if (o === null || o === undefined) return;
      if (Array.isArray(o)) {
        if (!o.length) { rows.push([prefix, '（空）']); return; }
        if (typeof o[0] !== 'object') { o.forEach((v) => rows.push([prefix, v])); return; }
        const keys = [];
        o.slice(0, 500).forEach((it) => Object.keys(it || {}).forEach((k) => { if (keys.indexOf(k) < 0) keys.push(k); }));
        rows.push([prefix + ' · 字段', keys.join(' | ')]);
        o.slice(0, 500).forEach((it) => rows.push([prefix + ' · 记录', keys.map((k) => it[k]).map(csvCell).join(' | ')]));
        return;
      }
      if (typeof o !== 'object') { rows.push([prefix, o]); return; }
      Object.keys(o).forEach((k) => {
        const v = o[k];
        const key = prefix ? prefix + '.' + k : k;
        if (v && typeof v === 'object') walk(v, key);
        else rows.push([key, v]);
      });
    };
    walk(obj, '');
    return rows;
  }

  function exportLast() {
    if (!lastResult) return toast('先点「▶ 计算」跑一次，再导出', 'warn');
    const rows = flattenRows(lastResult);
    const csv = '\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '质量工具_' + lastName + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast('已下载 ' + rows.length + ' 行结果', 'ok');
  }

  /** 散点图 + 拟合线（不依赖图表库，直接给 SVG） */
  function scatterChart(xs, ys, slope, intercept) {
    const n = Math.min(xs.length, ys.length);
    if (n < 2) return empty('暂无散点数据');
    const W = 620, H = 250, pad = { l: 52, r: 18, t: 18, b: 40 };
    const xs2 = xs.slice(0, n), ys2 = ys.slice(0, n);
    let xmin = Math.min.apply(null, xs2), xmax = Math.max.apply(null, xs2);
    let ymin = Math.min.apply(null, ys2), ymax = Math.max.apply(null, ys2);
    if (xmin === xmax) { xmin -= 1; xmax += 1; }
    if (ymin === ymax) { ymin -= 1; ymax += 1; }
    const xp = (v) => pad.l + (W - pad.l - pad.r) * ((v - xmin) / (xmax - xmin));
    const yp = (v) => H - pad.b - (H - pad.t - pad.b) * ((v - ymin) / (ymax - ymin));
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (H - pad.t - pad.b) * i / 4;
      g += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}" stroke="#eef1f6"/><text x="${pad.l - 6}" y="${(y + 3.5).toFixed(1)}" font-size="9" fill="#8791a5" text-anchor="end">${(ymax - (ymax - ymin) * i / 4).toFixed(2)}</text>`;
      const x = pad.l + (W - pad.l - pad.r) * i / 4;
      g += `<text x="${x.toFixed(1)}" y="${H - pad.b + 14}" font-size="9" fill="#8791a5" text-anchor="middle">${(xmin + (xmax - xmin) * i / 4).toFixed(2)}</text>`;
    }
    if (typeof slope === 'number' && typeof intercept === 'number') {
      g += `<line x1="${xp(xmin).toFixed(1)}" y1="${yp(intercept + slope * xmin).toFixed(1)}" x2="${xp(xmax).toFixed(1)}" y2="${yp(intercept + slope * xmax).toFixed(1)}" stroke="#e5484d" stroke-width="1.6" stroke-dasharray="5 4"/>`;
    }
    xs2.forEach((xv, i) => { g += `<circle cx="${xp(xv).toFixed(1)}" cy="${yp(ys2[i]).toFixed(1)}" r="3.4" fill="#1a56db" fill-opacity="0.72"/>`; });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="display:block;">${g}</svg>`;
  }

  /** 本地等宽分箱（粘贴数据时用） */
  function binsOf(values, k) {
    const bins = Math.max(2, Math.min(30, k || 12));
    const lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    const w = (hi - lo) / bins || 1;
    const out = [];
    for (let i = 0; i < bins; i++) out.push({ from: Number((lo + i * w).toFixed(4)), to: Number((lo + (i + 1) * w).toFixed(4)), count: 0 });
    values.forEach((v) => { let i = Math.floor((v - lo) / w); if (!isFinite(i) || i >= bins) i = bins - 1; if (i < 0) i = 0; out[i].count++; });
    return out;
  }

  /* ---------------- 结果渲染 ---------------- */
  function renderResult(name, res) {
    if (!res || res.ok === false) return `<div style="color:#e5484d;font-size:12.5px;">❌ ${esc((res && res.error) || '执行失败')}</div>`;
    let html = '';
    // 控制图
    if (name === 'stat_control_chart_calc' || name === 'spc_control_chart') {
      html += controlChart({ points: res.点位 || res.全部点值 || res.控制图点位 || [], ucl: res.控制限 && res.控制限.UCL, cl: res.控制限 && res.控制限.CL, lcl: res.控制限 && res.控制限.LCL });
    }
    if (name === 'stat_describe' && res.__hist) {
      html += histogramChart(res.__hist.分箱, res.__hist.lsl, res.__hist.usl);
    }
    if (res.帕累托表) {
      html += paretoChart(res.帕累托表.map((r) => ({ name: r.项目, value: r.数量, cumPct: parseFloat(r.累计占比) })));
    }
    // 通用渲染
    html += '<div style="margin-top:10px;">' + generic(res, 0) + '</div>';
    return html;
  }

  function generic(obj, depth) {
    if (obj === null || obj === undefined) return '—';
    if (typeof obj !== 'object') return esc(String(obj));
    if (Array.isArray(obj)) {
      if (!obj.length) return '<span style="color:#8791a5;">（空）</span>';
      if (typeof obj[0] !== 'object') return '<div style="font-size:12px;line-height:1.9;">' + obj.slice(0, 200).map((x) => esc(String(x))).join('、') + (obj.length > 200 ? ' …（共 ' + obj.length + ' 项）' : '') + '</div>';
      const keys = [];
      obj.slice(0, 12).forEach((o) => Object.keys(o).forEach((k) => { if (keys.indexOf(k) < 0 && keys.length < 12) keys.push(k); }));
      return '<div class="tbl-wrap">' + table(keys, obj.slice(0, 60).map((o) => keys.map((k) => genericCell(o[k])))) + (obj.length > 60 ? '<div style="font-size:11px;color:#8791a5;margin-top:4px;">显示前 60 条，共 ' + obj.length + ' 条</div>' : '') + '</div>';
    }
    const entries = Object.entries(obj).filter(([k]) => k !== 'ok' && k !== '__hist');
    const simple = entries.filter(([, v]) => v === null || typeof v !== 'object');
    const complex = entries.filter(([, v]) => v !== null && typeof v === 'object');
    let h = '';
    if (simple.length) {
      h += '<div class="info-grid" style="margin-bottom:10px;">' + simple.map(([k, v]) => {
        let txt;
        if (typeof v === 'boolean') txt = v ? '是' : '否';
        else if (typeof v === 'number') txt = Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4)));
        else txt = esc(String(v));
        if (/ppm|率|占比|%/.test(k) && typeof v === 'number' && /占比|率$/.test(k)) txt = esc(String(v)) + (/%$/.test(String(v)) ? '' : '');
        return `<div class="info-item"><div class="lbl">${esc(k)}</div><div class="val">${txt}</div></div>`;
      }).join('') + '</div>';
    }
    complex.forEach(([k, v]) => {
      h += '<div style="margin-top:12px;"><div style="font-size:12.5px;font-weight:700;color:#16233c;margin-bottom:6px;">' + esc(k) + '</div>' + generic(v, depth + 1) + '</div>';
    });
    return h;
  }
  function genericCell(v) {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') return '<span style="font-size:11px;color:#5e6b85;">' + esc(JSON.stringify(v).slice(0, 90)) + '</span>';
    if (typeof v === 'boolean') return v ? '✓' : '✗';
    return esc(String(v));
  }

  /* ---------------- 打开向导 ---------------- */
  async function openWizard(key) {
    const w = W[key];
    if (!w) return toast('该工具暂未配置向导', 'warn');
    let charOptions = [];
    if (w.fields.some((f) => f.type === 'char')) {
      try { const r = await API.get('/qip/api/spc/chars'); charOptions = r.chars || []; } catch (e) {}
    }
    const body = `<div style="font-size:12px;color:#5e6b85;line-height:1.8;margin-bottom:12px;">${esc(w.desc || '')}</div>` +
      w.fields.map((f) => {
        let ctrl;
        if (f.type === 'char') ctrl = `<select class="inp" data-field="${esc(f.key)}"><option value="">（不使用平台特性 / 用下面的数据）</option>${charOptions.map((c, i) => `<option value="${esc(c.编号)}"${i === 0 && !f.def ? ' selected' : ''}>${esc(c.编号)} ${esc(c.名称)}（${esc(c.车间)} · 规格 ${esc(c.规格)}）</option>`).join('')}</select>`;
        else if (f.type === 'select') ctrl = `<select class="inp" data-field="${esc(f.key)}">${(f.options || []).map((o) => { const v = o.value !== undefined ? o.value : o; return `<option value="${esc(v)}"${f.def === v ? ' selected' : ''}>${esc(o.label || o)}</option>`; }).join('')}</select>`;
        else if (f.type === 'textarea') ctrl = `<textarea class="inp" rows="${f.rows || 3}" data-field="${esc(f.key)}" placeholder="${esc(f.placeholder || '')}">${esc(f.def || '')}</textarea>`;
        else ctrl = `<input class="inp" type="${f.type === 'number' ? 'number' : 'text'}" data-field="${esc(f.key)}" value="${f.def === undefined ? '' : esc(f.def)}" placeholder="${esc(f.placeholder || '')}"/>`;
        return `<div class="form-row"><div class="fl">${esc(f.label)}${f.required ? ' <span style="color:#e5484d;">*</span>' : ''}</div><div class="fc">${ctrl}</div></div>`;
      }).join('');
    modal({
      width: 'wide', title: '🧰 ' + w.title, sub: brand() + ' · 质量工具',
      body: `<div id="wzForm">${body}</div><div id="wzResult" style="margin-top:16px;"></div>`,
      footer: `${act('关闭', '__closeModal', {}, 'btn')}${act('使用 AI 智能体完成', 'wzAi', { key }, 'btn')}${act('▶ 计算', 'wzRun', { key }, 'btn btn-primary')}`,
    });
  }

  async function runWizard(key) {
    const w = W[key]; if (!w) return;
    const scope = document.getElementById('wzForm');
    const out = document.getElementById('wzResult');
    const vals = UI.readForm(scope);
    out.innerHTML = '<div class="empty"><span class="spin"></span>　正在计算…</div>';
    let args = {};
    try {
      // 通用字段 → 工具参数
      if (w.tool === 'stat_capability_calc') {
        if (vals.values) args.values = parseNums(vals.values);
        else if (vals.charId) args.charId = vals.charId;
        if (vals.usl !== null && vals.usl !== '') args.usl = Number(vals.usl);
        if (vals.lsl !== null && vals.lsl !== '') args.lsl = Number(vals.lsl);
      } else if (w.tool === 'pareto_analysis') {
        args = { dataset: vals.dataset, dimension: vals.dimension, days: vals.days || undefined };
      } else if (w.tool === 'fmea_analyze') {
        args = { process: vals.process, items: (vals.rows || '').split('\n').map((l) => l.split(/[,，]/)).filter((a) => a.length >= 6).map((a) => ({ failureMode: a[0].trim(), effect: a[1].trim(), cause: a[2].trim(), s: Number(a[3]), o: Number(a[4]), d: Number(a[5]) })) };
        if (!args.items.length) throw new Error('请至少填写一行失效模式（失效模式,失效影响,失效原因,S,O,D）');
      } else if (w.tool === 'gantt_plan') {
        const tasks = (vals.tasksText || '').split('\n').map((l) => l.split(/[,，]/)).filter((a) => a[0] && a[0].trim()).map((a) => ({ name: a[0].trim(), duration: Number(a[1]) || 1, deps: a[2] && a[2].trim() ? [a[2].trim()] : [], owner: a[3] && a[3].trim() || '' }));
        args = { tasks, startDate: vals.startDate || undefined };
      } else if (w.tool === 'quality_cost_calc') {
        ['prevention', 'appraisal', 'internalFailure', 'externalFailure', 'salesRevenue'].forEach((k) => { if (vals[k] !== null && vals[k] !== '' && vals[k] !== undefined) args[k] = Number(vals[k]); });
      } else if (w.tool === 'stat_hypothesis_test') {
        args = { test: vals.test, alpha: vals.alpha || 0.05 };
        if (vals.mu0 !== null && vals.mu0 !== '') args.mu0 = Number(vals.mu0);
        if (vals.sample1) args.sample1 = parseNums(vals.sample1);
        if (vals.sample2) args.sample2 = parseNums(vals.sample2);
        if (w.custom === 'anova') {
          const groups = (vals.groupsText || '').split('\n').map((l) => parseNums(l)).filter((g) => g.length);
          if (groups.length < 2) throw new Error('请至少填写两组数据（每组一行）');
          args = { test: 'anova', groups };
        }
        if (args.test !== 'anova' && (!args.sample1 || !args.sample1.length)) throw new Error('请填写样本数据');
      } else if (w.tool === 'stat_regression') {
        args = { x: parseNums(vals.x), y: parseNums(vals.y), type: 'linear' };
        if (args.x.length !== args.y.length) throw new Error('X 与 Y 的数据个数必须相同（当前 X=' + args.x.length + '，Y=' + args.y.length + '）');
        if (args.x.length < 3) throw new Error('回归分析至少需要 3 组数据（当前 ' + args.x.length + ' 组）');
        if (vals.predictAt !== null && vals.predictAt !== '' && vals.predictAt !== undefined) args.predictAt = Number(vals.predictAt);
      } else if (w.tool === 'stat_grr') {
        const rows = (vals.rows || '').split('\n').map((l) => l.split(/[,，]/)).filter((a) => a.length >= 4);
        if (!rows.length) throw new Error('请填写 GR&R 数据');
        const ops = [], parts = [];
        rows.forEach((a) => { const o = a[0].trim(), p = a[1].trim(); if (ops.indexOf(o) < 0) ops.push(o); if (parts.indexOf(p) < 0) parts.push(p); });
        const data = ops.map(() => parts.map(() => []));
        rows.forEach((a) => { const oi = ops.indexOf(a[0].trim()), pi = parts.indexOf(a[1].trim()); data[oi][pi].push(Number(a[3])); });
        args = { data, method: 'range' };
        if (vals.tolerance !== null && vals.tolerance !== '' && vals.tolerance !== undefined) args.tolerance = Number(vals.tolerance);
      } else if (w.tool === 'doe_design') {
        const factors = (vals.factorsText || '').split('\n').map((l) => l.split(/[,，]/)).filter((a) => a[0] && a[0].trim()).map((a) => ({ name: a[0].trim(), low: a[1] ? a[1].trim() : '-1', high: a[2] ? a[2].trim() : '+1' }));
        if (factors.length < 2) throw new Error('请至少填写 2 个因子');
        args = { factors, design: vals.design, replicates: vals.replicates || 2, response: vals.response || '响应值' };
      } else if (w.tool === 'stat_control_chart_calc') {
        if (vals.values) args.values = parseNums(vals.values);
        else if (vals.charId) args.charId = vals.charId;
        args.chartType = vals.chartType || 'I-MR';
        if (!args.values && !args.charId) throw new Error('请选择平台特性或粘贴数据');
      } else if (w.tool === 'stat_describe') {
        if (vals.values) args = { values: parseNums(vals.values) };
        else if (vals.charId) args = { charId: vals.charId, days: 30 };
        else throw new Error('请选择平台特性或粘贴数据');
      } else if (w.tool === 'spc_histogram') {
        if (vals.charId) args = { charId: vals.charId, days: 30, bins: Number(vals.bins) || 12 };
        else if (vals.values) args = { values: parseNums(vals.values) };
        else throw new Error('请选择平台特性或粘贴数据');
      }
    } catch (e) {
      out.innerHTML = `<div style="color:#e5484d;font-size:12.5px;">❌ ${esc(e.message)}</div>`;
      return;
    }

    try {
      if (w.custom === 'hist') {
        // 直方图：选平台特性走 spc_histogram（真实历史数据）；粘贴数据在本地等宽分箱
        if (args.charId) {
          const r = await API.tool('spc_histogram', { charId: args.charId, days: 30, bins: Number(vals.bins) || 12 });
          const res = (r && r.result) || {};
          if (res.ok === false) { out.innerHTML = `<div style="color:#e5484d;font-size:12.5px;">❌ ${esc(res.error || '计算失败')}</div>`; return; }
          const spec = res.规格限 || {};
          lastResult = res; lastName = 'spc_histogram_' + args.charId;
          out.innerHTML = histogramChart(res.分箱 || [], spec.LSL, spec.USL) +
            '<div style="margin-top:10px;">' + generic(res, 0) + '</div>' + resultTail('spc_histogram', { charId: args.charId, bins: Number(vals.bins) || 12 });
          return;
        }
        const values = parseNums(vals.values);
        if (values.length < 5) throw new Error('请粘贴至少 5 个数据（或直接选一个平台特性）');
        const bins = binsOf(values, Number(vals.bins) || 12);
        const stat = await API.tool('stat_describe', { values });
        lastResult = { 分箱: bins, 统计量: (stat && stat.result) || null }; lastName = 'stat_describe';
        out.innerHTML = histogramChart(bins) +
          '<div style="margin-top:10px;">' + generic((stat && stat.result) || {}, 0) + '</div>' + resultTail('stat_describe', { values: values.length });
        return;
      }
      if (w.custom === 'scatter') {
        const r = await API.tool('stat_regression', args);
        const res = (r && r.result) || {};
        if (res.ok === false) { out.innerHTML = `<div style="color:#e5484d;font-size:12.5px;">❌ ${esc(res.error || '计算失败')}</div>`; return; }
        lastResult = res; lastName = 'stat_regression';
        out.innerHTML = scatterChart(args.x, args.y, res.斜率, res.截距) +
          '<div style="margin-top:10px;">' + generic(res, 0) + '</div>' + resultTail('stat_regression', args);
        return;
      }
      if (w.custom === 'std') {
        const r = await API.tool('kb_search', { query: vals.query, topK: 8, type: '标准' });
        const res = r.result || {};
        lastResult = res; lastName = 'kb_search';
        out.innerHTML = (res.结果 || []).length ? (res.结果 || []).map((x) => `<div class="list-row" style="display:block;">
          <div style="display:flex;gap:8px;align-items:center;"><b>${esc(x.标题)}</b>${tag(x.类型, 'orange')}<span style="margin-left:auto;font-size:11px;color:#1a56db;">相关度 ${x.相关度}</span></div>
          <div style="font-size:12px;color:#33415c;margin-top:6px;line-height:1.85;">${esc(x.对策 || '')}</div>
          <div style="font-size:11px;color:#8791a5;margin-top:5px;">出处：${esc(x.出处 || '')}　编号：${esc(x.编号)}</div></div>`).join('') : empty('未检索到相关标准条款，换个关键词试试', '🔍');
        return;
      }
      const r = await API.tool(w.tool, args);
      lastResult = r.result; lastName = w.tool;
      out.innerHTML = renderResult(w.tool, r.result) + resultTail(w.tool, args);
    } catch (e) {
      out.innerHTML = `<div style="color:#e5484d;font-size:12.5px;">❌ ${esc(e.message)}</div>`;
    }
  }

  function parseNums(s) {
    return String(s || '').split(/[\s,，;；\n\t]+/).map((x) => Number(x)).filter((x) => Number.isFinite(x));
  }

  // 每个 skill 一个独立图标（按名称关键字匹配，避免全部用同一个机器人脸）
  // 顺序即优先级：长词/专有词写在前面，避免「因果图根因分析」被「根因」先匹配
  const ICON_RULES = [
    [/8D/, '🎯'], [/FMEA|失效模式/, '⚠️'], [/标准条款|条款检索/, '📖'], [/海龟/, '🐢'], [/质量成本/, '💰'],
    [/甘特/, '📅'], [/过程能力|Cpk|Ppk/, '📐'], [/人机料法环|4M/, '🧩'], [/变化点/, '🔄'], [/5W2H/, '🧾'],
    [/因果图|鱼骨/, '🐟'], [/5Why|根因/, '❓'], [/假设检验/, '⚖️'], [/方差/, '📊'], [/回归/, '📈'],
    [/检查表/, '✅'], [/分层/, '🗂️'], [/排列图|帕累托/, '📶'], [/直方图/, '🔔'], [/控制图|SPC/, '📉'],
    [/散点/, '✳️'], [/关联图/, '🕸️'], [/系统图/, '🌳'], [/矩阵数据分析/, '🧮'], [/矩阵图/, '▦'],
    [/PDPC/, '🚦'], [/箭条/, '🏹'], [/KJ/, '🗃️'], [/DMAIC|六西格玛/, '🌀'], [/GR&R|GRR/, '📏'],
    [/MSA|偏倚|线性|稳定性/, '🎚️'], [/GD&T|几何尺寸|形位公差/, '🔧'], [/QFD|质量功能展开|质量屋/, '🏠'], [/DOE|试验设计/, '🧬'],
  ];
  function iconFor(name) {
    const n = String(name || '');
    for (const [re, ico] of ICON_RULES) if (re.test(n)) return ico;
    return '🧰';
  }

  // 两套版式提供同一套工具（34 项），不做删减、也不打角标
  function menuItems() {
    return [].concat(QTools.col1 || [], QTools.col2 || [], QTools.col3 || []);
  }

  function renderMenu() {
    const el = document.getElementById('qtGrid');
    if (!el) return;
    const items = menuItems();
    el.innerHTML = items.map((t) => `<div class="qt-item" data-act="qtPick" data-args='${esc(JSON.stringify(t))}' title="${esc(t.name)}"><span class="qt-ico">${iconFor(t.name)}</span><span class="qt-nm">${esc(t.name)}</span>${t.w ? '<span class="qt-sum">∑</span>' : ''}</div>`).join('')
      + (items.length ? '' : '<div class="empty">当前版式无可用工具</div>');
  }

  global.QTools = QTools;
  global.QWizard = { open: openWizard, run: runWizard, render: renderResult, menu: renderMenu, defs: W, exportLast: exportLast };
})(window);


