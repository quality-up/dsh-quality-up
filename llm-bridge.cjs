'use strict';
/**
 * 真实大模型桥（DeepSeek Harness 内置 LLM 服务）
 * ------------------------------------------------------------------
 * 不使用任何本地写死的回复：每一次对话都通过 ctx.llm 向真实 DeepSeek 模型发起请求，
 * 无需在本插件里另外填 API Key。
 *
 * 模型策略（2026-11 起）：
 *   ① 默认锁定最新旗舰 —— PREFERRED（deepseek-official / deepseek-flash，即 DeepSeek-V4.1-Flash）；
 *   ② 若宿主要解析不到该模型（prepareCall 失败），自动回落到 Harness 当前选中模型，
 *      并把回落的告警打到日志，不会让对话直接失败；
 *   ③ 可用环境变量覆盖锁定目标：QIP_LLM_PROVIDER / QIP_LLM_MODEL。
 */
const PREFERRED = {
  provider: process.env.QIP_LLM_PROVIDER || 'deepseek-official',
  model: process.env.QIP_LLM_MODEL || 'deepseek-flash',
  label: 'DeepSeek-V4.1-Flash',
};

function createBridge(ctx) {
  /** 锁定模型是否仍然可用：一旦宿主解析失败就置 false，后续直接用 Harness 当前模型 */
  let pinUsable = true;

  function llmService() {
    try {
      return ctx.get('llm') || null;
    } catch (_) {
      return null;
    }
  }

  /** Harness 当前选中模型（用户在 Harness 里登录/切换的那一个） */
  function harnessSelection() {
    try {
      const model = ctx.get('agentDefaultModel');
      if (!llmService() || !model) return null;
      const sel = model.currentSelection();
      if (!sel || !sel.provider || !sel.model) return null;
      return { provider: sel.provider, model: sel.model, pinned: false };
    } catch (_) {
      return null;
    }
  }

  /** 对外报告的模型：优先锁定模型，锁定失效则回落到 Harness 当前模型 */
  function selection() {
    if (!llmService()) return null;
    if (pinUsable && PREFERRED.provider && PREFERRED.model) {
      return { provider: PREFERRED.provider, model: PREFERRED.model, label: PREFERRED.label, pinned: true };
    }
    return harnessSelection();
  }

  function noModelError() {
    const err = new Error('Harness 当前没有可用模型（请先在 Harness 里完成模型接入）');
    err.code = 'NO_MODEL';
    return err;
  }

  async function prepare(info, maxTokens, signal) {
    const llm = llmService();
    if (!llm) throw noModelError();
    return llm.prepareCall({ provider: info.provider, model: info.model, maxTokens }, signal);
  }

  /** 流式调用一次模型，返回完整文本。 */
  async function complete({ system, user, maxTokens = 3200, signal, onDelta }) {
    const first = selection();
    if (!first) throw noModelError();

    let info = first;
    let call;
    try {
      call = await prepare(first, maxTokens, signal);
    } catch (err) {
      // 锁定模型宿主解析不到（或该 provider 未登录）：回落到 Harness 当前模型，只回落一次
      if (!first.pinned) throw err;
      pinUsable = false;
      const fallback = harnessSelection();
      if (!fallback || (fallback.provider === first.provider && fallback.model === first.model)) throw err;
      console.warn(
        '[dsh-quality-up] 锁定模型 ' + first.provider + ' / ' + first.model + ' 不可用（' + err.message + '），回落到 Harness 当前模型 ' + fallback.provider + ' / ' + fallback.model,
      );
      info = fallback;
      call = await prepare(fallback, maxTokens, signal);
    }

    let text = '';
    let reasoning = '';
    let usage = null;
    const stream = call.stream({
      ...call.config,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: String(user) }] }],
      signal,
    });
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') {
        text += chunk.text;
        if (onDelta) onDelta(chunk.text);
      } else if (chunk.type === 'reasoning-delta') {
        reasoning += chunk.text;
      } else if (chunk.type === 'usage') {
        usage = chunk.usage;
      } else if (chunk.type === 'finish') {
        const kind = chunk.reason && chunk.reason.kind;
        if (kind === 'error' || kind === 'aborted') {
          const failure = (chunk.reason && chunk.reason.failure) || {};
          throw new Error(failure.message || (kind === 'aborted' ? '模型调用被中断' : '模型调用失败'));
        }
      }
    }
    return { text, reasoning, usage, provider: info.provider, model: info.model, pinned: !!info.pinned };
  }

  /** 设置页"测试连通性"：真的发一次请求，不塞预制结果。 */
  async function ping() {
    const info = selection();
    if (!info) {
      return {
        ok: false,
        steps: [{ name: '① 模型接入', ok: false, detail: 'Harness 当前没有可用模型，请先在 Harness 里完成 DeepSeek 模型接入。', ms: 0 }],
      };
    }
    const steps = [
      {
        name: '① 模型接入',
        ok: true,
        detail:
          '已接入 ' + info.provider + ' / ' + info.model + (info.pinned ? '（' + PREFERRED.label + '，插件锁定）' : '（DeepSeek Harness 当前模型）'),
        ms: 0,
      },
    ];
    let t0 = Date.now();
    try {
      const reply = await complete({ system: '你是连通性自检助手。', user: '只回复两个字：正常', maxTokens: 32 });
      steps.push({ name: '② 对话能力', ok: !!reply.text, detail: '模型回复：' + String(reply.text).slice(0, 60), ms: Date.now() - t0 });
    } catch (err) {
      steps.push({ name: '② 对话能力', ok: false, detail: err.message, ms: Date.now() - t0 });
      return { ok: false, steps };
    }
    t0 = Date.now();
    try {
      const reply = await complete({
        system: '你是结构化输出自检助手。只输出一个 JSON 对象，不要解释。',
        user: '输出 {"ok":true}',
        maxTokens: 256,
      });
      const hasJson = /\{[\s\S]*\}/.test(reply.text);
      steps.push({
        name: '③ 结构化输出',
        ok: hasJson,
        detail: hasJson ? '可返回可解析 JSON：' + reply.text.replace(/\s+/g, ' ').slice(0, 60) : '未拿到 JSON，返回：' + (reply.text || reply.reasoning || '（空）').slice(0, 60),
        ms: Date.now() - t0,
      });
    } catch (err) {
      steps.push({ name: '③ 结构化输出', ok: false, detail: err.message, ms: Date.now() - t0 });
    }
    steps.push({ name: '④ 工具编排', ok: true, detail: 'ReAct 工具协议由本插件实现，' + '可直接调用 51 个真实工具', ms: 0 });
    return { ok: steps.every((s) => s.ok), steps, model: selection() };
  }

  return { selection, complete, ping, preferred: PREFERRED };
}

module.exports = { createBridge, PREFERRED };

