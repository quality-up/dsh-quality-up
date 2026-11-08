/* ==================================================================
   应用入口：路由、状态、动作分发、智能体对话
   ================================================================== */
(function (global) {
  'use strict';
  const { esc, act, toast, modal, closeModal, table, tag, infoGrid, md, dt, day, num, empty, loadingBlock } = UI;

  const State = global.State = { bootstrap: null, page: 'dashboard', loading: false };
// 版式（大中型企业版 / 中小型企业版）：页面用 global.Scale.isSme() 决定文案与栏目
global.Scale = {
  isSme: () => State.bootstrap && State.bootstrap.scale === 'sme',
  scale: () => (State.bootstrap && State.bootstrap.scale) || 'large',
  label: () => (global.Scale.isSme() ? '中小型企业版' : '大中型企业版'),
};
  const Pages = global.Pages = global.Pages || {};

  /** 当前命名（「系统 → 初始设置」保存的车间/产品名）；未连接时用内置默认 */
  function namingNow() {
    const n = (State.bootstrap || {}).naming || {};
    return {
      workshops: (Array.isArray(n.workshops) && n.workshops.length) ? n.workshops : ['一车间', '二车间', '三车间', '四车间', '五车间'],
      products: (Array.isArray(n.products) && n.products.length) ? n.products : ['产品A', '产品B', '产品C'],
    };
  }
  const WS = () => namingNow().workshops;
  const PD = () => namingNow().products;

  /** 把「初始设置」表单当前值收成草稿（车间/产品行数可变） */
  function initDraftFromForm() {
    const all = UI.readForm(document.getElementById('content'));
    const ws = [];
    const pd = [];
    Object.keys(all).forEach((k) => {
      if (/^ws\d+$/.test(k)) ws[Number(k.slice(2))] = String(all[k] === undefined ? '' : all[k]);
      if (/^pd\d+$/.test(k)) pd[Number(k.slice(2))] = String(all[k] === undefined ? '' : all[k]);
    });
    const compact = (arr) => { const out = []; for (let i = 0; i < arr.length; i++) out.push(arr[i] === undefined ? '' : arr[i]); return out; };
    return {
      company: String(all.nmCompany || ''),
      dept: String(all.nmDept || ''),
      note: String(all.nmNote || ''),
      workshops: compact(ws),
      products: compact(pd),
    };
  }

  /* ==================================================================
     路由
     ================================================================== */
  async function go(page, opts) {
    opts = opts || {};
    if (!Pages[page]) page = 'dashboard';
    State.page = page;
    document.querySelectorAll('.nav-item[data-page]').forEach((el) => el.classList.toggle('active', el.getAttribute('data-page') === page));
    document.querySelectorAll('.nav-menu').forEach((m) => m.classList.toggle('has-active', !!m.querySelector('.nav-item.active')));
    const content = document.getElementById('content');
    content.innerHTML = '<div class="empty" style="padding-top:80px;"><span class="spin"></span>　正在加载数据…</div>';
    const def = Pages[page];
    document.getElementById('pgTitle').textContent = def.title || page;
    document.getElementById('pgSub').textContent = def.sub || '';
    if (location.hash.slice(1) !== page) history.replaceState(null, '', '#' + page);
    try {
      const html = await def.render();
      content.innerHTML = html;
      content.scrollTop = 0;
      if (def.mount) def.mount();
      if (page === 'aiwb' && window.renderChat) window.renderChat();
    } catch (e) {
      console.error(e);
      content.innerHTML = `<div class="card"><div class="card-hd"><span class="t">页面加载失败</span></div>
        <div style="color:#e5484d;font-size:12.5px;line-height:1.9;">${esc(e.message)}</div>
        <div style="margin-top:10px;">${act('重试', 'refreshPage', {}, 'btn btn-primary')}${act('检查服务状态', 'healthCheck', {}, 'btn')}</div></div>`;
    }
  }
  async function refresh() { await loadBootstrap(); await go(State.page); }

  /** 确认弹窗：返回 Promise<boolean>（rows 为 [label, value] 列表，便于核对要点） */
  function askConfirm(title, rows, note) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; closeModal(); resolve(v); };
      modal({
        width: 'narrow',
        title: '确认 · ' + title,
        sub: '请核对下面这套设置',
        body: (rows || []).map(([k, v]) =>
          `<div style="display:flex;gap:10px;font-size:12.5px;line-height:2;border-bottom:1px dashed #eef1f6;">
             <div style="width:64px;flex:0 0 64px;color:#8791a5;">${esc(k)}</div>
             <div style="flex:1;color:#16233c;font-weight:600;word-break:break-all;">${esc(v)}</div>
           </div>`).join('') +
          (note ? `<div style="font-size:11.5px;color:#8791a5;line-height:1.9;margin-top:10px;">${esc(note)}</div>` : ''),
        footer: `<button class="btn" data-confirm="0">取消</button><button class="btn btn-primary" data-confirm="1">确认应用</button>`,
      });
      const panel = document.querySelector('.dm-panel');
      if (panel) panel.addEventListener('click', (e) => {
        const b = e.target.closest('[data-confirm]');
        if (b) finish(b.getAttribute('data-confirm') === '1');
      });
    });
  }

  async function loadBootstrap() {
    try {
      State.bootstrap = await API.bootstrap();
      const cfg = (State.bootstrap.settings || {}).llm || {};
      const chip = document.getElementById('chipModel');
      chip.textContent = cfg.hasApiKey ? (cfg.model || '模型已配置') : '模型未配置';
      chip.className = 'ds-chip' + (cfg.hasApiKey ? '' : ' err');
      const st = document.getElementById('chipStatus');
      st.textContent = '服务正常';
      st.className = 'ds-chip';
      const counts = State.bootstrap.counts || {};
      const badge = document.getElementById('badgeTodo');
      const todos = (State.bootstrap.todos || []).length;
      if (todos) { badge.style.display = ''; badge.textContent = todos; } else badge.style.display = 'none';
      const pinfo = Object.entries(counts).map(([k, v]) => k + ' ' + v).join(' · ');
      document.getElementById('pgSub').title = pinfo;
      // 顶栏组织文案跟随「初始设置」里的公司 / 部门
      const org = State.bootstrap.org || {};
      const navOrg = document.getElementById('navOrg');
      if (navOrg) navOrg.textContent = [org.company, org.dept].filter(Boolean).join(' · ') || '未设置组织名称';
      // 平台显示名：填了公司名称就整站显示公司名称
      const brandNow = (typeof State.bootstrap.brand === 'string' && State.bootstrap.brand.trim()) || '质上开源质量平台';
      const brandEl = document.getElementById('brandName');
      if (brandEl) { brandEl.textContent = brandNow; brandEl.title = brandNow; }
      // 左上角圆形图标里的字也跟着公司名称走（取首字）
      const iconEl = document.querySelector('.logo-icon');
      if (iconEl) iconEl.textContent = (brandNow === '质上开源质量平台' ? '质' : brandNow.slice(0, 1)) || '质';
      if (document.title !== brandNow) document.title = brandNow;
      try { window.localStorage.setItem('qip.brand', brandNow); } catch (e) { /* 隐私模式忽略 */ }
      SetState.lastBrand = brandNow;
      // 版式：大中型企业版 / 中小型企业版（当前生效的那枚高亮）
      const scaleNow = State.bootstrap.scale === 'sme' ? 'sme' : 'large';
      SetState.scale = scaleNow;
      const sw = document.getElementById('scaleSwitch');
      if (sw) {
        sw.querySelectorAll('.sc').forEach((el) => {
          const k = (el.getAttribute('data-args') || '').indexOf('sme') >= 0 ? 'sme' : 'large';
          el.classList.toggle('on', k === scaleNow);
        });
      }
      // 中小型企业版：顶部「数据分析」换成「体系文件」（调研 → 手册 → 程序文件）
      const navA = document.getElementById('navAnalysis');
      const navQ = document.getElementById('navQms');
      if (navA) navA.style.display = scaleNow === 'sme' ? 'none' : '';
      if (navQ) navQ.style.display = scaleNow === 'sme' ? '' : 'none';
    } catch (e) {
      const st = document.getElementById('chipStatus');
      st.textContent = '服务不可用';
      st.className = 'ds-chip err';
      toast('无法连接本地服务：' + e.message, 'err', 9000);
    }
  }

  /* ==================================================================
     对话（智能体）
     ================================================================== */
  const Chat = global.Chat;

  function chatEls() { return { body: document.getElementById('chatBody'), input: document.getElementById('chatInput'), state: document.getElementById('chatState') }; }

  function updateChatMeta() {
    const meta = document.getElementById('chatMeta');
    if (meta) meta.textContent = Chat.messages.length ? Chat.messages.length + ' 条消息' : '新会话';
  }

  let renderTimer = null;
  function scheduleChatRender() {
    if (renderTimer) return;
    renderTimer = requestAnimationFrame(() => { renderTimer = null; const b = document.getElementById('chatBody'); if (b && global.renderChat) global.renderChat(); });
  }
  function scrollBottom(force) {
    const b = document.getElementById('chatBody');
    if (!b) return;
    const near = b.scrollHeight - b.scrollTop - b.clientHeight < 160;
    if (force || near) b.scrollTop = b.scrollHeight;
  }

  async function send(text) {
    if (Chat.busy) { toast('正在生成中，请先等待或点击停止', 'warn'); return; }
    const q = String(text || '').trim();
    if (!q) return;
    if (!State.bootstrap || !(State.bootstrap.settings.llm || {}).hasApiKey) {
      toast('尚未配置大模型 API Key，正在跳转设置页…', 'warn');
      setTimeout(() => go('settings'), 600);
      return;
    }
    if (State.page !== 'aiwb') { await go('aiwb'); }
    const input = document.getElementById('chatInput');
    if (input) { input.value = ''; input.style.height = 'auto'; }

    Chat.messages.push({ role: 'user', content: q, ts: Date.now() });
    const am = { role: 'assistant', content: '', thinking: '', thinkingDone: false, trace: [], pending: [], running: true, statusText: '正在理解问题…', ts: Date.now() };
    Chat.messages.push(am);
    Chat.busy = true;
    updateChatMeta();
    scheduleChatRender(); scrollBottom(true);
    const st = document.getElementById('chatState');
    if (st) st.innerHTML = '<span class="spin"></span> 生成中';

    const history = Chat.messages.slice(0, -1).filter((m) => m.content).map((m) => ({ role: m.role, content: m.content }));
    const ctrl = new AbortController();
    Chat.ctrl = ctrl;
    let toolSeq = {};

    try {
      await API.chat({ text: q, sessionId: Chat.sessionId, history }, (ev) => {
        switch (ev.type) {
          case 'start':
            am.statusText = '已连接模型（' + ev.model + '，' + ev.tools + ' 个工具可用）';
            scheduleChatRender(); break;
          case 'round':
            am.statusText = '第 ' + ev.round + ' 轮推理…'; scheduleChatRender(); break;
          case 'reasoning':
            am.thinking += ev.text; am.statusText = '深度推理中…'; scheduleChatRender(); scrollBottom(); break;
          case 'reasoning_done':
            am.thinkingDone = true; scheduleChatRender(); break;
          case 'content':
            am.content += ev.text; am.statusText = '正在输出结论…'; scheduleChatRender(); scrollBottom(); break;
          case 'tool_call': {
            const t = { id: ev.id, name: ev.name, label: ev.label, plugin: ev.plugin, args: ev.args, running: true, ok: true, summary: '执行中…' };
            am.trace.push(t); toolSeq[ev.id] = t;
            am.statusText = '调用 ' + ev.plugin + ' · ' + ev.label + ' …';
            scheduleChatRender(); scrollBottom(); break;
          }
          case 'tool_result': {
            const t = toolSeq[ev.id] || (am.trace.find((x) => x.name === ev.name) || {});
            t.running = false; t.ok = ev.ok; t.summary = ev.summary; t.ms = ev.ms; t.result = ev.result; t.label = ev.label; t.plugin = ev.plugin;
            am.statusText = ev.summary; scheduleChatRender(); scrollBottom(); break;
          }
          case 'confirm_required': {
            const p = { id: ev.id, tool: ev.name, label: ev.label, plugin: ev.plugin, args: ev.args };
            am.pending.push(p); scheduleChatRender(); scrollBottom();
            toast('有一个动作需要你确认：' + ev.label, 'warn', 6000);
            break;
          }
          case 'error': am.error = ev.message; break;
        }
      }, ctrl.signal);
    } catch (e) {
      if (e && e.name === 'AbortError') am.error = '已手动停止生成。';
      else am.error = e.message || String(e);
    }
    am.running = false;
    am.statusText = '';
    am.thinkingDone = true;
    Chat.busy = false;
    Chat.ctrl = null;
    if (st) st.textContent = '';
    scheduleChatRender(); scrollBottom(true);
    updateChatMeta();
    loadBootstrap().catch(() => {});
  }

  /* ==================================================================
     动作表
     ================================================================== */
  /** 把「填写体系调研」页面的输入收集成后端要的结构 */
  function collectQmsSurvey() {
    const f = UI.readForm(document.getElementById('content'));
    const sv = {
      company: f.qmsCompany, otherCert: f.qmsOtherCert, certs: f.qmsCert ? [f.qmsCert] : [],
      chairman: f.qmsChairman, legalRep: f.qmsLegalRep, gm: f.qmsGm, mgmtRep: f.qmsMgmtRep,
      teamMembers: f.qmsTeam, certOffice: f.qmsCertOffice, auditors: f.qmsAuditors,
      products: f.qmsProducts, processFlow: f.qmsProcessFlow,
      geo: f.qmsGeo, area: f.qmsArea, building: f.qmsBuilding, staff: f.qmsStaff, techStaff: f.qmsTechStaff,
      equipment: f.qmsEquipment, customers: f.qmsCustomers, addr: f.qmsAddr, contactPerson: f.qmsContactPerson,
      tel: f.qmsTel, fax: f.qmsFax,
      mission: f.qmsMission, policy: f.qmsPolicy, objective: f.qmsObjective,
      certDate: f.qmsCertDate, phase1Date: f.qmsPhase1Date, weekend: f.qmsWeekend, design: f.qmsDesign,
      contactName: f.qmsContactName, contactPhone: f.qmsContactPhone,
    };
    const orgs = [];
    Object.keys(f).forEach((k) => {
      const m = /^org(\d+)d$/.exec(k);
      if (!m) return;
      const i = m[1];
      const dept = String(f['org' + i + 'd'] || '').trim();
      const owner = String(f['org' + i + 'o'] || '').trim();
      if (dept || owner) orgs.push({ duty: '', dept, owner });
    });
    sv.orgs = orgs;
    return sv;
  }

  /** 暂存草稿 / 标记填写完毕 */
  async function saveQmsSurvey(completed) {
    const sv = collectQmsSurvey();
    if (!String(sv.company || '').trim()) { toast('请先填写「公司名称」', 'warn', 6000); return false; }
    try {
      const r = await API.post('/qip/api/qms/survey', { survey: sv, completed: !!completed });
      if (global.QS) { global.QS.survey = (r && r.survey) || sv; global.QS.completion = (r && r.completion) || 0; }
      toast(completed ? ('已保存并标记填写完毕（完成度 ' + ((r && r.completion) || 0) + '%）') : '草稿已保存', 'ok', 6000);
      return true;
    } catch (e) {
      toast('保存失败：' + e.message, 'err', 8000);
      return false;
    }
  }

  /** 把纯文本（Markdown）下载成文件 */
  function downloadText(filename, text) {
    const blob = new Blob(['\ufeff' + String(text || '')], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = String(filename || 'export.md').replace(/[\\/:*?"<>|]/g, '_');
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('已下载：' + a.download, 'ok');
  }

  const Actions = global.Actions = {
    __closeModal: () => closeModal(),
    goto: (a) => go(a.page),
    refreshPage: () => refresh(),
    healthCheck: async () => {
      try { const h = await API.health(); modal({ width: 'narrow', title: '服务状态', body: infoGrid(Object.entries(h.counts).map(([k, v]) => [k, v]).concat([['服务', h.service], ['版本', h.version], ['运行时长', h.uptime], ['数据目录', h.dataDir], ['模型已配置', h.llmConfigured ? '是' : '否']])) }); }
      catch (e) { toast('服务不可用：' + e.message, 'err'); }
    },
    openSearch: () => {
      modal({
        width: 'narrow', title: '🔍 全局 AI 提问', sub: '输入自然语言或 @插件 定向查询',
        body: `<input class="inp" id="gsInput" placeholder="例如：@MES 查昨日二车间报废 / 分析充电口盖间隙超差" style="font-size:13px;padding:10px 12px;" onkeydown="if(event.key==='Enter')Actions.gsGo()"/>`,
        footer: `${act('取消', '__closeModal', {}, 'btn')}${act('去提问', 'gsGo', {}, 'btn btn-primary')}`,
      });
      setTimeout(() => { const el = document.getElementById('gsInput'); if (el) el.focus(); }, 50);
    },
    gsGo: () => {
      const el = document.getElementById('gsInput');
      const q = el ? el.value.trim() : '';
      if (!q) return toast('请输入内容', 'warn');
      closeModal(); send(q);
    },
    profile: async () => {
      const s = State.bootstrap || (await API.bootstrap());
      const push = (s.settings || {}).push || {};
      const org = s.org || {};
      const orgName = org.company || '某制造型企业';
      const deptName = org.dept || '质量改进部门';
      modal({
        width: 'narrow', title: '当前用户', sub: orgName + ' · ' + deptName,
        body: infoGrid([
          ['姓名', '李工'], ['部门', deptName],
          ['权限', '质量改进工程师（可发起审批、发现问题、推进 8D）'],
          ['AI 晨报推送', '每日 07:30 · ' + ((push.channels || []).join(' + ') || '企微 + 邮件')],
          ['判异预警', 'ABC 级质量问题实时推送'],
          ['报告草稿默认汇报', '质量部部长'],
          ['数据范围', Object.entries(s.counts || {}).map(([k, v]) => k + ' ' + v).join(' · '), true],
        ]),
        footer: `${act('个性化设置', 'goto', { page: 'settings' }, 'btn btn-primary')}${act('初始设置', 'goto', { page: 'init' }, 'btn')}${act('关闭', '__closeModal', {}, 'btn')}`,
      });
    },

    /* ---------- 质量工具 ---------- */
    qtOpen: () => { global.QWizard.menu(); document.getElementById('qtOverlay').classList.add('show'); },
    qtClose: () => document.getElementById('qtOverlay').classList.remove('show'),
    qtPick: (a) => {
      document.getElementById('qtOverlay').classList.remove('show');
      if (a.w) global.QWizard.open(a.w);
      else Actions.aiQuick({ q: a.ai || ('请用「' + a.name + '」方法帮我分析当前的质量问题。') });
    },
    wzRun: (a) => global.QWizard.run(a.key),
    wzAi: (a) => {
      const w = global.QWizard.defs[a.key];
      closeModal();
      Actions.aiQuick({ q: '请用「' + (w ? w.title : a.key) + '」帮我分析：先查平台真实数据，再给出结论与下一步动作。' });
    },
    wzInterpret: (a) => {
      closeModal();
      Actions.aiQuick({ q: '这是我刚用工具 ' + a.tool + ' 算出的结果参数：' + a.args + '。请解读这个结果在质量改进上的含义，指出是否可判定，并给出下一步动作。' });
    },
    wzExport: () => { if (global.QWizard && global.QWizard.exportLast) global.QWizard.exportLast(); else toast('先点「▶ 计算」跑一次，再导出', 'warn'); },

    /* ---------- 对话 ---------- */
    chatSend: () => { const el = document.getElementById('chatInput'); send(el ? el.value : ''); },
    chatStop: () => { if (Chat.ctrl) { Chat.ctrl.abort(); toast('已请求停止生成', 'warn'); } else toast('当前没有正在生成的内容', 'warn'); },
    chatClear: () => { Chat.messages = []; Chat.sessionId = 's-' + Date.now(); renderChat(); updateChatMeta(); toast('已开始新会话', 'ok'); },
    chatHistory: async () => {
      const r = await API.get('/qip/api/chats');
      const rows = r.rows || [];
      modal({
        width: 'narrow', title: '历史会话', sub: '共 ' + rows.length + ' 个',
        body: rows.length ? rows.map((c) => `<div class="list-row" data-act="chatLoad" data-args='${esc(JSON.stringify({ id: c.id }))}'><div style="flex:1;"><b>${esc(c.title || c.id)}</b><div style="font-size:11px;color:#8791a5;">${c.count} 条消息 · ${dt(c.updatedAt)}</div></div><span style="color:#1a56db;font-size:11px;">载入 ›</span></div>`).join('') : empty('暂无历史会话'),
      });
    },
    chatLoad: async (a) => {
      const r = await API.get('/qip/api/chats/' + a.id);
      if (!r.row) return toast('会话不存在', 'err');
      Chat.sessionId = a.id;
      Chat.messages = (r.row.messages || []).map((m) => ({ role: m.role, content: m.content, trace: m.trace || [], pending: [], thinkingDone: true }));
      closeModal(); renderChat(); updateChatMeta(); toast('已载入历史会话', 'ok');
    },
    quickAsk: async (a) => { await go('aiwb'); send(a.q); },
    aiQuick: async (a) => { await go('aiwb'); send(a.q); },
    chatFollowup: (a) => send(a.q),
    toggleThink: (a) => { const el = document.getElementById('think-' + a.i); if (el) el.classList.toggle('collapsed'); },
    showToolResult: (a) => {
      const m = Chat.messages[a.i]; const t = m && m.trace && m.trace[a.ti];
      if (!t) return;
      modal({
        title: '工具原始返回：' + (t.label || t.name), sub: t.plugin + ' · ' + (t.ms || 0) + 'ms',
        body: `<div style="font-size:11.5px;color:#5e6b85;margin-bottom:8px;">调用参数：<code>${esc(JSON.stringify(t.args))}</code></div>
               <pre style="background:#16233c;color:#e6edf7;border-radius:8px;padding:12px;font-size:11.5px;line-height:1.7;overflow:auto;max-height:56vh;">${esc(JSON.stringify(t.result, null, 2))}</pre>`,
      });
    },
    confirmAction: async (a) => {
      try {
        const r = await API.post('/qip/api/chat/confirm', { id: a.id });
        const m = Chat.messages[a.i];
        if (m) { m.pending = (m.pending || []).filter((p) => p.id !== a.id); m.content += `\n\n> ✅ 已人工确认并执行「${r.label || ''}」：${r.summary || (r.ok ? '执行成功' : '执行失败')}`; }
        toast(r.ok ? '已确认执行：' + (r.summary || '') : '执行失败：' + (r.error || ''), r.ok ? 'ok' : 'err');
        renderChat(); loadBootstrap();
      } catch (e) { toast('执行失败：' + e.message, 'err'); }
    },
    rejectAction: async (a) => {
      try {
        await API.post('/qip/api/chat/reject', { id: a.id, reason: '用户拒绝' });
        const m = Chat.messages[a.i];
        if (m) { m.pending = (m.pending || []).filter((p) => p.id !== a.id); m.content += `\n\n> ⛔ 已拒绝执行该动作。`; }
        toast('已拒绝该动作', 'warn'); renderChat();
      } catch (e) { toast(e.message, 'err'); }
    },

    /* ---------- 驾驶舱 ---------- */
    morningReport: async () => {
      modal({ width: 'wide', title: '🤖 AI 质量晨报', sub: '全部数字来自平台插件实时查询', body: loadingBlock('正在汇总…') });
      try {
        const r = await API.get('/qip/api/kpi/morning');
        modal({ width: 'wide', title: '🤖 AI 质量晨报', sub: '数据截至 ' + (r.snapshot && r.snapshot.dataAt || ''), body: `<div style="font-size:12.5px;line-height:1.9;">${md(r.markdown)}</div>`, footer: `${act('让 AI 深入分析', 'morningAi', {}, 'btn btn-ai')}${act('关闭', '__closeModal', {}, 'btn')}` });
      } catch (e) { modal({ width: 'narrow', title: '生成失败', body: esc(e.message) }); }
    },
    morningAi: () => { closeModal(); Actions.aiQuick({ q: '请基于晨报数据做深入分析：指出今天最该处理的 3 件事，每件给出责任人、时限和验证方式' }); },
    todoDone: async (a) => {
      await API.put('/qip/api/todos/' + a.id, { done: true });
      toast('已完成', 'ok'); refresh();
    },

    /* ---------- 问题库 ---------- */
    issueDetail: async (a) => {
      const r = await API.get('/qip/api/issues/' + a.id);
      const x = r.row; if (!x) return toast('问题不存在', 'err');
      // 工位串里可能已带车间名前缀（如「四车间三线·充电口盖安装」），避免重复拼
      const wsName = x.workshop || '';
      const stName = x.station || '';
      const stClean = wsName && stName.indexOf(wsName) === 0 ? stName.slice(wsName.length).replace(/^[·\-\s/]+/, '') : stName;
      modal({
        width: 'wide', title: '⚠️ ' + x.id + '　' + x.title, sub: (x.model || '') + ' · ' + wsName + (stClean ? ' · ' + stClean : ''),
        body: infoGrid([
          ['产品', esc(x.model || '—')], ['车间 / 工位', esc(wsName + (stClean ? ' / ' + stClean : ''))],
          ['来源', tag(x.source || '—', 'purple')], ['等级', tag(x.severity, x.severity === 'A' ? 'red' : 'orange')],
          ['状态', esc(x.status || '—')], ['责任人', esc(x.owner || '—')],
          ['关联项目', x.projectId ? tag(x.projectId, 'blue') : '—'], ['AI 相似度', x.aiSimilarity || '—'],
          ['发现时间', dt(x.createdAt)], ['关闭时间', x.closedAt ? dt(x.closedAt) : '—'],
          ['问题描述', esc(x.description || '—'), true],
          ['检测方式', esc(x.detectMethod || '—'), true],
        ]),
        footer: `${act('AI 根因分析', 'aiQuick', { q: '针对问题 ' + x.id + '（' + x.title + '）做根因分析：先查真实数据与相似案例，再给出按置信度排序的根因假设与验证方法' }, 'btn btn-ai')}
                 ${act('升级为 8D 项目', 'projectFromIssue', { id: x.id }, 'btn btn-primary')}
                 ${x.projectId ? act('查看项目', 'projectDetail', { id: x.projectId }, 'btn') : ''}
                 ${act('更新状态', 'issueUpdateDlg', { id: x.id }, 'btn')}
                 ${act('关闭', '__closeModal', {}, 'btn')}`,
      });
    },
    issueUpdateDlg: (a) => {
      closeModal();
      modal({
        width: 'narrow', title: '更新问题', sub: a.id,
        body: `<div class="form-row"><div class="fl">状态</div><div class="fc">${UI.input('status', '整改中', { type: 'select', options: ['整改中', 'QRQC 跟踪', '监控中', '已关闭'] })}</div></div>
               <div class="form-row"><div class="fl">责任人</div><div class="fc">${UI.input('owner', '', {})}</div></div>
               <div class="form-row"><div class="fl">根因</div><div class="fc">${UI.input('rootCause', '', { type: 'textarea', rows: 2 })}</div></div>
               <div class="form-row"><div class="fl">围堵/临时措施</div><div class="fc">${UI.input('containment', '', { type: 'textarea', rows: 2 })}</div></div>
               <div class="form-row"><div class="fl">验证结果</div><div class="fc">${UI.input('verifyResult', '', { type: 'textarea', rows: 2 })}</div></div>`,
        footer: `${act('取消', '__closeModal', {}, 'btn')}${act('保存', 'issueSave', { id: a.id }, 'btn btn-primary')}`,
      });
    },
    issueSave: async (a) => {
      const body = UI.readForm(document.querySelector('.dm-panel'));
      await API.put('/qip/api/issues/' + a.id, body);
      closeModal(); toast('已保存', 'ok'); refresh();
    },
    newIssue: () => {
      modal({
        width: 'narrow', title: '发现问题', sub: '保存时会自动做同构去重与相似案例匹配',
        body: `<div class="form-row"><div class="fl">问题简述 *</div><div class="fc">${UI.input('title', '', { placeholder: '一句话描述' })}</div></div>
               <div class="form-row"><div class="fl">详细描述</div><div class="fc">${UI.input('description', '', { type: 'textarea', rows: 3, placeholder: '现象、量化数据、发生时间、涉及批次/台数' })}</div></div>
               <div class="form-row"><div class="fl">产品</div><div class="fc">${UI.input('model', PD()[0], { type: 'select', options: PD() })}</div></div>
               <div class="form-row"><div class="fl">车间</div><div class="fc">${UI.input('workshop', WS()[3], { type: 'select', options: WS() })}</div></div>
               <div class="form-row"><div class="fl">工位</div><div class="fc">${UI.input('station', '', {})}</div></div>
               <div class="form-row"><div class="fl">来源</div><div class="fc">${UI.input('source', '现场', { type: 'select', options: ['现场', 'MES', 'AI 质检', '检验', '市场'] })}</div></div>
               <div class="form-row"><div class="fl">等级</div><div class="fc">${UI.input('severity', 'B', { type: 'select', options: [{ value: 'A', label: 'A（安全/法规/已流出）' }, { value: 'B', label: 'B（批量风险）' }, { value: 'C', label: 'C（个案）' }] })}</div></div>
               <div class="form-row"><div class="fl">责任人</div><div class="fc">${UI.input('owner', '', {})}</div></div>
               <div class="imp-hint" style="margin:14px 0 0;">
                 <span class="big">📱 可以手机拍拍拍导入问题</span>
                 <span class="imp-sub">批量时也可直接用 Excel / CSV 一键导入，表头写「问题描述、产品、车间、工位、来源、等级、责任人」即可。</span>
               </div>`,
        footer: `${act('取消', '__closeModal', {}, 'btn')}${act('📥 导入问题（Excel / CSV）', 'importFile', { target: 'issues' }, 'btn')}${act('保存并查重', 'issueCreate', {}, 'btn btn-primary')}`,
      });
    },
    issueCreate: async () => {
      const body = UI.readForm(document.querySelector('.dm-panel'));
      if (!body.title) return toast('请填写问题简述', 'warn');
      try {
        const r = await API.post('/qip/api/issues', body);
        // 触发后端的去重检测（通过工具接口调用一次 issue_create 不必要；这里直接调用相似检测工具）
        const sim = await API.tool('issue_similar_check', { description: body.title + ' ' + (body.description || '') });
        closeModal();
        const res = sim.result || {};
        const dups = (res.同构问题 || []).filter((x) => x.相似度 >= 0.45);
        modal({
          width: 'wide', title: '✅ 已发现问题 ' + r.row.id, sub: '问题已写入质量问题库',
          body: (dups.length ? `<div style="border:1px solid #ffdcd9;background:#fff5f4;border-radius:8px;padding:10px 12px;margin-bottom:12px;">
              <b style="color:#e5484d;">⚠ 检测到 ${dups.length} 起同构问题（可能重复发生）</b>
              <div style="font-size:12px;color:#5e6b85;margin-top:6px;line-height:1.9;">${dups.map((d) => '· ' + esc(d.编号) + ' ' + esc(d.问题) + '（相似度 ' + d.相似度 + '，' + esc(d.状态) + '）').join('<br>')}</div>
              <div style="margin-top:6px;">${esc(res.重复发生判定 || '')}</div></div>` : '<div style="font-size:12.5px;color:#18a058;margin-bottom:10px;">✓ 未发现明显同构问题</div>') +
            (res.知识库匹配 && res.知识库匹配.length ? `<div style="font-size:12.5px;margin-bottom:6px;"><b>知识库匹配：</b></div>` + res.知识库匹配.map((k) => `<div class="list-row" data-act="kbDetail" data-args='${esc(JSON.stringify({ id: k.编号 }))}'><div style="flex:1;"><b>${esc(k.标题)}</b><div style="font-size:11px;color:#8791a5;margin-top:3px;">${esc((k.对策摘要 || '').slice(0, 100))}</div></div></div>`).join('') : ''),
          footer: `${act('升级为 8D 项目', 'projectFromIssue', { id: r.row.id }, 'btn btn-primary')}${act('让 AI 分析', 'issueAi', { id: r.row.id, title: body.title }, 'btn btn-ai')}${act('关闭', '__closeModal', {}, 'btn')}`,
        });
        refresh();
      } catch (e) { toast('发现问题失败：' + e.message, 'err'); }
    },
    issueAi: (a) => { closeModal(); Actions.aiQuick({ q: '针对新发现的问题 ' + a.id + '（' + a.title + '），请给出：①同构问题与重复发生判断 ②按置信度排序的根因假设与验证方法 ③临时围堵措施 ④是否需要升级为 8D 项目' }); },
    filterIssues: () => toast('列表已按条件显示全部问题', 'ok'),
    /* 问题清单：A/B/C 分类筛选与分组折叠 */
    issueSev: (a) => {
      if (global.issueView) { global.issueView.sev = a.sev || 'all'; if (a.sev && a.sev !== 'all') global.issueView.open[a.sev] = true; }
      refresh();
    },
    issueOpenAll: (a) => {
      if (global.issueView) ['A', 'B', 'C'].forEach((s) => { global.issueView.open[s] = !!a.open; });
      refresh();
    },

    /* ---------- 项目 ---------- */
    projectFromIssue: (a) => {
      closeModal();
      Actions.newProject({ issueId: a.id });
    },
    projectFromGroup: (a) => Actions.newProject({ issueId: a.ids[0], title: a.title + '（重复发生专项）', workshop: a.workshop, model: a.model }),
    newProject: async (pre) => {
      pre = pre || {};
      let issue = null;
      if (pre.issueId) { try { const r = await API.get('/qip/api/issues/' + pre.issueId); issue = r.row; } catch (e) {} }
      const members = (State.bootstrap && State.bootstrap.settings) ? null : null;
      modal({
        width: 'narrow', title: '创立改进项目（8D）', sub: '平台会按技能图谱自动推荐团队并生成阶段 SLA',
        body: `<div class="form-row"><div class="fl">项目名称 *</div><div class="fc">${UI.input('title', pre.title || (issue ? issue.title : ''), {})}</div></div>
               <div class="form-row"><div class="fl">来源问题</div><div class="fc">${UI.input('issueId', pre.issueId || '', { placeholder: '如 #QI-2026-0411' })}</div></div>
               <div class="form-row"><div class="fl">产品</div><div class="fc">${UI.input('model', pre.model || (issue && issue.model) || PD()[0], { type: 'select', options: PD() })}</div></div>
               <div class="form-row"><div class="fl">车间</div><div class="fc">${UI.input('workshop', pre.workshop || (issue && issue.workshop) || WS()[3], { type: 'select', options: WS() })}</div></div>
               <div class="form-row"><div class="fl">组长</div><div class="fc">${UI.input('owner', (issue && issue.owner) || '李雪', {})}</div></div>
               <div class="form-row"><div class="fl">等级</div><div class="fc">${UI.input('severity', (issue && issue.severity) || 'B', { type: 'select', options: ['A', 'B', 'C'] })}</div></div>
               <div class="form-row"><div class="fl">项目背景与目标</div><div class="fc">${UI.input('description', (issue && issue.description) || '', { type: 'textarea', rows: 3, placeholder: '含量化指标，如"超差率由 3.4% 降至 0.5% 以内"' })}</div></div>`,
        footer: `${act('取消', '__closeModal', {}, 'btn')}${act('立项（自动推荐团队）', 'projectCreate', {}, 'btn btn-primary')}`,
      });
    },
    projectCreate: async () => {
      const body = UI.readForm(document.querySelector('.dm-panel'));
      if (!body.title) return toast('请填写项目名称', 'warn');
      try {
        const r = await API.tool('project_create', body);
        const res = r.result || {};
        if (!r.ok) return toast(res.error || '立项失败', 'err');
        closeModal();
        modal({
          width: 'wide', title: '✅ 已立项 ' + res.项目编号, sub: '已生成阶段 SLA 并推送 D1–D3 待办',
          body: `<div style="font-size:12.5px;font-weight:700;margin-bottom:8px;">推荐团队（按技能图谱与车间经验匹配）</div>` +
            table(['姓名', '角色', '部门', '推荐理由'], res.团队推荐.map((t) => [t.姓名, t.角色, t.部门, t.推荐理由])) +
            `<div style="font-size:12.5px;font-weight:700;margin:14px 0 8px;">阶段 SLA 计划</div>` +
            table(['阶段', 'SLA', '交付物', '计划完成'], res.阶段SLA.map((s) => [s.阶段, s.SLA, s.交付物, s.计划完成])) +
            `<div style="font-size:12.5px;font-weight:700;margin:14px 0 8px;">已推送待办</div>` + res.已推送待办.map((t) => '· ' + esc(t)).join('<br>'),
          footer: `${act('AI 起草 D2（5W2H）', 'aiQuick', { q: '为项目 ' + res.项目编号 + ' 起草 D2 问题描述（5W2H），要求包含平台真实量化数据，并写入项目' }, 'btn btn-ai')}${act('关闭', '__closeModal', {}, 'btn')}`,
        });
        refresh();
      } catch (e) { toast('立项失败：' + e.message, 'err'); }
    },
    projectDetail: async (a) => {
      const r = await API.get('/qip/api/projects/' + a.id);
      const p = r.row; if (!p) return toast('项目不存在', 'err');
      const STAGE_DEF = global.STAGE_DEF;
      const cur = STAGE_DEF.find((s) => s[0] === p.stage) || [];
      modal({
        width: 'wide', title: '🧩 ' + p.id + '　' + p.title, sub: '阶段 ' + p.stage + ' ' + (cur[1] || '') + ' · SLA ' + (cur[2] || '') + ' · 责任人 ' + p.owner,
        body: `<div class="stepper">${STAGE_DEF.map(([k, n]) => { const idx = STAGE_DEF.findIndex((x) => x[0] === p.stage); const i2 = STAGE_DEF.findIndex((x) => x[0] === k); return `<div class="st ${i2 < idx ? 'done' : i2 === idx ? 'on' : ''}" data-n="${i2 + 1}">${k}<br>${n}</div>`; }).join('')}</div>` +
          infoGrid([
            ['产品 / 车间', esc((p.model || '') + ' / ' + (p.workshop || ''))], ['等级', tag(p.severity, p.severity === 'A' ? 'red' : 'orange')],
            ['进度', p.progress + '%'], ['截止日期', day(p.dueAt) + (p.overdue ? '　' + tag('逾期 ' + p.overdueDays + ' 天', 'red') : '')],
            ['来源问题', esc(p.issueId || '—')], ['预估收益', (p.benefitEstimate || 0) + ' 万元'],
            ['验证进度', (p.verifyCount || 0) + '/' + (p.verifyTotal || 3)], ['AI 起草占比', Math.round((p.aiDraftRatio || 0) * 100) + '%'],
            ['项目描述', esc(p.description || '—'), true],
          ]) +
          (p.team && p.team.length ? `<div style="font-size:12.5px;font-weight:700;margin:14px 0 8px;">项目团队</div>` + table(['姓名', '角色', '部门', '推荐理由'], p.team.map((t) => [t.姓名, t.角色, t.部门, t.推荐理由 || ''])) : '') +
          ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'].filter((k) => p[k]).map((k) => `<div style="margin-top:12px;"><div style="font-size:12.5px;font-weight:700;">${k.toUpperCase()} 交付物</div><div style="font-size:12px;color:#33415c;line-height:1.9;margin-top:4px;white-space:pre-wrap;">${esc(String(p[k]).slice(0, 3000))}</div></div>`).join('') +
          (p.history && p.history.length ? `<div style="font-size:12.5px;font-weight:700;margin:14px 0 8px;">历史记录</div>` + table(['时间', '操作人', '动作', '说明'], p.history.slice(-10).reverse().map((h) => [dt(h.ts), esc(h.user), esc(h.action), esc(h.note || '')])) : ''),
        footer: `${act('推进下一阶段', 'projectAdvance', { id: p.id }, 'btn btn-primary')}
                 ${act('AI 根因分析（D4）', 'aiQuick', { q: '针对项目 ' + p.id + '（' + p.title + '）做 D4 根因分析，给出因果图、5Why、按置信度排序的假设与 DOE 验证方案' }, 'btn btn-ai')}
                 ${act('D5 对策并报 OA 审批', 'aiQuick', { q: '为项目 ' + p.id + ' 制定 D5 永久对策，测算收益，并发起 OA 审批' }, 'btn')}
                 ${p.stage !== 'D8' ? act('关闭项目（需确认）', 'projectCloseAsk', { id: p.id }, 'btn') : ''}
                 ${act('关闭', '__closeModal', {}, 'btn')}`,
      });
    },
    projectAdvance: (a) => {
      modal({
        width: 'narrow', title: '推进阶段', sub: a.id,
        body: `<div class="form-row"><div class="fl">目标阶段</div><div class="fc">${UI.input('stage', 'D4', { type: 'select', options: global.STAGE_DEF.map(([k, n]) => ({ value: k, label: k + ' ' + n })) })}</div></div>
               <div class="form-row"><div class="fl">该阶段交付物</div><div class="fc">${UI.input('content', '', { type: 'textarea', rows: 6, placeholder: '根因结论 / 对策内容 / 验证数据 …' })}</div></div>`,
        footer: `${act('取消', '__closeModal', {}, 'btn')}${act('推进', 'projectAdvanceDo', { id: a.id }, 'btn btn-primary')}`,
      });
    },
    projectAdvanceDo: async (a) => {
      const body = UI.readForm(document.querySelector('.dm-panel'));
      const r = await API.tool('project_advance', Object.assign({ id: a.id }, body));
      if (!r.ok) return toast(r.result.error || '推进失败', 'err');
      toast('已推进至 ' + r.result.新阶段, 'ok');
      closeModal(); refresh();
    },
    projectCloseAsk: (a) => {
      modal({
        width: 'narrow', title: '关闭改进项目', sub: '属于三类强制人工确认动作',
        body: `<div style="background:#fffbf2;border:1px solid #ffe0b2;border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.8;color:#c8620a;margin-bottom:12px;">⚠ 关闭操作会：①把项目推进到 D8 并计入关闭统计 ②同步关闭来源问题 ③自动归档为知识库历史案例。请填写关闭总结后确认。</div>` +
          `<div class="form-row"><div class="fl">关闭总结</div><div class="fc">${UI.input('summary', '', { type: 'textarea', rows: 4, placeholder: '根因、对策、验证效果（含量化数据）' })}</div></div>
           <div class="form-row"><div class="fl">核定收益（万元）</div><div class="fc">${UI.input('benefit', '', { type: 'number' })}</div></div>`,
        footer: `${act('取消', '__closeModal', {}, 'btn')}${act('确认关闭并归档', 'projectCloseDo', { id: a.id }, 'btn btn-primary')}`,
      });
    },
    projectCloseDo: async (a) => {
      const body = UI.readForm(document.querySelector('.dm-panel'));
      const r = await API.tool('project_close', Object.assign({ id: a.id }, body));
      if (!r.ok) return toast(r.result.error || '关闭失败', 'err');
      closeModal(); toast('项目已关闭并归档案例 ' + (r.result.归档案例 || ''), 'ok'); refresh();
    },

    /* ---------- QRQC ---------- */
    newQrqc: () => {
      modal({
        width: 'narrow', title: '发起 QRQC', sub: 'A 级问题 2h 内必须响应',
        body: `<div class="form-row"><div class="fl">层级</div><div class="fc">${UI.input('level', '车间', { type: 'select', options: ['班组', '车间', '厂级'] })}</div></div>
               <div class="form-row"><div class="fl">车间</div><div class="fc">${UI.input('workshop', WS()[3], { type: 'select', options: WS() })}</div></div>
               <div class="form-row"><div class="fl">产品</div><div class="fc">${UI.input('model', PD()[0], { type: 'select', options: PD() })}</div></div>
               <div class="form-row"><div class="fl">议题 *</div><div class="fc">${UI.input('topic', '', {})}</div></div>
               <div class="form-row"><div class="fl">问题描述 *</div><div class="fc">${UI.input('problem', '', { type: 'textarea', rows: 3, placeholder: '含量化数据' })}</div></div>
               <div class="form-row"><div class="fl">临时措施</div><div class="fc">${UI.input('tempAction', '', { type: 'textarea', rows: 2 })}</div></div>
               <div class="form-row"><div class="fl">责任人</div><div class="fc">${UI.input('owner', '', {})}</div></div>
               <div class="form-row"><div class="fl">闭环期限（小时）</div><div class="fc">${UI.input('dueHours', 24, { type: 'number' })}</div></div>`,
        footer: `${act('取消', '__closeModal', {}, 'btn')}${act('发起并派工', 'qrqcCreate', {}, 'btn btn-primary')}`,
      });
    },
    qrqcCreate: async () => {
      const body = UI.readForm(document.querySelector('.dm-panel'));
      if (!body.topic || !body.problem) return toast('请填写议题与问题描述', 'warn');
      const r = await API.tool('qrqc_create', body);
      if (!r.ok) return toast(r.result.error || '发起失败', 'err');
      closeModal(); toast('已发起 ' + r.result.QRQC编号, 'ok'); refresh();
    },
    qrqcMinutes: async (a) => {
      const r = await API.get('/qip/api/qrqc/' + a.id);
      const q = r.row; if (!q) return toast('记录不存在', 'err');
      modal({
        width: 'narrow', title: '生成 QRQC 纪要', sub: a.id + ' ' + (q.topic || ''),
        body: `<div style="font-size:12px;color:#5e6b85;line-height:1.9;margin-bottom:10px;">AI 将把会议内容结构化为「问题 / 临时措施 / 责任人 / 期限」四要素，并自动派工到个人待办。</div>
               <div class="form-row"><div class="fl">议题/问题</div><div class="fc">${UI.input('problem', q.problem || q.topic || '', { type: 'textarea', rows: 2 })}</div></div>
               <div class="form-row"><div class="fl">临时措施</div><div class="fc">${UI.input('tempAction', q.tempAction || '', { type: 'textarea', rows: 2 })}</div></div>
               <div class="form-row"><div class="fl">责任人</div><div class="fc">${UI.input('owner', q.owner || '', {})}</div></div>
               <div class="form-row"><div class="fl">期限（小时）</div><div class="fc">${UI.input('dueHours', q.dueHours || 24, { type: 'number' })}</div></div>`,
        footer: `${act('取消', '__closeModal', {}, 'btn')}${act('生成纪要并派工', 'qrqcMinutesDo', { id: a.id }, 'btn btn-primary')}`,
      });
    },
    qrqcMinutesDo: async (a) => {
      const f = UI.readForm(document.querySelector('.dm-panel'));
      const r = await API.tool('qrqc_minutes', { id: a.id, items: [{ problem: f.problem, tempAction: f.tempAction, owner: f.owner, dueHours: Number(f.dueHours) || 24 }] });
      if (!r.ok) return toast('生成失败', 'err');
      closeModal(); toast('纪要已生成并派工 ' + r.result.生成任务数 + ' 项', 'ok'); refresh();
    },
    voiceReport: (a) => {
      modal({
        width: 'narrow', title: '🎤 现场语音报问题', sub: '一句话 → 结构化问题单',
        body: `<div style="font-size:12px;color:#5e6b85;line-height:1.9;margin-bottom:10px;">直接口述或输入现场情况，平台自动识别产品/车间/工位/缺陷类别/等级，并匹配相似历史案例。</div>
               <div class="form-row"><div class="fl">现场描述 *</div><div class="fc">${UI.input('text', (a && a.text) || '', { type: 'textarea', rows: 3, placeholder: '例如：四车间三线右后门关门声发闷，连续第三台' })}</div></div>
               <div class="form-row"><div class="fl">报告人</div><div class="fc">${UI.input('reporter', '现场', {})}</div></div>`,
        footer: `${act('取消', '__closeModal', {}, 'btn')}${act('识别并录入', 'voiceDo', {}, 'btn btn-primary')}`,
      });
    },
    voiceDo: async () => {
      const f = UI.readForm(document.querySelector('.dm-panel'));
      if (!f.text) return toast('请输入现场描述', 'warn');
      const r = await API.tool('qrqc_voice_report', f);
      if (!r.ok) return toast('识别失败', 'err');
      const res = r.result;
      closeModal();
      modal({
        width: 'wide', title: '✅ 已发现问题 ' + res.问题编号, sub: 'AI 结构化提取结果',
        body: infoGrid(Object.entries(res.结构化结果).map(([k, v]) => [k, esc(v)])) +
          `<div style="font-size:12.5px;font-weight:700;margin:14px 0 8px;">相似历史案例</div>` +
          (res.相似历史案例 && res.相似历史案例.length ? res.相似历史案例.map((k) => `<div class="list-row" data-act="kbDetail" data-args='${esc(JSON.stringify({ id: k.编号 }))}'><div style="flex:1;"><b>${esc(k.标题)}</b></div><span style="font-size:11px;color:#1a56db;">相关度 ${k.相关度}</span></div>`).join('') : empty('暂无匹配案例')),
        footer: `${act('让 AI 分析', 'aiQuick', { q: '针对刚发现的现场问题 ' + res.问题编号 + '，结合相似案例给出临时围堵与根因排查方案' }, 'btn btn-ai')}${act('关闭', '__closeModal', {}, 'btn')}`,
      });
      refresh();
    },

    /* ---------- 收益 ---------- */
    benefitCalc: () => {
      modal({
        width: 'narrow', title: '收益测算', sub: '按财务核定口径（仅计直接损失）',
        body: `<div class="form-row"><div class="fl">平台特性（自动取改善前超差率）</div><div class="fc"><input class="inp" data-field="charId" placeholder="如 CT-0378（留空则手填）"/></div></div>
               <div class="form-row"><div class="fl">改善前损失率</div><div class="fc">${UI.input('baselineRate', '', { type: 'number', placeholder: '如 0.034' })}</div></div>
               <div class="form-row"><div class="fl">改善后目标损失率</div><div class="fc">${UI.input('targetRate', 0.005, { type: 'number' })}</div></div>
               <div class="form-row"><div class="fl">年产量（台）</div><div class="fc">${UI.input('annualVolume', 120000, { type: 'number' })}</div></div>
               <div class="form-row"><div class="fl">单件损失（元）</div><div class="fc">${UI.input('unitLoss', 180, { type: 'number' })}</div></div>
               <div class="form-row"><div class="fl">一次性投入（元）</div><div class="fc">${UI.input('oneTimeCost', '', { type: 'number' })}</div></div>`,
        footer: `${act('取消', '__closeModal', {}, 'btn')}${act('测算', 'benefitCalcDo', {}, 'btn btn-primary')}`,
      });
    },
    benefitCalcDo: async () => {
      const f = UI.readForm(document.querySelector('.dm-panel'));
      const args = {};
      Object.keys(f).forEach((k) => { if (f[k] !== '' && f[k] !== null && f[k] !== undefined) args[k] = f[k]; });
      const r = await API.tool('fin_benefit_calc', args);
      if (!r.ok) return toast(r.result.error || '测算失败', 'err');
      closeModal();
      modal({
        width: 'wide', title: '💰 收益测算结果', sub: '财务核定口径',
        body: `<div style="text-align:center;padding:6px 0 14px;"><div class="score-ring" style="font-size:34px;color:#7a5af8;">¥${r.result.结果.年化收益万元}<span style="font-size:14px;color:#8791a5;">万/年</span></div>
            <div style="font-size:12px;color:#8791a5;margin-top:4px;">投资回收期 ${r.result.结果.投资回收期月 === null ? '—' : r.result.结果.投资回收期月 + ' 个月'}　|　月度收益 ¥${r.result.结果.月度收益万元} 万</div></div>` +
          `<div style="font-size:12px;color:#33415c;background:#f8fafc;border-radius:8px;padding:10px 12px;line-height:1.9;margin-bottom:12px;">${esc(r.result.测算过程)}</div>` +
          infoGrid(Object.entries(r.result.输入).map(([k, v]) => [k, esc(v)])) +
          `<div style="font-size:12px;font-weight:700;margin:14px 0 6px;">财务口径说明</div><div style="font-size:12px;line-height:1.9;color:#33415c;">${r.result.财务口径说明.map((x) => '· ' + esc(x)).join('<br>')}</div>` +
          (r.result.数据说明 && r.result.数据说明.length ? `<div style="font-size:11.5px;color:#8791a5;margin-top:10px;">数据说明：${r.result.数据说明.map(esc).join('；')}</div>` : ''),
        footer: `${act('提交财务核定', 'benefitSubmitDo', { amount: r.result.结果.年化收益万元, note: '由 AI 测算提交' }, 'btn btn-primary')}${act('关闭', '__closeModal', {}, 'btn')}`,
      });
    },
    benefitSubmitDo: async (a) => {
      const r = await API.tool('fin_submit_benefit', { amount: a.amount, note: a.note || '', type: '报废降损', period: new Date().toISOString().slice(0, 7) });
      if (!r.ok) return toast('提交失败', 'err');
      closeModal(); toast('已提交财务核定：' + r.result.收益单号, 'ok'); refresh();
    },
    submitBenefit: async (a) => {
      const r = await API.put('/qip/api/benefits/' + a.id, { status: 'verified' });
      toast('已提交（本地环境可直接置为已核定）', 'ok'); refresh();
    },

    /* ---------- 报表与导出 ---------- */
    genReport: async (a) => {
      modal({ width: 'narrow', title: '正在生成报告…', body: loadingBlock('智能体正在汇总真实数据并生成 Word 文档（约 2~10 秒）') });
      try {
        const r = await API.tool('report_generate', { type: a.type, period: new Date().toISOString().slice(0, 7) });
        if (!r.ok) { closeModal(); return toast('生成失败：' + (r.result.error || ''), 'err'); }
        const res = r.result;
        closeModal();
        modal({
          width: 'narrow', title: '✅ 报告已生成', sub: res.报告标题,
          body: infoGrid([['报告编号', res.报告编号], ['格式', res.格式], ['文件大小', res.文件大小], ['章节', (res.章节 || []).join(' / '), true], ['内容摘要', esc(res.内容摘要 || ''), true]]) +
            `<div style="margin-top:12px;"><a class="btn btn-primary" href="${esc(res.下载链接)}">⬇ 下载 Word 文档</a></div>`,
          footer: `${act('关闭', '__closeModal', {}, 'btn')}`,
        });
        refresh();
      } catch (e) { closeModal(); toast('生成失败：' + e.message, 'err'); }
    },
    exportData: async (a) => {
      toast('正在导出，请稍候…', 'ai');
      try {
        const r = await API.tool('data_export', { dataset: a.dataset, format: a.format || 'xlsx', charId: a.charId, days: a.days, filename: a.filename });
        if (!r.ok) return toast('导出失败：' + (r.result.error || ''), 'err');
        const res = r.result;
        window.location.href = res.下载链接;
        toast('已导出：' + (res.文件名 || ''), 'ok');
      } catch (e) { toast('导出失败：' + e.message, 'err'); }
    },
    exportAudit: async () => {
      const r = await API.get('/qip/api/audit', { limit: 5000 });
      const rows = [['时间', '操作人', '插件', '动作', '参数', '结果摘要', '用途']].concat((r.rows || []).map((x) => [dt(x.ts), x.user, x.plugin, x.action, JSON.stringify(x.params || {}), x.resultSummary, x.purpose]));
      const csv = rows.map((line) => line.map((c) => '"' + String(c === undefined || c === null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      const a2 = document.createElement('a'); a2.href = URL.createObjectURL(blob); a2.download = '审计日志_' + new Date().toISOString().slice(0, 10) + '.csv'; a2.click();
      toast('审计日志已导出', 'ok');
    },

    /* ---------- SPC ---------- */
    spcSelect: async (a) => { global.SpcState.charId = a.charId; const r = await API.get('/qip/api/spc/chars'); document.getElementById('content').innerHTML = global.renderSpc(r.chars || []); },
    spcDays: async (a) => { global.SpcState.days = a.days; const r = await API.get('/qip/api/spc/chars'); document.getElementById('content').innerHTML = global.renderSpc(r.chars || []); },
    spcDetail: async (a) => { global.SpcState.charId = a.charId; global.SpcState.days = 7; await go('spc'); },

    /* ---------- 知识库 ---------- */
    kbSearch: async () => { const el = document.getElementById('kbQuery'); global.KBState.query = el ? el.value.trim() : ''; await go('knowledge'); },
    kbClear: async () => { global.KBState.query = ''; global.KBState.results = null; await go('knowledge'); },
    kbType: async (a) => { global.KBState.type = a.type; global.KBState.results = null; await go('knowledge'); },
    kbCat: async (a) => { global.KBState.category = a.category; global.KBState.results = null; await go('knowledge'); },
    kbDetail: async (a) => {
      const r = await API.get('/qip/api/knowledge/' + a.id);
      const k = r.row; if (!k) return toast('条目不存在', 'err');
      modal({
        width: 'wide', title: '📚 ' + k.title, sub: k.id + ' · ' + k.type + ' · ' + (k.category || ''),
        body: `<div style="background:#f7faff;border:1px solid #c9d8f5;border-radius:8px;padding:12px 14px;font-size:12.5px;line-height:1.95;color:#33415c;">
            <b style="color:#1a56db;">问题：</b>${esc(k.problem || '—')}<br><br>
            <b style="color:#1a56db;">原因：</b>${esc(k.cause || '—')}<br><br>
            <b style="color:#1a56db;">对策：</b>${esc(k.action || '—')}<br><br>
            <b style="color:#1a56db;">效果：</b>${esc(k.effect || '—')}</div>` +
          infoGrid([['类型', tag(k.type, 'purple')], ['类别', esc(k.category || '')], ['作者', esc(k.author || '')], ['浏览', k.views || 0], ['出处', esc(k.source || ''), true], ['标签', (k.tags || []).map((t) => tag(t, 'gray')).join(' ') || '—', true]]),
        footer: `${act('让 AI 结合本条分析我的问题', 'aiQuick', { q: '请参考知识库条目 ' + k.id + '「' + k.title + '」的方法论，结合平台真实数据，给出可执行的排查与处置步骤' }, 'btn btn-ai')}${act('关闭', '__closeModal', {}, 'btn')}`,
      });
    },
    newKnowledge: () => {
      modal({
        width: 'narrow', title: '新增经验卡', sub: '「问题-原因-对策-效果」四元组',
        body: `<div class="form-row"><div class="fl">标题 *</div><div class="fc">${UI.input('title', '', {})}</div></div>
               <div class="form-row"><div class="fl">问题现象 *</div><div class="fc">${UI.input('problem', '', { type: 'textarea', rows: 2 })}</div></div>
               <div class="form-row"><div class="fl">根本原因 *</div><div class="fc">${UI.input('cause', '', { type: 'textarea', rows: 2 })}</div></div>
               <div class="form-row"><div class="fl">对策步骤 *</div><div class="fc">${UI.input('action', '', { type: 'textarea', rows: 3 })}</div></div>
               <div class="form-row"><div class="fl">效果</div><div class="fc">${UI.input('effect', '', { type: 'textarea', rows: 2 })}</div></div>
               <div class="form-row"><div class="fl">类别</div><div class="fc">${UI.input('category', '通用', {})}</div></div>
               <div class="form-row"><div class="fl">标签（逗号分隔）</div><div class="fc">${UI.input('tagsText', '', {})}</div></div>`,
        footer: `${act('取消', '__closeModal', {}, 'btn')}${act('入库', 'kbSave', {}, 'btn btn-primary')}`,
      });
    },
    kbSave: async () => {
      const f = UI.readForm(document.querySelector('.dm-panel'));
      if (!f.title || !f.problem || !f.cause || !f.action) return toast('标题/问题/原因/对策为必填', 'warn');
      const r = await API.tool('kb_write', { title: f.title, problem: f.problem, cause: f.cause, action: f.action, effect: f.effect, category: f.category, tags: String(f.tagsText || '').split(/[,，]/).filter(Boolean) });
      if (!r.ok) return toast('入库失败', 'err');
      closeModal(); toast('经验卡已入库：' + r.result.经验卡编号, 'ok'); refresh();
    },

    /* ---------- 审批 ---------- */
    newWorkflow: () => {
      modal({
        width: 'narrow', title: '发起 OA 审批',
        body: `<div class="form-row"><div class="fl">流程类型</div><div class="fc">${UI.input('type', '8D永久对策审批', { type: 'select', options: ['8D永久对策审批', '临时措施审批', '收益核定', '改进项目立项'] })}</div></div>
               <div class="form-row"><div class="fl">标题 *</div><div class="fc">${UI.input('title', '', {})}</div></div>
               <div class="form-row"><div class="fl">关联编号</div><div class="fc">${UI.input('relatedId', '', { placeholder: '如 #QP-0377' })}</div></div>
               <div class="form-row"><div class="fl">审批内容</div><div class="fc">${UI.input('content', '', { type: 'textarea', rows: 4 })}</div></div>
               <div class="form-row"><div class="fl">加急</div><div class="fc">${UI.input('urgent', false, { type: 'checkbox', label: '加急处理' })}</div></div>`,
        footer: `${act('取消', '__closeModal', {}, 'btn')}${act('提交', 'wfDo', {}, 'btn btn-primary')}`,
      });
    },
    wfDo: async () => {
      const f = UI.readForm(document.querySelector('.dm-panel'));
      if (!f.title) return toast('请填写标题', 'warn');
      const r = await API.tool('oa_start_workflow', f);
      if (!r.ok) return toast('提交失败', 'err');
      closeModal(); toast('已发起审批 ' + r.result.审批单号, 'ok'); refresh();
    },
    approveWf: async (a) => {
      const w = (await API.get('/qip/api/workflows/' + a.id)).row;
      const approvers = (w.approvers || []).map((x) => ({ name: x.name, role: x.role, status: 'approved', at: new Date().toISOString() }));
      await API.put('/qip/api/workflows/' + a.id, { status: 'approved' });
      await API.post('/qip/api/workflows/' + a.id, {});
      const all = await API.get('/qip/api/workflows', { limit: 500 });
      toast('已批准 ' + a.id, 'ok');
      // 补充审批人状态
      try { storeFixApprovers(a.id, approvers); } catch (e) {}
      refresh();
    },
    rejectWf: async (a) => { await API.put('/qip/api/workflows/' + a.id, { status: 'rejected' }); toast('已驳回 ' + a.id, 'warn'); refresh(); },
    wfDetail: async (a) => {
      const w = (await API.get('/qip/api/workflows/' + a.id)).row;
      modal({
        width: 'narrow', title: '审批单 ' + w.id, sub: w.type,
        body: infoGrid([['标题', esc(w.title)], ['申请人', esc(w.applicant)], ['关联编号', esc(w.relatedId || '—')], ['状态', esc(w.status)], ['提交时间', dt(w.createdAt)], ['加急', w.urgent ? '是' : '否'], ['审批内容', esc(w.content || ''), true], ['AI 摘要', esc(w.aiSummary || ''), true]]) +
          table(['审批人', '角色', '状态', '时间'], (w.approvers || []).map((x) => [esc(x.name), esc(x.role), x.status === 'approved' ? tag('已批准', 'green') : tag('待审批', 'orange'), dt(x.at)])),
      });
    },

    /* ---------- 设置 ---------- */
    applyPreset: (a) => {
      const P = { deepseek: ['https://api.deepseek.com', 'deepseek-chat', 'deepseek-reasoner'], onprem: ['http://10.0.0.100:8000/v1', 'deepseek-r1-32b', 'deepseek-r1-32b'], ollama: ['http://127.0.0.1:11434/v1', 'deepseek-r1:14b', 'deepseek-r1:14b'], gateway: ['https://your-gateway.example.com/v1', 'deepseek-chat', 'deepseek-reasoner'] }[a.key];
      const set = (field, val) => { const el = document.querySelector('[data-field="' + field + '"]'); if (el) el.value = val; };
      set('llm.baseUrl', P[0]); set('llm.model', P[1]); set('llm.reasonerModel', P[2]);
      toast('已填充预设，请补充 API Key 后保存', 'ok');
    },
    /* ---------- 初始设置：命名 ---------- */
    addWs: () => {
      const d = initDraftFromForm();
      if (d.workshops.length >= 12) return toast('车间最多 12 个', 'warn');
      d.workshops.push('');
      SetState.initDraft = d;
      go('init');
    },
    delWs: (a) => {
      const d = initDraftFromForm();
      if (d.workshops.length <= 1) return toast('至少要保留 1 个车间', 'warn');
      d.workshops.splice(a.i, 1);
      SetState.initDraft = d;
      go('init');
    },
    addPd: () => {
      const d = initDraftFromForm();
      if (d.products.length >= 10) return toast('产品最多 10 个', 'warn');
      d.products.push('');
      SetState.initDraft = d;
      go('init');
    },
    delPd: (a) => {
      const d = initDraftFromForm();
      if (d.products.length <= 1) return toast('至少要保留 1 个产品', 'warn');
      d.products.splice(a.i, 1);
      SetState.initDraft = d;
      go('init');
    },
    aiNaming: async () => {
      const d = initDraftFromForm();
      const text = String(d.note || '').trim();
      if (!text) return toast('请先在「增加信息」里写下你们的情况，AI 才有依据判断', 'warn', 6000);
      modal({ width: 'narrow', title: '🤖 AI 正在判断如何调整', sub: '把这段说明交给智能体，让它给出建议的车间 / 产品 / 部门设置', body: loadingBlock('正在分析你们的描述…') });
      try {
        const r = await API.post('/qip/api/naming/interpret', { text });
        if (!r.ok) { closeModal(); return toast(r.error || 'AI 判断失败', 'err', 9000); }
        const cur = r.current || {};
        const sug = r.suggestion || {};
        SetState.aiSuggestion = sug;
        SetState.aiNoteText = text;
        const diff = (label, before, after) => {
          const b = (before || []).join('、') || '—';
          const a2 = (after || []).join('、') || '—';
          const same = b === a2;
          return `<div style="font-size:12px;line-height:1.9;padding:7px 0;border-bottom:1px dashed #eef1f6;">
            <b style="color:#33415c;">${label}</b>
            <div style="color:#8791a5;">现状：${esc(b)}</div>
            <div style="color:${same ? '#8791a5' : '#1a56db'};font-weight:600;">建议：${esc(a2)}${same ? '（不变）' : ''}</div>
          </div>`;
        };
        const steps = (sug.steps || []).length ? `<div style="font-size:11.5px;color:#5e6b85;line-height:1.9;margin-top:10px;">
            <b>操作建议</b><ul style="margin:6px 0 0 18px;padding:0;">${sug.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : '';
        const extra = (sug.extra || []).length ? `<div style="font-size:11.5px;color:#5e6b85;line-height:1.9;margin-top:10px;">
            <b>其它建议（需手工调整）</b><ul style="margin:6px 0 0 18px;padding:0;">${sug.extra.map((x) => `<li>${esc(x.path || '')}：${esc(String(x.value || ''))}${x.why ? ' —— ' + esc(x.why) : ''}</li>`).join('')}</ul></div>` : '';
        modal({
          width: 'narrow',
          title: '🤖 AI 建议这样调整',
          sub: esc(sug.summary || '') + (r.model ? '　·　' + esc(r.model) : ''),
          body: diff('公司', [cur.company], [sug.company]) + diff('部门', [cur.dept], [sug.dept]) +
            diff('车间', cur.workshops, sug.workshops) + diff('产品', cur.products, sug.products) + steps + extra,
          footer: `${act('填入表单（确认后再保存）', 'applyAiNaming', {}, 'btn btn-primary')}${act('取消', '__closeModal', {}, 'btn')}`,
        });
      } catch (e) {
        closeModal();
        toast('AI 判断失败：' + e.message, 'err', 9000);
      }
    },
    applyAiNaming: () => {
      const sug = SetState.aiSuggestion;
      if (!sug) return;
      SetState.initDraft = {
        company: sug.company || '', dept: sug.dept || '',
        workshops: (sug.workshops || []).slice(), products: (sug.products || []).slice(),
        note: SetState.aiNoteText || '',
      };
      SetState.aiSuggestion = null;
      go('init');
      toast('已把 AI 建议填入表单，核对后点「保存并应用到数据」', 'ok', 7000);
    },
    saveNaming: async () => {
      const d = initDraftFromForm();
      const workshops = d.workshops.map((w) => w.trim()).filter(Boolean);
      const products = d.products.map((p) => p.trim()).filter(Boolean);
      if (!workshops.length) return toast('至少要填 1 个车间名称', 'err');
      if (!products.length) return toast('至少要填 1 个产品名称', 'err');
      if (workshops.length > 12) return toast('车间最多 12 个', 'err');
      if (products.length > 10) return toast('产品最多 10 个', 'err');
      if (new Set(workshops).size !== workshops.length) return toast('车间名称不能重复', 'err');
      if (new Set(products).size !== products.length) return toast('产品名称不能重复', 'err');
      const company = d.company.trim() || '某制造型企业';
      const dept = d.dept.trim() || '质量改进部门';
      askConfirm('保存并应用到数据', [
        ['公司', company], ['部门', dept],
        ['车间', workshops.join('、') + '（' + workshops.length + ' 个）'],
        ['产品', products.join('、') + '（' + products.length + ' 个）'],
      ], '平台会把现有的车间/产品名称整体替换为上面这套（问题库、改进项目、SPC 特性、知识库、人员标签、报表里的旧名称一起替换）；被删掉的车间/产品，历史数据保留原名不丢。').then(async (ok) => {
        if (!ok) return;
        try {
          const r = await API.post('/qip/api/naming', { company, dept, workshops, products, note: d.note });
          const rn = r.renamed || {};
          let msg = `已应用：替换 ${rn.pairs || 0} 组名称、${rn.fields || 0} 个字段`;
          if ((rn.added || []).length) msg += `，新增 ${rn.added.length} 个`;
          if ((rn.dropped || []).length) msg += `，移除 ${rn.dropped.length} 个（历史数据保留原名）`;
          SetState.initDraft = null;
          const brandChanged = !!(r.naming && r.naming.brand && r.naming.brand !== SetState.lastBrand);
          toast(msg + (brandChanged ? '；平台显示名已改为「' + r.naming.brand + '」，Harness 左侧菜单名称刷新页面后同步' : ''), 'ok', 9000);
          await refresh();
        } catch (e) { toast('保存失败：' + e.message, 'err', 8000); }
      });
    },
    /* ---------------- 体系文件（中小型企业版） ---------------- */
    qmsDraft: async () => { await saveQmsSurvey(false); },
    qmsComplete: async (a) => {
      const ok = await saveQmsSurvey(true);
      if (ok && a && a.go) await go(a.go);
    },
    qmsGen: async (a) => {
      const type = a && a.type === 'procedure' ? 'procedure' : 'manual';
      const name = type === 'manual' ? '质量手册' : '程序文件';
      modal({ width: 'narrow', title: '正在生成' + name + '…', body: UI.loadingBlock('按调研表组织内容，接了模型时通常 20~60 秒', '') });
      try {
        const r = await API.post('/qip/api/qms/generate', { type });
        closeModal();
        if (!r || !r.ok) { toast((r && r.error) || '生成失败', 'err', 9000); return; }
        const src = r.source === 'ai' ? ('由模型 ' + (r.model || '')) : '由内置模板';
        toast('已生成 ' + (r.docs || []).length + ' 份' + name + '（' + src + '）' + (r.note ? '：' + r.note : ''), r.source === 'ai' ? 'ok' : 'warn', 9000);
        await refresh();
      } catch (e) {
        closeModal();
        toast('生成失败：' + e.message, 'err', 9000);
      }
    },
    qmsDoc: async (a) => {
      try {
        const r = await API.get('/qip/api/qms/doc/' + encodeURIComponent(a.id));
        const d = (r && r.doc) || {};
        UI.modal({
          title: UI.esc(d.title || '文件预览'),
          sub: (d.code || '') + ' · ' + (d.source === 'ai' ? 'AI 生成' : '模板生成') + ' · ' + String((d.content || '').length) + ' 字',
          width: 'dm-wide',
          body: '<pre class="md-pre">' + UI.esc(d.content || '') + '</pre>',
          footer: UI.act('下载 .md', 'qmsDown', { id: a.id }, 'btn btn-primary'),
        });
      } catch (e) { toast('打开失败：' + e.message, 'err'); }
    },
    qmsDown: async (a) => {
      try {
        const r = await API.get('/qip/api/qms/doc/' + encodeURIComponent(a.id));
        const d = (r && r.doc) || {};
        downloadText((d.code || 'QMS') + '_' + (d.title || '文件') + '.md', d.content || '');
      } catch (e) { toast('下载失败：' + e.message, 'err'); }
    },
    qmsDownAll: async (a) => {
      const type = (a && a.type) === 'procedure' ? 'procedure' : 'manual';
      try {
        const list = await API.get('/qip/api/qms/docs?type=' + type);
        const rows = (list && list.rows) || [];
        if (!rows.length) return toast('还没有可下载的文件', 'warn');
        const parts = [];
        for (const it of rows) {
          const r = await API.get('/qip/api/qms/doc/' + encodeURIComponent(it.id));
          const d = (r && r.doc) || {};
          parts.push(d.content || '');
        }
        downloadText((type === 'manual' ? '质量手册' : '程序文件汇编') + '.md', parts.join('\n\n---\n\n'));
      } catch (e) { toast('下载失败：' + e.message, 'err'); }
    },

    scalePick: async (a) => {
      const target = a && a.scale === 'sme' ? 'sme' : 'large';
      const labels = { large: '大中型企业版', sme: '中小型企业版' };
      if (target === SetState.scale) return; // 已经是当前版式：点了不动
      // 直接切换，不弹确认框
      try {
        const sw = document.getElementById('scaleSwitch');
        if (sw) sw.querySelectorAll('.sc').forEach((el) => {
          const k = (el.getAttribute('data-args') || '').indexOf('sme') >= 0 ? 'sme' : 'large';
          el.classList.toggle('on', k === target);
        });
        await API.post('/qip/api/scale', { scale: target });
        window.location.reload();
      } catch (e) {
        toast('切换' + labels[target] + '失败：' + e.message, 'err', 8000);
        // 失败时把高亮改回原版式
        const sw2 = document.getElementById('scaleSwitch');
        if (sw2) sw2.querySelectorAll('.sc').forEach((el) => {
          const k = (el.getAttribute('data-args') || '').indexOf('sme') >= 0 ? 'sme' : 'large';
          el.classList.toggle('on', k === SetState.scale);
        });
      }
    },
    resetNaming: async () => {
      askConfirm('恢复默认名称', [
        ['车间', '一车间 / 二车间 / 三车间 / 四车间 / 五车间'],
        ['产品', '产品A / 产品B / 产品C'],
        ['公司', '某制造型企业'], ['部门', '质量改进部门'],
      ], '当前已改过的名称会被整体替换回平台内置的名称。').then(async (ok) => {
        if (!ok) return;
        try {
          const r = await API.get('/qip/api/naming');
          const df = (r && r.defaults) || {};
          await API.post('/qip/api/naming', { company: df.company, dept: df.dept, workshops: df.workshops, products: df.products });
          SetState.initDraft = null;
          toast('已恢复默认名称', 'ok');
          await refresh();
        } catch (e) { toast('恢复失败：' + e.message, 'err', 8000); }
      });
    },
    saveSettings: async (a) => {
      const scope = document.querySelector('.dm-panel') || document.getElementById('content');
      const all = UI.readForm(document.getElementById('content'));
      const llm = {}, agent = {};
      Object.keys(all).forEach((k) => {
        if (k.indexOf('llm.') === 0) llm[k.slice(4)] = all[k];
        if (k.indexOf('agent.') === 0) agent[k.slice(6)] = all[k];
      });
      if (llm.apiKey === '') delete llm.apiKey;
      if (llm.temperature !== undefined) llm.temperature = Number(llm.temperature);
      if (llm.maxTokens !== undefined) llm.maxTokens = Number(llm.maxTokens);
      if (llm.timeoutMs !== undefined) llm.timeoutMs = Number(llm.timeoutMs);
      if (agent.maxRounds !== undefined) agent.maxRounds = Number(agent.maxRounds);
      try {
        await API.post('/qip/api/settings', { settings: { llm, agent } });
        toast('设置已保存到本机', 'ok');
        await loadBootstrap();
      } catch (e) { toast('保存失败：' + e.message, 'err'); }
    },
    testLlm: async () => {
      const all = UI.readForm(document.getElementById('content'));
      const llm = {};
      Object.keys(all).forEach((k) => { if (k.indexOf('llm.') === 0) llm[k.slice(4)] = all[k]; });
      if (llm.apiKey === '') delete llm.apiKey;
      global.SetState.testing = true; global.SetState.steps = null;
      await go('settings');
      try {
        const r = await API.post('/qip/api/settings/test-llm', { llm });
        global.SetState.testing = false; global.SetState.steps = r.steps || [];
        await go('settings');
        toast(r.ok ? '全部检查通过 ✅' : '存在未通过项，请查看详情', r.ok ? 'ok' : 'warn');
      } catch (e) {
        global.SetState.testing = false;
        global.SetState.steps = [{ name: '测试请求失败', ok: false, detail: e.message, ms: 0 }];
        await go('settings');
      }
    },
    troubleshoot: () => {
      modal({
        width: 'wide', title: '连接失败排查指南', sub: '99% 的问题出在这几处',
        body: `<div style="font-size:12.5px;line-height:2;">
          <b>① 401 / 403</b>：API Key 错误或已过期。DeepSeek 官方 Key 在 <code>platform.deepseek.com</code> 创建；注意不要有多余空格。<br>
          <b>② 404</b>：Base URL 写错。官方是 <code>https://api.deepseek.com</code>（不要加 <code>/v1/chat/completions</code>）；自建 vLLM/Ollama 通常要写成 <code>http://IP:端口/v1</code>。<br>
          <b>③ 402</b>：账户余额不足。<br>
          <b>④ 连接超时 / ENOTFOUND</b>：本机无法访问外网，或自建服务未启动。可先在本机浏览器打开 Base URL 验证。<br>
          <b>⑤ 工具调用失败（第 ③ 步不通过）</b>：所选模型不支持 function calling。请换用 <code>deepseek-chat</code> 或支持 tools 的模型；否则智能体只能聊天、无法查数。<br>
          <b>⑥ 流式不通过（第 ④ 步）</b>：网关屏蔽了 SSE。可在「模型接入」中关闭「流式输出」开关。<br>
          <b>⑦ 数据不出厂要求</b>：把 Base URL 指向厂内私有化 OpenAI 兼容端点（vLLM / TGI / Ollama），并把 API Key 按厂内网关要求填写。
        </div>`,
      });
    },
    pluginConfig: (a) => {
      const s = State.bootstrap.settings.plugins[a.key];
      modal({
        width: 'narrow', title: '配置插件 ' + s.name, sub: s.desc,
        body: `<div class="form-row"><div class="fl">启用</div><div class="fc">${UI.input('p.enabled', s.enabled !== false, { type: 'checkbox', label: '启用该插件（停用后其工具将从模型中移除）' })}</div></div>
               <div class="form-row"><div class="fl">数据模式</div><div class="fc">${UI.input('p.mode', s.mode || 'local', { type: 'select', options: [{ value: 'local', label: '本地数据仓（平台内数据，可导入 Excel）' }, { value: 'http', label: 'HTTP 直连真实系统' }] })}</div></div>
               <div class="form-row"><div class="fl">接口地址</div><div class="fc">${UI.input('p.baseUrl', s.baseUrl || '', { placeholder: '如 http://mes.gz-geely.local/api' })}</div></div>
               <div class="form-row"><div class="fl">鉴权 Key</div><div class="fc">${UI.input('p.apiKey', s.apiKey || '', { type: 'password', placeholder: '插件级 API Key' })}</div></div>
               <div class="form-row"><div class="fl">超时（毫秒）</div><div class="fc">${UI.input('p.timeoutMs', s.timeoutMs || 30000, { type: 'number' })}</div></div>`,
        footer: `${act('取消', '__closeModal', {}, 'btn')}${act('保存', 'pluginSave', { key: a.key }, 'btn btn-primary')}`,
      });
    },
    pluginSave: async (a) => {
      const f = UI.readForm(document.querySelector('.dm-panel'));
      await API.post('/qip/api/settings', { settings: { plugins: { [a.key]: { enabled: f['p.enabled'], mode: f['p.mode'], baseUrl: f['p.baseUrl'], apiKey: f['p.apiKey'], timeoutMs: Number(f['p.timeoutMs']) || 30000 } } } });
      closeModal(); toast('插件配置已保存', 'ok'); await loadBootstrap(); refresh();
    },
    pluginGuide: () => modal({
      width: 'wide', title: '插件接入说明', sub: '新增系统只开发适配器，主平台零改造',
      body: `<div style="font-size:12.5px;line-height:2;">
        <b>1. 插件协议</b>：每个插件声明 <code>manifest</code>（能力声明 + 参数 JSON Schema）+ <code>execute()</code> + <code>healthCheck()</code>。平台已按此协议实现 51 个工具。<br>
        <b>2. 接入方式</b>：在「系统设置 → 插件总线」把模式切为「HTTP 直连」，填写接口地址与鉴权 Key。平台会按统一协议调用，无需改主平台。<br>
        <b>3. 降级方案</b>：真实接口未就绪时，用「数据管理 → 导入 Excel/CSV」把数据导入本地数据仓，工具体系与结论口径完全一致。<br>
        <b>4. 鉴权与审计</b>：插件级 API Key + 用户级权限继承（OA 组织架构）；每次调用留痕（谁·何时·取了什么·用途）。<br>
        <b>5. 超时与降级</b>：单插件超时默认 30s，失败不影响整体编排，模型会收到错误并给出替代方案。<br>
        <b>6. 六大业务插件核心接口</b>：<code>getMeasureData / getScrapLine / getTraceByVIN / getBatchByWorkstation</code>（MES）、<code>getBOM / getBatch / getSupplier / getCost</code>（ERP）、<code>startWorkflow / pushTodo / getOrgTree</code>（OA）、<code>submitBenefit / getVerifiedBenefit</code>（FIN）、<code>getControlChart / getRuleViolations / getCpk</code>（SPC）、<code>getDefects / getImageResult</code>（AQI）。
      </div>`,
    }),
    wbGuide: () => modal({
      width: 'wide', title: 'AI 工作台使用指南',
      body: `<div style="font-size:12.5px;line-height:2;">
        <b>能做什么</b>：查数取证、SPC 判异、根因假设、经验检索、8D 立项推进、报告成文、数据导出、收益测算、审批发起 —— 全部基于真实数据和真实工具。<br>
        <b>怎么说</b>：像跟工程师同事说话一样即可。想定向查某个系统可用 <code>@MES</code>、<code>@SPC</code> 等前缀。<br>
        <b>护栏</b>：①数字全部来自工具 ②结论必须挂出处，没出处只能说「假设」 ③对外发送/承诺/8D 关闭会先请你确认 ④全程审计。<br>
        <b>效率技巧</b>：<br>
        · 一次问一件事，结论更准<br>
        · 让它「把结论写入项目 D4」可以直接推进 8D<br>
        · 说「导出 Excel」「生成 Word 报告」会真的产出文件<br>
        · 说「沉淀为经验卡」会把本次经验写入知识库，下次别人就能检索到
      </div>`,
    }),
    mobileGuide: () => modal({
      width: 'narrow', title: '移动端说明',
      body: `<div style="font-size:12.5px;line-height:2;">
        本页为移动端界面预览，用真实数据渲染。<br>
        实际落地建议：一期用<b>企业微信 H5</b>（复用本平台同一套 API，零安装）；二期做<b>微信小程序</b>（项目目录中已有小程序工程可复用）。<br>
        移动端与桌面端共用同一个 Harness 与数据，结论完全一致。
      </div>`,
    }),

    /* ---------- 数据管理 ---------- */
    importFile: (a) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx,.csv';
      input.onchange = async () => {
        const f = input.files[0];
        if (!f) return;
        toast('正在解析并导入 ' + f.name + ' …', 'ai', 8000);
        try {
          const r = await API.importFile(f, a.target);
          if (!r.ok) return toast('导入失败：' + r.error, 'err', 9000);
          modal({
            width: 'wide', title: '✅ 导入完成', sub: f.name,
            body: infoGrid([['目标数据集', r.target], ['成功导入', r.imported + ' 行'], ['跳过', r.skipped + ' 行'], ['识别到的列', (r.detectedColumns || []).join(' / ') || '（未识别）', true]]) +
              (r.errors && r.errors.length ? `<div style="color:#e5484d;font-size:12px;margin-top:8px;">${r.errors.map(esc).join('<br>')}</div>` : '') +
              `<div style="font-size:11.5px;color:#8791a5;margin-top:10px;">导入的数据已可直接用于 SPC 判异、Cpk 计算、报表与导出。</div>`,
          });
          await loadBootstrap(); refresh();
        } catch (e) { toast('导入失败：' + e.message, 'err'); }
      };
      input.click();
    },
    resetData: () => modal({
      width: 'narrow', title: '重建初始数据', sub: '会清空所有业务数据（保留模型配置）',
      body: '<div style="font-size:12.5px;color:#c8620a;line-height:1.9;">⚠ 该操作会清空问题库、项目、测量数据、知识库等全部业务数据，并重新灌入初始数据。模型配置会保留。</div>',
      footer: `${act('取消', '__closeModal', {}, 'btn')}${act('确认重建', 'resetDataDo', {}, 'btn btn-primary')}`,
    }),
    resetDataDo: async () => { await API.post('/qip/api/data/reset', {}); closeModal(); toast('初始数据已重建', 'ok'); await loadBootstrap(); refresh(); },
    clearData: () => modal({
      width: 'narrow', title: '清空业务数据', sub: '用于导入真实数据前的清场',
      body: '<div style="font-size:12.5px;color:#c8620a;line-height:1.9;">⚠ 将清空全部业务数据（不含人员与系统设置），之后页面会显示空状态。可通过「重建初始数据」恢复。</div>',
      footer: `${act('取消', '__closeModal', {}, 'btn')}${act('确认清空', 'clearDataDo', {}, 'btn btn-primary')}`,
    }),
    clearDataDo: async () => { await API.post('/qip/api/data/clear', {}); closeModal(); toast('已清空', 'ok'); await loadBootstrap(); refresh(); },
  };

  /* 每次数据变更后刷新徽标 */
  async function storeFixApprovers() { /* 占位：审批人状态由服务端 workflows 记录维护 */ }

  /* ==================================================================
     事件分发
     ================================================================== */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const actName = el.getAttribute('data-act');
    const fn = Actions[actName];
    if (!fn) return;
    let args = {};
    try { args = JSON.parse(el.getAttribute('data-args') || '{}'); } catch (err) {}
    e.preventDefault(); e.stopPropagation();
    try { fn(args, el); } catch (err) { console.error(err); toast('操作失败：' + err.message, 'err'); }
  });

  // 顶部导航：一级项直接跳页，带下拉的可展开二级菜单（下拉用 fixed 定位，窄屏滚动也不裁切）
  function closeNavMenus() { document.querySelectorAll('.nav-menu.open').forEach((m) => m.classList.remove('open')); }
  function openNavMenu(menu) {
    closeNavMenus();
    const parent = menu.querySelector('.nav-parent');
    const drop = menu.querySelector('.nav-drop');
    if (!parent || !drop) return;
    menu.classList.add('open');
    const r = parent.getBoundingClientRect();
    const w = drop.offsetWidth || 214;
    drop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    drop.style.top = Math.round(r.bottom + 6) + 'px';
  }
  const navEl = document.getElementById('nav');
  if (navEl) {
    navEl.addEventListener('click', (e) => {
      const parent = e.target.closest('.nav-parent');
      if (parent) {
        const menu = parent.closest('.nav-menu');
        if (menu.classList.contains('open')) closeNavMenus();
        else openNavMenu(menu);
        return;
      }
      const item = e.target.closest('.nav-item[data-page]');
      if (item) { closeNavMenus(); go(item.getAttribute('data-page')); }
    });
  }
  document.addEventListener('click', (e) => { if (!e.target.closest('.nav-menu')) closeNavMenus(); });
  window.addEventListener('resize', closeNavMenus);
  window.addEventListener('scroll', closeNavMenus, true);

  // 聊天输入框：Enter 发送 / Shift+Enter 换行 / 自动高度
  document.addEventListener('keydown', (e) => {
    if (e.target && e.target.id === 'chatInput') {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); Actions.chatSend(); }
    }
    if (e.key === 'Escape') { const qt = document.getElementById('qtOverlay'); if (qt) qt.classList.remove('show'); closeNavMenus(); closeModal(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); Actions.openSearch(); }
  });
  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'chatInput') {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(180, e.target.scrollHeight) + 'px';
    }
  });
  // 质量工具浮层点击遮罩关闭
  document.addEventListener('click', (e) => {
    const qt = document.getElementById('qtOverlay');
    if (qt && e.target === qt) qt.classList.remove('show');
  });

  window.addEventListener('hashchange', () => {
    const p = location.hash.slice(1);
    if (p && p !== State.page) go(p);
  });

  /* ==================================================================
     启动
     ================================================================== */
  (async function boot() {
    await loadBootstrap();
    global.QWizard.menu();
    const p = location.hash.slice(1) || 'dashboard';
    await go(Pages[p] ? p : 'dashboard');
    // 首次使用提示
    if (State.bootstrap && !(State.bootstrap.settings.llm || {}).hasApiKey) {
      setTimeout(() => {
        modal({
          width: 'narrow', title: '👋 欢迎使用' + ((State.bootstrap && State.bootstrap.brand) || '质上开源质量平台'),
          sub: '还差一步就能开始真实的智能体对话',
          body: `<div style="font-size:12.5px;line-height:2;">
            <b>这里的数字都是真的</b>：查真实数据、真算 Cpk 与判异、真出 Excel/Word、真写数据库。<br><br>
            现在只差接入大模型：<br>
            ① 点「去配置」→ 选一个预设（DeepSeek 官方 / 厂内私有化 / Ollama）<br>
            ② 填入 API Key<br>
            ③ 点「测试连通性」，看到 4 项全绿即可<br>
            ④ 回到「AI 改进工作台」开始对话<br><br>
            <span style="color:#8791a5;">提示：即使不接模型，SPC、知识库、报表、质量工具等功能也都可以正常使用。</span><br><br>
            <span style="color:#8791a5;">本插件以 MIT 许可开源：可自由修改、私有化部署与二次开发，保留版权与许可声明即可。</span></div>`,
          footer: `${act('稍后再说', '__closeModal', {}, 'btn')}${act('去配置', 'goto', { page: 'settings' }, 'btn btn-primary')}`,
        });
      }, 900);
    }
  })();
})(window);



