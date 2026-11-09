'use strict';
/**
 * 首次启动时灌入的初始数据（可在「系统设置 → 数据管理」中一键清空/重建）
 * ------------------------------------------------------------------
 * 设计原则：
 *  1. 数据内部自洽——SPC 判异能真的被 stats.js 检出，问题/项目/知识库互相引用；
 *  2. 与《功能清单与插件集成技术方案》业务口径一致（产品、车间、责任人、编号规则）；
 *  3. 确定性随机（mulberry32 固定种子），任何人任何时候重建都得到同一份数据。
 */

/* 确定性伪随机数生成器，保证初始数据可复现 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 标准正态（Box-Muller），用统一随机源保证可复现 */
function makeNormal(rnd) {
  let spare = null;
  return function () {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0, s = 0;
    do { u = rnd() * 2 - 1; v = rnd() * 2 - 1; s = u * u + v * v; } while (s === 0 || s >= 1);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    spare = v * m;
    return u * m;
  };
}

const MODELS = ['产品A', '产品B', '产品C'];
const WORKSHOPS = ['一车间', '二车间', '三车间', '四车间', '五车间'];
const SHIFTS = ['白班', '夜班'];
const SUPPLIERS = ['宁波华翔', '延锋内饰', '敏实集团', '宁德时代', '博世汽车', '拓普集团', '凌云股份', '均胜电子'];

/* 基准日期：与原型界面口径保持一致（2026-09-30 为数据日） */
// 数据基准日：首次灌库当天（重建初始数据时按当天重新生成），
// 这样近 7/14/30 日窗口、趋势图与 SLA 计时都跟真实当天对齐。
const DATA_DAY = (() => {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  return d;
})();

/* ------------------------------------------------------------------ */
/* 人员：质量改进部门 16 人 + 相关部门接口人                          */
/* ------------------------------------------------------------------ */
const MEMBERS = [
  { name: '陈伟', role: '科长', dept: '质量改进部门', seniority: 18, phone: '0851-8801-1001', skills: { '8D': 98, 数据分析: 92, 现场工艺: 95, 沟通协调: 90, 标准法规: 94, AI应用: 86 }, expert: ['三车间', '四车间', '市场质量'], canBeMentor: true },
  { name: '王磊', role: '主管工程师', dept: '质量改进部门', seniority: 9, phone: '0851-8801-1002', skills: { '8D': 88, 数据分析: 78, 现场工艺: 90, 沟通协调: 74, 标准法规: 82, AI应用: 80 }, expert: ['三车间', '一车间'] },
  { name: '李雪', role: '主管工程师', dept: '质量改进部门', seniority: 7, phone: '0851-8801-1003', skills: { '8D': 85, 数据分析: 90, 现场工艺: 76, 沟通协调: 82, 标准法规: 78, AI应用: 88 }, expert: ['四车间', '尺寸工程'] },
  { name: '张涛', role: '责任工程师', dept: '质量改进部门', seniority: 5, phone: '0851-8801-1004', skills: { '8D': 80, 数据分析: 72, 现场工艺: 84, 沟通协调: 70, 标准法规: 74, AI应用: 76 }, expert: ['二车间', '三电'] },
  { name: '陈浩', role: '责任工程师', dept: '质量改进部门', seniority: 4, phone: '0851-8801-1005', skills: { '8D': 76, 数据分析: 74, 现场工艺: 86, 沟通协调: 76, 标准法规: 70, AI应用: 82 }, expert: ['二车间', '一车间'] },
  { name: '刘婷', role: '责任工程师', dept: '质量改进部门', seniority: 4, phone: '0851-8801-1006', skills: { '8D': 78, 数据分析: 86, 现场工艺: 72, 沟通协调: 74, 标准法规: 76, AI应用: 84 }, expert: ['五车间', '三电'] },
  { name: '赵敏', role: '责任工程师', dept: '质量改进部门', seniority: 3, phone: '0851-8801-1007', skills: { '8D': 74, 数据分析: 68, 现场工艺: 80, 沟通协调: 82, 标准法规: 68, AI应用: 78 }, expert: ['四车间', '内饰'] },
  { name: '孙宇', role: '责任工程师', dept: '质量改进部门', seniority: 3, phone: '0851-8801-1008', skills: { '8D': 72, 数据分析: 70, 现场工艺: 82, 沟通协调: 66, 标准法规: 70, AI应用: 74 }, expert: ['一车间', '模具'] },
  { name: '周凯', role: '助理工程师', dept: '质量改进部门', seniority: 2, phone: '0851-8801-1009', skills: { '8D': 64, 数据分析: 62, 现场工艺: 70, 沟通协调: 62, 标准法规: 58, AI应用: 80 }, expert: ['三车间'] },
  { name: '吴迪', role: '助理工程师', dept: '质量改进部门', seniority: 2, phone: '0851-8801-1010', skills: { '8D': 62, 数据分析: 66, 现场工艺: 68, 沟通协调: 60, 标准法规: 56, AI应用: 82 }, expert: ['二车间'] },
  { name: '徐倩', role: '助理工程师', dept: '质量改进部门', seniority: 1, phone: '0851-8801-1011', skills: { '8D': 55, 数据分析: 58, 现场工艺: 60, 沟通协调: 64, 标准法规: 52, AI应用: 78 }, expert: ['四车间'] },
  { name: '黄睿', role: '助理工程师', dept: '质量改进部门', seniority: 1, phone: '0851-8801-1012', skills: { '8D': 52, 数据分析: 60, 现场工艺: 58, 沟通协调: 58, 标准法规: 50, AI应用: 76 }, expert: ['五车间'] },
  { name: '罗静', role: '助理工程师', dept: '质量改进部门', seniority: 1, phone: '0851-8801-1013', skills: { '8D': 50, 数据分析: 54, 现场工艺: 56, 沟通协调: 66, 标准法规: 54, AI应用: 74 }, expert: ['一车间'] },
  { name: '马超', role: '助理工程师', dept: '质量改进部门', seniority: 1, phone: '0851-8801-1014', skills: { '8D': 48, 数据分析: 52, 现场工艺: 62, 沟通协调: 56, 标准法规: 48, AI应用: 72 }, expert: ['四车间'] },
  { name: '秦岭', role: '助理工程师', dept: '质量改进部门', seniority: 1, phone: '0851-8801-1015', skills: { '8D': 46, 数据分析: 50, 现场工艺: 54, 沟通协调: 60, 标准法规: 46, AI应用: 70 }, expert: ['三车间'] },
  { name: '何佳', role: '助理工程师', dept: '质量改进部门', seniority: 1, phone: '0851-8801-1016', skills: { '8D': 45, 数据分析: 48, 现场工艺: 52, 沟通协调: 62, 标准法规: 50, AI应用: 68 }, expert: ['二车间'] },
  // 相关部门接口人（用于自动派工与团队组建推荐）
  { name: '杨帆', role: '四车间技术员', dept: '四车间', seniority: 12, phone: '0851-8802-2001', skills: { '8D': 70, 数据分析: 60, 现场工艺: 96, 沟通协调: 72, 标准法规: 66, AI应用: 60 }, expert: ['四车间'] },
  { name: '许强', role: '二车间技术员', dept: '二车间', seniority: 11, phone: '0851-8802-2002', skills: { '8D': 68, 数据分析: 58, 现场工艺: 95, 沟通协调: 70, 标准法规: 64, AI应用: 58 }, expert: ['二车间'] },
  { name: '彭勇', role: '工艺工程师', dept: '制造工程部', seniority: 14, phone: '0851-8803-3001', skills: { '8D': 82, 数据分析: 80, 现场工艺: 92, 沟通协调: 76, 标准法规: 78, AI应用: 66 }, expert: ['三车间', '尺寸工程'] },
];

/* ------------------------------------------------------------------ */
/* SPC 关键特性与真实测量序列                                            */
/* ------------------------------------------------------------------ */
const SPCS = [
  {
    id: 'CT-0378', name: '充电口盖与侧围间隙', model: '产品C', workshop: '四车间',
    station: '四车间三线·充电口盖安装', nominal: 3.5, usl: 4.0, lsl: 3.0, unit: 'mm',
    subgroupSize: 5, ctq: true, controlMethod: 'Xbar-R',
    // 失控剧本：末段连续下行并击穿下控制限
    fault: { type: 'trend-down', startOffset: -11, step: 0.055, extraLowAt: -1 },
  },
  {
    id: 'CT-0211', name: '面漆膜厚（左前门）', model: '产品A', workshop: '三车间',
    station: '三车间·面漆二线', nominal: 90, usl: 105, lsl: 75, unit: 'μm',
    subgroupSize: 5, ctq: true, controlMethod: 'Xbar-R',
    // 输漆泵速度下降导致膜厚缓慢下漂（AI 晨报中提到的判异）
    fault: { type: 'trend-down', startOffset: -18, step: 0.28 },
  },
  {
    id: 'CT-0155', name: '底盘悬置螺栓拧紧扭矩', model: '产品B', workshop: '四车间',
    station: '四车间二线·底盘合装', nominal: 45, usl: 50, lsl: 40, unit: 'N·m',
    subgroupSize: 5, ctq: true, controlMethod: 'Xbar-R', fault: { type: 'normal' },
  },
  {
    id: 'CT-0402', name: '侧围门框间隙面差', model: '产品A', workshop: '二车间',
    station: '二车间·侧围线', nominal: 0.5, usl: 1.0, lsl: 0, unit: 'mm',
    subgroupSize: 5, ctq: true, controlMethod: 'Xbar-R',
    // 波动放大（刀具/夹具磨损期的典型形态）
    fault: { type: 'drift-up', startOffset: -20, step: 0.006 },
  },
  {
    id: 'CT-0301', name: '电池模组绝缘电阻', model: '产品C', workshop: '五车间',
    station: '五车间·模组下线检测', nominal: 560, usl: 5000, lsl: 500, unit: 'MΩ',
    subgroupSize: 3, ctq: true, controlMethod: 'I-MR',
    // 绝缘电阻是单侧特性（只需 ≥500MΩ），上限取值仅作占位；
    // 过程波动由 sigma 单独给定，否则 (USL-LSL)/12 会被巨大的占位上限带偏。
    sigma: 22, fault: { type: 'occasional-low', prob: 0.05 },
  },
  {
    id: 'CT-0088', name: '侧围外板拉延件料厚', model: '产品A', workshop: '一车间',
    station: '一车间·A 线', nominal: 0.8, usl: 0.88, lsl: 0.72, unit: 'mm',
    subgroupSize: 4, ctq: true, controlMethod: 'Xbar-R', fault: { type: 'shift-up', startOffset: -15, delta: 0.03 },
  },
  {
    id: 'CT-0455', name: '前门锁扣装配位置度', model: '产品B', workshop: '四车间',
    station: '四车间一线·车门装配', nominal: 1.2, usl: 2.0, lsl: 0.4, unit: 'mm',
    subgroupSize: 5, ctq: false, controlMethod: 'Xbar-R', fault: { type: 'normal' },
  },
];

/**
 * 依据 fault 剧本生成一条时间序列（子组化）
 * @returns {Array<{ts:string, shift:string, values:number[], batch:string, operator:string}>}
 */
function buildSeries(spc, seed) {
  const rnd = mulberry32(seed);
  const normal = makeNormal(rnd);
  const subgroups = 60;            // 约 3 天一档，共 60 个子组
  const n = spc.subgroupSize;
  // 常规波动水平：优先用特性自带的 sigma（单侧特性必须显式给定），否则按公差带的 1/12 估
  const sigma = spc.sigma || (spc.usl - spc.lsl) / 12;
  const out = [];
  const batches = [];
  for (let b = 0; b < 12; b++) batches.push('B' + String(2500 + b).slice(1) + '-' + String(10 + b));
  for (let g = 0; g < subgroups; g++) {
    const t = new Date(DATA_DAY.getTime() - (subgroups - 1 - g) * 72 * 60 * 1000); // 每子组间隔 72 分钟
    const shift = t.getHours() >= 8 && t.getHours() < 20 ? '白班' : '夜班';
    let mu = spc.nominal;
    let sd = sigma;
    const f = spc.fault || {};
    if (f.type === 'trend-down' && g >= subgroups + f.startOffset) {
      mu -= (g - (subgroups + f.startOffset) + 1) * (f.step || 0.05);
    }
    if (f.type === 'drift-up' && g >= subgroups + f.startOffset) {
      sd = sigma * (1 + (g - (subgroups + f.startOffset)) * 0.06);
    }
    if (f.type === 'shift-up' && g >= subgroups + f.startOffset) {
      mu += f.delta || 0.02;
    }
    const values = [];
    for (let i = 0; i < n; i++) {
      let v = mu + normal() * sd;
      if (f.type === 'occasional-low' && rnd() < (f.prob || 0.03)) v = spc.lsl - Math.abs(normal()) * 12 - 3;
      values.push(Number(v.toFixed(spc.unit === 'μm' ? 1 : spc.unit === 'MΩ' ? 1 : 3)));
    }
    // 剧本要求：最后一个子组出现一点击穿下控制限
    if (f.extraLowAt && g === subgroups - 1) {
      values[values.length - 1] = Number((spc.lsl - sigma * 1.9).toFixed(3));
    }
    out.push({
      ts: t.toISOString(),
      shift,
      values,
      batch: batches[Math.floor(g / 5) % batches.length],
      operator: ['刘洋', '王强', '李娜', '陈明', '赵刚', '孙丽'][Math.floor(rnd() * 6)],
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 质量问题库（与原型一致 + 扩充，形成真实工作台）                        */
/* ------------------------------------------------------------------ */
const ISSUES = [
  ['#QI-2026-0412', '产品A', '三车间', '面漆二线', '左前门漆面颗粒（出口批次）', 'AI 质检', 'A', '王磊', 0.81, '整改中',
    'AI 视觉检测在 09-29 夜班出口批次中发现左前门漆面颗粒缺陷密度由 0.3 个/台升至 2.1 个/台，主要为 0.2~0.5mm 圆形凸起，集中出现在门板上沿 150mm 区域。'],
  ['#QI-2026-0411', '产品C', '四车间', '四车间三线', '充电口盖间隙超差 3.4%', 'MES', 'A', '李雪', 0.87, '整改中',
    '近 7 日充电口盖与侧围间隙测量值超标 43/1247 条（3.4%），SPC 判异：连续 6 点下行趋势并击穿下控制限，失控始于 09-28 夜班。'],
  ['#QI-2026-0409', '产品B', '四车间', '四车间二线', '驱动电机高频啸叫（加速段）', '市场', 'B', '张涛', 0.74, '整改中',
    '3MIS 客诉中 "加速时电机高频异响" 环比上升 12%，涉及产品集中在 2026-07 生产的产品B，转速 4200~4800rpm 区间明显。'],
  ['#QI-2026-0407', '产品A', '二车间', '侧围线', '门框间隙面差波动', 'MES', 'B', '陈浩', 0.69, 'QRQC 跟踪',
    '侧围门框 Y 向面差测量值标准差由 0.12mm 增大至 0.21mm，趋势持续 5 天，尚未超差但过程能力 Cpk 由 1.42 降至 1.02。'],
  ['#QI-2026-0405', '产品C', '五车间', '模组下线检测', '模组绝缘电阻偏低', '检验', 'A', '刘婷', 0.66, '整改中',
    '模组绝缘电阻检测出现 3 例低于 500MΩ 下限（最低 412MΩ），均来自同一批电芯，怀疑注液后干燥工序时间不足。'],
  ['#QI-2026-0403', '产品B', '四车间', '内饰线', '仪表台异响（粗糙路面）', '市场', 'C', '赵敏', 0.58, '监控中',
    '客户反馈粗糙路面行驶时仪表台右侧有轻微 "嗒嗒" 声，路试复现率约 30%，尚未定位到具体接触点。'],
  ['#QI-2026-0401', '产品A', '一车间', '一车间 A 线', '侧围外板拉延棱线开裂', '检验', 'B', '孙宇', 0.62, '整改中',
    '侧围外板后门上方拉延棱线出现微裂纹 5 件，板料减薄率实测 24%（标准 ≤20%），怀疑模具压边圈间隙调整不当。'],
  ['#QI-2026-0398', '产品C', '四车间', '四车间三线', '左 A 柱线束干涉异响', '现场', 'B', '陈浩', 0.83, '整改中',
    '左 A 柱线束支架与仪表台横梁间隙不足，颠簸路面产生干涉异响。3 个月内第 4 次发生，AI 判定为同构问题聚类。'],
  ['#QI-2026-0391', '产品A', '四车间', '四车间三线', '左 A 柱线束干涉', '现场', 'B', '陈浩', 0.83, '已关闭',
    '同上位置干涉问题，已更换支架形式并调整走向，QRQC 关闭。'],
  ['#QI-2026-0378', '产品A', '四车间', '四车间三线', '左 A 柱线束磨碰', '现场', 'C', '吴迪', 0.79, '已关闭',
    '线束与支架距离 <3mm，加装护套处理。'],
  ['#QI-2026-0355', '产品A', '四车间', '四车间三线', '左 A 柱异响', '现场', 'C', '吴迪', 0.76, '已关闭',
    '线束卡片脱落导致线束贴附钣金，重新卡接。'],
  ['#QI-2026-0396', '产品B', '三车间', '电泳线', '电泳漆缩孔', 'AI 质检', 'B', '周凯', 0.71, '已关闭',
    '电泳涂层出现零星缩孔，怀疑前处理脱脂槽液污染，已更换槽液后复检合格。'],
  ['#QI-2026-0394', '产品A', '二车间', '主焊线', '后地板焊点虚焊', 'MES', 'A', '张涛', 0.68, '已关闭',
    '焊点熔核直径不足 4mm 共 12 点，电极帽磨损导致，已更换电极帽并加严点检频次。'],
  ['#QI-2026-0392', '产品C', '五车间', '五车间装配线', '五车间上盖密封胶断胶', 'AI 质检', 'B', '黄睿', 0.64, '已关闭',
    '视觉检测发现密封胶轨迹有 2 处断点，胶枪压力波动导致，已加装压力监控。'],
  ['#QI-2026-0389', '产品B', '四车间', '四车间二线', '前门锁扣位置度超差', 'MES', 'C', '马超', 0.55, '已关闭',
    '前门锁扣位置度个别超差，夹具定位面有铁屑，清洁后恢复。'],
  ['#QI-2026-0386', '产品A', '一车间', '一车间 B 线', '翼子板回弹超差', '检验', 'B', '罗静', 0.60, '已关闭',
    '翼子板边缘回弹量超差 0.6mm，通过调整拉延筋阻力解决。'],
  ['#QI-2026-0383', '产品C', '四车间', '四车间三线', '充电口盖关闭力偏大', '现场', 'C', '徐倩', 0.57, '已关闭',
    '客户感知关闭力偏大，实测 42N（标准 ≤35N），调整锁扣弹簧后合格。'],
  ['#QI-2026-0380', '产品B', '三车间', '面漆一线', '清漆橘皮偏重', 'AI 质检',  'C', '秦岭', 0.52, '已关闭',
    '清漆长波值偏高，喷涂室温度偏低，调整后恢复。'],
  ['#QI-2026-0377', '产品A', '二车间', '侧围线', '侧围点焊飞溅', '现场', 'C', '何佳', 0.49, '已关闭',
    '点焊飞溅附着钣金，焊接参数电流偏大，优化参数后消除。'],
  ['#QI-2026-0374', '产品C', '五车间', '模组装配', '模组采样线束压接不良', '检验', 'B', '刘婷', 0.61, '已关闭',
    '采样线束压接拉力不足，压接模具磨损，更换模具后合格。'],
];

/* ------------------------------------------------------------------ */
/* 问题库扩量：按车间的典型缺陷模板批量生成（让问题库从 20 起扩到 200 起）    */
/* ------------------------------------------------------------------ */
const ISSUE_TPL = {
  '一车间': [
    ['侧围外板拉延棱线开裂', '一车间 A 线'], ['翼子板回弹超差', '一车间 B 线'], ['门内板起皱', '一车间 C 线'],
    ['顶盖成形开裂', '一车间 A 线'], ['后地板拉延减薄超差', '一车间 B 线'], ['A 柱加强板毛刺', '一车间 C 线'],
    ['门框内板尺寸超差', '一车间 A 线'], ['侧围料厚减薄率超标', '一车间 B 线'], ['行李箱盖成形回弹', '一车间 C 线'], ['前围板拉毛', '一车间 A 线'],
  ],
  '二车间': [
    ['后地板焊点虚焊', '二车间主焊线'], ['侧围点焊飞溅', '二车间侧围线'], ['门框间隙面差波动', '二车间侧围线'],
    ['焊点熔核直径偏小', '二车间主焊线'], ['侧围搭接间隙超差', '二车间侧围线'], ['白车身 Y 向偏差超差', '二车间调整线'],
    ['主焊线夹具定位偏移', '二车间主焊线'], ['车门总成焊点漏焊', '二车间车门线'], ['顶盖搭接处烧穿', '二车间主焊线'], ['装配线螺栓扭矩不足', '二车间调整线'],
  ],
  '三车间': [
    ['左前门漆面颗粒', '三车间面漆二线'], ['电泳漆缩孔', '三车间电泳线'], ['清漆橘皮偏重', '三车间面漆一线'],
    ['面漆膜厚下限超差', '三车间面漆二线'], ['车门边缘流挂', '三车间面漆一线'], ['漆面针孔', '三车间面漆二线'],
    ['色差超标（前后门）', '三车间面漆一线'], ['喷涂室颗粒污染', '三车间喷涂室'], ['裙边胶条鼓包', '三车间打胶线'], ['烘干后划伤（转运）', '三车间转运线'],
  ],
  '四车间': [
    ['充电口盖间隙超差', '四车间三线'], ['仪表台异响（粗糙路面）', '四车间内饰线'], ['左 A 柱线束干涉', '四车间三线'],
    ['前门锁扣位置度超差', '四车间二线'], ['驱动电机高频啸叫', '四车间二线'], ['车门关闭力偏大', '四车间三线'],
    ['底盘悬置螺栓扭矩未达标', '四车间二线'], ['内饰板卡扣脱落', '四车间内饰线'], ['座椅导轨异响', '四车间内饰线'], ['玻璃升降卡滞', '四车间三线'],
  ],
  '五车间': [
    ['模组绝缘电阻偏低', '五车间模组下线检测'], ['上盖密封胶断胶', '五车间装配线'], ['模组采样线束压接不良', '五车间模组装配'],
    ['PACK 气密性不合格', '五车间气密检测'], ['BMS 通讯偶发中断', '五车间下线检测'], ['铜排螺栓扭矩不足', '五车间装配线'],
    ['电芯焊接虚焊', '五车间模组装配'], ['液冷板泄漏', '五车间气密检测'], ['模组下线检测误判率偏高', '五车间下线检测'], ['PACK 铭牌信息错贴', '五车间包装线'],
  ],
};
const ISSUE_OWNERS = ['王磊', '李雪', '张涛', '陈浩', '刘婷', '赵敏', '孙宇', '周凯', '吴迪', '黄睿', '罗静', '马超', '徐倩', '秦岭', '何佳'];
const ISSUE_SOURCES = ['现场', 'MES', 'AI 质检', '检验', '市场'];
const ISSUE_SEV_POOL = ['B', 'B', 'C', 'B', 'A', 'C', 'B', 'C', 'B', 'A', 'C', 'B', 'C', 'B', 'C', 'B', 'A', 'C', 'B', 'C'];
const ISSUE_STATUS_POOL = ['已关闭', '已关闭', '整改中', '已关闭', '监控中', '整改中', '已关闭', 'QRQC 跟踪', '整改中', '已关闭'];

/** 生成扩容问题（在 seed 与运行期迁移中共用，保证同一批数据） */
function buildExpandedIssues(startNo, count, seedNo, nowMs) {
  const rnd = mulberry32(seedNo);
  const now = nowMs || Date.now();
  const out = [];
  for (let k = 0; k < count; k++) {
    const ws = WORKSHOPS[k % WORKSHOPS.length];
    const list = ISSUE_TPL[ws];
    const tpl = list[Math.floor(k / WORKSHOPS.length) % list.length];
    const title = tpl[0], station = tpl[1];
    const model = MODELS[Math.floor(rnd() * MODELS.length)];
    const source = ISSUE_SOURCES[Math.floor(rnd() * ISSUE_SOURCES.length)];
    const severity = ISSUE_SEV_POOL[Math.floor(rnd() * ISSUE_SEV_POOL.length)];
    const status = ISSUE_STATUS_POOL[Math.floor(rnd() * ISSUE_STATUS_POOL.length)];
    const owner = ISSUE_OWNERS[Math.floor(rnd() * ISSUE_OWNERS.length)];
    const days = status === '已关闭' ? 20 + Math.floor(rnd() * 70) : 1 + Math.floor(rnd() * 45);
    const created = new Date(now - days * 86400000 + (8 + Math.floor(rnd() * 10)) * 3600000);
    const cnt = 1 + Math.floor(rnd() * 9);
    const rate = (0.4 + rnd() * 3.4).toFixed(1);
    const desc = station + '近 7 日累计发现「' + title + '」' + cnt + ' 例，不良率 ' + rate + '%，' +
      (source === 'MES' ? '在线测量数据已触发趋势告警；' : source === 'AI 质检' ? 'AI 视觉复核确认缺陷形态一致；' : source === '市场' ? '售后工单与舆情均指向该部位；' : '现场确认并留存照片证据；') +
      '已通知班组长核对 4M 变化点，待补充批次追溯。';
    out.push({
      id: '#QI-2026-' + String(startNo + k).padStart(4, '0'),
      model, workshop: ws, station, title, source, severity, owner,
      aiSimilarity: Number((0.45 + rnd() * 0.45).toFixed(2)), status, description: desc,
      createdAt: created.toISOString(), updatedAt: created.toISOString(),
      closedAt: status === '已关闭' ? new Date(created.getTime() + (3 + Math.floor(rnd() * 12)) * 86400000).toISOString() : null,
      projectId: null, tags: [],
      history: [{ ts: created.toISOString(), user: owner, action: '发现问题', note: '来源：' + source }],
      detectMethod: source === 'AI 质检' ? 'AI 视觉检测（置信度 ' + (0.78 + rnd() * 0.18).toFixed(2) + '）' : source === 'MES' ? 'MES 在线测量' : source === '市场' ? '售后 DMS 工单 + 舆情' : '现场确认',
      quantity: cnt, rootCause: '', containment: '', verifyResult: '',
    });
  }
  return out;
}

/** 运行期一次性扩量：把已有实例的问题库扩到 10 倍（幂等，标记 meta.dataScaleIssues） */
function scaleupIssues(store, target) {
  const want = target || 200;
  const meta = store.db.meta || (store.db.meta = {});
  if (meta.dataScaleIssues === 10) return null;
  const have = (store.db.issues || []).length;
  if (have >= want - 20) { meta.dataScaleIssues = 10; return null; }
  const extra = buildExpandedIssues(420, want - have, 20261018);
  extra.forEach((doc) => store.db.issues.push(doc));
  meta.dataScaleIssues = 10;
  if (typeof store.touch === 'function') store.touch();
  return { added: extra.length, total: store.db.issues.length };
}

/* ------------------------------------------------------------------ */
/* 改进项目（8D 各阶段分布）                                             */
/* ------------------------------------------------------------------ */
/**
 * 改进项目种子数据
 * 字段顺序：[编号, 名称, 来源问题, 产品, 车间, 责任人, 等级, 阶段,
 *           距截止日天数(正=还有N天，负=已超期N天), 预留, 已完成的验证批次数, 描述]
 * 注意：只保留"距截止天数"一个时间字段，避免出现"截止日期在未来却显示超期"的矛盾数据。
 */
const PROJECTS = [
  ['#QP-0415', '产品A 左前门漆面颗粒（出口批次）', '#QI-2026-0412', '产品A', '三车间', '王磊', 'A', 'D2', 15, 0, 0,
    '出口批次漆面颗粒缺陷密度异常上升，需在 15 天内完成根因定位并恢复。'],
  ['#QP-0413', '产品B 前门锁异响', '#QI-2026-0389', '产品B', '四车间', '赵敏', 'B', 'D3', 12, 0, 0,
    '前门锁扣与锁舌配合间隙偏大导致颠簸路面异响，临时措施已导入产线。'],
  ['#QP-0377', '产品C 充电口盖间隙超差', '#QI-2026-0411', '产品C', '四车间', '李雪', 'A', 'D4', 0, 0, 0,
    '间隙超标 3.4%，SPC 判异连续下行。AI 根因假设：工装定位销磨损 P=0.72 / 供应商换批尺寸漂移 P=0.21 / 操作变异 P=0.07。今日 17:00 前需完成根因验证复核。'],
  ['#QP-0372', '产品B 驱动电机高频啸叫', '#QI-2026-0409', '产品B', '四车间', '张涛', 'B', 'D4', -3, 0, 0,
    '市场投诉环比上升，需定位 4200~4800rpm 区间异响源；已超期 3 天，升级厂级 QRQC。'],
  ['#QP-0369', '产品C 模组绝缘电阻偏低', '#QI-2026-0405', '产品C', '五车间', '刘婷', 'A', 'D5', -2, 0, 0,
    '绝缘电阻低于 500MΩ 下限，永久对策为延长干燥工序时间并增加在线监测；已超期 2 天。'],
  ['#QP-0365', '产品A 侧围外板拉延开裂', '#QI-2026-0401', '产品A', '一车间', '孙宇', 'B', 'D6', -1, 0, 2,
    '拉延棱线微裂纹，已调整压边圈间隙，正在采集 3 批验证数据；已超期 1 天。'],
  ['#QP-0351', '产品A 尾门间隙不均', '#QI-2025-0912', '产品A', '四车间', '陈浩', 'B', 'D7', 5, 0, 0,
    '尾门左右间隙差 1.2mm，已固化夹具调整方法并横展 5 个工位，接近关闭。'],
  ['#QP-0342', '产品B 空调出风异味', '#QI-2025-0888', '产品B', '四车间', '赵敏', 'C', 'D8', 0, 0, 0,
    '空调蒸发箱清洗工艺优化，异味投诉归零，收益 ¥8 万已核定。'],
  ['#QP-0340', '产品A 二车间点焊虚焊', '#QI-2026-0394', '产品A', '二车间', '张涛', 'A', 'D8', 0, 0, 0,
    '电极帽磨损导致熔核直径不足，已建立电极帽寿命管理，收益 ¥31 万。'],
  ['#QP-0338', '产品C 五车间密封胶断胶', '#QI-2026-0392', '产品C', '五车间', '黄睿', 'B', 'D6', 8, 0, 1,
    '胶枪压力波动导致轨迹断点，已加装压力闭环监控，正在采集验证数据。'],
  ['#QP-0335', '产品B 三车间电泳缩孔', '#QI-2026-0396', '产品B', '三车间', '周凯', 'B', 'D7', 6, 0, 0,
    '脱脂槽液污染，已更换槽液并建立槽液污染度日检，准备横展。'],
  ['#QP-0330', '产品A 翼子板回弹超差', '#QI-2026-0386', '产品A', '一车间', '罗静', 'B', 'D8', 0, 0, 0,
    '拉延筋阻力调整，回弹量控制在 0.3mm 内，收益 ¥14 万。'],
];

/* ------------------------------------------------------------------ */
/* 知识库：经验卡 / 历史案例 / 标准条款（真实质量工程内容）                 */
/* ------------------------------------------------------------------ */
const KNOWLEDGE = [
  { id: '#C-0231', type: '经验卡', category: '尺寸工程', model: '通用', title: '充电口盖间隙超差的快速排查顺序',
    problem: '充电口盖与侧围间隙批量超差，测量值波动或整体偏移。',
    cause: '按发生概率排序：①工装定位销磨损（占历史 42%）②口盖总成来料尺寸漂移 ③装配手法变异 ④侧围钣金件回弹。',
    action: '①用三坐标复测定位销实际尺寸并与图纸对比（重点看磨损量 >0.15mm）②同批次口盖抽检 30 件确认来料 ③切换定位销后连续测 50 台验证 ④固化到 SOS 并增加定位销月度点检。',
    effect: '历史 6 起同位置问题中 5 起通过更换定位销解决，平均停线时间 40min，一次修复率 83%。',
    tags: ['间隙', '面差', '充电口盖', '四车间', '定位销', '尺寸'], source: '陈伟（18年三车间/四车间经验）访谈转写', author: '陈伟', views: 218, refs: 6 },
  { id: '#C-0232', type: '经验卡', category: '三车间', model: '通用', title: '漆面颗粒缺陷的污染源定位方法',
    problem: '面漆出现颗粒（凸起）缺陷，密度突然上升。',
    cause: '①喷房送风过滤棉寿命到期 ②机器人雾化器积漆掉落 ③中涂打磨灰未吹净 ④输漆管路结皮脱落。',
    action: '①用透明胶带粘取颗粒做显微镜形貌判别（纤维=过滤棉/漆渣=管路结皮）②检查送风压差是否 >250Pa ③雾化器清洗周期由 72h 缩短至 48h ④增加中涂后吹净工位。',
    effect: '颗粒缺陷密度从 2.1 个/台降至 0.3 个/台，出口批次免于返修。',
    tags: ['漆面', '颗粒', '三车间', '面漆', '污染'], source: '王磊（9年三车间经验）访谈转写', author: '王磊', views: 186, refs: 4 },
  { id: '#C-0233', type: '经验卡', category: '扭紧', model: '通用', title: '螺纹副扭矩衰减的判定：曲线正常不代表结果正常',
    problem: '复检时扭矩低于标准下限，但拧紧枪记录的曲线完全正常。',
    cause: '①螺纹副摩擦系数变化（润滑剂批次差异）②被连接件存在间隙，拧紧后回弹 ③复检方法错误：复查时应先做标记法而非直接复拧。',
    action: '①核对润滑剂批次并抽检摩擦系数 ②用残余扭矩法（标记法）复检，不得直接复拧 ③对异常工位做 24h 后扭矩衰减跟踪（衰减 >10% 即判不合格）。',
    effect: '底盘 4 工位扭矩衰减误判率从 15% 降至 2%。',
    tags: ['扭矩', '拧紧', '四车间', '底盘', '衰减'], source: '彭勇（14年工艺）访谈转写', author: '彭勇', views: 154, refs: 3 },
  { id: '#C-0234', type: '经验卡', category: '焊接', model: '通用', title: '虚焊的三步确认法',
    problem: '焊点外观正常但强度不足（虚焊）。',
    cause: '①电极帽磨损导致接触面增大、电流密度下降 ②板件间隙过大导致分流 ③焊机二次回路阻抗增大。',
    action: '①每 200 点做一次熔核剥离检查（撬棒法）②电极帽直径超过初始值 +1.5mm 即更换 ③每周测一次二次回路阻抗 ④用焊接监控仪看动态电阻曲线是否出现"过早平台"。',
    effect: '虚焊流出率由 0.8‰ 降至 0.05‰。',
    tags: ['二车间', '点焊', '虚焊', '电极帽', '熔核'], source: '许强（11年二车间）访谈转写', author: '许强', views: 132, refs: 5 },
  { id: '#C-0235', type: '经验卡', category: '三电', model: '产品C', title: '模组绝缘电阻偏低的排查路径',
    problem: '模组下线绝缘电阻低于 500MΩ。',
    cause: '①注液后干燥（老化）时间不足，电解液残留 ②模组壳体毛刺刺穿绝缘膜 ③采样线束压接处有金属屑 ④环境湿度 >65%RH 时测量值偏低。',
    action: '①先确认测量环境湿度（>65%RH 需修正）②拆解检查绝缘膜有无刺穿点 ③干燥工序时间由 8h 延长至 12h ④增加模组内部金属屑吹扫并做清洁度检测。',
    effect: '偏低比例由 0.24% 降至 0.03%，年减少报废 ¥42 万。',
    tags: ['绝缘电阻', '五车间', '模组', '三电', '干燥'], source: '刘婷（4年三电经验）访谈转写', author: '刘婷', views: 98, refs: 2 },
  { id: '#C-0236', type: '经验卡', category: '一车间', model: '通用', title: '拉延件开裂的六要素排查',
    problem: '拉延件圆角或棱线处开裂。',
    cause: '①压边力过大 ②凹模圆角过小（R<3t）③板料n值/r值批次波动 ④润滑不足 ⑤模具磨损 ⑥板料厚度负偏差。',
    action: '①先量减薄率（>20% 即风险）②检查压边圈垫片是否松动 ③比对板料批次力学性能报告 ④用拉延筋阻力调整替代调压边力。',
    effect: '开裂率从 1.2% 降至 0.15%。',
    tags: ['一车间', '拉延', '开裂', '模具', '减薄率'], source: '孙宇（3年一车间/模具）访谈转写', author: '孙宇', views: 121, refs: 3 },
  { id: '#C-0237', type: '经验卡', category: '异响', model: '通用', title: '整车异响的分区隔离法',
    problem: '颠簸路面异响，难以定位声源。',
    cause: '常见声源：①线束与钣金干涉 ②卡扣脱落 ③内饰件摩擦 ④焊点脱开 ⑤座椅骨架。',
    action: '①先做"贴胶带隔离法"：对可疑接触点贴绒布胶带逐个排除 ②用听诊器沿路径分段确认 ③举升机下用橡胶锤敲击复现 ④确认后加装护套/绒布并横展同平台产品。',
    effect: '异响类问题平均定位时间由 3.5 天缩短至 0.5 天。',
    tags: ['异响', '四车间', '线束', 'NVH'], source: '杨帆（12年四车间）访谈转写', author: '杨帆', views: 167, refs: 7 },
  { id: '#C-0238', type: '经验卡', category: '尺寸工程', model: '通用', title: '尺寸问题的"三坐标 + 检具 + 蓝光"三件套取证法',
    problem: '尺寸超差需要快速判断是单件问题还是四车间累积问题。',
    cause: '单件超差、夹具定位偏差、装配累积公差三类原因表现相似。',
    action: '①单件上检具（快速判定来料）②三坐标测关键特征（判定模具/夹具）③蓝光扫描整车（判定累积与匹配）④三者数据叠加到同一坐标系做偏差向量分析。',
    effect: '尺寸类根因定位一次命中率由 55% 提升至 86%。',
    tags: ['尺寸', '三坐标', '蓝光', '检具', '公差'], source: '彭勇（14年尺寸工程）访谈转写', author: '彭勇', views: 143, refs: 5 },
  { id: '#C-0239', type: '经验卡', category: '三车间', model: '通用', title: '电泳缩孔的槽液排查清单',
    problem: '电泳涂层出现缩孔（火山口状）。',
    cause: '①前处理脱脂不净，油污残留 ②槽液被硅油/防锈油污染 ③磷化膜异常 ④烘干室落尘。',
    action: '①测脱脂槽液油含量（>3g/L 需排油）②做槽液表面张力测试 ③检查前工序是否使用了含硅离型剂 ④必要时倒槽更新 30% 槽液。',
    effect: '缩孔缺陷由 5 件/批降至 0，年节约返工 ¥18 万。',
    tags: ['电泳', '缩孔', '三车间', '槽液', '前处理'], source: '周凯（2年三车间经验）访谈转写 + 王磊复核', author: '周凯', views: 76, refs: 2 },
  { id: '#C-0240', type: '经验卡', category: '质量管理', model: '通用', title: '质量问题定级的"三看"准则',
    problem: '问题等级定不准，导致资源分配失衡。',
    cause: '定级随意、只看数量不看风险。',
    action: '三看：①看安全/法规（涉及安全一律 A 级）②看流出风险（是否已流出到市场/客户）③看批量（潜在影响台数 >500 台升一级）。A 级 24h 响应并升级厂级 QRQC，B 级 48h，C 级纳入周度跟踪。',
    effect: 'A 级问题 2h 响应率 96.3%，无重大流出事件。',
    tags: ['定级', 'QRQC', '流程', '风险'], source: '陈伟（科长）管理经验', author: '陈伟', views: 205, refs: 8 },
  { id: '#C-0241', type: '历史案例', category: '尺寸工程', model: '产品C', title: '2024 款同位置充电口盖间隙问题（工装定位销磨损）',
    problem: '2024 款产品充电口盖间隙连续 8 点下行并击穿下控制限。',
    cause: '定位销材料硬度不足（HRC 52），在夜班高产时段温升导致磨损加速，累计 3 个月磨损 0.22mm。',
    action: '更换为 HRC 60 硬质合金定位销，并将月度点检改为双周点检。',
    effect: '间隙 Cpk 由 0.87 提升至 1.68，一年未复发。',
    tags: ['充电口盖', '间隙', '定位销', '历史案例', '相似度0.87'], source: '故障案例库 #QI-2024-0988', author: '李雪', views: 92, refs: 4, similarity: 0.87 },
  { id: '#C-0242', type: '历史案例', category: '四车间', model: '产品A', title: '左 A 柱线束干涉同构问题（4 次重复发生）',
    problem: '左 A 柱线束支架与仪表台横梁间隙不足，颠簸路面干涉异响，3 个月内第 4 次发生。',
    cause: '支架形式未做设计变更，每次仅现场调整走向（临时措施），未做 D7 预防横展。',
    action: '升级为质量改进项目，从设计端变更支架 Z 向高度 +5mm，并横展到全部 5 个同平台工位。',
    effect: '横展后 6 个月零复发。',
    tags: ['线束干涉', '异响', 'A柱', '重复发生', '横展'], source: '故障案例库 #QI-2026-0398 聚类', author: '陈浩', views: 88, refs: 6, similarity: 0.83 },
  { id: '#C-0243', type: '历史案例', category: '三车间', model: '产品A', title: '出口批次漆面颗粒（送风过滤棉失效）',
    problem: '出口批次漆面颗粒缺陷密度突升。',
    cause: '喷房送风过滤棉超期使用 700h（标准 500h），压差 310Pa 未及时更换，纤维脱落附着湿膜。',
    action: '建立过滤棉压差在线监控 + 到期强制更换，并将压差纳入班组点检。',
    effect: '颗粒缺陷密度 2.1 → 0.3 个/台。',
    tags: ['漆面', '颗粒', '过滤棉', '三车间', '出口'], source: '故障案例库 #QI-2025-0771', author: '王磊', views: 71, refs: 3, similarity: 0.81 },
  { id: '#C-0244', type: '标准', category: '标准法规', model: '通用', title: 'GB/T 4091-2001 常规控制图八大判异准则',
    problem: '—',
    cause: '—',
    action: '准则1：1点落在A区之外；准则2：连续9点在中心线同侧；准则3：连续6点递增或递减；准则4：连续14点上下交替；准则5：连续3点中有2点在中心线同侧B区以外；准则6：连续5点中有4点在中心线同侧C区以外；准则7：连续15点在C区之内；准则8：连续8点在中心线两侧且无点在C区。',
    effect: '用于 SPC 智能判异模块的规则引擎实现依据。',
    tags: ['GB/T 4091', '控制图', '判异', '标准', 'SPC'], source: '国家标准全文公开系统', author: '标准化室', views: 341, refs: 12 },
  { id: '#C-0245', type: '标准', category: '标准法规', model: '通用', title: 'AIAG MSA-4 测量系统分析：GR&R 接受准则',
    problem: '—',
    cause: '—',
    action: '①%GRR <10%：测量系统可接受；②10%~30%：视应用重要性、成本、风险决定是否接受；③>30%：不可接受，必须改进。ndc（可区分类别数）应 ≥5。',
    effect: '用于 MSA 工具与量具验收判定。',
    tags: ['MSA', 'GRR', '量具', 'AIAG', '标准'], source: 'AIAG MSA 参考手册第 4 版', author: '标准化室', views: 288, refs: 9 },
  { id: '#C-0246', type: '标准', category: '标准法规', model: '通用', title: '过程能力指数判定准则（Cpk）',
    problem: '—',
    cause: '—',
    action: 'Cpk ≥1.67 优秀；1.33≤Cpk<1.67 良好（量产常规要求）；1.00≤Cpk<1.33 尚可但需改进；Cpk<1.00 过程能力不足，必须整改并 100% 检验。关键安全特性（CTQ/CC）要求 Cpk ≥1.67。',
    effect: '用于 SPC 模块自动给出整改建议。',
    tags: ['Cpk', '过程能力', '判定', '标准'], source: '企业质量手册 QM-2026 第 7.3 条', author: '标准化室', views: 312, refs: 11 },
  { id: '#C-0247', type: '标准', category: '标准法规', model: '通用', title: '8D 问题解决法各阶段交付物与 SLA 要求',
    problem: '—',
    cause: '—',
    action: 'D1 组建团队(24h)：团队名单+技能匹配；D2 描述问题(24h)：5W2H+量化数据；D3 临时措施(48h)：围堵方案+有效性验证；D4 根因分析(10日)：鱼骨图/5Why+数据取证+验证结论；D5 永久对策(15日)：对策+OA审批；D6 实施验证(30日)：验证数据+效果判定；D7 预防横展(15日)：横展清单+标准化；D8 关闭表彰：收益核定+归档。',
    effect: '平台据此自动计时并触发超期升级。',
    tags: ['8D', 'SLA', '阶段', '交付物', '标准'], source: '企业 8D 管理规定 QP-08-2026', author: '标准化室', views: 276, refs: 10 },
  { id: '#C-0248', type: '标准', category: '标准法规', model: '通用', title: 'IATF 16949 关于不合格品控制与防错的要求（条款 8.7 / 10.2.4）',
    problem: '—',
    cause: '—',
    action: '8.7 不合格品控制：必须标识、隔离、评审、处置，并保留记录。10.2.4 防错：组织应有一个用于防止不合格品产生的过程，防错装置失效或变更时必须重新验证，并保留记录。',
    effect: '用于防再发工具与横展清单的合规检查项。',
    tags: ['IATF16949', '不合格品', '防错', '合规'], source: 'IATF 16949:2016', author: '标准化室', views: 199, refs: 6 },
  { id: '#C-0249', type: '经验卡', category: 'FMEA', model: '通用', title: 'FMEA 的 S/O/D 打分容易踩的坑',
    problem: 'FMEA 严重度/频度/探测度打分主观、虚高或虚低，导致 RPN 排序失真。',
    cause: '①S 按后果不按失效影响链 ②O 没有历史数据支撑 ③D 把"有检测"等同于"能探测"。',
    action: '①S 一律对照 AIAG 表格逐条判定，涉及安全必须 S≥9 ②O 用近 12 个月实际 ppm 反推 ③D 打分必须有探测方法和探测时机，无在线防错的项目 D 不得低于 5 ④RPN>100 或 S≥9 的必须走 AP（措施优先级）。',
    effect: 'FMEA 评审一次通过率由 61% 提升至 89%。',
    tags: ['FMEA', 'RPN', 'AP', '打分', '风险'], source: '陈伟（科长）经验 + AIAG FMEA-4', author: '陈伟', views: 231, refs: 7 },
  { id: '#C-0250', type: '经验卡', category: '数据分析', model: '通用', title: 'SPC 判异后的"三问"定性法',
    problem: '判异报警很多，但不知道从哪查起。',
    cause: '只看图形不看时间与班次维度，导致排查范围过大。',
    action: '三问：①什么时候开始失控？（对齐班次、换批、换料、换模具时间点）②失控是全特性还是单一特性？（共性因素 vs 特异性原因）③同工序其它特性是否同时异常？（设备类 vs 工装类）。三问完成后 80% 的问题可以直接锁定排查方向。',
    effect: 'D4 根因定位周期由平均 6.2 天缩短至 2.8 天。',
    tags: ['SPC', '判异', '根因', '数据分析', '排查'], source: '李雪（7年尺寸/数据分析）经验', author: '李雪', views: 244, refs: 9 },
  { id: '#C-0251', type: '经验卡', category: '收益核算', model: '通用', title: '改进收益的计算口径（财务可核定版）',
    problem: '改进收益自说自话，财务不认。',
    cause: '口径混乱：把"潜在损失"当"已实现收益"，或重复计算。',
    action: '四条铁律：①只计已发生且可追溯的直接损失（报废料、返工工时、停线损失、索赔）②单价用 ERP 当期标准价，工时用财务核定费率 ③摊销期不超过 12 个月 ④同一损失不得在两个项目中重复计入。收益 = (改善前损失率 - 改善后损失率) × 产量 × 单位损失。',
    effect: '收益核定通过率由 62% 提升至 91.3%。',
    tags: ['收益', '财务口径', '核定', '降损'], source: '财务共享中心 + 陈伟', author: '陈伟', views: 187, refs: 5 },
  { id: '#C-0252', type: '经验卡', category: 'QRQC', model: '通用', title: 'QRQC 会议开得有效的三个关键',
    problem: 'QRQC 会开了但问题没解决，纪要没人认领。',
    cause: '①没有量化的问题描述 ②临时措施没有责任人和期限 ③上次任务未回顾。',
    action: '①每个问题必须带量化数据（超差率/投诉数/停线时长）②现场定责任人和完成时间，当场写入待办 ③会议前 5 分钟先过上次遗留任务 ④厂级 QRQC 只处理 2h 未闭环的 A 级问题。',
    effect: 'QRQC 任务按时完成率 91%，2h 响应率 96.3%。',
    tags: ['QRQC', '会议', '闭环', '任务'], source: '陈伟（科长）管理经验', author: '陈伟', views: 212, refs: 8 },
  { id: '#C-0253', type: '经验卡', category: '尺寸工程', model: '通用', title: 'GD&T 基准选择对测量的影响',
    problem: '同一零件用不同基准测量结果差异大，争议不断。',
    cause: '基准不统一（设计基准 vs 制造基准 vs 检测基准）。',
    action: '①测量基准必须与图纸基准一致（基准优先顺序 A→B→C）②四车间匹配问题要用整车坐标系（RPS）而非单件基准 ③检具与三坐标的基准方案必须书面固化到检测指导书。',
    effect: '尺寸争议减少 70%，复测次数下降。',
    tags: ['GD&T', '基准', '测量', '尺寸'], source: '彭勇（14年尺寸工程）经验', author: '彭勇', views: 158, refs: 4 },
  { id: '#C-0254', type: '经验卡', category: '供应商', model: '通用', title: '供应商来料异常的三级响应',
    problem: '来料异常处理慢，影响产线。',
    cause: '没有分级响应机制，所有异常都走同一流程。',
    action: '①一级（不影响装配、可挑选使用）：车间挑选 + 供应商 3 日内提交整改 ②二级（影响装配、需返工）：停用批次 + 供应商 24h 内到场 + 8D ③三级（涉及安全/法规）：整批退货 + 索赔 + 供应商现场审核。统一由 SQE 归口，结果写入供应商绩效。',
    effect: '来料异常平均闭环时间由 12 天缩短至 5 天。',
    tags: ['供应商', '来料', 'SQE', '响应'], source: '供应商质量管理规定 QP-07', author: '张涛', views: 134, refs: 3 },
  { id: '#C-0255', type: '经验卡', category: '精益', model: '通用', title: '七大浪费在整车厂的具体表现与量化方法',
    problem: '改善提案难以量化收益。',
    cause: '浪费识别停留在定性描述。',
    action: '①搬运：按行走距离×频次×工时费率 ②库存：在制品天数×资金成本 ③动作：MTM 分析多余动作时间 ④等待：停线/等料时长 ⑤过量生产：超领用量 ⑥加工过度：多余检验工时 ⑦不良：返工工时+报废料。每个提案必须至少量化一项。',
    effect: '精益类提案量化率由 35% 提升至 88%。',
    tags: ['精益', '七大浪费', '改善', '量化'], source: '精益生产管理办法 LP-03', author: '陈伟', views: 176, refs: 6 },
  { id: '#C-0256', type: '历史案例', category: '三电', model: '产品C', title: '驱动电机高频啸叫（逆变器载波频率与结构共振耦合）',
    problem: '产品B/产品C 在 4200~4800rpm 区间出现高频啸叫。',
    cause: '逆变器载波频率与电机端盖结构模态（约 3.6kHz）耦合，产生结构噪声放大。',
    action: '①载波频率由 8kHz 改为 10kHz 随机 PWM ②端盖增加加强筋改变模态频率 ③软件增加转速区间避让策略。',
    effect: '主观评价由 6.5 分提升至 8.0 分，客诉下降。',
    tags: ['电机', '啸叫', 'NVH', '逆变器', '三电'], source: '故障案例库 #QI-2026-0409 关联', author: '张涛', views: 64, refs: 2, similarity: 0.74 },
  { id: '#C-0257', type: '经验卡', category: '现场管理', model: '通用', title: '变化点管理：换批/换人/换模的时间对齐排查法',
    problem: '4M 变化点太多，不知道哪个是根因。',
    cause: '变化点没有登记，事后无法回溯。',
    action: '①建立变化点看板，换批/换料/换模/换人/换参数全部登记到分钟级 ②发生异常时先做"时间轴叠加"：把 SPC 失控起点与变化点登记表叠在一张图上 ③重叠的变化点优先排查，命中率高。',
    effect: '变化点相关问题的根因定位命中率由 48% 提升至 79%。',
    tags: ['变化点', '4M', '排查', '时间轴'], source: '陈浩（4年现场）经验', author: '陈浩', views: 149, refs: 5 },
  { id: '#C-0258', type: '经验卡', category: '数据分析', model: '通用', title: 'DOE 在整车问题验证中的最小可行方案',
    problem: '产线不允许做大规模试验，但需要验证根因。',
    cause: '直接上全因子试验成本过高。',
    action: '①先做筛选试验（部分因子 2^(4-1)，8 次运行）找到显著因子 ②对显著因子做响应曲面（中心复合，13 次运行）找最优 ③用确认试验（3 次重复）验证 ④单次 DOE 控制在 30 台以内，利用夜班低产量时段实施。',
    effect: '根因验证平均样本量由 120 台降至 28 台。',
    tags: ['DOE', '试验设计', '验证', '部分因子'], source: '李雪（7年数据分析）经验', author: '李雪', views: 128, refs: 4 },
  { id: '#C-0259', type: '经验卡', category: '三车间', model: '通用', title: '膜厚 SPC 连续下降的系统排查（输漆泵优先）',
    problem: '面漆膜厚测量值连续多点下降但仍未超差。',
    cause: '①输漆泵转速漂移 ②涂料粘度变化（温度升高）③雾化空气压力下降 ④机器人速度提升。',
    action: '①先查输漆泵转速反馈与实际流量（偏差 >3% 即异常）②测涂料粘度（升高/降低均影响膜厚）③校核雾化空气压力 ④最后查机器人轨迹速度。按此顺序排查 90% 可在 2h 内定位。',
    effect: '膜厚类问题平均处理时间由 8h 缩短至 2h。',
    tags: ['膜厚', '三车间', '输漆泵', 'SPC', '粘度'], source: '王磊（9年三车间）经验', author: '王磊', views: 163, refs: 4 },
  { id: '#C-0260', type: '经验卡', category: '管理', model: '通用', title: '新员工 3 周独立上手带教法',
    problem: '新人成长慢，老师傅带教没有方法。',
    cause: '缺少结构化任务和即时反馈。',
    action: '第 1 周：跟学 + 知识库闯关（8D/SPC/因果图基础），每日一问一答；第 2 周：辅做（老师傅选题，新人写 D1-D3，AI 与师傅双评）；第 3 周：独立跟一个 C 级问题全流程，AI 旁站记录，师傅只在关键节点把关。每周一次案例复盘。',
    effect: '独立上手周期由 12 周缩短至 3 周，8D 一次通过率 61%→89%。',
    tags: ['带教', '新人', '成长', '知识库'], source: '陈伟（科长）管理经验', author: '陈伟', views: 194, refs: 7 },
  { id: '#C-0261', type: '标准', category: '标准法规', model: '通用', title: '质量成本（COPQ）四项构成与计算口径',
    problem: '—',
    cause: '—',
    action: '①预防成本：培训、体系、FMEA、SPC 建设投入 ②鉴定成本：检验、试验、量具校准 ③内部失败成本：报废、返工、停线 ④外部失败成本：索赔、召回、运费、客户罚款。质量成本率 = 总质量成本 / 销售收入，行业标杆 <2%，整车厂优秀水平 1.2%~1.8%。',
    effect: '用于质量成本计算工具。',
    tags: ['质量成本', 'COPQ', '预防', '鉴定', '失败'], source: '中国质量协会质量成本指南 + 财务口径', author: '标准化室', views: 167, refs: 5 },
  { id: '#C-0262', type: '经验卡', category: '防再发', model: '通用', title: '横展清单必须包含的五个维度',
    problem: '问题关闭了但同平台其它产品又复发。',
    cause: '横展范围靠拍脑袋，覆盖不全。',
    action: '五维横展：①同平台其它产品 ②同工序其它工位 ③同供应商其它料号 ④同类型设备 ⑤同工艺参数的其它产线。每一维都要给出"适用/不适用"结论并说明理由，适用项必须有责任人与验证证据。',
    effect: '重复发生率下降 62%。',
    tags: ['横展', '防再发', 'D7', '标准化'], source: '陈浩（4年现场）+ 8D 管理规定', author: '陈浩', views: 172, refs: 6 },
];

/* ------------------------------------------------------------------ */
/* QRQC 会议记录                                                        */
/* ------------------------------------------------------------------ */
const QRQC = [
  ['班组', '四车间三线', '产品C', '充电口盖间隙超差升级评审', ['李雪', '杨帆', '刘洋'],
    '充电口盖间隙 3.4% 超差，连续 6 点下行并击穿下控制限', '暂停使用旧定位销，加严抽检至 10 台/小时', '李雪', 2, 'closed'],
  ['车间', '三车间', '产品A', '出口批次漆面颗粒围堵', ['王磊', '周凯', '彭勇'],
    '左前门漆面颗粒缺陷密度 2.1 个/台，影响出口交付', '出口批次 100% 人工复检 + 更换送风过滤棉', '王磊', 4, 'closed'],
  ['厂级', '质量部', '产品B', '驱动电机啸叫厂级 QRQC', ['张涛', '陈伟', '彭勇'],
    '电机高频啸叫客诉环比上升 12%，涉及安全感知', '锁定 4200~4800rpm 区间，载波频率临时调整', '张涛', 24, 'open'],
];

/* ------------------------------------------------------------------ */
/* 收益台账                                                             */
/* ------------------------------------------------------------------ */
const BENEFITS = [
  ['#QP-0342', '报废降损', 8.0, '2026-08', 'verified', '空调出风异味工艺优化，减少蒸发箱报废'],
  ['#QP-0340', '报废降损', 31.0, '2026-08', 'verified', '二车间虚焊治理，减少白车身报废与返修'],
  ['#QP-0330', '报废降损', 14.0, '2026-07', 'verified', '翼子板回弹治理，板料利用率提升'],
  ['#QP-0351', '停线损失', 22.5, '2026-09', 'verified', '尾门间隙治理，减少调整停线'],
  ['#QP-0369', '报废降损', 42.0, '2026-09', 'pending', '模组绝缘电阻治理（财务核定中）'],
  ['#QP-0365', '效率提升', 18.6, '2026-09', 'pending', '拉延开裂治理，减少模具停机（财务核定中）'],
  ['#QP-0335', '报废降损', 18.0, '2026-09', 'verified', '电泳缩孔治理，减少返工'],
  ['#QP-0338', '索赔挽回', 26.4, '2026-08', 'verified', '五车间密封胶断胶治理，避免售后索赔'],
  ['#QP-0342', '效率提升', 12.0, '2026-08', 'verified', '空调工艺优化，工时降低'],
];

/* ------------------------------------------------------------------ */
/* AI 质检缺陷记录                                                       */
/* ------------------------------------------------------------------ */
function buildDefects() {
  const rnd = mulberry32(90210);
  const out = [];
  const types = [
    ['漆面颗粒', '三车间', '面漆二线', 0.89],
    ['间隙超差', '四车间', '四车间三线', 0.94],
    ['面差超差', '四车间', '四车间一线', 0.91],
    ['缩孔', '三车间', '电泳线', 0.86],
    ['飞溅', '二车间', '主焊线', 0.83],
    ['密封胶断点', '五车间', '五车间装配线', 0.87],
  ];
  for (let i = 0; i < 180; i++) {
    const t = types[Math.floor(rnd() * types.length)];
    const model = MODELS[Math.floor(rnd() * 3)];
    const day = 30 - Math.floor(rnd() * 30);
    const ts = new Date(DATA_DAY.getTime() - (30 - day) * 86400000 - Math.floor(rnd() * 86400000));
    out.push({
      type: t[0], workshop: t[1], station: t[2], model,
      confidence: Number((t[3] - rnd() * 0.08).toFixed(2)),
      ts: ts.toISOString(),
      severity: rnd() > 0.85 ? 'A' : rnd() > 0.5 ? 'B' : 'C',
      batch: 'B25' + String(10 + (i % 12)).slice(1) + '-' + String(1 + (i % 30)),
      imageRef: 'AQI/' + ts.toISOString().slice(0, 10) + '/' + String(1000 + i) + '.jpg',
      exported: rnd() > 0.7,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */
function seed(store) {
  const now = new Date();
  const iso = (d) => d.toISOString();
  const dayAgo = (n, h) => new Date(now.getTime() - n * 86400000 + (h || 0) * 3600000);

  // 计数器与设置
  store.db.counters = { issue: 412, project: 415, qrqc: 86, workflow: 1042, todo: 312, benefit: 96, report: 58, knowledge: 262, chat: 0, audit: 1280, measurement: 0, spcChar: 455, member: 19, defect: 0 };
  store.db.settings = defaultSettings();
  store.db.meta.createdAt = iso(now);

  // 人员
  MEMBERS.forEach((m, i) => {
    store.db.members.push(Object.assign({
      id: 'U-' + String(i + 1).padStart(3, '0'),
      createdAt: iso(dayAgo(400)), updatedAt: iso(dayAgo(400)),
      avatar: m.name.slice(-2),
    }, m));
  });

  // SPC 特性 + 测量数据
  let measSeq = 0;
  SPCS.forEach((s, si) => {
    const series = buildSeries(s, 1000 + si * 37);
    const flat = [];
    series.forEach((g) => {
      g.values.forEach((v, vi) => {
        measSeq++;
        flat.push({
          id: 'MS-' + String(measSeq).padStart(8, '0'),
          charId: s.id,
          charName: s.name,
          model: s.model,
          workshop: s.workshop,
          station: s.station,
          ts: new Date(new Date(g.ts).getTime() + vi * 60 * 1000).toISOString(),
          shift: g.shift,
          value: v,
          unit: s.unit,
          batch: g.batch,
          supplier: SUPPLIERS[(si + vi) % SUPPLIERS.length],
          operator: g.operator,
          vin: 'LG' + s.id.slice(3) + String(100000 + measSeq).slice(1),
          subgroup: series.indexOf(g) + 1,
          source: 'MES',
        });
      });
    });
    store.db.measurements.push(...flat);
    store.db.spcChars.push({
      id: s.id, name: s.name, model: s.model, workshop: s.workshop, station: s.station,
      nominal: s.nominal, usl: s.usl, lsl: s.lsl, unit: s.unit,
      subgroupSize: s.subgroupSize, ctq: s.ctq, controlMethod: s.controlMethod,
      freq: '5 分钟采集 / 夜间批同步', createdAt: iso(dayAgo(180)), updatedAt: iso(now),
      sampleCount: flat.length,
      series: series.map((g) => ({ ts: g.ts, shift: g.shift, values: g.values, batch: g.batch })),
    });
  });

  // 质量问题
  ISSUES.forEach((r, i) => {
    const [id, model, ws, station, title, source, sev, owner, sim, status, desc] = r;
    const created = dayAgo(status === '已关闭' ? 25 + i * 3 : 1 + (i % 20), 9);
    store.db.issues.push({
      id, model, workshop: ws, station, title, source, severity: sev, owner,
      aiSimilarity: sim, status, description: desc,
      createdAt: iso(created), updatedAt: iso(created),
      closedAt: status === '已关闭' ? iso(dayAgo(Math.max(1, 22 + i * 3 - 14), 16)) : null,
      projectId: null, tags: [], history: [{ ts: iso(created), user: owner, action: '发现问题', note: '来源：' + source }],
      detectMethod: source === 'AI 质检' ? 'AI 视觉检测（置信度 ' + (0.82 + (i % 12) / 100).toFixed(2) + '）' : source === 'MES' ? 'MES 在线测量' : source === '市场' ? '售后 DMS 工单 + 舆情' : '现场确认',
      quantity: 0, rootCause: '', containment: '', verifyResult: '',
    });
  });

  // 问题库扩量到 10 倍：再生成 180 起（合计 200），并打标避免运行期重复扩容
  buildExpandedIssues(420, 180, 20261018, now.getTime()).forEach((doc) => store.db.issues.push(doc));
  store.db.meta.dataScaleIssues = 10;

  // 改进项目并回填问题的 projectId
  PROJECTS.forEach((r, i) => {
    const [id, title, issueId, model, ws, owner, sev, stage, scheduleDays, _reserved, verifyCount, desc] = r;
    const issue = store.db.issues.find((x) => x.id === issueId);
    if (issue) issue.projectId = id;
    const created = dayAgo(30 + i * 2, 10);
    const stageOrder = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'];
    const idx = stageOrder.indexOf(stage);
    const stages = {};
    stageOrder.forEach((st, k) => {
      stages[st] = { done: stage === 'D8' ? k <= idx : k < idx, at: k <= idx ? iso(dayAgo(Math.max(1, 30 + i * 2 - k * 3), 15)) : null, content: '' };
    });
    store.db.projects.push({
      id, title, issueId, model, workshop: ws, owner, severity: sev, stage,
      stageIndex: idx, description: desc,
      createdAt: iso(created), updatedAt: iso(now),
      dueAt: iso(dayAgo(-scheduleDays, 17)),
      closedAt: stage === 'D8' ? iso(dayAgo(Math.max(1, 5 + i), 11)) : null,
      overdue: scheduleDays < 0, overdueDays: Math.max(0, -scheduleDays),
      progress: Math.round(((idx + (verifyCount ? 0.5 : 0)) / 8) * 100),
      team: buildTeam(owner, ws, sev),
      stages, d1: '', d2: '', d3: '', d4: '', d5: '', d6: '', d7: '', d8: '',
      verifyCount, verifyTotal: 3,
      benefitEstimate: sev === 'A' ? 40 + (i % 5) * 15 : 8 + (i % 4) * 6,
      history: [
        { ts: iso(created), user: owner, action: '立项', note: '来源问题 ' + issueId },
        { ts: iso(dayAgo(Math.max(1, 20 + i), 14)), user: owner, action: '阶段推进', note: '推进至 ' + stage },
      ],
      aiDrafted: true,
      aiDraftRatio: 0.83,
    });
  });

  // QRQC
  QRQC.forEach((r, i) => {
    const [level, ws, model, topic, attendees, problem, tempAction, owner, hours, status] = r;
    const d = dayAgo(i === 0 ? 0 : i, 9);
    store.db.qrqc.push({
      id: 'QR-2026-' + String(80 + i).padStart(4, '0'),
      level, workshop: ws, model, topic, attendees, problem, tempAction, owner,
      responseHours: 2, dueHours: hours, status,
      createdAt: iso(d), updatedAt: iso(d),
      location: ws + ' QRQC 会议室',
      minutes: '', tasks: [],
      responseAt: iso(new Date(d.getTime() + 1.5 * 3600000)),
      closedAt: status === 'closed' ? iso(new Date(d.getTime() + hours * 3600000)) : null,
    });
  });

  // 待办（OA）
  const todoSeeds = [
    ['#QP-0377 根因验证复核', 0, 'A', '李雪'],
    ['厂级 QRQC 会议 14:00（AI 纪要与任务已预生成）', 0, 'A', '陈伟'],
    ['周质量报告草稿确认发布', 0, 'B', '王磊'],
    ['#QP-0415 漆面颗粒 D2 问题描述复核', 1, 'A', '王磊'],
    ['#QP-0369 永久对策 OA 审批', -1, 'A', '刘婷'],
    ['出口批次漆面颗粒围堵效果验证', 0, 'A', '周凯'],
  ];
  todoSeeds.forEach((t, i) => {
    store.db.todos.push({
      id: 'TD-' + String(300 + i), user: t[3], title: t[0], priority: t[2], link: '',
      dueAt: iso(dayAgo(-t[1], 17)), done: false, createdAt: iso(dayAgo(1)), source: '本平台 / OA',
    });
  });

  // OA 审批流
  const wf = [
    ['8D永久对策审批', '#QP-0369 模组绝缘电阻偏低 - D5 永久对策审批', '刘婷', 'pending', '#QP-0369', '延长注液后干燥时间由 8h 至 12h，增加在线绝缘监测，预计投入 ¥6.8 万，年化收益 ¥42 万。'],
    ['临时措施审批', '#QP-0415 漆面颗粒 - D3 临时措施审批', '王磊', 'pending', '#QP-0415', '出口批次 100% 人工复检 + 更换送风过滤棉，围堵成本 ¥1.2 万，未拦截潜在损失 ¥18 万。'],
    ['收益核定', '#QP-0340 二车间虚焊治理 - 收益核定申请', '张涛', 'approved', '#QP-0340', '报废降损 ¥31 万，按 12 个月摊销，财务口径核定通过。'],
    ['改进项目立项', '#QP-0415 漆面颗粒（出口批次）立项申请', '王磊', 'approved', '#QP-0415', 'A 级问题，涉及出口交付，同意立项。'],
  ];
  wf.forEach((w, i) => {
    const d = dayAgo(i < 2 ? i : 5 + i, 10);
    store.db.workflows.push({
      id: 'OA-2026-' + String(1030 + i), type: w[0], title: w[1], applicant: w[2], status: w[3],
      relatedId: w[4], content: w[5],
      approvers: [{ name: '陈伟', role: '科长', status: w[3] === 'pending' ? 'pending' : 'approved', at: w[3] === 'pending' ? null : iso(d) },
                  { name: '质量部部长', role: '部长', status: w[3] === 'approved' ? 'approved' : 'pending', at: w[3] === 'approved' ? iso(new Date(d.getTime() + 7200000)) : null }],
      createdAt: iso(d), updatedAt: iso(d),
      urgent: i < 2,
      aiSummary: '围堵成本 ¥1.2 万 vs 未拦截潜在损失 ¥18 万，AI 建议：批准。',
    });
  });

  // 收益台账
  BENEFITS.forEach((b, i) => {
    const [pid, type, amount, period, status, note] = b;
    const p = store.db.projects.find((x) => x.id === pid) || {};
    store.db.benefits.push({
      id: 'BN-2026-' + String(80 + i).padStart(4, '0'),
      projectId: pid, projectTitle: p.title || '', type, amount, period, status,
      note, createdAt: iso(dayAgo(20 + i * 3)), updatedAt: iso(dayAgo(2)),
      formula: '收益 = (改善前损失率 - 改善后损失率) × 产量 × 单位损失',
      verifiedBy: status === 'verified' ? '财务共享中心·李会计' : '',
      verifiedAt: status === 'verified' ? iso(dayAgo(5 + i)) : null,
      aiDriven: i % 3 !== 1,
    });
  });

  // 知识库
  KNOWLEDGE.forEach((k) => {
    store.db.knowledge.push(Object.assign({}, k, {
      createdAt: iso(dayAgo(30 + (k.views % 300))), updatedAt: iso(dayAgo(3)),
      attachments: [], status: 'published',
    }));
  });

  // AI 质检缺陷
  store.db.defects = buildDefects();

  // 审计日志初始记录
  for (let i = 0; i < 12; i++) {
    store.db.audit.push({
      id: 'AU-' + String(1270 + i),
      ts: iso(dayAgo(i, 8)), user: ['李雪', '王磊', '张涛', '刘婷'][i % 4],
      plugin: ['@MES', '@SPC', '@ERP', '@OA', '@FIN', '知识库'][i % 6],
      action: ['查询测量数据', '控制图判异', '批次追溯', '发起审批', '收益测算', '案例检索'][i % 6],
      params: { sample: true }, resultSummary: '初始审计记录', purpose: '初始数据初始化',
    });
  }

  store.saveSync(true);
  return {
    issues: store.db.issues.length,
    projects: store.db.projects.length,
    measurements: store.db.measurements.length,
    knowledge: store.db.knowledge.length,
    members: store.db.members.length,
  };
}

/** 依据问题所在车间与等级，推荐 8D 团队（技能图谱匹配） */
function buildTeam(leader, workshop, severity) {
  const pool = MEMBERS.filter((m) => m.expert && m.expert.includes(workshop));
  const team = [{ name: leader, role: '组长', dept: '质量改进部门', reason: '责任工程师' }];
  pool.slice(0, 2).forEach((m) => {
    if (m.name !== leader) team.push({ name: m.name, role: '技术专家', dept: m.dept, reason: '车间经验 ' + m.seniority + ' 年 · ' + workshop });
  });
  const crossPool = MEMBERS.filter((m) => m.dept && m.dept.indexOf('车间') >= 0 && m.expert && m.expert.includes(workshop));
  crossPool.slice(0, 1).forEach((m) => team.push({ name: m.name, role: '现场执行', dept: m.dept, reason: '现场工艺' }));
  if (severity === 'A') team.push({ name: '陈伟', role: '决策/资源', dept: '质量改进部门', reason: 'A 级问题科长参与' });
  return team;
}

/** 默认系统设置（LLM + 插件总线） */
function defaultSettings() {
  return {
    org: {
      company: '某制造型企业',
      dept: '质量改进部门',
      headcount: 16,
      dataDay: '2026-09-30',
    },
    // 初始设置：公司/部门/车间/产品的「当前命名」，用户在「系统 → 初始设置」里改完后
    // 平台会按旧名→新名把初始数据整体替换（host.cjs 的 /api/naming）
    naming: {
      company: '某制造型企业',
      dept: '质量改进部门',
      workshops: WORKSHOPS.slice(),
      products: MODELS.slice(),
    },
    llm: {
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      model: 'deepseek-chat',
      reasonerModel: 'deepseek-reasoner',
      temperature: 0.3,
      maxTokens: 4096,
      timeoutMs: 120000,
      deepThinking: false,
      stream: true,
    },
    agent: {
      maxRounds: 8,
      autoTool: true,
      requireCitation: true,       // 结论必须有出处，无出处降级为「假设」
      humanConfirm: true,          // 对外发送 / 对外承诺 / 8D 关闭 三类动作强制人工确认
      confirmActions: ['oa_start_workflow', 'mail_send', 'project_close', 'report_publish'],
      maskSensitive: true,         // VIN / 手机号 脱敏
      systemPersona: '',
    },
    plugins: {
      mes: { name: '@MES 制造执行', enabled: true, mode: 'local', baseUrl: '', apiKey: '', timeoutMs: 30000, desc: '在线测量、报废/停线、整车追溯、批次装配关系' },
      spc: { name: '@SPC 统计控制', enabled: true, mode: 'local', baseUrl: '', apiKey: '', timeoutMs: 30000, desc: '控制限、判异记录、Cpk' },
      erp: { name: '@ERP 物料/BOM', enabled: true, mode: 'local', baseUrl: '', apiKey: '', timeoutMs: 30000, desc: 'BOM、批次与供应商、物料价格、成本中心' },
      oa: { name: '@OA 流程审批', enabled: true, mode: 'local', baseUrl: '', apiKey: '', timeoutMs: 30000, desc: '审批流、待办、组织权限' },
      fin: { name: '@FIN 财务核算', enabled: true, mode: 'local', baseUrl: '', apiKey: '', timeoutMs: 30000, desc: '收益测算提交、核定结果、损失口径' },
      aqi: { name: '@AQI AI 质检', enabled: true, mode: 'local', baseUrl: '', apiKey: '', timeoutMs: 30000, desc: '视觉检测缺陷结果（含置信度）' },
      doc: { name: '@DOC 文档', enabled: true, mode: 'local', baseUrl: '', apiKey: '', timeoutMs: 30000, desc: '标准/规范同步、报告导出 DOCX/PDF' },
      mail: { name: '@MAIL 邮件', enabled: false, mode: 'local', baseUrl: '', apiKey: '', timeoutMs: 30000, desc: '报表分发、升级抄送' },
    },
    push: {
      morningReport: '07:30',
      channels: ['企微', '邮件'],
      alarmLevels: ['A', 'B', 'C'],
    },
  };
}

module.exports = { seed, defaultSettings, SPCS, MEMBERS, DATA_DAY, buildExpandedIssues, scaleupIssues };
