'use strict';
/**
 * 智能体内核（内置实现）—— 改走 Harness 内置真实 DeepSeek 模型
 * ------------------------------------------------------------------
 * 与内置 src/agent.js 的区别只有一处：不再用「OpenAI 兼容 + API Key」直连，
 * 而是把每一轮推理交给 DeepSeek Harness 的 ctx.llm（真实 DeepSeek）。
 *
 * 工具编排协议：每轮模型只输出一个 JSON（ReAct）：
 *   调工具 {"thought":"...","tool":"工具名","args":{...}}
 *   给结论 {"thought":"...","final":"Markdown 回答"}
 * 这样不依赖各供应商 function-calling 的差异，任何 Harness 模型都能稳定编排。
 *
 * 护栏沿用内置实现：结论要有出处、三类动作人工确认、VIN/手机号脱敏、全程审计。
 */
const store = require('./src/lib/store');
const base = require('./src/agent');
const registry = base.registry;

const runtime = { llm: null };
function setRuntime(next) { Object.assign(runtime, next || {}); }

const CONFIRM_HINT = '该动作属于「对外发送 / 对外承诺 / 项目关闭」类，系统已挂起为待确认项；请告诉用户点击确认后才会真正执行，不要声称已经执行。';

/* ---------------- 工具筛选与目录 ---------------- */

function pluginFilter(settings) {
  const plugins = (settings && settings.plugins) || {};
  const disabled = new Set();
  Object.keys(plugins).forEach((k) => { if (plugins[k] && plugins[k].enabled === false) disabled.add(plugins[k].name); });
  return (t) => !disabled.has(t.plugin);
}

function signatureOf(params) {
  const props = (params && params.properties) || {};
  const required = new Set((params && params.required) || []);
  return Object.keys(props)
    .map((key) => (required.has(key) ? key : key + '?'))
    .join(', ');
}

function catalogText(tools) {
  return tools
    .map((t) => '- ' + t.name + '(' + signatureOf(t.parameters) + ')：[' + t.plugin + '] ' + t.label +
      (t.description ? ' — ' + String(t.description).replace(/\s+/g, ' ').slice(0, 140) : ''))
    .join('\n');
}

function protocolText(tools, maxRounds) {
  return [
    '',
    '# 工具调用协议（必须严格遵守）',
    '你有两类输出，二选一；**每轮只输出一个 JSON 对象**，不要输出 Markdown 代码块以外的任何解释文字。',
    '1) 需要取数/执行动作时：',
    '{"thought":"为什么调用、期望拿到什么","tool":"工具名","args":{参数对象}}',
    '2) 已经可以回答时：',
    '{"thought":"本轮推理摘要","final":"给用户的完整中文 Markdown 回答"}',
    '',
    '规则：',
    '- tool 必须是下面清单里的名字，禁止编造；args 按括号里的参数签名给，缺省参数可以省略。',
    '- 每轮只调用一个工具；拿到工具结果后再决定下一步。最多 ' + maxRounds + ' 轮。',
    '- 回答里的每一个数字都必须来自工具返回值；没有工具数据支撑的判断只能写成「假设」，并给出验证方法。',
    '- 需要人工确认的动作会被系统挂起，不要在回答里声称它已经执行。',
    '',
    '# 可用工具（共 ' + tools.length + ' 个，全部真实执行）',
    catalogText(tools),
    '',
  ].join('\n');
}

/* ---------------- 解析模型输出 ---------------- */

function parseAction(raw) {
  const text = String(raw || '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(body.slice(start, end + 1));
      if (obj && typeof obj === 'object') {
        if (typeof obj.tool === 'string' && obj.tool) {
          return { thought: obj.thought ? String(obj.thought) : '', tool: obj.tool, args: obj.args && typeof obj.args === 'object' ? obj.args : {} };
        }
        if (typeof obj.final === 'string') return { thought: obj.thought ? String(obj.thought) : '', final: obj.final };
        if (typeof obj.answer === 'string') return { thought: obj.thought ? String(obj.thought) : '', final: obj.answer };
      }
    } catch (_) { /* 不是 JSON：按普通回答处理 */ }
  }
  return { thought: '', final: text.trim() };
}

function truncate(text, max) {
  return text && text.length > max ? text.slice(0, max) + '…[已截断]' : text;
}

function buildUserMessage({ question, history, transcript }) {
  const lines = [];
  if (history && history.length) {
    lines.push('<历史对话>');
    for (const item of history) lines.push((item.role === 'user' ? '用户：' : '助手：') + truncate(String(item.content || ''), 1200));
    lines.push('</历史对话>');
    lines.push('');
  }
  lines.push('<用户当前问题>');
  lines.push(question);
  lines.push('</用户当前问题>');
  if (transcript && transcript.length) {
    lines.push('');
    lines.push('<已执行的工具调用与真实返回>');
    for (const step of transcript) {
      lines.push('[工具] ' + step.name + ' 参数=' + JSON.stringify(step.args || {}));
      lines.push('[真实返回] ' + truncate(step.resultText, 6000));
    }
    lines.push('</已执行的工具调用与真实返回>');
  }
  lines.push('');
  lines.push('现在请继续：要么按协议输出下一个工具调用，要么输出最终回答。');
  return lines.join('\n');
}

/* ---------------- 主循环 ---------------- */

async function run(p, onEvent) {
  const emit = (event) => { try { if (onEvent) onEvent(event); } catch (_) { /* 前端已断开 */ } };
  const settings = p.settings || store.db.settings || {};
  const agentCfg = settings.agent || {};
  const maxRounds = Math.min(Math.max(Number(agentCfg.maxRounds) || 8, 1), 16);
  const llm = runtime.llm;

  if (!llm) {
    emit({ type: 'error', code: 'NO_MODEL', message: 'Harness 当前没有可用模型，插件无法发起真实对话。请先在 Harness 里完成 DeepSeek 模型接入。' });
    return { ok: false, code: 'NO_MODEL' };
  }

  const tools = registry.all().filter(pluginFilter(settings));
  const byName = new Map(tools.map((t) => [t.name, t]));
  emit({ type: 'start', model: (runtime.model && runtime.model.model) || 'DeepSeek', tools: tools.length, rounds: maxRounds });

  const system = base.buildSystemPrompt(settings) + protocolText(tools, maxRounds);
  const history = (p.history || []).slice(-24);
  const mask = (text) => (agentCfg.maskSensitive === false ? String(text) : base.maskSensitive(String(text)));
  const question = mask(p.text || '');

  const trace = [];
  const pending = [];
  const transcript = [];
  let round = 0;
  let finalText = '';
  let usage = null;
  let lastModel = null;

  while (round < maxRounds) {
    round += 1;
    emit({ type: 'round', round });

    let result;
    try {
      result = await llm.complete({
        system,
        user: buildUserMessage({ question, history, transcript }),
        maxTokens: 3200,
        signal: p.signal,
      });
    } catch (err) {
      emit({ type: 'error', message: err.message, round });
      return { ok: false, error: err.message, rounds: round, trace, pending };
    }
    lastModel = result.model;
    if (result.usage) usage = result.usage;

    const action = parseAction(result.text);
    if (action.thought) {
      emit({ type: 'reasoning', text: action.thought });
      emit({ type: 'reasoning_done', length: action.thought.length });
    }

    if (!action.tool) {
      finalText = action.final || '（模型没有返回内容）';
      emit({ type: 'content', text: finalText });
      emit({ type: 'done', content: finalText, rounds: round, trace, pending, model: lastModel });
      return { ok: true, content: finalText, trace, pending, rounds: round, model: lastModel, usage };
    }

    const tool = byName.get(action.tool);
    const callId = 'tc-' + Date.now().toString(36) + '-' + round;
    if (!tool) {
      const summary = '✖ 工具不存在：' + action.tool;
      emit({ type: 'tool_call', id: callId, name: action.tool, label: action.tool, plugin: '未知', args: action.args });
      emit({ type: 'tool_result', id: callId, name: action.tool, label: action.tool, plugin: '未知', ok: false, summary, ms: 0, result: { ok: false, error: summary } });
      transcript.push({ name: action.tool, args: action.args, resultText: JSON.stringify({ ok: false, error: '工具不存在，请从清单中选择' }) });
      continue;
    }

    emit({ type: 'tool_call', id: callId, name: tool.name, label: tool.label, plugin: tool.plugin, args: action.args, write: tool.write, confirm: tool.confirm });

    // 护栏：三类动作挂起，等人工确认
    if (registry.needsConfirm(tool.name, agentCfg.confirmActions)) {
      const item = {
        id: 'PA-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        tool: tool.name, label: tool.label, plugin: tool.plugin, args: action.args,
        sessionId: p.sessionId, createdAt: new Date().toISOString(), status: 'pending',
      };
      store.col('pendingActions').insert(item);
      pending.push(item);
      emit({ type: 'confirm_required', id: item.id, name: tool.name, label: tool.label, plugin: tool.plugin, args: action.args });
      const pendingPayload = { ok: true, status: '已挂起等待人工确认', 待确认编号: item.id, 说明: CONFIRM_HINT };
      emit({ type: 'tool_result', id: callId, name: tool.name, label: tool.label, plugin: tool.plugin, ok: true, summary: '⏸ 已挂起待人工确认', ms: 0, result: pendingPayload });
      transcript.push({ name: tool.name, args: action.args, resultText: JSON.stringify(pendingPayload) });
      continue;
    }

    const started = Date.now();
    let output;
    try {
      output = await tool.run(action.args || {}, { outputDir: p.outputDir });
    } catch (err) {
      output = { ok: false, error: '工具执行异常：' + err.message };
    }
    if (output && typeof output.then === 'function') output = await output;
    const ms = Date.now() - started;
    const ok = !(output && output.ok === false);
    const summary = base.summarize(tool.name, output);

    trace.push({ name: tool.name, label: tool.label, plugin: tool.plugin, args: action.args, summary, ms, ok });
    try {
      store.audit({
        user: '当前用户', plugin: tool.plugin, action: tool.label,
        params: action.args, resultSummary: summary, purpose: '智能体调用（Harness 内置 DeepSeek）',
      });
    } catch (_) { /* 审计失败不影响主流程 */ }

    emit({ type: 'tool_result', id: callId, name: tool.name, label: tool.label, plugin: tool.plugin, ok, summary, ms, result: output });
    transcript.push({ name: tool.name, args: action.args, resultText: JSON.stringify(output) });
  }

  const tail = '\n\n（已达到最大工具调用轮次 ' + maxRounds + '，如需继续请分步提问。）';
  finalText += tail;
  emit({ type: 'content', text: tail });
  emit({ type: 'done', content: finalText, rounds: round, trace, pending, truncated: true, model: lastModel });
  return { ok: true, content: finalText, trace, pending, rounds: round, truncated: true, model: lastModel, usage };
}

module.exports = {
  run,
  setRuntime,
  runtime,
  morningReport: base.morningReport,
  executePending: base.executePending,
  rejectPending: base.rejectPending,
  summarize: base.summarize,
  buildSystemPrompt: base.buildSystemPrompt,
  maskSensitive: base.maskSensitive,
  registry,
};
