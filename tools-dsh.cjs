'use strict';
/**
 * 把平台里的真实工具注册成 DeepSeek Harness 的 Agent 工具。
 * ------------------------------------------------------------------
 * 每个 Harness 工具都直接调用内置工具注册中心的实现：
 * 参数结构、执行逻辑、统计口径全部复用，不存在"另写一套数据"。
 * 因此对话里（Harness 自带 DeepSeek 智能体）也能真的查数、算 SPC、出报告。
 */
const host = require('./host.cjs');

const registry = host.registry;

const text = (value) => [{ type: 'text', text: String(value) }];

const DEFS = [
  {
    ds: 'qip_overview',
    real: 'dashboard_overview',
    desc: '查询质量驾驶舱的真实 KPI 总览：测量点数、超差点、判异特性、在改项目、按期率、已核定收益等，全部由统计引擎实算。用户问"整体质量怎么样/今天质量指标"时先用它。',
  },
  {
    ds: 'qip_spc_list_chars',
    real: 'spc_list_chars',
    desc: '列出平台里所有可做 SPC 分析的关键特性（编号、名称、产品、车间、规格上下限、子组大小）。回答任何 SPC 问题前先调用它确认特性编号。',
  },
  {
    ds: 'qip_spc_rule_check',
    real: 'spc_rule_check',
    desc: '对指定特性做 GB/T 4091 八大判异准则检查（真实统计引擎，返回命中的准则、涉及点位、控制限）。用户问"有没有判异/失控/异常波动"时用它。',
  },
  {
    ds: 'qip_spc_capability',
    real: 'spc_capability',
    desc: '计算指定特性的过程能力 Cp/Cpk/Pp/Ppk、ppm 与判定（能力充足/不足）。用户问"Cpk 多少/过程能力"时用它。',
  },
  {
    ds: 'qip_spc_control_chart',
    real: 'spc_control_chart',
    desc: '生成指定特性的真实控制图数据（I-MR/Xbar-R/Xbar-S/EWMA、UCL/CL/LCL、逐点数值），用于展示过程受控状态。',
  },
  {
    ds: 'qip_measurements',
    real: 'mes_query_measurements',
    desc: '从 @MES 数据仓查询指定特性的在线测量值：样本量、均值、超差条数与比例、分班次统计、批次与追溯字段。用户问"这批数据怎么样/超差多少"时用它。',
  },
  {
    ds: 'qip_issue_search',
    real: 'issue_search',
    desc: '检索质量问题库（支持关键词、产品、车间、状态），返回问题编号、等级、责任人、项目关联。用户问"有哪些质量问题/某个问题进展"时用它。',
  },
  {
    ds: 'qip_issue_create',
    real: 'issue_create',
    desc: '登记一条新的质量问题（自动编号、自动查重、相似历史案例匹配）。用户明确要求"登记/新建一个问题"时用它。',
  },
  {
    ds: 'qip_project_list',
    real: 'project_list',
    desc: '列出质量改进项目（8D）：编号、标题、阶段、等级、责任人、SLA 与超期状态。用户问"有哪些改进项目/8D 进展"时用它。',
  },
  {
    ds: 'qip_project_advance',
    real: 'project_advance',
    desc: '推进某个 8D 改进项目到下一阶段，并写入该阶段交付物。用户明确要求"把某项目推进到 D4/下一阶段"时用它。',
  },
  {
    ds: 'qip_knowledge_search',
    real: 'kb_search',
    desc: '在企业知识库里做中文语义检索（BM25），命中师傅经验卡/历史案例/标准条款，带编号出处。做根因分析前先检索历史经验。',
  },
  {
    ds: 'qip_risk_scan',
    real: 'aqi_risk_scan',
    desc: '跨源风险扫描：判异、缺陷密度上升、项目超期、重复问题聚类等，返回按 A/B/C 分级的风险清单与建议动作。用户问"有什么风险/该关注什么"时用它。',
  },
  {
    ds: 'qip_benefit_calc',
    real: 'fin_benefit_calc',
    desc: '按财务口径测算改进收益：年化收益（万元）、投资回收期（月）、计算依据。用户问"这个改进值多少钱/收益测算"时用它。',
  },
  {
    ds: 'qip_report_generate',
    real: 'report_generate',
    desc: '生成真实 Word(.docx) 报告文件（周报/月报/专项/根因/SPC/8D），返回磁盘绝对路径与文件大小。用户要求"出报告/导报告"时用它。',
  },
  {
    ds: 'qip_data_export',
    real: 'data_export',
    desc: '把平台数据导出为真实 Excel(.xlsx) 多工作表文件或 CSV，返回磁盘绝对路径与包含的工作表。用户要求"导出数据/要 Excel"时用它。',
  },
  {
    ds: 'qip_db_status',
    real: 'dashboard_overview',
    desc: '查看平台真实存储状态：SQLite 数据库文件路径、大小、各表行数、测量值条数（数据是否真的落库）。用户问"数据存在哪/有没有入库"时用它。',
  },
];

const RENDER_LIMIT = 7000;

function buildTools() {
  const out = [];
  for (const def of DEFS) {
    const real = registry.get(def.real);
    if (!real) {
      console.warn('[dsh-quality-up] 跳过工具 ' + def.ds + '：平台没有 ' + def.real);
      continue;
    }
    out.push({
      name: def.ds,
      description: def.desc + '（真实执行 ' + real.plugin + ' · ' + real.name + '）',
      parameters: real.parameters || { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: { type: 'object', additionalProperties: true, properties: {} },
        render: (_args, value) => {
          let preview = '';
          try {
            preview = JSON.stringify(value, null, 2);
          } catch (_) {
            preview = String(value);
          }
          if (preview.length > RENDER_LIMIT) preview = preview.slice(0, RENDER_LIMIT) + '\n…（已截断）';
          let summary = '';
          try { summary = host.agent.summarize(real.name, value); } catch (_) { summary = ''; }
          return text((summary ? summary + '\n\n' : '') + preview);
        },
      },
      async execute(args) {
        if (def.ds === 'qip_db_status') {
          const info = host.store.persist ? host.store.persist.info() : { engine: 'json', path: host.store.file };
          return {
            ok: true,
            database: info,
            dataDir: host.DATA_DIR,
            reportDir: host.OUTPUT_DIR,
            counts: host.countAll(),
            note: '所有业务数据以 SQLite 为权威存储，另留 JSON 快照用于备份。',
          };
        }
        const result = await real.run(args || {}, { outputDir: host.OUTPUT_DIR });
        return result === undefined ? { ok: true } : result;
      },
    });
  }
  return out;
}

module.exports = { buildTools, DEFS };


