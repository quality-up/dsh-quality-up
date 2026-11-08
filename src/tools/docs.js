'use strict';
/**
 * 文档与报表工具：让智能体产出"可交付物"
 * ------------------------------------------------------------------
 * · report_generate  生成真实的 .docx 报告（周报/月报/专项/根因分析/8D）
 * · data_export      把平台真实数据导出为真正的 .xlsx / .csv
 * · report_list      报表中心清单
 * 用到的 OOXML 能力来自 lib/office.js（零依赖自研）。
 */
const fs = require('fs');
const path = require('path');
const { define } = require('./registry');
const store = require('../lib/store');
const stats = require('../lib/stats');
const { seriesOf, dataNow, sinceISO } = require('./data');
const { STAGES } = require('./business');

let office = null;
function getOffice() {
  if (!office) office = require('../lib/office');
  return office;
}

/** 输出目录（服务器注入） */
function outDir(ctx) {
  const dir = (ctx && ctx.outputDir) || path.join(process.cwd(), 'data', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function localStamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function safeName(s) { return String(s).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80); }

/* ------------------------------------------------------------------ */
define({
  plugin: '@DOC', name: 'report_generate', label: '生成质量报告（Word）',
  description: '生成真实可下载的 Word 报告（.docx）。支持：质量周报、质量月报、专项分析报告、根因分析报告、8D 报告、SPC 分析报告。报告内含真实数据表格与统计结论。生成后返回下载链接。',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['质量周报', '质量月报', '专项分析报告', '根因分析报告', '8D报告', 'SPC分析报告'], description: '报告类型' },
      title: { type: 'string', description: '报告标题（可自动生成）' },
      scope: { type: 'string', description: '范围：产品/车间/项目编号/特性编号' },
      period: { type: 'string', description: '期间，如 2026-09 或 第 40 周' },
      sections: { type: 'array', items: { type: 'object' }, description: '自定义章节 [{heading, paragraphs:[], bullets:[], table:{header,rows}}]' },
      includeCharts: { type: 'boolean', description: '是否包含表格化图表数据（默认 true）' },
      projectId: { type: 'string', description: '8D/根因分析报告可指定项目' },
      author: { type: 'string' },
    },
    required: ['type'],
  },
  run(args, ctx) {
    const blocks = [];
    const period = args.period || new Date().toISOString().slice(0, 7);
    const now = localStamp(new Date());
    const title = args.title || (args.scope ? args.scope + ' ' : '') + args.type + '（' + period + '）';
    blocks.push({ type: 'title', text: title });
    blocks.push({ type: 'subtitle', text: '某制造型企业 · 质量改进部门　|　编制日期：' + now + '　|　编制人：' + (args.author || 'AI 质量改进智能体（人工复核后发布）') });
    blocks.push({ type: 'hr' });

    const ov = dashboardSnapshot(args.scope);
    blocks.push({ type: 'h1', text: '一、总体情况' });
    blocks.push({ type: 'p', text: '本期（' + period + '）平台共归集质量数据 ' + ov.measurements + ' 个在线测量点，命中 SPC 判异 ' + ov.violations + ' 条，超差点 ' + ov.oos + ' 个；质量问题 ' + ov.issueTotal + ' 起（未关闭 ' + ov.issueOpen + ' 起，其中 A 级 ' + ov.issueA + ' 起）；在改改进项目 ' + ov.projOpen + ' 个，按期率 ' + ov.onTimeRate + '，超期 ' + ov.projOverdue + ' 个。' });
    blocks.push({ type: 'kv', items: [
      ['一次下线合格率（FTT 代理值）', ov.ftt],
      ['SPC 判异总数', String(ov.violations)],
      ['在线测量超差点', String(ov.oos)],
      ['未关闭质量问题', ov.issueOpen + ' 起（A 级 ' + ov.issueA + ' 起）'],
      ['在改改进项目', ov.projOpen + ' 个'],
      ['项目按期关闭率', ov.onTimeRate],
      ['已核定改进收益', ov.benefitVerified + ' 万元'],
      ['数据截至', ov.dataAt],
    ] });

    // 特性状态表
    blocks.push({ type: 'h1', text: '二、过程能力与判异情况' });
    blocks.push({ type: 'table', header: ['特性编号', '特性名称', '车间', 'USL/LSL', '均值', 'Cpk', '超差数', '判异数', '状态'],
      rows: ov.charRows.map((c) => [c.id, c.name, c.workshop, c.usl + ' / ' + c.lsl, c.mean, c.cpk, c.oos, c.hits, c.status]),
      widths: [1200, 2200, 900, 1400, 900, 700, 700, 700, 900] });
    if (ov.violations > 0) {
      blocks.push({ type: 'p', text: '本期判异明细（最严重的 5 项）：' });
      blocks.push({ type: 'table', header: ['特性', '命中准则', '严重度', '涉及点数', '控制限'],
        rows: ov.violationRows.slice(0, 5).map((v) => [v.char, v.rules, v.severity, String(v.count), v.limits]) });
      blocks.push({ type: 'quote', text: 'SPC 判异结论由平台判异引擎按 GB/T 4091 八大准则自动计算得出，非人工目测判断。' });
    }

    // 问题与项目
    blocks.push({ type: 'h1', text: '三、重点问题与改进项目' });
    if (ov.topIssues.length) {
      blocks.push({ type: 'table', header: ['编号', '产品', '车间', '问题描述', '等级', '状态', '责任人', '关联项目'],
        rows: ov.topIssues.map((i) => [i.id, i.model, i.workshop, i.title, i.severity, i.status, i.owner, i.projectId || '—']) });
    }
    if (ov.projects.length) {
      blocks.push({ type: 'p', text: '' });
      blocks.push({ type: 'table', header: ['项目编号', '项目名称', '当前阶段', '责任人', '进度', '截止', '是否超期'],
        rows: ov.projects.map((p) => [p.id, p.title, p.stage, p.owner, p.progress + '%', (p.dueAt || '').slice(0, 10), p.overdue ? '超期 ' + p.overdueDays + ' 天' : '正常']) });
    }

    // 收益
    blocks.push({ type: 'h1', text: '四、改进收益' });
    const ledger = store.col('benefits').all();
    const vt = ledger.filter((b) => b.status === 'verified').reduce((a, c) => a + c.amount, 0);
    const pd = ledger.filter((b) => b.status === 'pending').reduce((a, c) => a + c.amount, 0);
    blocks.push({ type: 'p', text: '已财务核定收益 ' + vt.toFixed(1) + ' 万元，待核定 ' + pd.toFixed(1) + ' 万元。收益口径：仅计直接损失（报废料、返工工时、停线损失、索赔），单价采用 ERP 当期标准价，摊销期不超过 12 个月。' });
    if (ledger.length) {
      blocks.push({ type: 'table', header: ['单号', '项目', '类型', '金额（万元）', '期间', '状态'],
        rows: ledger.slice(0, 15).map((b) => [b.id, b.projectId || '—', b.type, String(b.amount), b.period, b.status === 'verified' ? '财务已核定' : '待核定']) });
    }

    // 自定义章节
    (args.sections || []).forEach((s, i) => {
      blocks.push({ type: 'h1', text: String.fromCharCode(20116 + i) + '、' + s.heading });
      (s.paragraphs || []).forEach((p) => blocks.push({ type: 'p', text: p }));
      (s.bullets || []).forEach((b) => blocks.push({ type: 'bullet', text: b }));
      if (s.table) blocks.push({ type: 'table', header: s.table.header, rows: s.table.rows });
    });

    // 结论与建议
    blocks.push({ type: 'h1', text: '五、结论与下一步建议' });
    const conclusion = [];
    if (ov.violations > 0) conclusion.push('①本期存在 ' + ov.violations + ' 条 SPC 判异信号，需在 24h 内锁定失控起点并做 4M 变化点比对（换批、换人、换模、换参数）。');
    if (ov.projOverdue > 0) conclusion.push('②' + ov.projOverdue + ' 个改进项目超期，建议升级厂级 QRQC 并抄送科长，明确资源与卡点。');
    if (ov.issueA > 0) conclusion.push('③存在 ' + ov.issueA + ' 起未关闭 A 级问题，须按 2h 响应、24h 围堵的要求推进，必要时启动专题攻关。');
    if (ov.topIssues.length) conclusion.push('④' + ov.topIssues[0].workshop + '「' + ov.topIssues[0].title + '」为当前占比最高问题，建议作为下阶段专项改进方向。');
    conclusion.push('⑤持续把关闭项目的经验按「问题-原因-对策-效果」四元组沉淀入知识库，形成防再发闭环。');
    conclusion.forEach((c) => blocks.push({ type: 'numbered', text: c }));
    blocks.push({ type: 'hr' });
    blocks.push({ type: 'subtitle', text: '本报告由「' + brandName() + '」自动生成；所有数据来自平台插件（@MES/@SPC/@AQI/@OA/@FIN）实时查询，结论均挂接数据出处。对外发布前需经人工确认。' });

    const buf = getOffice().docxWrite(blocks);
    const dir = outDir(ctx);
    const fname = safeName(title) + '_' + Date.now() + '.docx';
    const fp = path.join(dir, fname);
    fs.writeFileSync(fp, buf);
    const rec = store.col('reports').insert({
      type: args.type, title, period, scope: args.scope || '', author: args.author || '智能体',
      format: 'docx', file: path.basename(fp), size: buf.length, sections: (args.sections || []).map((s) => s.heading),
      downloadUrl: '/qip/api/reports/download/' + encodeURIComponent(path.basename(fp)), status: 'draft',
      createdAt: new Date().toISOString(),
    });
    store.audit({ plugin: '@DOC', action: '生成报告', params: { type: args.type, title }, resultSummary: rec.id + ' ' + path.basename(fp), purpose: '报表生成' });
    return {
      ok: true, 报告编号: rec.id, 报告标题: title, 格式: 'Word (.docx)', 文件大小: Math.round(buf.length / 1024) + ' KB',
      下载链接: rec.downloadUrl, 已保存至: '报表中心',
      章节: blocks.filter((b) => b.type === 'h1').map((b) => b.text),
      内容摘要: '含总体情况 KPI、' + ov.charRows.length + ' 个特性的过程能力表、' + ov.topIssues.length + ' 起重点问题、' + ov.projects.length + ' 个改进项目、收益台账与结论建议。',
      提醒: '报告为草稿状态，对外发布前需人工确认（报告中心 → 确认发布）。',
    };
  },
});

/** 汇总驾驶舱快照（供报告与晨报复用） */
function dashboardSnapshot(scope) {
  const chars = store.col('spcChars').all().filter((c) => !scope || (c.workshop + c.model + c.id + c.name).indexOf(scope) >= 0 || scope.indexOf(c.id) >= 0);
  const charRows = [];
  let measurements = 0, oos = 0, violations = 0;
  const violationRows = [];
  for (const ch of chars) {
    const rows = seriesOf(ch.id, 30);
    const v = rows.map((r) => r.value);
    const o = rows.filter((r) => r.value > ch.usl || r.value < ch.lsl).length;
    measurements += v.length; oos += o;
    let cpk = '—', mean = '—', hits = [];
    try {
      if (v.length > 4) { const c = stats.capability(v, ch.usl, ch.lsl); cpk = c.cpk.toFixed(2); mean = c.mean.toFixed(4); }
      if (v.length > 8) { const imr = stats.chartIMR(v); hits = stats.spcRules(v, { center: imr.center, ucl: imr.ucl, lcl: imr.lcl, sigma: imr.sigmaWithin }); }
    } catch (_) {}
    violations += hits.length;
    if (hits.length) violationRows.push({ char: ch.id + ' ' + ch.name, rules: hits.map((h) => '准则' + h.rule).join('/'), severity: hits.some((h) => h.severity === 'high') ? '高' : '中', count: hits.reduce((a, c) => a + c.indexes.length, 0), limits: ch.lsl + '~' + ch.usl + ch.unit });
    charRows.push({ id: ch.id, name: ch.name, workshop: ch.workshop, usl: ch.usl, lsl: ch.lsl, mean, cpk, oos: o, hits: hits.length, status: hits.length ? '失控' : cpk === '—' ? '数据不足' : Number(cpk) >= 1.33 ? '受控' : '需关注' });
  }
  const issues = store.col('issues').all();
  const projects = store.col('projects').all().filter((p) => !scope || (p.workshop + p.model + p.id + p.title).indexOf(scope) >= 0);
  const open = projects.filter((p) => p.stage !== 'D8');
  const ledger = store.col('benefits').all();
  return {
    measurements, oos, violations, violationRows, charRows,
    ftt: measurements > 0 ? (((measurements - oos) / measurements) * 100).toFixed(2) + '%' : '暂无测量数据',
    issueTotal: issues.length, issueOpen: issues.filter((i) => i.status !== '已关闭').length,
    issueA: issues.filter((i) => i.severity === 'A' && i.status !== '已关闭').length,
    topIssues: issues.slice().sort((a, b) => (b.aiSimilarity || 0) - (a.aiSimilarity || 0)).slice(0, 8),
    projOpen: open.length, projOverdue: open.filter((p) => p.overdue).length,
    onTimeRate: open.length ? ((open.filter((p) => !p.overdue).length / open.length) * 100).toFixed(1) + '%' : '—',
    projects: open.slice(0, 12),
    benefitVerified: Number(ledger.filter((b) => b.status === 'verified').reduce((a, c) => a + c.amount, 0).toFixed(1)),
    dataAt: localStamp(dataNow()),
  };
}

/* ------------------------------------------------------------------ */
define({
  plugin: '@DOC', name: 'data_export', label: '导出真实数据（Excel/CSV）',
  description: '把平台真实数据导出为真正的 Excel（.xlsx，多工作表）或 CSV 文件，返回下载链接。支持导出：问题库、改进项目、SPC 测量数据、判异结果、知识库、收益台账、AI 质检缺陷、全部。',
  parameters: {
    type: 'object',
    properties: {
      dataset: { type: 'string', enum: ['issues', 'projects', 'measurements', 'spc', 'knowledge', 'benefits', 'defects', 'all'], description: '数据集' },
      format: { type: 'string', enum: ['xlsx', 'csv'], description: '默认 xlsx' },
      charId: { type: 'string', description: '导出测量数据时可指定特性' },
      days: { type: 'number', description: '时间窗天数' },
      filename: { type: 'string' },
    },
    required: ['dataset'],
  },
  run(args, ctx) {
    const ds = args.dataset;
    const sheets = [];
    const add = (name, rows) => { if (rows && rows.length) sheets.push({ name, rows }); };

    if (ds === 'issues' || ds === 'all') add('质量问题库', [['编号', '产品', '车间', '工位', '问题描述', '来源', '等级', '状态', '责任人', '关联项目', '登记时间', '关闭时间']].concat(
      store.col('issues').all().map((i) => [i.id, i.model, i.workshop, i.station, i.title, i.source, i.severity, i.status, i.owner, i.projectId || '', (i.createdAt || '').slice(0, 10), i.closedAt ? i.closedAt.slice(0, 10) : ''])));
    if (ds === 'projects' || ds === 'all') add('改进项目', [['编号', '项目名称', '产品', '车间', '责任人', '等级', '当前阶段', '进度', '截止日期', '是否超期', '来源问题', '预估收益(万元)']].concat(
      store.col('projects').all().map((p) => [p.id, p.title, p.model, p.workshop, p.owner, p.severity, p.stage, p.progress + '%', (p.dueAt || '').slice(0, 10), p.overdue ? '超期' : '正常', p.issueId, p.benefitEstimate])));
    if (ds === 'measurements' || ds === 'all') {
      const rows = [['特性编号', '特性名称', '产品', '车间', '工位', '时间', '班次', '测量值', '单位', '批次', '供应商', '操作者', 'VIN']];
      let ms = store.col('measurements').all();
      if (args.charId) ms = ms.filter((m) => m.charId === args.charId);
      if (args.days) ms = ms.filter((m) => m.ts >= sinceISO(args.days));
      ms.slice(0, 60000).forEach((m) => rows.push([m.charId, m.charName, m.model, m.workshop, m.station, m.ts.slice(0, 19), m.shift, m.value, m.unit, m.batch, m.supplier, m.operator, m.vin]));
      add('测量数据', rows);
    }
    if (ds === 'spc' || ds === 'all') {
      const rows = [['特性编号', '名称', 'USL', 'LSL', '均值', '标准差', 'Cp', 'Cpk', 'Ppk', '超差数', '判异数', '状态']];
      const snap = dashboardSnapshot(args.charId);
      snap.charRows.forEach((c) => rows.push([c.id, c.name, c.usl, c.lsl, c.mean, '', '', c.cpk, '', c.oos, c.hits, c.status]));
      add('SPC过程能力', rows);
    }
    if (ds === 'knowledge' || ds === 'all') add('知识库', [['编号', '类型', '类别', '标题', '问题', '原因', '对策', '效果', '标签', '出处', '作者', '浏览数']].concat(
      store.col('knowledge').all().map((k) => [k.id, k.type, k.category, k.title, k.problem, k.cause, k.action, k.effect, (k.tags || []).join('/'), k.source, k.author, k.views])));
    if (ds === 'benefits' || ds === 'all') add('收益台账', [['单号', '项目', '类型', '金额(万元)', '期间', '状态', '核定人', '口径']].concat(
      store.col('benefits').all().map((b) => [b.id, b.projectId, b.type, b.amount, b.period, b.status === 'verified' ? '财务已核定' : '待核定', b.verifiedBy, b.formula])));
    if (ds === 'defects' || ds === 'all') add('AI质检缺陷', [['时间', '产品', '车间', '工位', '缺陷类型', '置信度', '等级', '批次', '图片']].concat(
      store.col('defects').all().map((d) => [d.ts.slice(0, 19), d.model, d.workshop, d.station, d.type, d.confidence, d.severity, d.batch, d.imageRef])));

    if (!sheets.length) return { ok: false, error: '该数据集没有数据可导出' };
    const dir = outDir(ctx);
    const base = safeName(args.filename || (brandName() + '_质量数据_' + ds + '_' + new Date().toISOString().slice(0, 10)));
    let fp, url, size;
    if (args.format === 'csv') {
      const buf = getOffice().csvWrite(sheets[0].rows);
      fp = path.join(dir, base + '.csv'); fs.writeFileSync(fp, buf); size = buf.length; url = '/qip/api/reports/download/' + encodeURIComponent(path.basename(fp));
    } else {
      const buf = getOffice().xlsxWrite(sheets.map((s) => ({ name: s.name, rows: s.rows, headerRow: true })));
      fp = path.join(dir, base + '.xlsx'); fs.writeFileSync(fp, buf); size = buf.length; url = '/qip/api/reports/download/' + encodeURIComponent(path.basename(fp));
    }
    return {
      ok: true, 数据集: ds, 格式: args.format === 'csv' ? 'CSV' : 'Excel (.xlsx)',
      工作表: sheets.map((s) => s.name + '（' + (s.rows.length - 1) + ' 行）'),
      文件大小: Math.round(size / 1024) + ' KB', 下载链接: url, 文件名: path.basename(fp),
    };
  },
});

/* ------------------------------------------------------------------ */
define({
  plugin: '@DOC', name: 'report_list', label: '报表清单',
  description: '查看报表中心已生成的报告与导出文件清单。',
  parameters: { type: 'object', properties: { limit: { type: 'number' } } },
  run(args) {
    const rows = store.col('reports').all().slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { ok: true, 报表数: rows.length, 清单: rows.slice(0, args.limit || 20).map((r) => ({ 编号: r.id, 类型: r.type, 标题: r.title, 期间: r.period, 格式: r.format, 状态: r.status === 'published' ? '已发布' : '草稿', 生成时间: (r.createdAt || '').slice(0, 16).replace('T', ' '), 下载: r.downloadUrl })) };
  },
});

/* ------------------------------------------------------------------ */
define({
  plugin: '@DOC', name: 'qrqc_voice_report', label: '现场语音报问题',
  description: '把车间现场语音/文字描述（如「四车间三线右后门关门声发闷，连续第三台」）结构化为标准质量问题单：自动识别产品/车间/工位/缺陷类别/等级，回填 MES 工位批次，并匹配相似历史案例。',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '现场语音转写文本或口头描述' },
      reporter: { type: 'string', description: '报告人' },
    },
    required: ['text'],
  },
  write: true,
  run(args) {
    const t = args.text || '';
    const wsNames = (((store.db.settings || {}).naming || {}).workshops) || ['一车间', '二车间', '三车间', '四车间', '五车间'];
    const workshop = wsNames.find((w) => t.indexOf(w) >= 0 || t.indexOf(w.replace(' ', '')) >= 0) || '';
    const pdNames = (((store.db.settings || {}).naming || {}).products) || ['产品A', '产品B', '产品C'];
    const modelHit = pdNames.find((p) => t.indexOf(p) >= 0) || '';
    const modelMatch = modelHit ? null : t.match(/产品\s*([ABC])/);
    const model = modelHit || (modelMatch ? '产品' + modelMatch[1] : '');
    const stationMatch = t.match(/([\u4e00-\u9fa5]{0,4}(?:一线|二线|三线|线|工位|车间))/);
    const station = stationMatch ? stationMatch[0] : (workshop ? workshop + '（工位待补）' : '');
    const severity = /(安全|起火|断裂|失效|批量|出口|法规)/.test(t) ? 'A' : /(连续|第[三四五六七八九十]台|多台|批量)/.test(t) ? 'B' : 'C';
    const rec = store.col('issues').insert({
      title: t.slice(0, 40), description: '【现场语音报障】' + t, model, workshop, station,
      source: '现场', severity, owner: '待指派', status: '整改中', projectId: null, tags: [],
      quantity: 0, history: [{ ts: new Date().toISOString(), user: args.reporter || '现场报障', action: '语音报障登记', note: 'AI 结构化提取' }],
    });
    const retrieval = require('../lib/retrieval');
    const { getKbIndex } = require('./business');
    const kb = retrieval.search(getKbIndex(), t, 3).map((h) => ({ 编号: h.doc.id, 标题: h.doc.title, 相关度: h.score }));
    return {
      ok: true, 问题编号: rec.id,
      结构化结果: { 产品: model || '待确认', 车间: workshop || '待确认', 工位: station, 问题: t, 等级: severity, 定级依据: severity === 'A' ? '涉及安全/法规或已流出' : severity === 'B' ? '批量或重复发生' : '个案' },
      回填建议: { 批次: '可由 @MES 按工位+时间窗自动回填', 班次: '按报障时间自动关联' },
      相似历史案例: kb,
      下一步: '已写入问题库；如为重复发生，建议调用 project_create 立项',
    };
  },
});

module.exports = { dashboardSnapshot, outDir };

/** 平台显示名：初始设置里填了公司名称就用它（与 host.cjs 的 brandName 口径一致） */
function brandName() {
  try {
    const s = (store.db && store.db.settings) || {};
    const b = typeof s.brand === 'string' ? s.brand.trim() : '';
    return b || '质上开源质量平台';
  } catch (e) {
    return '质上开源质量平台';
  }
}

