'use strict';
/**
 * 中小型企业版初始数据
 * ------------------------------------------------------------------
 * 与「大中型企业版」不是同一套数据的缩小版，而是按中小制造企业的真实约束重做：
 *   · 组织：两个车间（冲压 / 装配）+ 3 人质量部，质量主管兼检验、工艺
 *   · 产品：2 个（1 内销 + 1 代工），无多平台车型矩阵
 *   · 数据量：特征 2 个（I-MR，60 点）、问题 48 起、课题 5 个、知识 16 条
 *   · 关注点：一次合格率、客户投诉、返工损失、点检与 QRQC 日清——而不是 Cpk 全套
 */
const { defaultSettings } = require('./seed');

const WS = ['一车间', '二车间'];
const PD = ['产品甲', '产品乙'];

const MEMBERS = [
  ['周建国', '质量主管', '质量管理', 12],
  ['陈立', '检验员（兼计量）', '来料检验', 8],
  ['刘畅', '巡检员', '过程巡检', 5],
  ['赵大勇', '一车间班长', '冲压', 15],
  ['孙鹏', '二车间班长', '装配', 11],
  ['王芳', '工艺工程师（兼质量）', '工艺', 9],
  ['李军', '设备维修', '设备', 14],
  ['钱伟', '采购员', '采购', 7],
  ['吴倩', '客服兼跟单', '客户', 4],
  ['郑小虎', '仓储', '来料仓储', 6],
  ['何静', '生产计划', '计划', 5],
  ['郭亮', '冲压操作工（兼改善提案）', '冲压', 3],
];

// 两个特征：I-MR，每个 60 点
const CHARS = [
  { id: 'CT-A01', name: '产品甲 外径尺寸', model: '产品甲', workshop: '一车间', station: '一车间·冲压线', nominal: 12.0, usl: 12.12, lsl: 11.88, unit: 'mm', mu: 12.004, sd: 0.021, seed: 20261001 },
  { id: 'CT-B02', name: '产品乙 螺纹扭矩', model: '产品乙', workshop: '二车间', station: '二车间·装配线', nominal: 18.0, usl: 22.0, lsl: 14.0, unit: 'N·m', mu: 17.8, sd: 1.15, seed: 20261002 },
];

// 问题：来源以现场与来料为主，客户投诉单列
const ISSUE_TPL = [
  ['产品甲', '一车间', '一车间·冲压线', '外径超上限（12.14mm）', '现场', 'B', '零件与模具导柱间隙偏大，换模后首件未全检'],
  ['产品甲', '一车间', '一车间·冲压线', '冲压件毛刺超标', '现场', 'C', '模具刃口磨损，未按 5000 件周期刃磨'],
  ['产品甲', '一车间', '一车间·去毛刺工位', '去毛刺漏工序', '巡检', 'C', '工序卡未随流转箱，操作工凭经验判断'],
  ['产品乙', '二车间', '二车间·装配线', '螺纹扭矩低于 14N·m', '现场', 'B', '电动扳手扭矩未班前校验，电池衰减导致偏低'],
  ['产品乙', '二车间', '二车间·装配线', '装配漏装定位销', '现场', 'A', '定位销混料，工位缺防错与首件确认'],
  ['产品乙', '二车间', '二车间·终检', '终检漏检外观划伤', '巡检', 'C', '终检照明不足，抽检比例 10% 偏低'],
  ['产品甲', '来料', '一车间·来料区', '钢板来料厚度公差偏薄', '来料', 'B', '供应商换轧机未报备，入厂只测硬度未测厚度'],
  ['产品乙', '来料', '二车间·来料区', '外购螺栓强度不足', '来料', 'A', '供应商更换材料批次，未做材质证明复核'],
  ['产品乙', '来料', '二车间·来料区', '包装破损导致件表面划伤', '来料', 'C', '长途运输未加隔板，供应商包装标准陈旧'],
  ['产品甲', '客户', '一车间·成品仓', '客户投诉外径装配过盈', '客户', 'A', '出货前未按客户图纸核对关键尺寸'],
  ['产品乙', '客户', '二车间·成品仓', '客户反馈装配后异响', '客户', 'A', '螺栓扭矩下限波动，装机后松动'],
  ['产品甲', '客户', '一车间·成品仓', '客户投诉表面氧化', '客户', 'B', '梅雨季节成品库存防潮措施缺失'],
];

const PROJECTS = [
  ['#QP-S001', '产品乙 装配漏装定位销（A 级流出）', '产品乙', '二车间', '孙鹏', 'A', 'D5', 6, '定位销工位加装光电防错，首件双人确认'],
  ['#QP-S002', '产品乙 螺纹扭矩波动治理', '产品乙', '二车间', '陈立', 'B', 'D4', 12, '扳手每班校验 + 扭矩在线记录，抽检提至 20%'],
  ['#QP-S003', '产品甲 外径超上限（客户过盈）', '产品甲', '一车间', '赵大勇', 'A', 'D6', -2, '模具导柱更换，首件全检纳入作业指导书'],
  ['#QP-S004', '钢板来料厚度未检', '产品甲', '一车间', '钱伟', 'B', 'D7', 9, '入厂检验增加厚度千分尺测点，供应商换料须报备'],
  ['#QP-S005', '成品仓防潮改善（QC 小组课题）', '产品甲', '一车间', '王芳', 'C', 'D8', 3, '加装除湿机 + 库存先进先出看板，月度点检'],
];

const KNOWLEDGE = [
  ['经验卡', '冲压件毛刺快速判定与刃磨周期', '一车间', ['一车间', '模具'], 41],
  ['经验卡', '电动扳手扭矩班前校验三步法', '二车间', ['二车间', '装配'], 58],
  ['经验卡', '来料钢板厚度快检手法', '来料', ['来料', '检验'], 33],
  ['经验卡', '小批量多品种的首件确认清单', '工艺', ['工艺', '标准'], 76],
  ['历史案例', '定位销漏装的防错改造（低成本方案）', '二车间', ['二车间', '防错'], 64],
  ['历史案例', '客户投诉外径过盈的闭环复盘', '客户', ['客户', '冲压'], 29],
  ['历史案例', '梅雨季成品氧化处理', '一车间', ['一车间', '库存'], 22],
  ['标准', 'GB/T 2828.1 抽样检验速查（小批量）', '标准', ['标准'], 88],
  ['标准', '紧固件扭矩验收要求（客户特殊要求摘编）', '标准', ['标准', '客户'], 51],
  ['标准', '冲压件外观检验标准（自定）', '标准', ['标准', '一车间'], 47],
  ['方法', 'QC 七大手法在本厂的用法', '方法', ['方法', '培训'], 95],
  ['方法', '5Why + 鱼骨图做单件问题的根因', '方法', ['方法', '改进'], 72],
  ['方法', 'PDCA 周循环：班前 10 分钟碰头会', '方法', ['方法', '管理'], 61],
  ['方法', '改善提案一页纸模板', '方法', ['方法', '提案'], 39],
  ['培训', '新员工三日上岗培训（含安全）', '培训', ['培训', '上手'], 55],
  ['培训', '一人多岗矩阵与替岗演练', '培训', ['培训', '人员'], 26],
];

function rng(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function seedSme(store) {
  const now = new Date();
  const iso = (d) => d.toISOString();
  const dayAgo = (n, h) => new Date(now.getTime() - n * 86400000 + (h || 0) * 3600000);
  const stamp = (n) => String(n).padStart(4, '0');

  store.db.counters = { issue: 48, project: 5, qrqc: 18, workflow: 26, todo: 14, benefit: 6, report: 12, knowledge: 16, chat: 0, audit: 96, measurement: 0, spcChar: 2, member: 12, defect: 12 };
  store.db.settings = defaultSettings();
  const st = store.db.settings;
  st.org = Object.assign({}, st.org, {
    company: '某某精密制造有限公司',
    dept: '质量部',
    plant: '本厂（冲压 + 装配两个车间）',
    headcount: 12,
    contact: '周建国 · 质量主管',
  });
  st.naming = { company: '某某精密制造有限公司', dept: '质量部', workshops: WS.slice(), products: PD.slice() };
  store.db.meta.createdAt = iso(now);
  store.db.meta.scale = 'sme';

  // 人员
  MEMBERS.forEach((m, i) => {
    store.db.members.push({
      id: 'U-' + String(i + 1).padStart(3, '0'),
      name: m[0], role: m[1], dept: '质量部',
      group: m[2], years: m[3], avatar: m[0].slice(-2),
      skills: { '8D': 3 + (i % 3), '数据分析': 2 + (i % 3), '现场工艺': 4 + (i % 3), '沟通协调': 3, '标准法规': 2, 'AI应用': 2 },
      createdAt: iso(dayAgo(300)), updatedAt: iso(dayAgo(60)),
    });
  });

  // 特征与测量值（300 点 / 特征：每班 5 件、一天两班，近 30 天）
  let seq = 0;
  CHARS.forEach((c, ci) => {
    const rand = rng(c.seed);
    const values = [];
    const rows = [];
    const N = 300;
    for (let k = 0; k < N; k++) {
      seq++;
      let v = c.mu + gauss(rand) * c.sd + (k / N) * c.sd * 0.35; // 轻微趋势（刀具/夹具磨损）
      if (k === 270) v = ci === 0 ? c.usl + c.sd * 1.3 : c.lsl - c.sd * 1.1; // 同一天各出现 1 个超差点
      const value = Number(v.toFixed(c.unit === 'mm' ? 3 : 2));
      values.push(value);
      const ts = new Date(now.getTime() - (N - k) * 2.4 * 3600000); // 每 2.4 小时一点（≈ 每班 5 件）
      rows.push({
        id: 'MS-' + stamp(seq + 1),
        charId: c.id, charName: c.name, model: c.model, workshop: c.workshop, station: c.station,
        ts: ts.toISOString(), shift: k % 2 ? '夜班' : '白班',
        value, unit: c.unit, batch: 'B' + (20261000 + Math.floor(k / 20)),
        supplier: ci === 0 ? '宁波钢联' : '本地紧固件厂', operator: k % 2 ? '刘畅' : '陈立',
        vin: '', subgroup: k + 1, source: '人工录入',
      });
    }
    store.db.measurements.push(...rows);
    store.db.spcChars.push({
      id: c.id, name: c.name, model: c.model, workshop: c.workshop, station: c.station,
      nominal: c.nominal, usl: c.usl, lsl: c.lsl, unit: c.unit,
      subgroupSize: 1, ctq: true, controlMethod: 'I-MR',
      freq: '每班 5 件 / 手工录入', createdAt: iso(dayAgo(120)), updatedAt: iso(now),
      sampleCount: rows.length,
      series: values.map((v, k) => ({ ts: rows[k].ts, shift: rows[k].shift, values: [v], batch: rows[k].batch })),
    });
  });

  // 问题：48 起（模板循环 + 序号），A 5 / B 18 / C 25
  const sevPlan = [];
  for (let i = 0; i < 48; i++) sevPlan.push(i < 5 ? 'A' : i < 23 ? 'B' : 'C');
  let ai = 0;
  for (let i = 0; i < 48; i++) {
    const t = ISSUE_TPL[i % ISSUE_TPL.length];
    const sev = sevPlan[i];
    const closed = i % 5 !== 0;
    const created = dayAgo(closed ? 20 + (i % 40) : 1 + (i % 9), 9);
    const owner = MEMBERS[i % MEMBERS.length][0];
    store.db.issues.push({
      id: '#QI-S-' + stamp(101 + i),
      model: t[0], workshop: t[1], station: t[2], title: t[3],
      source: t[4], severity: sev, owner, aiSimilarity: 0.6 + ((i % 9) / 100),
      status: closed ? '已关闭' : (i % 7 === 0 ? '监控中' : '整改中'),
      description: t[6],
      createdAt: iso(created), updatedAt: iso(created),
      closedAt: closed ? iso(dayAgo(Math.max(1, 14 + (i % 20)), 16)) : null,
      projectId: null, tags: [], quantity: 1 + (i % 6),
      detectMethod: t[4] === '客户' ? '客户投诉转办（客服）' : t[4] === '来料' ? '来料检验记录' : '现场确认 / 巡检',
      rootCause: closed ? '已确认为' + t[6].slice(0, 12) + '…' : '',
      containment: closed ? '已实施临时措施并验证' : '',
      verifyResult: closed ? '连续两周无复发' : '',
      history: [{ ts: iso(created), user: owner, action: '发现问题', note: '来源：' + t[4] }],
    });
    ai++;
  }

  // 课题：5 个
  const stageOrder = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'];
  PROJECTS.forEach((p, i) => {
    const [id, title, model, ws, owner, sev, stage, scheduleDays, desc] = p;
    const issue = store.db.issues.find((x) => x.workshop === ws && x.model === model);
    if (issue) issue.projectId = id;
    const idx = stageOrder.indexOf(stage);
    const created = dayAgo(20 + i * 3, 10);
    const stages = {};
    stageOrder.forEach((s2, k) => {
      stages[s2] = { done: stage === 'D8' ? k <= idx : k < idx, at: k <= idx ? iso(dayAgo(Math.max(1, 20 + i * 3 - k * 2), 15)) : null, content: '' };
    });
    store.db.projects.push({
      id, title, issueId: issue ? issue.id : '', model, workshop: ws, owner, severity: sev, stage,
      stageIndex: idx, description: desc,
      createdAt: iso(created), updatedAt: iso(now),
      dueAt: iso(dayAgo(-scheduleDays, 17)),
      closedAt: stage === 'D8' ? iso(dayAgo(4, 11)) : null,
      overdue: scheduleDays < 0, overdueDays: Math.max(0, -scheduleDays),
      progress: Math.round(((idx + 0.5) / 8) * 100),
      team: [owner, '周建国', '王芳'],
      stages, d1: '', d2: '', d3: '', d4: '', d5: '', d6: '', d7: '', d8: '',
      verifyCount: 1, verifyTotal: 2,
      benefitEstimate: sev === 'A' ? 12 + i * 3 : 4 + i * 2,
      history: [{ ts: iso(created), user: owner, action: '立项', note: '来源问题 ' + (issue ? issue.id : '') }],
      aiDrafted: true, aiDraftRatio: 0.55,
    });
  });

  // QRQC：8 场（中小厂以班前会为主）
  for (let i = 0; i < 8; i++) {
    const d = dayAgo(i, 8);
    store.db.qrqc.push({
      id: 'QR-S-' + stamp(11 + i),
      level: i % 3 === 0 ? '厂级' : '车间级', workshop: WS[i % 2], model: PD[i % 2],
      topic: '昨日问题日清：' + ISSUE_TPL[i % ISSUE_TPL.length][3],
      attendees: 5 + (i % 4), problem: ISSUE_TPL[i % ISSUE_TPL.length][6],
      tempAction: '当班隔离 + 100% 复检', owner: MEMBERS[i % MEMBERS.length][0],
      responseHours: 1, dueHours: 24, status: i % 4 === 0 ? 'closed' : 'open',
      createdAt: iso(d), updatedAt: iso(d), location: WS[i % 2] + ' 班前会区',
      minutes: '', tasks: [], responseAt: iso(new Date(d.getTime() + 3600000)),
      closedAt: i % 4 === 0 ? iso(new Date(d.getTime() + 8 * 3600000)) : null,
    });
  }

  // 待办
  [['外径超上限首件确认', '赵大勇', 'A', 0], ['扳手扭矩校验记录补录', '陈立', 'B', 0],
    ['客户异响投诉回复草稿', '吴倩', 'A', 1], ['来料厚度测点新增确认', '钱伟', 'B', -1],
    ['QC 小组活动记录（本周）', '王芳', 'C', 0]].forEach((t, i) => {
    store.db.todos.push({
      id: 'TD-S-' + stamp(1 + i), user: t[1], title: t[0], priority: t[2], link: '',
      dueAt: iso(dayAgo(-t[3], 17)), done: false, createdAt: iso(dayAgo(1)), source: '本平台',
    });
  });

  // 审批（中小厂审批链短：质量主管 + 厂长）
  [['永久对策审批', '#QP-S002 扭矩波动 - 扳手校验纳入日常', '陈立', 'pending', '费用 ¥0.3 万，月度节省返工 ¥1.1 万。'],
    ['客户投诉闭环', '#QP-S001 定位销漏装 - 客户 8D 回复', '孙鹏', 'pending', '已回复客户，等待关闭确认。'],
    ['改善提案奖励', '郭亮：冲压废料分类回收提案', '赵大勇', 'approved', '月省废料处理费 ¥0.18 万，奖励 ¥300。']].forEach((w, i) => {
    const d = dayAgo(i, 10);
    store.db.workflows.push({
      id: 'OA-S-' + stamp(1 + i), type: w[0], title: w[1], applicant: w[2], status: w[3],
      relatedId: i === 0 ? '#QP-S002' : i === 1 ? '#QP-S001' : '', content: w[4],
      approvers: [{ name: '周建国', role: '质量主管', status: w[3] === 'pending' ? 'pending' : 'approved', at: w[3] === 'pending' ? null : iso(d) },
        { name: '厂长', role: '厂长', status: w[3] === 'approved' ? 'approved' : 'pending', at: w[3] === 'approved' ? iso(new Date(d.getTime() + 5400000)) : null }],
      createdAt: iso(d), updatedAt: iso(d), urgent: i === 0,
      aiSummary: '投入小、回收快，建议批准。',
    });
  });

  // 收益台账
  [['#QP-S005', '质量成本', 3.6, '2026-10', 'verified', '防潮改善后报废率由 2.1% 降至 0.6%'],
    ['#QP-S003', '报废降损', 9.4, '2026-11', 'pending', '外径过盈返工减少，按 12 个月摊销'],
    ['#QP-S002', '返工工时', 1.1, '2026-11', 'pending', '扭矩复检工时下降'],
    ['#QP-S004', '来料索赔', 2.2, '2026-10', 'verified', '供应商厚度超差索赔回收']].forEach((b, i) => {
    const p = store.db.projects.find((x) => x.id === b[0]) || {};
    store.db.benefits.push({
      id: 'BN-S-' + stamp(1 + i), projectId: b[0], projectTitle: p.title || '', type: b[1],
      amount: b[2], period: b[3], status: b[4], note: b[5],
      createdAt: iso(dayAgo(10 + i * 4)), updatedAt: iso(dayAgo(1)),
      formula: '收益 =（改善前损失 - 改善后损失）× 月产量', verifiedBy: b[4] === 'verified' ? '财务（兼）' : '',
      verifiedAt: b[4] === 'verified' ? iso(dayAgo(3)) : null, aiDriven: false,
    });
  });

  // 知识库
  KNOWLEDGE.forEach((k, i) => {
    store.db.knowledge.push({
      id: '#C-S-' + stamp(1 + i), type: k[0], title: k[1], category: k[2], tags: k[3], views: k[4],
      summary: k[1], content: '【' + k[0] + '】' + k[1] + '：本厂实操做法，详见现场作业指导书与点检表。',
      author: MEMBERS[i % MEMBERS.length][0], source: '本厂经验沉淀',
      createdAt: iso(dayAgo(20 + i * 3)), updatedAt: iso(dayAgo(2)), attachments: [], status: 'published',
    });
  });

  // AI 质检缺陷（中小厂用低成本视觉检测，量小）
  for (let i = 0; i < 12; i++) {
    store.db.defects.push({
      id: 'DF-S-' + stamp(1 + i), ts: iso(dayAgo(i % 6, 10 + i)),
      model: PD[i % 2], workshop: WS[i % 2], station: (i % 2 ? '二车间·装配线' : '一车间·冲压线'),
      type: i % 3 === 0 ? '外观-划伤' : i % 3 === 1 ? '尺寸-超差' : '装配-漏装',
      confidence: 0.81 + (i % 8) / 100, image: '', status: i % 4 === 0 ? '已确认' : '待复核',
      reviewer: MEMBERS[i % MEMBERS.length][0], note: 'AI 初判，需人工复核',
    });
  }

  // 审计
  for (let i = 0; i < 8; i++) {
    store.db.audit.push({
      id: 'AU-S-' + stamp(1 + i), ts: iso(dayAgo(i, 8)), user: ['周建国', '陈立', '刘畅', '王芳'][i % 4],
      plugin: ['本平台', '@MES', '知识库'][i % 3],
      action: ['查询测量数据', '控制图判异', '案例检索', '发起审批'][i % 4],
      params: {}, resultSummary: '初始审计记录', purpose: '初始数据初始化',
    });
  }

  store.saveSync(true);
  return {
    scale: 'sme',
    issues: store.db.issues.length,
    projects: store.db.projects.length,
    measurements: store.db.measurements.length,
    knowledge: store.db.knowledge.length,
    members: store.db.members.length,
  };
}

module.exports = { seedSme, SME_WORKSHOPS: WS, SME_PRODUCTS: PD };
