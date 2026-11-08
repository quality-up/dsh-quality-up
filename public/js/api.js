/* ==================================================================
   API 客户端：REST 封装 + SSE 流式对话
   ================================================================== */
(function (global) {
  'use strict';

  async function req(method, path, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    // 业务编号可能带 '#'（如 #QP-0377），必须转义，否则会被当成 URL 片段
    const res = await fetch(encodeURI(path.replace(/#/g, '%23')), opt);
    const txt = await res.text();
    let json;
    try { json = txt ? JSON.parse(txt) : {}; } catch (e) { throw new Error('服务端返回了非 JSON 内容（HTTP ' + res.status + '）：' + txt.slice(0, 200)); }
    if (!res.ok && json.error) throw new Error(json.error);
    return json;
  }
  function qs(params) {
    const p = new URLSearchParams();
    Object.keys(params || {}).forEach((k) => { if (params[k] !== undefined && params[k] !== null && params[k] !== '') p.set(k, params[k]); });
    const s = p.toString();
    return s ? '?' + s : '';
  }

  const API = {
    get: (path, params) => req('GET', path + qs(params)),
    post: (path, body) => req('POST', path, body || {}),
    put: (path, body) => req('PUT', path, body || {}),
    del: (path) => req('DELETE', path),
    bootstrap: () => req('GET', '/qip/api/bootstrap'),
    health: () => req('GET', '/qip/api/health'),

    /** 工具直接调用（界面按钮） */
    tool: (name, args) => req('POST', '/qip/api/tools/' + name, args || {}),

    /** 流式对话：onEvent 收到 start/reasoning/content/tool_call/tool_result/confirm_required/done/error/finish */
    async chat(payload, onEvent, signal) {
      const res = await fetch('/qip/api/chat/stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal,
      });
      if (!res.ok) {
        let msg = 'HTTP ' + res.status;
        try { const j = await res.json(); msg = j.error || msg; } catch (e) {}
        onEvent({ type: 'error', message: msg });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder('utf-8');
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const evt = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = evt.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try { onEvent(JSON.parse(data)); } catch (e) { /* 忽略 */ }
        }
      }
    },

    /** 文件导入：转 base64 上传 */
    async importFile(file, target) {
      const b64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1]);
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      return req('POST', '/qip/api/import', { filename: file.name, base64: b64, target });
    },
  };

  global.API = API;
})(window);
