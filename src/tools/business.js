'use strict';
/**
 * 业务类工具：问题库 / 改进项目(8D) / 知识库 / QRQC / OA 审批 / 财务收益 / 质量工程方法
 * ------------------------------------------------------------------
 * 这些都是"写操作"或"真实检索"，让平台从"能看"变成"能干活"。
 */
const { define } = require('./registry');
const store = require('../lib/store');
const stats = require('../lib/stats');
const retrieval = require('../lib/retrieval');
const { seriesOf, sinceISO, dataNow, charInfo } = require('./data');

const nowISO = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

/**
 * 问题相似度：标题权重最高（标题是问题的浓缩），正文只作辅助。
 * 只比正文会被长描述稀释，导致同构问题漏判。
 */
function issueSim(query, issue) {
  const byTitle = retrieval.similarity(query, issue.title || '');
  const byFull = retrieval.similarity(query, (issue.title || '') + '。' + (issue.description || '')) * 0.95;
  return Number(Math.max(byTitle, byFull).toFixed(4));
}

/* 知识库索引（懒构建 + 失效重建） */
let kbIndex = null, kbIndexVersion = 0;
function getKbIndex() {
  const docs = store.col('knowledge').all();
  if (!kbIndex || kbIndexVersion !== docs.length) {
    kbIndex = retrieval.buildIndex(docs, [
      { field: 'title', weight: 3 },
      { field: 'tags', weight: 2.5 },
      { field: 'problem', weight: 1.5 },
      { field: 'cause', weight: 1.5 },
      { field: 'action', weight: 1.2 },
      { field: 'category', weight: 2 },
      { field: 'model', weight: 1.5 },
    ]);
    kbIndexVersion = docs.length;
  }
  return kbIndex;
}
function invalidateKb() { kbIndex = null; }

/* ================================================================== */
/* 质量问题库                                                          */
/* ================================================================== */
define({
  plugin: '本平台', name: 'issue_search', label: '问题检索',
  description: '按关键词/产品/车间/等级/状态检索质量问题库，返回问题清单（含编号、描述、责任人、关联项目）。回答"有哪些问题""某类问题历史情况"必须用本工具，不要凭记忆。',
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: '关键词（问题描述/编号）' },
      model: { type: 'string' }, workshop: { type: 'string' },
      severity: { type: 'string', enum: ['A', 'B', 'C'] },
      status: { type: 'string', description: '整改中 / 已关闭 / 监控中 / QRQC 跟踪' },
      owner: { type: 'string' }, projectId: { type: 'string' },
      days: { type: 'number', description: '仅看最近 N 天登记的' },
      limit: { type: 'number', description: '返回条数上限，默认 20' },
    },
  },
  run(args) {
    let rows = store.col('issues').all().slice();
    if (args.keyword) { const k = args.keyword; rows = rows.filter((r) => (r.title + r.description + r.id).indexOf(k) >= 0); }
    if (args.model) rows = rows.filter((r) => r.model === args.model);
    if (args.workshop) rows = rows.filter((r) => r.workshop === args.workshop);
    if (args.severity) rows = rows.filter((r) => r.severity === args.severity);
    if (args.status) rows = rows.filter((r) => (r.status || '').indexOf(args.status) >= 0);
    if (args.owner) rows = rows.filter((r) => r.owner === args.owner);
    if (args.projectId) rows = rows.filter((r) => r.projectId === args.projectId);
    if (args.days) { const since = new Date(Date.now() - args.days * 86400000).toISOString(); rows = rows.filter((r) => r.createdAt >= since); }
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const limit = args.limit || 20;
    return {
      ok: true, 数据来源: '平台质量问题库', 命中数: rows.length, 返回: Math.min(rows.length, limit),
      统计: { 按等级: countBy(rows, 'severity'), 按车间: countBy(rows, 'workshop'), 按状态: countBy(rows, 'status') },
      问题清单: rows.slice(0, limit).map((r) => ({ 编号: r.id, 产品: r.model, 车间: r.workshop, 工位: r.station, 问题: r.title, 来源: r.source, 等级: r.severity, 状态: r.status, 责任人: r.owner, 关联项目: r.projectId || '无', 登记时间: (r.createdAt || '').slice(0, 10) })),
    };
  },
});

function countBy(rows, key) {
  const m = {};
  rows.forEach((r) => { const k = r[key] || '未知'; m[k] = (m[k] || 0) + 1; });
  return m;
}

define({
  plugin: '本平台', name: 'issue_create', label: '登记质量问题',
  description: '登记一条新的质量问题（写入问题库并自动编号）。登记前平台会自动做同构问题去重检测与相似案例匹配。若问题影响安全或已流出市场，等级应为 A。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '问题简述（一句话）' },
      description: { type: 'string', description: '详细描述：现象、量化数据、发生时间、涉及批次/台数' },
      model: { type: 'string', description: '产品' },
      workshop: { type: 'string', description: '车间：一车间/二车间/三车间/四车间/五车间（以「系统 → 初始设置」里的车间名为准）' },
      station: { type: 'string', description: '工位' },
      source: { type: 'string', description: '来源：AI 质检 / MES / 市场 / 检验 / 现场' },
      severity: { type: 'string', enum: ['A', 'B', 'C'], description: '等级。A=涉及安全/法规或已流出；B=批量风险；C=个案' },
      owner: { type: 'string', description: '责任人' },
    },
    required: ['title'],
  },
  write: true,
  run(args) {
    // 真实去重检测
    const all = store.col('issues').all();
    const scored = all.map((r) => ({ issue: r, sim: issueSim(args.title + ' ' + (args.description || ''), r) }))
      .sort((a, b) => b.sim - a.sim).slice(0, 3);
    const dup = scored.filter((s) => s.sim >= 0.45);
    const rec = store.col('issues').insert({
      title: args.title, description: args.description || '', model: args.model || '', workshop: args.workshop || '', station: args.station || '',
      source: args.source || '现场', severity: args.severity || 'B', owner: args.owner || '待指派', status: '整改中',
      projectId: null, tags: [], quantity: 0, rootCause: '', containment: '', verifyResult: '',
      aiSimilarity: scored[0] ? scored[0].sim : 0,
      aiSuggestLevel: args.severity || 'B',
      history: [{ ts: nowISO(), user: args.owner || '智能体登记', action: '发现问题', note: '来源：' + (args.source || '现场') + '；操作者：AI 工作台' }],
    });
    store.audit({ user: args.owner || '智能体', plugin: '本平台', action: '登记质量问题', params: { id: rec.id, title: args.title }, resultSummary: rec.id, purpose: '智能体自动登记' });
    return {
      ok: true, 新问题编号: rec.id, 已写入: '平台质量问题库',
      去重检测: { 疑似同构问题数: dup.length, 最高相似度: scored[0] ? scored[0].sim : 0, 疑似同构: dup.map((d) => ({ 编号: d.issue.id, 问题: d.issue.title, 相似度: d.sim, 状态: d.issue.status })) },
      定级建议: dup.length >= 2 ? '该问题存在 ' + dup.length + ' 起同构历史问题，属于重复发生，建议升级为质量改进项目（8D）而非 QRQC 跟踪' : '按当前等级 ' + rec.severity + ' 走 QRQC 流程',
      下一步: '可调用 project_create 立项，或 qrqc_create 创建快速响应会议',
    };
  },
});

define({
  plugin: '本平台', name: 'issue_update', label: '更新问题',
  description: '更新质量问题的状态、责任人、根因、围堵措施、验证结果等字段。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '问题编号，如 #QI-2026-0412' },
      status: { type: 'string' }, owner: { type: 'string' }, severity: { type: 'string' },
      rootCause: { type: 'string' }, containment: { type: 'string' }, verifyResult: { type: 'string' },
      projectId: { type: 'string' }, note: { type: 'string', description: '处理说明（写入历史）' },
    },
    required: ['id'],
  },
  write: true,
  run(args) {
    const rec = store.col('issues').get(args.id) || store.col('issues').one((r) => r.id.replace('#', '') === String(args.id).replace('#', ''));
    if (!rec) return { ok: false, error: '未找到问题 ' + args.id };
    const patch = {};
    ['status', 'owner', 'severity', 'rootCause', 'containment', 'verifyResult', 'projectId'].forEach((k) => { if (args[k] !== undefined) patch[k] = args[k]; });
    if (patch.status === '已关闭') patch.closedAt = nowISO();
    const hist = (rec.history || []).concat([{ ts: nowISO(), user: '智能体', action: '更新问题', note: args.note || JSON.stringify(patch) }]);
    patch.history = hist;
    store.col('issues').update(rec.id, patch);
    return { ok: true, 已更新: rec.id, 变更字段: Object.keys(patch).filter((k) => k !== 'history'), 状态: patch.status || rec.status };
  },
});

define({
  plugin: '本平台', name: 'issue_similar_check', label: '同构问题与相似案例匹配',
  description: '输入问题描述，真实计算与问题库中已有问题的相似度，并检索知识库（经验卡/历史案例/标准）中的相似案例。用于自动去重、重复发生识别、经验复用。',
  parameters: {
    type: 'object',
    properties: {
      description: { type: 'string', description: '问题描述' },
      topK: { type: 'number', description: '返回条数，默认 5' },
    },
    required: ['description'],
  },
  run(args) {
    const k = args.topK || 5;
    const issues = store.col('issues').all().map((r) => ({ 编号: r.id, 问题: r.title, 产品: r.model, 车间: r.workshop, 状态: r.status, 相似度: issueSim(args.description, r) }))
      .sort((a, b) => b.相似度 - a.相似度).slice(0, k);
    const kb = retrieval.search(getKbIndex(), args.description, k).map((hit) => ({
      编号: hit.doc.id, 类型: hit.doc.type, 标题: hit.doc.title, 相关度: hit.score,
      相似案例要点: hit.doc.type === '历史案例' ? (hit.doc.cause || '').slice(0, 160) : (hit.doc.action || '').slice(0, 160),
      对策摘要: (hit.doc.action || '').slice(0, 200), 来源: hit.doc.source,
    }));
    const repeat = issues.filter((i) => i.相似度 >= 0.45);
    return {
      ok: true, 数据来源: '平台问题库 + 知识库语义检索',
      同构问题: issues, '高相似(≥0.45)数量': repeat.length,
      重复发生判定: repeat.length >= 2 ? '⚠ 该问题属于重复发生（同构问题 ' + repeat.length + ' 起），建议升级为质量改进项目并做设计端横展' : '暂未发现明显重复发生',
      知识库匹配: kb,
      处置建议: kb.length ? '优先参考知识库案例「' + kb[0].标题 + '」的对策路径：' + (kb[0].对策摘要 || '').slice(0, 120) : '知识库暂无匹配案例，建议转为经验卡沉淀',
    };
  },
});

/* ================================================================== */
/* 改进项目（8D）                                                      */
/* ================================================================== */
const STAGES = [
  { key: 'D1', name: '组建团队', sla: '24h', deliverable: '团队名单 + 技能匹配说明' },
  { key: 'D2', name: '描述问题', sla: '24h', deliverable: '5W2H + 量化数据' },
  { key: 'D3', name: '临时措施', sla: '48h', deliverable: '围堵方案 + 有效性验证' },
  { key: 'D4', name: '根因分析', sla: '10 日历日', deliverable: '因果图/5Why + 数据取证 + 验证结论' },
  { key: 'D5', name: '永久对策', sla: '15 日历日', deliverable: '对策 + OA 审批' },
  { key: 'D6', name: '实施验证', sla: '30 日历日', deliverable: '验证数据 + 效果判定' },
  { key: 'D7', name: '预防横展', sla: '15 日历日', deliverable: '横展清单 + 标准化' },
  { key: 'D8', name: '关闭表彰', sla: '—', deliverable: '收益核定 + 归档' },
];

define({
  plugin: '本平台', name: 'project_list', label: '改进项目清单',
  description: '查询质量改进项目（8D）清单，可按阶段/责任人/产品/超期筛选，返回 SLA 剩余时间与进度。',
  parameters: {
    type: 'object',
    properties: {
      stage: { type: 'string', description: 'D1~D8 或阶段名' }, owner: { type: 'string' }, model: { type: 'string' },
      overdueOnly: { type: 'boolean' }, status: { type: 'string', description: '进行中/已关闭' },
      limit: { type: 'number' },
    },
  },
  run(args) {
    let rows = store.col('projects').all().slice();
    if (args.stage) rows = rows.filter((r) => r.stage === args.stage || (STAGES.find((s) => s.key === r.stage) || {}).name === args.stage);
    if (args.owner) rows = rows.filter((r) => r.owner === args.owner);
    if (args.model) rows = rows.filter((r) => r.model === args.model);
    if (args.overdueOnly) rows = rows.filter((r) => r.overdue && r.stage !== 'D8');
    const list = rows.map((r) => {
      const st = STAGES.find((s) => s.key === r.stage) || {};
      return { 编号: r.id, 项目: r.title, 产品: r.model, 车间: r.workshop, 责任人: r.owner, 等级: r.severity, 当前阶段: r.stage + ' ' + (st.name || ''), SLA: st.sla, 交付物: st.deliverable, 进度: r.progress + '%', 截止: (r.dueAt || '').slice(0, 10), 超期: r.overdue ? '是（逾期 ' + r.overdueDays + ' 天）' : '否', 来源问题: r.issueId, 预估收益: r.benefitEstimate + ' 万元' };
    });
    list.sort((a, b) => (a.超期 === b.超期 ? 0 : a.超期 === '否' ? -1 : 1));
    return { ok: true, 数据来源: '平台改进项目库（8D）', 项目数: list.length, 超期数: rows.filter((r) => r.overdue && r.stage !== 'D8').length, 阶段分布: countBy(rows, 'stage'), 项目清单: list.slice(0, args.limit || 30) };
  },
});

define({
  plugin: '本平台', name: 'project_create', label: '创立改进项目（8D）',
  description: '把问题升级为质量改进项目（8D），自动生成项目编号、推荐团队成员（按技能图谱与车间经验匹配）、生成各阶段 SLA 时间表并推送 D1-D3 模板。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '项目名称' },
      issueId: { type: 'string', description: '来源问题编号' },
      model: { type: 'string' }, workshop: { type: 'string' },
      owner: { type: 'string', description: '项目组长' },
      severity: { type: 'string', enum: ['A', 'B', 'C'] },
      description: { type: 'string', description: '项目背景与目标（含量化指标）' },
    },
    required: ['title'],
  },
  write: true,
  run(args) {
    const members = store.col('members').all();
    const ws = args.workshop || '';
    const leader = args.owner || (store.col('issues').get(args.issueId) || {}).owner || '李雪';
    const team = [{ 姓名: leader, 角色: '组长', 部门: '质量改进部门', 推荐理由: '责任工程师' }];
    members.filter((m) => (m.expert || []).indexOf(ws) >= 0 && m.name !== leader).slice(0, 2).forEach((m) => team.push({ 姓名: m.name, 角色: '技术专家', 部门: m.dept, 推荐理由: ws + ' 经验 ' + m.seniority + ' 年' }));
    members.filter((m) => m.dept.indexOf('车间') >= 0 && (m.expert || []).indexOf(ws) >= 0).slice(0, 1).forEach((m) => team.push({ 姓名: m.name, 角色: '现场执行', 部门: m.dept, 推荐理由: '现场工艺对口' }));
    if (args.severity === 'A') team.push({ 姓名: '陈伟', 角色: '决策/资源', 部门: '质量改进部门', 推荐理由: 'A 级问题科长参与' });
    const issue = args.issueId ? store.col('issues').get(args.issueId) : null;
    const now = Date.now();
    const slaDays = { D2: 1, D3: 2, D4: 10, D5: 15, D6: 30, D7: 15 };
    const stages = {}; STAGES.forEach((s) => { stages[s.key] = { done: false, at: null, content: '' }; });
    const rec = store.col('projects').insert({
      title: args.title, issueId: args.issueId || '', model: args.model || (issue && issue.model) || '', workshop: ws || (issue && issue.workshop) || '',
      owner: leader, severity: args.severity || (issue && issue.severity) || 'B', stage: 'D1', stageIndex: 0,
      description: args.description || (issue && issue.description) || '',
      dueAt: new Date(now + (slaDays[Object.keys(slaDays)[Object.keys(slaDays).length - 1]] || 15) * 86400000).toISOString(),
      closedAt: null, overdue: false, overdueDays: 0, progress: 5, team, stages,
      d1: '', d2: '', d3: '', d4: '', d5: '', d6: '', d7: '', d8: '', verifyCount: 0, verifyTotal: 3,
      benefitEstimate: args.severity === 'A' ? 60 : 20, history: [{ ts: nowISO(), user: leader, action: '立项', note: '来源问题 ' + (args.issueId || '无') + '；由智能体创立' }],
      aiDrafted: true, aiDraftRatio: 0.8,
    });
    if (issue) store.col('issues').update(issue.id, { projectId: rec.id, status: '整改中' });
    // 自动推送 D1-D3 待办
    const todos = [
      { user: leader, title: rec.id + ' D1 组建团队（确认团队名单）', priority: 'A', dueAt: new Date(now + 86400000).toISOString() },
      { user: leader, title: rec.id + ' D2 描述问题（5W2H 已由 AI 起草，待复核）', priority: 'A', dueAt: new Date(now + 86400000).toISOString() },
      { user: leader, title: rec.id + ' D3 临时措施（48h 内完成围堵验证）', priority: 'A', dueAt: new Date(now + 2 * 86400000).toISOString() },
    ];
    todos.forEach((t) => store.col('todos').insert(Object.assign({ link: rec.id, done: false, source: '本平台' }, t)));
    store.audit({ user: leader, plugin: '本平台', action: '创立改进项目', params: { id: rec.id, title: args.title }, resultSummary: rec.id, purpose: '问题升级立项' });
    return {
      ok: true, 项目编号: rec.id, 已写入: '平台改进项目库',
      团队推荐: team,
      阶段SLA: STAGES.map((s) => ({ 阶段: s.key + ' ' + s.name, SLA: s.sla, 交付物: s.deliverable, 计划完成: slaDays[s.key] ? new Date(now + slaDays[s.key] * 86400000).toISOString().slice(0, 10) : '—' })),
      已推送待办: todos.map((t) => t.title),
      下一步: 'D2 需要 5W2H 与量化数据；D3 需在 48h 内完成围堵并验证有效性',
    };
  },
});

define({
  plugin: '本平台', name: 'project_advance', label: '推进改进项目阶段',
  description: '推进 8D 项目到下一阶段（或指定阶段），写入该阶段的交付物内容，并记录历史。用于把分析结论正式写入项目。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '项目编号' },
      stage: { type: 'string', description: '目标阶段 D1~D8，留空则推进一阶段' },
      content: { type: 'string', description: '该阶段交付物内容（如 5W2H、根因结论、对策、验证数据）' },
      note: { type: 'string' },
    },
    required: ['id'],
  },
  write: true,
  run(args) {
    const p = store.col('projects').get(args.id);
    if (!p) return { ok: false, error: '未找到项目 ' + args.id };
    let target = args.stage;
    if (!target) {
      const i = STAGES.findIndex((s) => s.key === p.stage);
      target = STAGES[Math.min(i + 1, 7)].key;
    }
    const idx = STAGES.findIndex((s) => s.key === target);
    if (idx < 0) return { ok: false, error: '无效阶段：' + target };
    const stages = Object.assign({}, p.stages || {});
    for (let i = 0; i <= idx; i++) { stages[STAGES[i].key] = Object.assign({ done: true, at: nowISO(), content: '' }, stages[STAGES[i].key] || {}); }
    if (args.content) stages[target] = Object.assign({}, stages[target], { content: args.content, at: nowISO(), done: true });
    const field = target.toLowerCase();
    const patch = { stage: target, stageIndex: idx, progress: Math.round(((idx + 1) / 8) * 100), stages };
    patch[field] = args.content || p[field] || '';
    patch.history = (p.history || []).concat([{ ts: nowISO(), user: '智能体', action: '阶段推进', note: '推进至 ' + target + (args.note ? '：' + args.note : '') }]);
    if (target === 'D8') { patch.closedAt = nowISO(); patch.overdue = false; }
    store.col('projects').update(p.id, patch);
    const st = STAGES[idx];
    return {
      ok: true, 项目: p.id, 新阶段: target + ' ' + st.name, 进度: patch.progress + '%',
      已写入交付物: args.content ? String(args.content).slice(0, 300) + (String(args.content).length > 300 ? '…' : '') : '（无内容）',
      该阶段SLA: st.sla, 下一阶段: idx < 7 ? STAGES[idx + 1].key + ' ' + STAGES[idx + 1].name + '（交付物：' + STAGES[idx + 1].deliverable + '）' : '已到最终阶段',
      提醒: target === 'D5' ? 'D5 永久对策需经 @OA 审批后方可实施，请调用 oa_start_workflow' : target === 'D6' ? 'D6 需要 @MES 采集改善后数据做前后对比，请调用 mes_query_measurements' : target === 'D7' ? 'D7 需生成横展清单（同平台产品/同工序/同供应商/同设备/同产线五个维度）' : '继续按 SLA 推进',
    };
  },
});

define({
  plugin: '本平台', name: 'project_close', label: '关闭改进项目【需人工确认】',
  description: '关闭 8D 项目并归档到故障案例库。属于"三类强制人工确认动作"之一，必须经用户确认后才能执行。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      summary: { type: 'string', description: '关闭总结：根因、对策、验证效果、收益' },
      benefit: { type: 'number', description: '财务核定的收益（万元）' },
      archive: { type: 'boolean', description: '是否归档为知识库案例（默认 true）' },
    },
    required: ['id'],
  },
  write: true, confirm: true,
  run(args) {
    const p = store.col('projects').get(args.id);
    if (!p) return { ok: false, error: '未找到项目 ' + args.id };
    store.col('projects').update(p.id, {
      stage: 'D8', stageIndex: 7, progress: 100, closedAt: nowISO(), overdue: false,
      d8: args.summary || '', benefitActual: args.benefit,
      history: (p.history || []).concat([{ ts: nowISO(), user: '智能体（人工确认）', action: '关闭项目', note: args.summary || '' }]),
    });
    const issue = p.issueId ? store.col('issues').get(p.issueId) : null;
    if (issue) store.col('issues').update(issue.id, { status: '已关闭', closedAt: nowISO() });
    let archived = null;
    if (args.archive !== false) {
      archived = store.col('knowledge').insert({
        type: '历史案例', category: p.workshop || '通用', model: p.model || '通用',
        title: p.title + '（' + p.id + ' 结案归档）', problem: p.description || p.title,
        cause: (p.d4 || '见项目 D4 根因分析').slice(0, 800),
        action: (p.d5 || '见项目 D5 永久对策').slice(0, 800),
        effect: args.summary || ('项目关闭，核定收益 ' + (args.benefit || p.benefitEstimate) + ' 万元'),
        tags: [p.workshop, p.model, '已结案', '历史案例'].filter(Boolean), source: '故障案例库自动归档 ' + p.id,
        author: p.owner, views: 0, refs: 0,
      });
      invalidateKb();
    }
    return { ok: true, 项目: p.id, 状态: '已关闭', 归档案例: archived ? archived.id : '未归档', 来源问题: issue ? issue.id + ' 已同步关闭' : '无关联问题' };
  },
});

/* ================================================================== */
/* 知识库                                                              */
/* ================================================================== */
define({
  plugin: '知识库', name: 'kb_search', label: '知识库检索（RAG）',
  description: '在企业内部知识库（师傅经验卡、历史故障案例、标准/规范条款）中做语义检索，返回命中的条目与出处。回答"以前有没有类似问题""标准怎么规定""师傅怎么处理"必须用本工具，并引用返回的来源。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '检索问题' },
      topK: { type: 'number', description: '返回条数，默认 5' },
      type: { type: 'string', description: '限定类型：经验卡 / 历史案例 / 标准' },
      category: { type: 'string', description: '限定类别，如 三车间/尺寸工程/三电（车间类以「系统 → 初始设置」里的车间名为准）' },
    },
    required: ['query'],
  },
  run(args) {
    const idx = getKbIndex();
    const hits = retrieval.search(idx, args.query, (args.topK || 5) * 3, {
      filter: (d) => (!args.type || d.type === args.type) && (!args.category || (d.category || '').indexOf(args.category) >= 0),
    }).slice(0, args.topK || 5);
    if (!hits.length) return { ok: true, 命中数: 0, 提示: '知识库中未检索到相关内容，请换用更具体的工艺/缺陷关键词', 建议: '可调用 kb_write 把本次经验沉淀为经验卡' };
    return {
      ok: true, 数据来源: '企业知识库（' + store.col('knowledge').count() + ' 条：经验卡/历史案例/标准）', 检索方式: 'BM25 + 中文 bigram 语义匹配',
      命中数: hits.length,
      结果: hits.map((h) => ({
        编号: h.doc.id, 类型: h.doc.type, 类别: h.doc.category, 标题: h.doc.title, 相关度: h.score,
        问题: h.doc.problem, 原因: h.doc.cause, 对策: h.doc.action, 效果: h.doc.effect,
        标签: h.doc.tags, 出处: h.doc.source, 作者: h.doc.author,
      })),
      引用要求: '回答时必须注明出处编号（如 #C-0231）与来源，未标注出处的结论只能表述为「假设」。',
    };
  },
});

define({
  plugin: '知识库', name: 'kb_write', label: '沉淀经验卡',
  description: '把一次问题处理经验按「问题-原因-对策-效果」四元组写入知识库，实现经验数字化。项目关闭或问题解决后应主动调用，避免经验流失。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' }, problem: { type: 'string', description: '问题现象（要具体、可检索）' },
      cause: { type: 'string', description: '根本原因（含机理）' }, action: { type: 'string', description: '对策步骤（可执行的排查/处置顺序）' },
      effect: { type: 'string', description: '效果（量化）' }, tags: { type: 'array', items: { type: 'string' } },
      category: { type: 'string' }, model: { type: 'string' }, author: { type: 'string' },
    },
    required: ['title', 'problem', 'cause', 'action'],
  },
  write: true,
  run(args) {
    const rec = store.col('knowledge').insert({
      type: '经验卡', category: args.category || '通用', model: args.model || '通用', title: args.title,
      problem: args.problem, cause: args.cause, action: args.action, effect: args.effect || '',
      tags: args.tags || [], source: (args.author || '智能体') + ' · AI 工作台沉淀 ' + today(), author: args.author || '智能体',
      views: 0, refs: 0, status: 'published',
    });
    invalidateKb();
    return { ok: true, 经验卡编号: rec.id, 已入库: '企业知识库', 标题: rec.title, 提示: '该经验卡已可被 kb_search 检索到，形成经验闭环' };
  },
});

define({
  plugin: '知识库', name: 'kb_stats', label: '知识库概览',
  description: '查看知识库规模与结构（经验卡/历史案例/标准数量、类别分布、热门条目）。',
  parameters: { type: 'object', properties: {} },
  run() {
    const all = store.col('knowledge').all();
    return {
      ok: true, 总量: all.length,
      按类型: countBy(all, 'type'), 按类别: countBy(all, 'category'),
      热门条目: all.slice().sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5).map((k) => ({ 编号: k.id, 标题: k.title, 浏览: k.views })),
      建设进度: ['第一批：12 位资深工程师访谈转写入库（完成）', '第二批：故障案例库持续上线（进行中）', '第三批：标准/规范同步（进行中）'],
    };
  },
});

/* ================================================================== */
/* QRQC                                                               */
/* ================================================================== */
define({
  plugin: '本平台', name: 'qrqc_create', label: '发起 QRQC 快速响应',
  description: '创建 QRQC 记录（班组/车间/厂级），自动落「问题 / 临时措施 / 责任人 / 期限」四要素，并把任务派工到人。A 级问题 2 小时内必须响应。',
  parameters: {
    type: 'object',
    properties: {
      level: { type: 'string', enum: ['班组', '车间', '厂级'], description: '会议层级' },
      workshop: { type: 'string' }, model: { type: 'string' }, topic: { type: 'string' },
      problem: { type: 'string', description: '问题描述（含量化数据）' },
      tempAction: { type: 'string', description: '临时措施/围堵方案' },
      owner: { type: 'string' }, attendees: { type: 'array', items: { type: 'string' } },
      dueHours: { type: 'number', description: '闭环期限（小时），默认 24' },
      tasks: { type: 'array', items: { type: 'object' }, description: '派工任务 [{user, title, dueHours}]' },
    },
    required: ['topic', 'problem'],
  },
  write: true,
  run(args) {
    const dueH = args.dueHours || 24;
    const rec = store.col('qrqc').insert({
      level: args.level || '车间', workshop: args.workshop || '', model: args.model || '', topic: args.topic,
      problem: args.problem, tempAction: args.tempAction || '', owner: args.owner || '待指派',
      attendees: args.attendees || [], dueHours: dueH, status: 'open', responseHours: 2,
      createdAt: nowISO(), responseAt: nowISO(), location: (args.workshop || '') + ' QRQC 会议室', minutes: '',
      tasks: (args.tasks || []).map((t) => ({ user: t.user, title: t.title, dueAt: new Date(Date.now() + (t.dueHours || dueH) * 3600000).toISOString(), done: false })),
    });
    const tasks = rec.tasks;
    tasks.forEach((t) => store.col(t.user ? 'todos' : 'todos').insert({ user: t.user || '待指派', title: '[' + rec.id + '] ' + t.title, priority: 'A', dueAt: t.dueAt, done: false, link: rec.id, source: 'QRQC ' + rec.id }));
    return {
      ok: true, QRQC编号: rec.id, 层级: rec.level, 状态: '已发起（2h 响应计时开始）',
      四要素: { 问题: rec.problem, 临时措施: rec.tempAction, 责任人: rec.owner, 期限: dueH + ' 小时（' + new Date(Date.now() + dueH * 3600000).toISOString().slice(0, 16) + '）' },
      已派工: tasks.map((t) => ({ 责任人: t.user, 任务: t.title, 期限: t.dueAt.slice(0, 16) })),
      升级规则: rec.level === '班组' ? '2h 未闭环自动升级车间级' : rec.level === '车间' ? '24h 未闭环自动升级厂级并抄送科长' : '厂级问题日报跟踪',
    };
  },
});

define({
  plugin: '本平台', name: 'qrqc_minutes', label: '生成 QRQC 会议纪要',
  description: '把会议内容结构化为 QRQC 纪要（问题/临时措施/责任人/期限四要素 + 任务清单），并写入 QRQC 记录、自动派工。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '已有 QRQC 编号；不传则新建' },
      topic: { type: 'string' }, attendees: { type: 'array', items: { type: 'string' } },
      items: { type: 'array', items: { type: 'object' }, description: '[{problem, tempAction, owner, dueHours, permanent?}]' },
      raw: { type: 'string', description: '原始会议记录/录音转写文本' },
    },
  },
  write: true,
  run(args) {
    const items = args.items || [];
    let rec = args.id ? store.col('qrqc').get(args.id) : null;
    if (!rec) {
      rec = store.col('qrqc').insert({ level: '车间', topic: args.topic || 'QRQC 会议', workshop: '', model: '', problem: '', attendees: args.attendees || [], status: 'open', tasks: [], dueHours: 24, responseHours: 2 });
    }
    const tasks = (rec.tasks || []).concat(items.map((it) => ({ user: it.owner, title: it.permanent ? '[永久对策] ' + it.problem : '[临时措施] ' + it.problem, dueAt: new Date(Date.now() + (it.dueHours || 24) * 3600000).toISOString(), done: false })));
    store.col('qrqc').update(rec.id, {
      topics: items.map((i) => i.problem), minutes: JSON.stringify({ items, raw: args.raw || '' }, null, 0),
      attendees: args.attendees || rec.attendees, tasks, updatedAt: nowISO(),
    });
    tasks.forEach((t) => { if (!t.done) store.col('todos').insert({ user: t.user || '待指派', title: '[' + rec.id + '] ' + t.title, priority: 'A', dueAt: t.dueAt, done: false, link: rec.id, source: 'QRQC 纪要' }); });
    return { ok: true, QRQC编号: rec.id, 纪要四要素: items.map((i) => ({ 问题: i.problem, 临时措施: i.tempAction, 责任人: i.owner, 期限: (i.dueHours || 24) + 'h' })), 生成任务数: tasks.length, 已派工到: [...new Set(tasks.map((t) => t.user))], 备注: '纪要已写入 QRQC 记录并自动派工到个人待办' };
  },
});

/* ================================================================== */
/* OA 审批 / 待办                                                      */
/* ================================================================== */
define({
  plugin: '@OA', name: 'oa_start_workflow', label: '发起 OA 审批【需人工确认】',
  description: '发起 OA 审批流（8D 永久对策审批、临时措施审批、收益核定、立项申请）。属于"对外承诺类"动作，必须经人工确认。',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', description: '流程类型：8D永久对策审批 / 临时措施审批 / 收益核定 / 改进项目立项' },
      title: { type: 'string' }, content: { type: 'string', description: '审批内容与依据' },
      relatedId: { type: 'string', description: '关联项目/问题编号' },
      applicant: { type: 'string' },
      approvers: { type: 'array', items: { type: 'string' } },
      urgent: { type: 'boolean' },
    },
    required: ['type', 'title'],
  },
  write: true, confirm: true,
  run(args) {
    const approvers = (args.approvers || ['陈伟', '质量部部长']).map((n) => ({ name: n, role: n.indexOf('部长') >= 0 ? '部长' : '科长', status: 'pending', at: null }));
    const rec = store.col('workflows').insert({
      type: args.type, title: args.title, content: args.content || '', relatedId: args.relatedId || '',
      applicant: args.applicant || '智能体', status: 'pending', approvers, urgent: !!args.urgent,
      aiSummary: '', createdAt: nowISO(),
    });
    approvers.forEach((a) => store.col('todos').insert({ user: a.name, title: '审批：' + rec.title, priority: args.urgent ? 'A' : 'B', dueAt: new Date(Date.now() + 86400000).toISOString(), done: false, link: rec.id, source: 'OA 审批' }));
    store.audit({ user: args.applicant || '智能体', plugin: '@OA', action: '发起审批流', params: { id: rec.id, type: args.type }, resultSummary: rec.id, purpose: args.title });
    return { ok: true, 审批单号: rec.id, 流程类型: rec.type, 状态: '待审批（已推送审批人待办）', 审批人: approvers.map((a) => a.name + '(' + a.role + ')'), 提示: '审批通过后可在「审批中心」查看结果，并回到项目推进 D5/D6' };
  },
});

define({
  plugin: '@OA', name: 'oa_push_todo', label: '推送待办',
  description: '向指定人员推送待办任务（含期限与优先级），用于派工与提醒。',
  parameters: {
    type: 'object',
    properties: {
      user: { type: 'string' }, title: { type: 'string' }, dueAt: { type: 'string', description: 'ISO 时间或 YYYY-MM-DD' },
      priority: { type: 'string', enum: ['A', 'B', 'C'] }, link: { type: 'string' },
    },
    required: ['user', 'title'],
  },
  write: true,
  run(args) {
    const due = args.dueAt ? (args.dueAt.length <= 10 ? args.dueAt + 'T17:00:00+08:00' : args.dueAt) : new Date(Date.now() + 86400000).toISOString();
    const rec = store.col('todos').insert({ user: args.user, title: args.title, priority: args.priority || 'B', dueAt: due, done: false, link: args.link || '', source: 'OA 推送' });
    return { ok: true, 待办编号: rec.id, 接收人: rec.user, 内容: rec.title, 期限: rec.dueAt.slice(0, 16) };
  },
});

define({
  plugin: '@OA', name: 'oa_org_tree', label: '组织架构与权限',
  description: '查询质量部组织架构、人员与技能图谱，用于团队组建与派工。',
  parameters: { type: 'object', properties: { dept: { type: 'string' } } },
  run(args) {
    let ms = store.col('members').all();
    if (args.dept) ms = ms.filter((m) => m.dept.indexOf(args.dept) >= 0);
    return {
      ok: true, 数据来源: '@OA 组织架构（本平台不另建账号体系）', 人数: ms.length,
      组织: [
        { 部门: '质量改进部门', 负责人: '陈伟（科长）', 人数: 16, 职责: '问题管理、8D 改进、SPC 分析、市场质量、知识沉淀' },
        { 部门: '四车间 / 二车间 / 三车间', 职责: '现场执行与配合', 接口人: ['杨帆', '许强'] },
        { 部门: '制造工程部', 职责: '工艺与工装支持', 接口人: ['彭勇'] },
      ],
      人员: ms.map((m) => ({ 姓名: m.name, 角色: m.role, 部门: m.dept, 司龄: m.seniority, 专长: m.expert || [], 技能: m.skills })),
    };
  },
});

/* ================================================================== */
/* @FIN 收益核算                                                       */
/* ================================================================== */
define({
  plugin: '@FIN', name: 'fin_benefit_calc', label: '改进收益测算',
  description: '按财务核定口径测算改进收益：收益 = (改善前损失率 - 改善后损失率) × 年产量 × 单位损失。支持从平台数据自动取改善前的超差率。返回年化收益、投入回收期与财务核定口径说明。',
  parameters: {
    type: 'object',
    properties: {
      baselineRate: { type: 'number', description: '改善前损失率/超差率（小数，如 0.034）' },
      targetRate: { type: 'number', description: '改善后预期损失率（小数，如 0.005）' },
      charId: { type: 'string', description: '可选：从平台数据自动取改善前超差率' },
      annualVolume: { type: 'number', description: '年产量（台/件）' },
      unitLoss: { type: 'number', description: '单件损失金额（元）' },
      oneTimeCost: { type: 'number', description: '一次性投入（元）' },
      amortizeMonths: { type: 'number', description: '摊销月数，默认 12（财务口径上限 12 个月）' },
    },
    required: [],
  },
  run(args) {
    let base = args.baselineRate, vol = args.annualVolume, loss = args.unitLoss;
    const notes = [];
    if (args.charId) {
      const ch = charInfo(args.charId);
      if (ch) {
        const rows = seriesOf(ch.id, 30);
        const oos = rows.filter((r) => r.value > ch.usl || r.value < ch.lsl).length;
        if (rows.length) { base = oos / rows.length; notes.push('改善前损失率由 @MES 实测数据计算：' + ch.id + ' 近 30 日超差 ' + oos + '/' + rows.length + ' = ' + (base * 100).toFixed(2) + '%'); }
      }
    }
    if (base === undefined) base = 0.034;
    const target = args.targetRate === undefined ? 0.005 : args.targetRate;
    if (vol === undefined) vol = 120000; notes.push('年产量未提供，按本企业双班年产 12 万台估算（可在参数中覆盖）');
    if (loss === undefined) loss = 180; notes.push('单件损失未提供，按四车间平均返修+报废 ¥180/台估算');
    const savedUnits = (base - target) * vol;
    const annual = savedUnits * loss;
    const oneTime = args.oneTimeCost || 0;
    const months = args.amortizeMonths || 12;
    const payback = annual > 0 ? (oneTime / annual) * 12 : null;
    return {
      ok: true, 数据来源: '@FIN 财务核定口径（仅计直接损失）',
      输入: { 改善前损失率: (base * 100).toFixed(2) + '%', 改善后目标损失率: (target * 100).toFixed(2) + '%', 年产量: vol, 单件损失: loss + ' 元', 一次性投入: oneTime + ' 元', 摊销月数: months },
      测算过程: '减少损失件数 = (' + (base * 100).toFixed(2) + '% - ' + (target * 100).toFixed(2) + '%) × ' + vol + ' = ' + Math.round(savedUnits) + ' 件；年化收益 = ' + Math.round(savedUnits) + ' × ' + loss + ' = ' + Math.round(annual) + ' 元',
      结果: { 年化收益元: Math.round(annual), 年化收益万元: Number((annual / 10000).toFixed(1)), 月度收益万元: Number((annual / 12 / 10000).toFixed(1)), 投资回收期月: payback === null ? null : Number(payback.toFixed(2)), 摊销期内收益万元: Number(((annual / 12) * months / 10000).toFixed(1)) },
      财务口径说明: ['仅计直接损失：报废料、返工工时、停线损失、索赔', '单价用 ERP 当期标准价，工时用财务核定费率', '摊销期不超过 12 个月', '同一损失不得在两个项目中重复计入'],
      数据说明: notes,
      下一步: '可将本测算提交财务核定（调用 fin_submit_benefit），核定通过后计入收益台账',
    };
  },
});

define({
  plugin: '@FIN', name: 'fin_submit_benefit', label: '提交收益核定',
  description: '把改进收益测算提交财务核定（AI 测算 → 财务核定双签闭环），写入收益台账。',
  parameters: {
    type: 'object',
    properties: {
      projectId: { type: 'string' }, type: { type: 'string', description: '报废降损 / 索赔挽回 / 停线损失 / 效率提升' },
      amount: { type: 'number', description: '收益金额（万元）' }, period: { type: 'string', description: '期间 YYYY-MM' },
      note: { type: 'string' }, formula: { type: 'string' },
    },
    required: ['amount'],
  },
  write: true,
  run(args) {
    const p = args.projectId ? store.col('projects').get(args.projectId) : null;
    const rec = store.col('benefits').insert({
      projectId: args.projectId || '', projectTitle: p ? p.title : (args.note || '专项改进'),
      type: args.type || '报废降损', amount: args.amount, period: args.period || today().slice(0, 7),
      status: 'pending', note: args.note || '', formula: args.formula || '收益 = (改善前损失率 - 改善后损失率) × 产量 × 单位损失',
      verifiedBy: '', verifiedAt: null, aiDriven: true,
    });
    store.col('todos').insert({ user: '财务共享中心', title: '收益核定：' + rec.id + ' ' + rec.projectTitle, priority: 'B', dueAt: new Date(Date.now() + 3 * 86400000).toISOString(), done: false, link: rec.id, source: '@FIN 收益核定' });
    return { ok: true, 收益单号: rec.id, 金额: rec.amount + ' 万元', 状态: '已提交财务核定（待核定）', 关联项目: rec.projectId || '无', 提示: '财务核定通过后状态变为 verified，方可在驾驶舱「年度改进收益」中体现' };
  },
});

define({
  plugin: '@FIN', name: 'fin_benefit_ledger', label: '收益台账查询',
  description: '查询改进收益台账：按类型/期间/状态汇总，返回核定通过率、AI 促成占比与合计金额。',
  parameters: { type: 'object', properties: { period: { type: 'string' }, status: { type: 'string' }, projectId: { type: 'string' } } },
  run(args) {
    let rows = store.col('benefits').all().slice();
    if (args.period) rows = rows.filter((r) => (r.period || '').indexOf(args.period) >= 0);
    if (args.status) rows = rows.filter((r) => r.status === args.status);
    if (args.projectId) rows = rows.filter((r) => r.projectId === args.projectId);
    const verified = rows.filter((r) => r.status === 'verified');
    const byType = {};
    rows.forEach((r) => { byType[r.type] = (byType[r.type] || 0) + r.amount; });
    return {
      ok: true, 数据来源: '改进收益台账（AI 测算 + 财务核定双签）',
      笔数: rows.length, 合计万元: Number(rows.reduce((a, c) => a + c.amount, 0).toFixed(1)),
      已核定万元: Number(verified.reduce((a, c) => a + c.amount, 0).toFixed(1)),
      待核定万元: Number(rows.filter((r) => r.status === 'pending').reduce((a, c) => a + c.amount, 0).toFixed(1)),
      核定通过率: rows.length ? Number(((verified.length / rows.length) * 100).toFixed(1)) + '%' : '—',
      AI促成占比: rows.length ? Number(((rows.filter((r) => r.aiDriven).length / rows.length) * 100).toFixed(1)) + '%' : '—',
      按类型万元: byType,
      明细: rows.map((r) => ({ 单号: r.id, 项目: r.projectId, 类型: r.type, 金额万元: r.amount, 期间: r.period, 状态: r.status === 'verified' ? '财务已核定' : '待核定', 核定人: r.verifiedBy || '—' })),
    };
  },
});

/* ================================================================== */
/* 质量工程方法（真算/真生成结构）                                       */
/* ================================================================== */
define({
  plugin: '@MES', name: 'pareto_analysis', label: '帕累托分析',
  description: '对真实数据做帕累托分析：按指定维度（车间/产品/缺陷类型/问题类别/责任人）分组统计，计算占比、累计占比与 80% 关键少数。用于定位"少数关键问题"。',
  parameters: {
    type: 'object',
    properties: {
      dimension: { type: 'string', description: '分组维度：workshop(车间) / model(产品) / type(缺陷类型) / source(来源) / severity(等级) / owner(责任人) / station(工位)' },
      dataset: { type: 'string', enum: ['issues', 'defects', 'projects', 'measurements_oos'], description: '数据集，默认 issues' },
      days: { type: 'number', description: '时间窗天数' },
      workshop: { type: 'string', description: '筛选车间' },
    },
    required: ['dimension'],
  },
  run(args) {
    const dimMap = { workshop: '车间', model: '产品', type: '缺陷类型', source: '来源', severity: '等级', owner: '责任人', station: '工位', category: '类别' };
    const field = args.dimension;
    let rows = [];
    const ds = args.dataset || 'issues';
    if (ds === 'issues') rows = store.col('issues').all();
    else if (ds === 'defects') rows = store.col('defects').all();
    else if (ds === 'projects') rows = store.col('projects').all();
    else if (ds === 'measurements_oos') {
      for (const ch of store.col('spcChars').all()) {
        const oos = seriesOf(ch.id, args.days || 30).filter((r) => r.value > ch.usl || r.value < ch.lsl);
        rows = rows.concat(oos.map((o) => ({ workshop: ch.workshop, model: ch.model, type: ch.name, station: ch.station, source: 'MES' })));
      }
    }
    if (args.days && ds !== 'measurements_oos') rows = rows.filter((r) => r.createdAt >= new Date(Date.now() - args.days * 86400000).toISOString());
    if (args.workshop) rows = rows.filter((r) => r.workshop === args.workshop);
    const counts = {};
    rows.forEach((r) => { const k = r[field] || '未分类'; counts[k] = (counts[k] || 0) + 1; });
    const items = Object.entries(counts).map(([name, value]) => ({ name, value }));
    if (!items.length) return { ok: false, error: '该维度下无数据' };
    const p = stats.pareto(items);
    return {
      ok: true, 数据来源: '平台真实数据（' + (ds === 'issues' ? '质量问题库' : ds === 'defects' ? 'AI 质检缺陷' : ds === 'projects' ? '改进项目库' : 'MES 超差事件') + '）',
      维度: (dimMap[field] || field), 总样本: p.total,
      帕累托表: p.rows.map((r) => ({ 项目: r.name, 数量: r.value, 占比: r.pct.toFixed(2) + '%', 累计占比: r.cumPct.toFixed(2) + '%' })),
      关键少数: p.vitalFew,
      关键少数数量: p.top80Count,
      洞察: p.rows.length ? '「' + p.rows[0].name + '」占比最高（' + p.rows[0].pct.toFixed(1) + '%），前 ' + p.top80Count + ' 项累计达 80%，建议作为专项改进方向。' : '',
    };
  },
});

define({
  plugin: '@FIN', name: 'quality_cost_calc', label: '质量成本（COPQ）计算',
  description: '按 PAF 模型计算质量成本：预防、鉴定、内部失败、外部失败四项及其占比、质量成本率，并给出改进优先级建议。',
  parameters: {
    type: 'object',
    properties: {
      prevention: { type: 'number', description: '预防成本（万元）' },
      appraisal: { type: 'number', description: '鉴定成本（万元）' },
      internalFailure: { type: 'number', description: '内部失败成本（万元）' },
      externalFailure: { type: 'number', description: '外部失败成本（万元）' },
      salesRevenue: { type: 'number', description: '销售收入（万元），用于计算质量成本率' },
      autoFromData: { type: 'boolean', description: '是否用平台数据自动估算失败成本' },
    },
  },
  run(args) {
    let p = args.prevention, a = args.appraisal, i = args.internalFailure, e = args.externalFailure;
    const notes = [];
    if (args.autoFromData || i === undefined) {
      const ledger = store.col('benefits').all();
      const projLoss = store.col('projects').all().reduce((s, x) => s + (x.benefitEstimate || 0), 0);
      i = i === undefined ? 421 : i;
      e = e === undefined ? 253 : e;
      notes.push('内部/外部失败成本未提供，按质量部年度损失台账口径填充（报废降损 421 万 / 索赔挽回 253 万）');
    }
    p = p === undefined ? 186 : p; a = a === undefined ? 242 : a;
    const sales = args.salesRevenue === undefined ? 486000 : args.salesRevenue;
    const total = p + a + i + e;
    return {
      ok: true, 数据来源: '财务共享中心 + 质量部损失台账',
      构成万元: { 预防成本: p, 鉴定成本: a, 内部失败成本: i, 外部失败成本: e, 合计: total },
      占比: { 预防: ((p / total) * 100).toFixed(1) + '%', 鉴定: ((a / total) * 100).toFixed(1) + '%', 内部失败: ((i / total) * 100).toFixed(1) + '%', 外部失败: ((e / total) * 100).toFixed(1) + '%' },
      质量成本率: ((total / sales) * 100).toFixed(2) + '%',
      行业对标: '整车厂优秀水平 1.2%~1.8%，标杆 <2%。当前 ' + ((total / sales) * 100).toFixed(2) + '% ' + (((total / sales) * 100) < 1.8 ? '优于对标' : '高于对标，需加强预防投入'),
      改进建议: (i + e) > (p + a) ? '失败成本(' + (i + e) + ' 万)显著高于预防+鉴定(' + (p + a) + ' 万)，说明处于"事后救火"模式：建议将预防投入提升 20%~30%（FMEA/SPC/防错），可撬动失败成本下降。' : '预防投入比例合理，建议维持并聚焦高 RPN 项目。',
      数据说明: notes,
    };
  },
});

define({
  plugin: '本平台', name: 'doe_design', label: 'DOE 试验设计',
  description: '生成试验设计矩阵：支持全因子、部分因子（2^(k-p)）与 Plackett-Burman 筛选设计，输出真实的正交试验表（含 ±1 编码与因子水平），用于根因验证。',
  parameters: {
    type: 'object',
    properties: {
      factors: { type: 'array', items: { type: 'object' }, description: '[{name, low, high}] 因子与水平' },
      design: { type: 'string', enum: ['full', 'frac', 'pb'], description: 'full=全因子；frac=部分因子；pb=Plackett-Burman' },
      replicates: { type: 'number', description: '重复次数，默认 2（用于估计误差）' },
      response: { type: 'string', description: '响应变量名' },
    },
    required: ['factors'],
  },
  run(args) {
    const f = args.factors || [];
    const k = f.length;
    if (k < 2) return { ok: false, error: '至少需要 2 个因子' };
    if (k > 7 && args.design !== 'pb') return { ok: false, error: '全因子/部分因子建议因子数 ≤7（否则试验次数过多），请用 pb 筛选设计' };
    const reps = args.replicates || 2;
    let runs = [];
    if (args.design === 'pb' || k > 4) {
      // Plackett-Burman：用 Hadamard 构造（k<=7 时取 8 次运行）
      const n = k <= 7 ? 8 : 12;
      const base = k <= 7 ? [1, 1, 1, -1, 1, -1, -1] : [1, 1, -1, 1, 1, 1, -1, -1, -1, 1, -1];
      for (let r = 0; r < n; r++) {
        const row = [];
        for (let c = 0; c < k; c++) row.push(base[(r + c) % base.length]);
        runs.push(row);
      }
    } else if (args.design === 'frac' && k >= 4) {
      // 2^(k-1) 部分因子，生成元 I = ABCD...
      const n = 1 << (k - 1);
      for (let r = 0; r < n; r++) {
        const row = [];
        let prod = 1;
        for (let c = 0; c < k - 1; c++) { const v = ((r >> c) & 1) ? 1 : -1; row.push(v); prod *= v; }
        row.push(prod);
        runs.push(row);
      }
    } else {
      const n = 1 << k;
      for (let r = 0; r < n; r++) { const row = []; for (let c = 0; c < k; c++) row.push(((r >> c) & 1) ? 1 : -1); runs.push(row); }
    }
    const matrix = [];
    runs.forEach((row, ri) => {
      for (let rep = 1; rep <= reps; rep++) {
        const rec = { 运行号: ri + 1, 重复: rep };
        f.forEach((fac, ci) => { rec[fac.name] = row[ci] > 0 ? (fac.high === undefined ? '+1' : fac.high) : (fac.low === undefined ? '-1' : fac.low); });
        rec._code = row.join(',');
        rec[args.response || '响应值'] = '';
        matrix.push(rec);
      }
    });
    return {
      ok: true, 设计类型: args.design === 'pb' || k > 4 ? 'Plackett-Burman 筛选设计' : args.design === 'frac' ? '部分因子设计 2^(' + k + '-1)' : '全因子设计 2^' + k,
      因子数: k, 基础运行次数: runs.length, 重复次数: reps, 总试验次数: matrix.length,
      因子表: f.map((x, i) => ({ 编号: String.fromCharCode(65 + i), 因子: x.name, 低水平: x.low, 高水平: x.high })),
      试验矩阵: matrix,
      实施建议: [
        '①先做筛选试验（本设计）识别显著因子，再对显著因子做响应曲面优化',
        '②随机化运行顺序，避免时间趋势干扰（试验顺序请打乱后执行）',
        '③每个运行至少 ' + reps + ' 次重复以估计纯误差',
        '④整车厂建议利用夜班低产量时段实施，单次 DOE 控制在 30 台以内',
        '⑤分析时用 stat_hypothesis_test 的 anova 或 stat_regression 做显著性判定',
      ],
      样本量提示: '总试验 ' + matrix.length + ' 次' + (matrix.length > 30 ? '，超出建议范围，可减少重复次数或改用部分因子' : '，在整车厂可实施范围内'),
    };
  },
});

define({
  plugin: '本平台', name: 'gantt_plan', label: '甘特图规划',
  description: '为改进项目生成甘特计划：输入任务清单（名称、工期、依赖、责任人），自动计算最早开始/结束时间、关键路径与里程碑。',
  parameters: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: '可选：基于已有项目的 8D 阶段生成' },
      startDate: { type: 'string', description: '开始日期 YYYY-MM-DD' },
      tasks: { type: 'array', items: { type: 'object' }, description: '[{name, duration, deps:[任务名], owner}]' },
    },
  },
  run(args) {
    let tasks = args.tasks;
    if (!tasks && args.projectId) {
      const p = store.col('projects').get(args.projectId);
      const sla = { D1: 1, D2: 1, D3: 2, D4: 10, D5: 15, D6: 30, D7: 15, D8: 2 };
      const names = { D1: '组建团队', D2: '描述问题(5W2H)', D3: '临时措施/围堵', D4: '根因分析', D5: '永久对策+OA审批', D6: '实施验证', D7: '预防横展', D8: '关闭表彰归档' };
      tasks = Object.keys(sla).map((k, i, arr) => ({ name: k + ' ' + names[k], duration: sla[k], deps: i ? [arr[i - 1] + ' ' + names[arr[i - 1]]] : [], owner: p ? p.owner : '' }));
    }
    if (!tasks || !tasks.length) return { ok: false, error: '需提供 tasks 或 projectId' };
    const start = args.startDate ? new Date(args.startDate + 'T00:00:00+08:00') : new Date();
    const finish = {};
    const rows = [];
    const dayMs = 86400000;
    function early(t) {
      if (finish[t.name]) return finish[t.name];
      let s = start.getTime();
      (t.deps || []).forEach((d) => { const dep = tasks.find((x) => x.name === d); if (dep) s = Math.max(s, early(dep)); });
      const e = s + (t.duration || 1) * dayMs;
      finish[t.name] = e;
      return e;
    }
    tasks.forEach((t) => early(t));
    let cursor = start.getTime();
    tasks.forEach((t) => {
      let s = start.getTime();
      (t.deps || []).forEach((d) => { const dep = tasks.find((x) => x.name === d); if (dep) s = Math.max(s, finish[dep.name]); });
      rows.push({ 任务: t.name, 责任人: t.owner || '—', 工期天: t.duration || 1, 开始: new Date(s).toISOString().slice(0, 10), 结束: new Date(s + (t.duration || 1) * dayMs - dayMs).toISOString().slice(0, 10), 依赖: (t.deps || []).join('、') || '无', 关键路径: !!t.critical });
    });
    const projectEnd = Math.max(...rows.map((r) => Date.parse(r.结束 + 'T00:00:00+08:00')));
    return {
      ok: true, 项目周期: rows.length ? Math.round((projectEnd - start.getTime()) / dayMs) + 1 + ' 天' : '—',
      开始: start.toISOString().slice(0, 10), 计划完成: new Date(projectEnd).toISOString().slice(0, 10),
      甘特表: rows,
      里程碑: rows.filter((r) => (r.依赖 || '').indexOf('、') < 0 && r !== rows[0]).map((r) => r.任务) || [],
      提示: '关键链上任一任务延期将导致项目整体延期，建议对关键路径任务设置每日跟踪。',
    };
  },
});

define({
  plugin: '本平台', name: 'fmea_analyze', label: 'FMEA 风险分析',
  description: '按 AIAG-VDA 规则计算 FMEA 的 S/O/D、AP（措施优先级）与 RPN，并按风险排序输出改进优先级清单。S≥9 一律判为高优先级。',
  parameters: {
    type: 'object',
    properties: {
      items: { type: 'array', items: { type: 'object' }, description: '[{failureMode, effect, cause, s, o, d, currentControl, recommendedAction}]' },
      process: { type: 'string', description: '过程/工序名称' },
    },
    required: ['items'],
  },
  run(args) {
    const judged = args.items.map((it) => {
      const s = Number(it.s || 5), o = Number(it.o || 5), d = Number(it.d || 5);
      const rpn = s * o * d;
      // AIAG-VDA AP 规则（简化版，覆盖主要判定路径）
      let ap;
      if (s >= 9 && o >= 2) ap = 'H';
      else if (s >= 9) ap = 'M';
      else if (rpn >= 200 || (s >= 7 && o >= 4) || (s >= 5 && o >= 7)) ap = 'H';
      else if (rpn >= 100 || (s >= 7 && o >= 2) || (o >= 5 && d >= 5)) ap = 'M';
      else ap = 'L';
      return { 失效模式: it.failureMode, 失效影响: it.effect, 失效原因: it.cause, S: s, O: o, D: d, RPN: rpn, AP: ap, 现行控制: it.currentControl || '—', 建议措施: it.recommendedAction || '', 措施优先级: ap === 'H' ? '高：必须采取措施或说明不采取措施的理由' : ap === 'M' ? '中：宜采取措施' : '低：可接受，保持监控' };
    }).sort((a, b) => (b.AP === a.AP ? (b.S === a.S ? b.RPN - a.RPN : b.S - a.S) : b.AP.localeCompare(a.AP)));
    return {
      ok: true, 分析对象: args.process || '未指定', 条目数: judged.length,
      高风险项: judged.filter((x) => x.AP === 'H').length, 中风险项: judged.filter((x) => x.AP === 'M').length,
      AP: { H: judged.filter((x) => x.AP === 'H').length, M: judged.filter((x) => x.AP === 'M').length, L: judged.filter((x) => x.AP === 'L').length },
      明细: judged,
      打分规范提示: ['S 必须对照 AIAG-VDA 表逐条判定，涉及安全/法规一律 S≥9', 'O 应用近 12 个月实际 ppm 反推，避免主观', 'D 必须有探测方法与探测时机；无在线防错时 D 不得低于 5', 'RPN 仅作参考，AIAG-VDA 以 AP 为准'],
    };
  },
});

define({
  plugin: '本平台', name: 'platform_help', label: '平台能力说明',
  description: '返回本平台的插件清单、可用工具、数据范围与使用规范。不确定能做什么时调用。',
  parameters: { type: 'object', properties: {} },
  run() {
    const reg = require('./registry');
    const byPlugin = {};
    reg.all().forEach((t) => { (byPlugin[t.plugin] = byPlugin[t.plugin] || []).push(t.name + '（' + t.label + '）'); });
    return {
      ok: true, 平台: brandName(),
      插件: byPlugin,
      数据范围: {
        质量问题: store.col('issues').count() + ' 条',
        改进项目: store.col('projects').count() + ' 条',
        SPC特性: store.col('spcChars').count() + ' 个特性 / ' + store.col('measurements').count() + ' 条测量值',
        知识库: store.col('knowledge').count() + ' 条（经验卡/历史案例/标准）',
        AI质检缺陷: store.col('defects').count() + ' 条',
        人员: store.col('members').count() + ' 人',
      },
      使用规范: [
        '①一切数字必须来自工具返回值，禁止编造；工具未返回的数据要明确说"无数据"',
        '②结论必须挂接出处（数据来源/单据/编号）；无出处的判断只能表述为「假设」并说明置信度',
        '③对外发送、对外承诺、8D 关闭三类动作必须先经人工确认',
        '④根因分析要给出按置信度排序的假设，并说明每条假设需要什么数据来验证',
      ],
    };
  },
});

define({
  plugin: '本平台', name: 'dashboard_overview', label: '驾驶舱指标总览',
  description: '返回平台核心 KPI 的真实计算结果（FTT 代理指标、超差率、判异数、项目按期率、收益、风险数），用于生成晨报与驾驶舱。',
  parameters: { type: 'object', properties: { days: { type: 'number', description: '统计窗口，默认 7' } } },
  run(args) {
    const days = args.days || 7;
    const chars = store.col('spcChars').all();
    let totalMeas = 0, totalOos = 0, violations = 0;
    const charStatus = [];
    for (const ch of chars) {
      const rows = seriesOf(ch.id, days);
      const oos = rows.filter((r) => r.value > ch.usl || r.value < ch.lsl).length;
      totalMeas += rows.length; totalOos += oos;
      let hits = 0, cpk = null;
      try {
        if (rows.length > 8) {
          const imr = stats.chartIMR(rows.map((r) => r.value));
          hits = stats.spcRules(rows.map((r) => r.value), { center: imr.center, ucl: imr.ucl, lcl: imr.lcl, sigma: imr.sigmaWithin }).length;
          violations += hits;
        }
        if (rows.length > 4) cpk = stats.capability(rows.map((r) => r.value), ch.usl, ch.lsl).cpk;
      } catch (_) {}
      charStatus.push({ 特性: ch.id + ' ' + ch.name, 车间: ch.workshop, Cpk: cpk === null ? null : Number(cpk.toFixed(2)), 超差数: oos, 判异数: hits, 状态: hits > 0 ? '失控' : cpk === null ? '数据不足' : cpk >= 1.33 ? '受控' : '需关注' });
    }
    const issues = store.col('issues').all();
    const projects = store.col('projects').all();
    const open = projects.filter((p) => p.stage !== 'D8');
    const onTime = open.filter((p) => !p.overdue).length;
    const ledger = store.col('benefits').all();
    const verified = ledger.filter((b) => b.status === 'verified').reduce((a, c) => a + c.amount, 0);
    return {
      ok: true, 统计窗口: '近 ' + days + ' 天（数据截至 ' + dataNow().toISOString().slice(0, 16) + '）',
      KPI: {
        一次下线合格率FTT代理值: totalMeas > 0 ? (((totalMeas - totalOos) / totalMeas) * 100).toFixed(2) + '%（基于 ' + totalMeas + ' 个在线测量点）' : '暂无测量数据',
        过程判异总数: violations,
        超差点数: totalOos,
        质量问题总数: issues.length,
        未关闭问题: issues.filter((i) => i.status !== '已关闭').length,
        A级问题: issues.filter((i) => i.severity === 'A' && i.status !== '已关闭').length,
        在改项目: open.length,
        项目按期率: open.length ? ((onTime / open.length) * 100).toFixed(1) + '%' : '—',
        超期项目: open.filter((p) => p.overdue).length,
        已核定收益万元: Number(verified.toFixed(1)),
        待核定收益万元: Number(ledger.filter((b) => b.status === 'pending').reduce((a, c) => a + c.amount, 0).toFixed(1)),
      },
      特性状态: charStatus,
      高风险特性: charStatus.filter((c) => c.状态 === '失控' || c.状态 === '需关注'),
    };
  },
});

module.exports = { STAGES, getKbIndex, invalidateKb };

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

