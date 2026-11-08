'use strict';
/**
 * 体系文件（中小型企业版）：调研表 → 质量手册 / 程序文件的生成逻辑。
 * 设计原则：接了模型就让模型写；没接模型就用内置模板生成骨架，绝不假装是 AI 写的。
 * 所有输出都是 Markdown 文本，前端负责渲染与下载。
 */

const CERT_NAME = { IATF16949: 'IATF 16949:2016', ISO9001: 'ISO 9001:2015', ISO14001: 'ISO 14001:2015', ISO45001: 'ISO 45001:2018' };

function s(v, dflt) {
  const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return t || (dflt === undefined ? '' : dflt);
}
function arr(v) { return Array.isArray(v) ? v.filter((x) => String(x == null ? '' : x).trim()) : []; }

/** 把调研表整理成生成用的「要点摘要」 */
function brief(sv) {
  sv = sv || {};
  const certs = arr(sv.certs).map((c) => CERT_NAME[c] || c);
  const orgs = arr(sv.orgs).map((o) => `${s(o.dept, '相关部门')}（${s(o.duty)}${o.owner ? '，负责人 ' + s(o.owner) : ''}）`);
  const products = s(sv.products, '公司主导产品');
  return {
    company: s(sv.company, '本公司'),
    cert: certs.length ? certs.join(' + ') : 'ISO 9001:2015',
    certShort: arr(sv.certs)[0] || 'ISO9001',
    products,
    scale: {
      staff: Number(sv.staff || 0) || null,
      tech: Number(sv.techStaff || 0) || null,
      area: s(sv.area), building: s(sv.building),
      customers: s(sv.customers),
      equipment: s(sv.equipment),
    },
    leaders: {
      chairman: s(sv.chairman), legal: s(sv.legalRep), gm: s(sv.gm), deputy: s(sv.deputyGm), rep: s(sv.mgmtRep),
      office: s(sv.certOffice), auditors: s(sv.auditors), team: s(sv.teamMembers),
    },
    orgs,
    policy: s(sv.policy), objective: s(sv.objective), purpose: s(sv.mission),
    plan: { date: s(sv.certDate), phase1: s(sv.phase1Date), weekend: s(sv.weekend), design: s(sv.design) },
    contact: { person: s(sv.contactPerson), phone: s(sv.contactPhone), addr: s(sv.addr), tel: s(sv.tel), fax: s(sv.fax) },
  };
}

function chapterList(b) {
  const iso = b.certShort === 'IATF16949' ? 'IATF 16949' : b.cert;
  return [
    ['1', '范围', `本手册适用于${b.company}${b.products ? '的' + b.products : ''}的设计开发、生产、检验与交付全过程，用于向客户及相关方证实本公司满足${iso}标准要求。`],
    ['2', '规范性引用文件', `${iso}；ISO 9000:2015《质量管理体系 基础和术语》；与产品相关的国家标准、行业标准及顾客特定要求。`],
    ['3', '术语和定义', '采用 ISO 9000:2015 的术语和定义；本公司内部使用的「不合格品」「让步接收」「首件确认」等术语见附录 A。'],
    ['4', '组织环境', `本公司识别了内外部环境因素与相关方需求（主要客户：${b.scale.customers || '见顾客清单'}）。质量管理体系范围见第 1 章，过程清单与相互关系见附录 B 过程关系图。`],
    ['5', '领导作用', `最高管理者${b.leaders.gm ? '（' + b.leaders.gm + '）' : ''}对质量管理体系有效性负责，管理者代表为${b.leaders.rep || '质量负责人'}。质量方针见第 5.2 条，职责与权限见《组织架构与职责说明》。`],
    ['6', '策划', '依据风险与机遇的评估结果制定质量目标（见 6.2），并规划变更管理。目标按部门分解，每月在质量例会上评审达成情况。'],
    ['7', '支持', '人员、基础设施、过程运行环境、监视和测量资源、组织知识按《人力资源与培训控制程序》《基础设施与设备管理程序》执行；成文信息按《文件与记录控制程序》管理。'],
    ['8', '运行', `从顾客要求评审、设计开发${b.plan.design === '无' ? '（本公司不承担设计开发，按顾客图纸生产）' : ''}、采购、生产与服务提供到放行与交付，各过程按对应程序文件执行，关键工序设质量控制点。`],
    ['9', '绩效评价', '通过顾客满意度调查、过程绩效指标、内部审核（每年至少一次）、管理评审（每年至少一次）评价体系绩效。'],
    ['10', '改进', '对不合格与顾客投诉采取纠正措施，运用 PDCA 与 QC 手法推动持续改进，改进结果纳入知识库。'],
  ];
}

/** 内置模板：质量手册 */
function manualTemplate(b) {
  const L = [];
  L.push(`# ${b.company}　质量手册`);
  L.push('');
  L.push(`> 依据 ${b.cert} 编制　|　版本 A/0　|　编制日期 ${new Date().toLocaleDateString('zh-CN')}`);
  L.push('');
  L.push('## 目录');
  chapterList(b).forEach(([no, name]) => L.push(`${no}. ${name}`));
  L.push('附录 A　术语与缩略语');
  L.push('附录 B　过程清单与过程关系图');
  L.push('附录 C　文件清单');
  L.push('');
  L.push('## 0 发布令');
  L.push('');
  L.push(`${b.company}依据 ${b.cert} 建立并实施质量管理体系。本手册阐述了本公司的质量方针、目标与各过程要求，是全体员工必须遵守的纲领性文件，自发布之日起执行。`);
  L.push('');
  L.push(`最高管理者：${b.leaders.gm || '＿＿＿＿'}　　日期：${b.plan.date || '＿＿＿＿'}`);
  L.push('');
  L.push('## 公司简介');
  L.push('');
  L.push(`${b.company}主要从事${b.products}的生产与销售${b.scale.staff ? `，现有员工 ${b.scale.staff} 人（其中管理技术人员 ${b.scale.tech || '若干'} 人）` : ''}${b.scale.area ? `，占地面积 ${b.scale.area} ㎡、建筑面积 ${b.scale.building || '—'} ㎡` : ''}。`);
  if (b.scale.equipment) L.push(`主要生产设备：${b.scale.equipment}。`);
  if (b.scale.customers) L.push(`主要客户：${b.scale.customers}。`);
  if (b.contact.addr) L.push(`地址：${b.contact.addr}${b.contact.tel ? '　电话：' + b.contact.tel : ''}${b.contact.fax ? '　传真：' + b.contact.fax : ''}`);
  L.push('');
  L.push('## 质量方针与目标');
  L.push('');
  L.push(`**公司宗旨**：${b.purpose || '以质量求生存，以改进求发展'}`);
  L.push('');
  L.push(`**质量方针**：${b.policy || '全员参与、过程受控、持续改进、顾客满意'}`);
  L.push('');
  L.push(`**质量目标**：${b.objective || '一次合格率 ≥ 98%；顾客投诉 ≤ 2 起/年；交付及时率 ≥ 98%；重大质量事故为 0'}`);
  L.push('');
  chapterList(b).forEach(([no, name, text]) => {
    L.push(`## ${no} ${name}`);
    L.push('');
    L.push(text);
    L.push('');
  });
  L.push('## 附录 A　术语与缩略语');
  L.push('');
  L.push('| 缩略语 | 全称 | 说明 |');
  L.push('| --- | --- | --- |');
  L.push('| CTQ | Critical To Quality | 关键质量特性 |');
  L.push('| SPC | Statistical Process Control | 统计过程控制 |');
  L.push('| QRQC | Quick Response Quality Control | 快速反应质量控制 |');
  L.push('| PDCA | Plan-Do-Check-Act | 戴明循环 |');
  L.push('| 8D | Eight Disciplines | 八步问题解决法 |');
  L.push('');
  L.push('## 附录 B　过程清单与过程关系图');
  L.push('');
  L.push('| 序号 | 过程名称 | 过程所有者 | 主要输入 | 主要输出 | 绩效指标 |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  const procs = [
    ['M1', '管理职责与策划', b.leaders.gm || '总经理', '公司战略、相关方要求', '方针目标、职责权限', '目标达成率'],
    ['M2', '内部审核与管理评审', b.leaders.rep || '管理者代表', '体系运行记录', '审核报告、评审决议', '不符合项关闭率'],
    ['C1', '顾客要求与合同评审', b.orgs.find((x) => x.indexOf('市场') >= 0) ? '市场部门' : '市场负责人', '顾客订单/图纸', '合同评审记录', '合同履约率'],
    ['C2', '采购与供应商管理', '采购负责人', '采购计划', '合格供方、来料', '来料合格率'],
    ['R1', '生产与服务提供', '生产负责人', '生产计划、物料', '合格产品', '一次合格率'],
    ['R2', '监视测量与放行', '质量负责人', '半成品、成品', '检验记录、放行单', '漏检率'],
    ['S1', '不合格品控制与改进', '质量负责人', '不合格品、投诉', '纠正措施、改进成果', '重复问题占比'],
    ['S2', '人力资源与培训', '综合管理负责人', '岗位要求', '培训记录、能力评价', '培训完成率'],
  ];
  procs.forEach((p) => L.push(`| ${p.join(' | ')} |`));
  L.push('');
  L.push('## 附录 C　文件清单');
  L.push('');
  L.push('| 层级 | 文件类别 | 示例 | 编制/审核 |');
  L.push('| --- | --- | --- | --- |');
  L.push('| 一级 | 质量手册 | 本手册 | 管理者代表 / 最高管理者 |');
  L.push('| 二级 | 程序文件 | 文件控制、记录控制、不合格品控制等 10 个 | 各部门 / 管理者代表 |');
  L.push('| 三级 | 作业指导书、检验规范 | 工序作业指导书、检验标准 | 技术/质量部门 |');
  L.push('| 四级 | 记录表单 | 检验记录、培训记录 | 使用部门 |');
  L.push('');
  L.push(`> 本手册由「${b.company}」体系文件模块生成${b.cert ? '' : ''}；首次建立体系时作为骨架，实施前请按实际流程复核。`);
  return L.join('\n');
}

/** 十个程序文件的骨架（中小型制造企业常用） */
const PROC_DEFS = [
  ['文件控制程序', '规定体系文件的编制、审批、发放、修订、作废与回收，确保现场使用有效版本。', ['文件管理员建立《受控文件清单》', '编制人起草，部门负责人审核，管理者代表批准', '发放时加盖「受控」章并登记签收', '修订须填《文件更改申请单》，旧版同步回收', '每年至少一次全面评审文件的适宜性']],
  ['记录控制程序', '规定质量记录的标识、贮存、保护、检索、保存期限与处置。', ['记录表单编号纳入《记录清单》', '记录须真实、及时、字迹清晰，不得涂改', '按类别归档，纸质与电子记录分别设保管人', '保存期限一般不少于 3 年（法规/顾客另有要求从其规定）', '到期销毁需经管理者代表批准并登记']],
  ['管理评审程序', '规定管理评审的策划、输入、输出与跟踪，确保体系持续适宜有效。', ['每年至少一次，由最高管理者主持', '输入包含审核结果、顾客反馈、过程绩效、纠正措施状况等', '输出形成《管理评审报告》与改进决定', '决议事项分解为任务，明确责任人与完成期限', '下次评审时复核上次决议落实情况']],
  ['内部审核程序', '规定内审的策划、实施、报告与不符合项跟踪。', ['年初编制年度内审计划，覆盖全部过程', '组成审核组，内审员不审自己的工作', '编制检查表，现场收集客观证据', '开具《不符合项报告》，责任部门制定纠正措施', '跟踪验证关闭情况，形成内审报告']],
  ['不合格品控制程序', '规定不合格品的标识、隔离、评审、处置与再验证。', ['发现即挂红牌、移入隔离区并登记', '由质量部门组织评审：返工/返修/让步/报废', '返工返修后须重新检验', '让步接收须经顾客或授权人书面同意', '统计不合格数据，月度分析趋势']],
  ['纠正措施程序', '规定不合格（含顾客投诉）的原因分析、措施与有效性验证。', ['描述问题并量化影响（时间、数量、批次）', '采用 5Why/因果图定位根本原因', '制定临时措施与永久对策，明确责任人与期限', '实施后验证有效性（数据对比）', '有效措施纳入 SOP 与知识库，必要时横展']],
  ['采购与供应商控制程序', '规定供方选择、评价、再评价与采购过程的控制。', ['按重要度对供方分类，收集资质与样品验证', '建立《合格供方名录》，年度再评价', '采购文件写明规格、验收标准与追溯要求', '来料按检验规范抽检，异常启动供方反馈', '连续不良的供方降级或取消资格']],
  ['生产与服务提供控制程序', '规定生产计划、工序控制、首件确认、标识与追溯、防护与交付。', ['生产计划下达后确认物料、设备、工装状态', '首件检验合格后方可批量生产', '关键工序设置控制点，按作业指导书执行并记录', '产品标识清楚，批次可追溯', '包装防护与交付按顾客要求执行']],
  ['监视和测量资源控制程序', '规定测量设备的配备、校准、标识与失准处理。', ['建立《测量设备台账》，明确精度与校准周期', '按周期送检或内校，粘贴校准状态标识', '校准记录归档，不合格的停用并追溯已测产品', '新购设备验收合格后方可投入使用', '设备异常时评估对已交付产品的影响']],
  ['人力资源与培训控制程序', '规定岗位能力要求、招聘、培训与能力评价。', ['编制岗位说明，明确教育、技能与经验要求', '新人入职培训含安全、质量意识与岗位技能', '年度培训计划结合质量目标与问题短板制定', '培训后考核，记录归档并评价有效性', '一人多岗须具备对应岗位上岗资格']],
];

/** 内置模板：程序文件（返回数组，便于逐个下载） */
function procedureTemplates(b) {
  return PROC_DEFS.map(([title, purpose, steps], i) => {
    const code = 'QP-' + String(i + 1).padStart(2, '0');
    const L = [];
    L.push(`# ${title}（${code}）`);
    L.push('');
    L.push(`**适用单位**：${b.company}　|　**依据**：${b.cert}　|　**版本**：A/0`);
    L.push('');
    L.push('## 1 目的');
    L.push('');
    L.push(purpose);
    L.push('');
    L.push('## 2 适用范围');
    L.push('');
    L.push(`适用于${b.company}质量管理体系覆盖的${b.products}相关过程。`);
    L.push('');
    L.push('## 3 职责');
    L.push('');
    L.push(`- 管理者代表（${b.leaders.rep || '质量负责人'}）：批准本程序并监督执行`);
    L.push(`- ${b.orgs[0] || '质量部门'}：组织实施、检查与记录归档`);
    L.push('- 各相关部门：按本程序要求执行并保存记录');
    L.push('');
    L.push('## 4 工作流程');
    L.push('');
    steps.forEach((st, k) => L.push(`${k + 1}. ${st}`));
    L.push('');
    L.push('## 5 相关记录');
    L.push('');
    L.push(`- 本程序涉及的记录按《记录控制程序》编号、保存`);
    L.push(`- 记录保存期限：3 年（法规或顾客另有要求时从其规定）`);
    L.push('');
    L.push('## 6 相关文件');
    L.push('');
    L.push('- 质量手册');
    L.push('- 《文件控制程序》《记录控制程序》');
    L.push('');
    return { title, code, content: L.join('\n') };
  });
}

function manualPrompt(b) {
  return [
    '你是资深质量体系咨询师，为一家中小型制造企业编写 ISO 9001 / IATF 16949 质量手册。',
    '只输出 Markdown，不要解释、不要代码块围栏。结构必须包含：标题、目录、0 发布令、公司简介、质量方针与目标、第 1~10 章（范围/规范性引用文件/术语/组织环境/领导作用/策划/支持/运行/绩效评价/改进）、附录 A 术语、附录 B 过程清单表、附录 C 文件清单表。',
    '要求：紧扣给定企业信息（公司名、产品、规模、组织、方针目标、认证计划），不要编造未提供的事实；条文要能直接落地到中小企业，篇幅 1500~2500 字。',
    '【企业调研信息】',
    JSON.stringify(b, null, 2),
  ].join('\n');
}

function procedurePrompt(b) {
  return [
    '你是资深质量体系咨询师，为一家中小型制造企业编写体系程序文件。',
    '只输出 Markdown。共 10 个程序文件，用二级标题「## 文件名」分隔，每个包含：编号（QP-01…QP-10）、目的、适用范围、职责、工作流程（编号步骤）、相关记录、相关文件。',
    '十个文件：文件控制、记录控制、管理评审、内部审核、不合格品控制、纠正措施、采购与供应商控制、生产与服务提供控制、监视和测量资源控制、人力资源与培训。',
    '要求：步骤要具体可执行（谁、做什么、留下什么记录），贴合中小企业一人多岗的实际，不要照抄大企业条文。',
    '【企业调研信息】',
    JSON.stringify(b, null, 2),
  ].join('\n');
}

/** 把 AI 返回的多篇程序文件切成数组 */
function splitProcedures(md) {
  const text = String(md || '');
  const parts = text.split(/\n(?=##\s+)/).map((x) => x.trim()).filter(Boolean);
  return parts.map((chunk, i) => {
    const first = chunk.split('\n')[0].replace(/^#+\s*/, '').trim();
    const m = first.match(/^(.*?)[（(]?(QP[-\s]?\d+)?[）)]?$/);
    return { title: first.replace(/[（(].*?[）)]/g, '').slice(0, 40) || `程序文件 ${i + 1}`, code: 'QP-' + String(i + 1).padStart(2, '0'), content: chunk };
  });
}

module.exports = { brief, manualTemplate, procedureTemplates, manualPrompt, procedurePrompt, splitProcedures, CERT_NAME };
