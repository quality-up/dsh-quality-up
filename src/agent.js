'use strict';
function localNow(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/**
 * 智能体内核（DeepSeek Harness 风格）
 * ------------------------------------------------------------------
 * 用户一句话 → 意图理解 → 任务规划(ReAct) → 插件编排 → 知识检索 →
 * 结果整合 → 成文/成图/成流程
 *
 * 硬性护栏（对应技术方案第五章）：
 *   ① 结论必须有出处：System Prompt 强制要求引用工具返回的数据来源，无出处只能称「假设」
 *   ② 三类动作强制人工确认：对外发送、对外承诺、8D 关闭 → 挂起为待确认项
 *   ③ 敏感脱敏：VIN、手机号在进入 Prompt 前脱敏
 *   ④ 全程审计：每次工具调用落审计库
 */
const store = require('./lib/store');
const llm = require('./lib/llm');
const registry = require('./tools/registry');

// 载入全部工具
require('./tools/data');
require('./tools/analysis');
require('./tools/business');
require('./tools/docs');

const PLUGIN_ORDER = ['@MES', '@SPC', '@ERP', '@OA', '@FIN', '@AQI', '知识库', '@DOC', '@MAIL', '本平台'];

/* ---------------- 敏感信息脱敏 ---------------- */
function maskSensitive(text) {
  if (!text) return text;
  return String(text)
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, (m) => m.slice(0, 3) + '****' + m.slice(-4))   // VIN
    .replace(/\b1[3-9]\d{9}\b/g, (m) => m.slice(0, 3) + '****' + m.slice(-4))            // 手机号
    .replace(/\b\d{17}[\dXx]\b/g, '******************');                                  // 身份证
}

/* ---------------- 系统提示词 ---------------- */
function buildSystemPrompt(settings) {
  const org = settings.org || {};
  const custom = settings.agent && settings.agent.systemPersona;
  const now = new Date();
  const dataAt = (function () {
    const ms = store.col('measurements').all();
    let max = 0; for (const m of ms) { const t = Date.parse(m.ts); if (t > max) max = t; }
    return max ? new Date(max).toISOString().slice(0, 16).replace('T', ' ') : now.toISOString().slice(0, 16).replace('T', ' ');
  })();

  return [
    '# 角色',
    '你是「' + (org.company || '某制造型企业') + ' · ' + (org.dept || '质量改进部门') + '」的 AI 质量改进工程师，运行在「' + brandName() + '」上，通过热插拔插件读写企业系统。',
    '你的服务对象是质量改进工程师、车间技术员与质量管理者，他们的专业水平很高，但司龄普遍较短、缺少老师傅的现场经验。',
    '',
    '# 你可以调用的数据与系统（通过工具真实访问，不是模拟）',
    '· @MES 制造执行：在线测量值、报废/停线、整车 VIN 追溯、批次装配关系',
    '· @SPC 统计控制：控制图、GB/T 4091 八大判异、Cpk/Ppk、假设检验、回归、GR&R',
    '· @ERP 物料/BOM：批次与供应商、物料价格与工时费率',
    '· @OA 流程审批：发起审批流、推送待办、组织架构与技能图谱',
    '· @FIN 财务核算：收益测算与核定台账、质量成本',
    '· @AQI AI 质检：视觉缺陷检测结果与置信度',
    '· 知识库：师傅经验卡、历史故障案例、标准/规范条款（语义检索）',
    '· 本平台：问题库、8D 改进项目、QRQC、FMEA、DOE、甘特图等质量工具',
    '',
    '# 铁律（必须遵守，违反即视为回答失败）',
    '0. **只认本平台的工具**：工具清单里凡是带 `qip_` 前缀的（如 qip_overview / qip_project_list / qip_issue_search / qip_measurements / qip_spc_capability），才是读「本平台」真实数据库的版本。如果同时存在**同名但不带 qip_ 前缀**的工具（别的插件注册的 project_list / issue_search / aqi_defect_query 等），一律不要使用——那些数据不属于本平台，引用它等于答错。不确定用哪个时，先调 qip_overview 对齐口径。',
    '1. **一切数字必须来自工具返回值**。禁止凭印象给数字、禁止估算、禁止编造编号。需要数据时先调用工具。工具没返回的，明确说"平台无该数据"。',
    '2. **结论必须挂接出处**。每个关键结论后用括号标注来源与编号，例如：（来源：@MES 特性 CT-0378 近 7 日 1,247 条测量值）、（出处：#C-0231 经验卡）、（依据：GB/T 4091 准则 3）。**没有出处的判断只能表述为「假设」并给出置信度与验证方法**。',
    '3. **根因分析要给排序假设**，每条假设写明：置信度（P≈x.xx）、支持证据（来自哪个工具的具体数据）、验证方法（要取什么数据/做什么试验）。不要只给一个"标准答案"。',
    '4. **对外发送、对外承诺、8D 关闭三类动作必须人工确认**：相关工具会自动挂起，你要明确告诉用户"已生成待确认项，请点击确认后执行"，不得声称已经执行。',
    '5. **区分"相关"与"因果"**。数据相关性高不等于因果，要用变化点时间对齐、分层分析或 DOE 验证。',
    '6. 复述数据时保留原始精度，不要随意四舍五入到失去意义；带单位。',
    '',
    '# 输出风格',
    '· 用中文，结构化输出（小标题 / 编号 / 表格化的 Markdown）。',
    '· 先给结论，再给数据支撑，最后给下一步动作（谁、做什么、什么时候完成）。',
    '· 面向现场：给出可执行的排查顺序，而不是泛泛而谈。',
    '· 不要输出"作为AI我无法…"这类推辞；没数据就去查，查不到就说没数据并给出获取途径。',
    '· 如果问题可以用已有工具解决，直接调用工具，不要反问用户要数据。',
    '',
    '# 当前上下文',
    '· 企业：' + (org.company || '某制造型企业') + ' / ' + (org.dept || '质量改进部门') + ' / 编制 ' + (org.headcount || 16) + ' 人',
    '· 当前时间：' + localNow(now) + '（Asia/Shanghai）',
    '· 平台数据截至：' + dataAt,
    '· 已接入插件：' + PLUGIN_ORDER.join('、'),
    custom ? '\n# 企业自定义要求\n' + custom : '',
  ].join('\n');
}

/* ---------------- 工具执行 ---------------- */
function pluginFilter(settings) {
  const plugins = settings.plugins || {};
  const disabled = new Set();
  Object.keys(plugins).forEach((k) => { if (plugins[k] && plugins[k].enabled === false) disabled.add(plugins[k].name); });
  return (t) => !disabled.has(t.plugin);
}

function findTool(name) { return registry.get(name); }

/** 生成工具结果的"人话摘要"，用于前端调用链可视化与审计 */
function summarize(name, result) {
  if (!result) return '无返回';
  if (result.ok === false) return '✖ ' + (result.error || '执行失败');
  const t = findTool(name);
  switch (name) {
    case 'mes_query_measurements': return '✔ 返回 ' + result.样本量 + ' 条测量值，超差 ' + result.超差.条数 + ' 条（' + result.超差.比例 + '）';
    case 'spc_rule_check': return result.命中准则数 ? '⚠ 命中 ' + result.命中准则数 + ' 条判异准则：' + (result.判异结果 || []).map((r) => '准则' + r.准则).join('、') : '✔ 过程受控，未发现判异信号';
    case 'spc_capability': return '✔ Cpk=' + result.能力指数.Cpk + '，判定：' + result.判定;
    case 'spc_control_chart': return '✔ ' + result.图类型 + ' 控制图，UCL=' + result.控制限.UCL + ' CL=' + result.控制限.CL + ' LCL=' + result.控制限.LCL;
    case 'spc_list_chars': return '✔ 返回 ' + result.特性数 + ' 个关键特性';
    case 'erp_batch_trace': return '✔ 返回 ' + result.物料数 + ' 个物料及其批次/供应商分布';
    case 'kb_search': return result.命中数 ? '✔ 命中 ' + result.命中数 + ' 条：' + (result.结果 || []).map((r) => r.编号).join('、') : '✔ 知识库未命中';
    case 'issue_search': return '✔ 命中 ' + result.命中数 + ' 条问题';
    case 'issue_create': return '✔ 已创建问题 ' + result.新问题编号 + (result.去重检测.疑似同构问题数 ? '，发现 ' + result.去重检测.疑似同构问题数 + ' 起同构问题' : '');
    case 'project_create': return '✔ 已创建改进项目 ' + result.项目编号 + '，推荐团队 ' + result.团队推荐.length + ' 人';
    case 'project_advance': return '✔ ' + result.项目 + ' 推进至 ' + result.新阶段;
    case 'pareto_analysis': return '✔ ' + result.维度 + ' 帕累托：' + (result.关键少数 || []).join('、') + ' 为关键少数';
    case 'aqi_risk_scan': return '⚠ 扫描出 ' + result.风险总数 + ' 项风险（A 级 ' + result.A级风险 + ' 项）';
    case 'aqi_defect_query': return '✔ 返回 ' + result.缺陷总数 + ' 条缺陷记录';
    case 'report_generate': return '✔ 已生成 ' + result.格式 + '：' + result.报告标题 + '（' + result.文件大小 + '）';
    case 'data_export': return '✔ 已导出 ' + result.格式 + '：' + result.工作表.join('、');
    case 'fin_benefit_calc': return '✔ 年化收益 ' + result.结果.年化收益万元 + ' 万元，回收期 ' + result.结果.投资回收期月 + ' 个月';
    case 'dashboard_overview': return '✔ 已汇总 ' + Object.keys(result.KPI).length + ' 项 KPI';
    case 'oa_start_workflow': return '✔ 已发起审批 ' + result.审批单号 + '（待审批）';
    case 'project_close': return '✔ 项目 ' + result.项目 + ' 已关闭，归档案例 ' + result.归档案例;
    case 'stat_hypothesis_test': return result.p值 !== undefined ? '✔ ' + result.检验方法 + '：p=' + result.p值 + '，' + result.结论 : '✔ ' + result.检验方法;
    case 'stat_capability_calc': return '✔ Cpk=' + result.能力指数.Cpk + '（' + result.判定 + '）';
    case 'stat_grr': return '✔ %GRR=' + result.百分比['%GRR'] + '，ndc=' + result.ndc可区分类别数 + '，' + result.判定;
    case 'mes_scrap_summary': return '✔ 超差事件 ' + result.合计.超差事件数 + ' 起，折算损失 ¥' + result.合计.折算损失金额;
    default: {
      const keys = Object.keys(result).filter((k) => k !== 'ok').slice(0, 3);
      return '✔ 返回 ' + keys.join('、') + (keys.length >= 3 ? ' 等字段' : '');
    }
  }
}

/* ---------------- 主流程 ---------------- */
/**
 * @param {object} p {text, sessionId, settings, history, signals}
 * @param {function} onEvent 事件回调
 */
async function run(p, onEvent) {
  const emit = (e) => { try { onEvent && onEvent(e); } catch (_) {} };
  const settings = p.settings || store.db.settings || {};
  const cfg = Object.assign({}, settings.llm || {});
  const agentCfg = settings.agent || {};
  const maxRounds = agentCfg.maxRounds || 8;

  if (!cfg.apiKey) {
    emit({ type: 'error', code: 'NO_API_KEY', message: '尚未配置大模型 API Key。请点击右上角「系统设置 → 模型接入」填写 DeepSeek API Key（或厂内私有化部署地址）后即可开始真实对话。' });
    return { ok: false, code: 'NO_API_KEY' };
  }

  const tools = registry.schemas(pluginFilter(settings));
  const messages = [];
  messages.push({ role: 'system', content: buildSystemPrompt(settings) });

  // 历史对话（仅保留最近 12 轮，控制上下文）
  const history = (p.history || []).slice(-24);
  for (const h of history) {
    if (h.role === 'user' || h.role === 'assistant') messages.push({ role: h.role, content: agentCfg.maskSensitive === false ? h.content : maskSensitive(h.content) });
  }
  const userText = agentCfg.maskSensitive === false ? p.text : maskSensitive(p.text);
  messages.push({ role: 'user', content: userText });

  emit({ type: 'start', model: cfg.model, tools: tools.length, rounds: maxRounds });

  const trace = [];          // 工具调用链
  const pending = [];        // 待人工确认的动作
  let round = 0;
  let finalText = '';
  let usageTotal = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  while (round < maxRounds) {
    round++;
    emit({ type: 'round', round });
    let res;
    try {
      res = await llm.chat(cfg, messages, {
        stream: cfg.stream !== false,
        tools,
        signal: p.signal,
        onDelta: (d) => {
          if (d.type === 'reasoning') emit({ type: 'reasoning', text: d.text });
          else if (d.type === 'content') emit({ type: 'content', text: d.text });
          else if (d.type === 'tool_call_delta') emit({ type: 'tool_call_delta', name: d.name });
        },
      });
    } catch (e) {
      emit({ type: 'error', message: e.message, code: e.status === 401 ? 'AUTH' : 'LLM' });
      return { ok: false, error: e.message };
    }

    if (res.usage) {
      usageTotal.prompt_tokens += res.usage.prompt_tokens || 0;
      usageTotal.completion_tokens += res.usage.completion_tokens || 0;
      usageTotal.total_tokens += res.usage.total_tokens || 0;
    }
    if (res.reasoning) emit({ type: 'reasoning_done', length: res.reasoning.length });
    if (res.content) finalText += res.content;

    const assistantMsg = { role: 'assistant', content: res.content || '' };
    if (res.toolCalls && res.toolCalls.length) {
      assistantMsg.tool_calls = res.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.rawArguments } }));
    }
    messages.push(assistantMsg);

    if (!res.toolCalls || !res.toolCalls.length) {
      emit({ type: 'done', content: finalText, usage: usageTotal, rounds: round, trace, pending });
      return { ok: true, content: finalText, trace, pending, usage: usageTotal, rounds: round };
    }

    // 并行执行多个工具调用（无依赖的查询可并行，写操作串行以免编号冲突）
    const results = [];
    for (const tc of res.toolCalls) {
      const tool = findTool(tc.name);
      const t0 = Date.now();
      if (!tool) {
        results.push({ id: tc.id, name: tc.name, ok: false, content: JSON.stringify({ ok: false, error: '工具不存在：' + tc.name }) });
        continue;
      }
      emit({ type: 'tool_call', id: tc.id, name: tc.name, label: tool.label, plugin: tool.plugin, args: tc.arguments, write: tool.write, confirm: tool.confirm });

      // 人工确认拦截
      if (registry.needsConfirm(tc.name, agentCfg.confirmActions)) {
        const action = {
          id: 'PA-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          tool: tc.name, label: tool.label, plugin: tool.plugin, args: tc.arguments,
          sessionId: p.sessionId, createdAt: new Date().toISOString(), status: 'pending',
        };
        store.col('pendingActions').insert(action);
        pending.push(action);
        emit({ type: 'confirm_required', id: action.id, name: tc.name, label: tool.label, plugin: tool.plugin, args: tc.arguments });
        results.push({
          id: tc.id, name: tc.name, ok: true, status: 'pending_confirm',
          content: JSON.stringify({ ok: true, status: '已挂起等待人工确认', 待确认编号: action.id, 说明: '该动作属于"对外承诺/对外发送/8D关闭"类，系统已生成待确认项，用户在界面点击确认后才会真正执行。请告知用户，不要声称已执行。' }),
        });
        continue;
      }

      let out;
      try {
        out = await tool.run(tc.arguments || {}, { outputDir: p.outputDir });
      } catch (e) {
        out = { ok: false, error: '工具执行异常：' + e.message };
      }
      const ms = Date.now() - t0;
      const summary = summarize(tc.name, out);
      trace.push({ name: tc.name, label: tool.label, plugin: tool.plugin, args: tc.arguments, summary, ms, ok: out && out.ok !== false });
      store.audit({ user: '当前用户', plugin: tool.plugin, action: tool.label, params: tc.arguments, resultSummary: summary, purpose: '智能体调用' });
      emit({ type: 'tool_result', id: tc.id, name: tc.name, label: tool.label, plugin: tool.plugin, ok: out && out.ok !== false, summary, ms, result: out });
      results.push({ id: tc.id, name: tc.name, ok: out && out.ok !== false, content: JSON.stringify(out) });
    }

    for (const r of results) messages.push({ role: 'tool', tool_call_id: r.id, name: r.name, content: truncate(r.content, 24000) });
    emit({ type: 'round_end', round });
  }

  // 达到轮次上限
  const tail = '\n\n（已达到最大工具调用轮次 ' + maxRounds + '，如需继续请分步提问。）';
  finalText += tail;
  emit({ type: 'content', text: tail });
  emit({ type: 'done', content: finalText, usage: usageTotal, rounds: round, trace, pending, truncated: true });
  return { ok: true, content: finalText, trace, pending, usage: usageTotal, rounds: round, truncated: true };
}

function truncate(s, n) { return s && s.length > n ? s.slice(0, n) + '…[结果过长已截断]' : s; }

/** 执行一个被人工确认的动作 */
async function executePending(actionId, outputDir) {
  const a = store.col('pendingActions').get(actionId);
  if (!a) return { ok: false, error: '待确认项不存在或已处理' };
  if (a.status !== 'pending') return { ok: false, error: '该待确认项已' + (a.status === 'approved' ? '执行' : '被拒绝') };
  const tool = registry.get(a.tool);
  if (!tool) return { ok: false, error: '工具不存在' };
  let out;
  try { out = await tool.run(a.args || {}, { outputDir }); }
  catch (e) { out = { ok: false, error: e.message }; }
  const ok = out && out.ok !== false;
  store.col('pendingActions').update(a.id, { status: ok ? 'approved' : 'failed', decidedAt: new Date().toISOString(), result: summarize(a.tool, out) });
  store.audit({ user: '当前用户（人工确认）', plugin: a.plugin, action: a.label, params: a.args, resultSummary: summarize(a.tool, out), purpose: '人工确认后执行' });
  return { ok, tool: a.tool, label: a.label, result: out, summary: summarize(a.tool, out) };
}

function rejectPending(actionId, reason) {
  const a = store.col('pendingActions').get(actionId);
  if (!a) return { ok: false, error: '待确认项不存在' };
  store.col('pendingActions').update(a.id, { status: 'rejected', decidedAt: new Date().toISOString(), reason: reason || '' });
  store.audit({ user: '当前用户', plugin: a.plugin, action: a.label, params: a.args, resultSummary: '人工拒绝：' + (reason || ''), purpose: '人工确认' });
  return { ok: true };
}

/** AI 晨报：真实汇总，不编造 */
async function morningReport(settings) {
  const { dashboardSnapshot } = require('./tools/docs');
  const snap = dashboardSnapshot('');
  const risks = registry.get('aqi_risk_scan').run({ days: 3 });
  const lines = [];
  lines.push('# AI 质量晨报 · ' + new Date().toISOString().slice(0, 10));
  lines.push('数据截至：' + snap.dataAt + '　|　自动生成，全部数字来自平台插件实时查询');
  lines.push('');
  lines.push('## 一、过程判异');
  if (snap.violations > 0) {
    snap.violationRows.slice(0, 5).forEach((v) => lines.push('- ⚠ **' + v.char + '** 命中 ' + v.rules + '（严重度：' + v.severity + '，涉及 ' + v.count + ' 点，控制限 ' + v.limits + '）'));
  } else lines.push('- 昨日无 SPC 判异信号');
  lines.push('');
  lines.push('## 二、质量风险');
  (risks.风险清单 || []).slice(0, 5).forEach((r) => lines.push('- [' + r.等级 + '级] **' + r.对象 + '**：' + r.描述 + '　→ 建议：' + r.建议动作));
  if (!risks.风险清单 || !risks.风险清单.length) lines.push('- 未发现显著风险');
  lines.push('');
  lines.push('## 三、问题与项目');
  lines.push('- 未关闭质量问题 ' + snap.issueOpen + ' 起（A 级 ' + snap.issueA + ' 起）；在改项目 ' + snap.projOpen + ' 个，超期 ' + snap.projOverdue + ' 个，按期率 ' + snap.onTimeRate);
  lines.push('');
  lines.push('## 四、经营指标');
  lines.push('- 过程合格率（FTT 代理值）：' + snap.ftt + '（基于 ' + snap.measurements + ' 个在线测量点，超差 ' + snap.oos + ' 点）');
  lines.push('- 已核定改进收益：' + snap.benefitVerified + ' 万元');
  lines.push('');
  lines.push('## 五、今日待办');
  const todos = store.col('todos').find((t) => !t.done).slice(0, 6);
  todos.forEach((t) => lines.push('- [' + t.priority + '] ' + t.title + '（' + t.user + '，' + (t.dueAt || '').slice(0, 16).replace('T', ' ') + '）'));
  if (!todos.length) lines.push('- 暂无待办');
  return { markdown: lines.join('\n'), snapshot: snap, risks };
}

module.exports = { run, executePending, rejectPending, morningReport, buildSystemPrompt, summarize, maskSensitive, registry };

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

