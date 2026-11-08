'use strict';
/**
 * LLM 客户端（零依赖，Node 18+ 内置 fetch）
 * ------------------------------------------------------------------
 * 兼容任何 OpenAI 风格的 /chat/completions 端点：
 *   · DeepSeek 官方      baseUrl = https://api.deepseek.com
 *   · 厂内私有化部署      baseUrl = http://10.x.x.x:8000/v1   (vLLM / TGI / Ollama OpenAI 兼容层)
 *   · 其它兼容网关        baseUrl = https://xxx/v1
 * 支持：流式 SSE、工具调用（function calling）增量拼装、reasoning_content 思维链、
 *       超时控制、错误归一化、用量统计。
 */
const DEFAULT_TIMEOUT = 120000;

function normalizeBase(baseUrl) {
  let b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!b) b = 'https://api.deepseek.com';
  // Ollama 原生端口给出提示式兼容
  if (/\/v1$/.test(b)) return b;
  if (/ollama/i.test(b) && !/\/v1/.test(b)) return b + '/v1';
  return b;
}

function buildUrl(baseUrl, path) {
  const b = normalizeBase(baseUrl);
  // DeepSeek 官方同时支持 /chat/completions 与 /v1/chat/completions
  const p = path.replace(/^\//, '');
  return b + '/' + p;
}

class LLMError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'LLMError';
    this.status = status;
    this.body = body;
  }
}

/**
 * 发起一次 chat completion
 * @param {object} cfg {baseUrl, apiKey, model, temperature, maxTokens, timeoutMs}
 * @param {Array} messages OpenAI 格式消息
 * @param {object} opts {tools, toolChoice, stream, onDelta, signal, jsonMode}
 * @returns {Promise<{content:string, reasoning:string, toolCalls:Array, usage:object, finishReason:string, raw:object}>}
 */
async function chat(cfg, messages, opts = {}) {
  const baseUrl = normalizeBase(cfg.baseUrl);
  const model = cfg.model || 'deepseek-chat';
  const body = {
    model,
    messages,
    temperature: cfg.temperature === undefined ? 0.3 : cfg.temperature,
    stream: !!opts.stream,
  };
  if (cfg.maxTokens) body.max_tokens = cfg.maxTokens;
  if (opts.tools && opts.tools.length) {
    body.tools = opts.tools;
    body.tool_choice = opts.toolChoice || 'auto';
  }
  if (opts.jsonMode) body.response_format = { type: 'json_object' };

  const ctrl = new AbortController();
  const timeout = cfg.timeoutMs || DEFAULT_TIMEOUT;
  const timer = setTimeout(() => ctrl.abort(new Error('LLM 请求超时（' + Math.round(timeout / 1000) + 's）')), timeout);
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
  if (cfg.extraHeaders) Object.assign(headers, cfg.extraHeaders);

  let res;
  try {
    res = await fetch(buildUrl(baseUrl, 'chat/completions'), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const msg = e && e.name === 'AbortError' ? 'LLM 请求已中止或超时：' + (ctrl.signal.reason && ctrl.signal.reason.message ? ctrl.signal.reason.message : e.message) : 'LLM 网络请求失败：' + (e && e.message);
    throw new LLMError(msg, 0, null);
  }

  if (!res.ok) {
    clearTimeout(timer);
    let text = '';
    try { text = await res.text(); } catch (_) {}
    throw new LLMError(explainHttpError(res.status, text, baseUrl), res.status, text);
  }

  if (!body.stream) {
    clearTimeout(timer);
    const json = await res.json();
    const choice = (json.choices && json.choices[0]) || {};
    const msg = choice.message || {};
    const out = {
      content: msg.content || '',
      reasoning: msg.reasoning_content || msg.reasoning || '',
      toolCalls: (msg.tool_calls || []).map(normalizeToolCall),
      usage: json.usage || {},
      finishReason: choice.finish_reason || 'stop',
      raw: json,
    };
    if (opts.onDelta) {
      if (out.reasoning) opts.onDelta({ type: 'reasoning', text: out.reasoning });
      if (out.content) opts.onDelta({ type: 'content', text: out.content });
    }
    return out;
  }

  // ---------------- 流式解析 ----------------
  const acc = { content: '', reasoning: '', toolCalls: [], usage: {}, finishReason: 'stop' };
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  /** 流式 tool_calls 按 index 拼装 */
  const toolMap = new Map();

  function handleChunk(json) {
    if (json.usage) acc.usage = json.usage;
    const choice = (json.choices && json.choices[0]) || {};
    if (choice.finish_reason) acc.finishReason = choice.finish_reason;
    const delta = choice.delta || {};
    if (delta.reasoning_content) {
      acc.reasoning += delta.reasoning_content;
      if (opts.onDelta) opts.onDelta({ type: 'reasoning', text: delta.reasoning_content });
    }
    if (delta.content) {
      acc.content += delta.content;
      if (opts.onDelta) opts.onDelta({ type: 'content', text: delta.content });
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index === undefined ? 0 : tc.index;
        if (!toolMap.has(idx)) toolMap.set(idx, { id: '', type: 'function', function: { name: '', arguments: '' } });
        const cur = toolMap.get(idx);
        if (tc.id) cur.id = tc.id;
        if (tc.type) cur.type = tc.type;
        if (tc.function) {
          if (tc.function.name) cur.function.name += tc.function.name;
          if (tc.function.arguments) cur.function.arguments += tc.function.arguments;
        }
        if (opts.onDelta) opts.onDelta({ type: 'tool_call_delta', index: idx, name: tc.function && tc.function.name, args: tc.function && tc.function.arguments });
      }
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        let line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        line = line.replace(/\r$/, '');
        if (!line) continue;
        if (line.startsWith(':')) continue;               // SSE 注释/心跳
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') { buf = ''; break; }
        try { handleChunk(JSON.parse(data)); } catch (_) { /* 忽略不完整分片 */ }
      }
    }
  } catch (e) {
    clearTimeout(timer);
    throw new LLMError('LLM 流式读取中断：' + (e && e.message), 0, null);
  }
  clearTimeout(timer);

  acc.toolCalls = [...toolMap.keys()].sort((a, b) => a - b).map((k) => normalizeToolCall(toolMap.get(k)));
  return acc;
}

function normalizeToolCall(tc) {
  const fn = tc.function || {};
  let args = fn.arguments;
  if (typeof args === 'string') {
    const s = args.trim();
    if (!s) args = {};
    else { try { args = JSON.parse(s); } catch (_) { args = { __raw: s, __parseError: true }; } }
  }
  return {
    id: tc.id || 'call_' + Math.random().toString(36).slice(2, 10),
    type: 'function',
    name: fn.name || '',
    arguments: args || {},
    rawArguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments || {}),
  };
}

/** 把 HTTP 错误翻译成运维一眼能懂的提示 */
function explainHttpError(status, text, baseUrl) {
  let detail = text || '';
  try { const j = JSON.parse(text); detail = (j.error && (j.error.message || j.error.code)) || j.message || text; } catch (_) {}
  const tips = {
    401: 'API Key 无效或已过期，请在「系统设置 → 模型接入」中重新填写。',
    402: '账户余额不足（DeepSeek 按量计费），请先充值。',
    403: '无权限访问该模型或该接口。',
    404: '接口地址不存在。请检查 Base URL（DeepSeek 官方为 https://api.deepseek.com，自建服务通常需要在末尾加 /v1）。',
    422: '请求参数不合法（常见原因：模型名写错、消息格式不合法）。',
    429: '请求过于频繁或超出配额，请稍后重试。',
    500: '模型服务端错误，请稍后重试。',
    502: '网关错误：上游模型服务不可达（自建部署请确认 vLLM/Ollama 已启动）。',
    503: '模型服务暂不可用（自建部署常见：服务未启动或显存不足）。',
    504: '网关超时。',
  };
  return '模型接口返回 ' + status + '：' + (tips[status] || '未知错误。') + (detail ? ' 服务端信息：' + String(detail).slice(0, 400) : '') + '（当前 Base URL：' + normalizeBase(baseUrl) + '）';
}

/**
 * 连通性自检：依次尝试 models 列表与一次极短对话
 * @returns {Promise<{ok:boolean, steps:Array<{name:string, ok:boolean, detail:string, ms:number}>}>}
 */
async function testConnection(cfg) {
  const steps = [];
  // 1) /models
  let t0 = Date.now();
  try {
    const headers = {};
    if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
    const res = await fetch(buildUrl(cfg.baseUrl, 'models'), { headers, signal: AbortSignal.timeout(15000) });
    const ms = Date.now() - t0;
    if (res.ok) {
      const j = await res.json().catch(() => ({}));
      const ids = (j.data || []).map((m) => m.id).slice(0, 20);
      steps.push({ name: '① 接口连通性（GET /models）', ok: true, detail: '可达；可用模型：' + (ids.join(', ') || '未返回列表'), ms });
    } else {
      const txt = await res.text().catch(() => '');
      steps.push({ name: '① 接口连通性（GET /models）', ok: false, detail: explainHttpError(res.status, txt, cfg.baseUrl), ms });
    }
  } catch (e) {
    steps.push({ name: '① 接口连通性（GET /models）', ok: false, detail: '无法连接：' + e.message, ms: Date.now() - t0 });
  }
  // 2) 最小对话
  t0 = Date.now();
  try {
    const r = await chat(Object.assign({}, cfg, { maxTokens: 32, timeoutMs: 30000 }), [
      { role: 'user', content: '请只回复两个字：正常' },
    ], { stream: false, tools: [] });
    steps.push({ name: '② 对话推理（POST /chat/completions）', ok: true, detail: '模型 ' + (cfg.model || 'deepseek-chat') + ' 回复：' + (r.content || '').trim().slice(0, 40), ms: Date.now() - t0 });
  } catch (e) {
    steps.push({ name: '② 对话推理（POST /chat/completions）', ok: false, detail: e.message, ms: Date.now() - t0 });
  }
  // 3) 工具调用能力
  t0 = Date.now();
  try {
    const r = await chat(Object.assign({}, cfg, { maxTokens: 128, timeoutMs: 45000 }), [
      { role: 'user', content: '请调用工具 get_now 查询当前时间。' },
    ], {
      stream: false,
      tools: [{ type: 'function', function: { name: 'get_now', description: '获取当前时间', parameters: { type: 'object', properties: {}, required: [] } } }],
    });
    const ok = r.toolCalls && r.toolCalls.length > 0;
    steps.push({ name: '③ 工具调用能力（function calling）', ok, detail: ok ? '模型正确发起工具调用：' + r.toolCalls[0].name : '模型未发起工具调用（该模型可能不支持 function calling，智能体将无法自动查数）', ms: Date.now() - t0 });
  } catch (e) {
    steps.push({ name: '③ 工具调用能力（function calling）', ok: false, detail: e.message, ms: Date.now() - t0 });
  }
  // 4) 流式能力
  t0 = Date.now();
  try {
    let got = 0;
    await chat(Object.assign({}, cfg, { maxTokens: 32, timeoutMs: 30000 }), [{ role: 'user', content: '数到三' }], {
      stream: true, tools: [], onDelta: (d) => { if (d.type === 'content') got += d.text.length; },
    });
    steps.push({ name: '④ 流式输出（SSE）', ok: got > 0, detail: got > 0 ? '流式正常，收到 ' + got + ' 个字符' : '未收到流式内容', ms: Date.now() - t0 });
  } catch (e) {
    steps.push({ name: '④ 流式输出（SSE）', ok: false, detail: e.message, ms: Date.now() - t0 });
  }

  return { ok: steps.every((s) => s.ok), steps };
}

module.exports = { chat, testConnection, LLMError, normalizeBase };
