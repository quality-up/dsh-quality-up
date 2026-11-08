/* ==================================================================
   系统页面：审批中心 / 系统设置 / 审计日志
   ================================================================== */
(function (global) {
  'use strict';
  const { esc, act, card, kpi, table, tag, dt, day, num, empty, infoGrid, input, readForm, toast, modal, brand } = UI;
  const Pages = global.Pages;
  const SetState = global.SetState = { steps: null, testing: false, initDraft: null, aiSuggestion: null, aiNoteText: '' };

  /* ================= 初始设置（公司 / 部门 / 车间 / 产品命名，可增可减） ================= */
  Pages.init = {
    title: '初始设置', sub: '公司 · 部门 · 车间 · 产品｜车间与产品可增可减，保存后自动替换平台内置的车间/产品名称',
    async render() {
      // 服务未重启（旧后端还没有 /api/naming）时回落到 bootstrap 里的命名，页面不至于报错
      const FALLBACK = { company: '某制造型企业', dept: '质量改进部门', workshops: ['一车间', '二车间', '三车间', '四车间', '五车间'], products: ['产品A', '产品B', '产品C'] };
      let r = null;
      try { r = await API.get('/qip/api/naming'); } catch (e) { r = { naming: ((global.State.bootstrap || {}).naming) || FALLBACK, defaults: FALLBACK, note: null }; }
      const draft = SetState.initDraft || null;
      const d = r.defaults || FALLBACK;
      const n = draft ? Object.assign({}, r.naming || {}, draft) : (r.naming || {});
      const ws = ((n.workshops || []).length ? n.workshops.slice() : ['']).slice(0, 12);
      const pd = ((n.products || []).length ? n.products.slice() : ['']).slice(0, 10);
      const noteText = (draft && draft.note !== undefined) ? draft.note : ((r.note && r.note.text) || '');
      const dWs = d.workshops || [];
      const dPd = d.products || [];
      const row = (label, small, field, value, ph) => `
        <div class="form-row"><div class="fl">${label}<small>${small || ''}</small></div><div class="fc">${input(field, value, { placeholder: ph || '' })}</div></div>`;
      const delBtn = (kind, i, canDel) => (canDel
        ? `<span style="flex:0 0 auto;">${act('✕', kind === 'ws' ? 'delWs' : 'delPd', { i }, 'btn btn-sm')}</span>` : '');
      const wsRows = ws.map((v, i) => `
        <div class="form-row"><div class="fl">车间 ${i + 1}<small>默认：${dWs[i] || '—'}</small></div>
          <div class="fc" style="display:flex;gap:8px;align-items:center;">${input('ws' + i, v, { placeholder: '例如：' + (dWs[i] || '一车间') })}${delBtn('ws', i, ws.length > 1)}</div></div>`).join('');
      const pdRows = pd.map((v, i) => `
        <div class="form-row"><div class="fl">产品 ${i + 1}<small>默认：${dPd[i] || '—'}</small></div>
          <div class="fc" style="display:flex;gap:8px;align-items:center;">${input('pd' + i, v, { placeholder: '例如：' + (dPd[i] || '产品A') })}${delBtn('pd', i, pd.length > 1)}</div></div>`).join('');
      return `
      <div class="ai-strip">
        <div class="ai-ico">🏷️</div>
        <div class="ai-txt"><b>填一次，全平台都按你的叫法：</b>车间、产品可以按你们的实际情况<b>增加或删除</b>；保存后平台会把内置的车间/产品名称整体替换为你的口径 —— 问题库、改进项目、SPC 特性、知识库、人员与专家标签、报表与导出文档一起换掉。名称随时可以再改，也可以恢复默认。</div>
        ${act('保存并应用到数据', 'saveNaming', {}, 'btn btn-ai')}
      </div>
      <div class="grid g2" style="align-items:start;">
        <div>
          ${card('公司 / 部门', '显示在顶栏、AI 人设与导出文档',
            row('公司名称', '平台内统一的组织名称', 'nmCompany', n.company || '', '例如：某某汽车零部件有限公司') +
            row('部门名称', '质量问题归口部门', 'nmDept', n.dept || '', '例如：质量管理部 · 质量改进科'))}
          <div style="height:14px;"></div>
          ${card('产品名称', '可以增加 / 减少，至少 1 个', pdRows +
            `<div style="margin-top:10px;">${act('＋ 增加产品', 'addPd', {}, 'btn btn-sm')}</div>` +
            `<div class="tips-line">保存后按「对应关系」替换：同名的保持不变，新填的名称替换到对应位置的旧名称上；删掉的产品，历史数据会保留原名（不再出现在下拉选项里）。</div>`)}
        </div>
        ${card('车间名称', '可以增加 / 减少，至少 1 个', wsRows +
          `<div style="margin-top:10px;">${act('＋ 增加车间', 'addWs', {}, 'btn btn-sm')}</div>` +
          `<div class="tips-line">同一行改了就按「旧名 → 新名」整库替换（含工位里的车间前缀）；新增的车间会出现在发现问题、改进立项、语音报障的下拉里；删除的车间，其历史数据保留原名，不会丢。</div>`)}
      </div>
      <div style="margin-top:14px;">
        ${card('增加信息', '把平台还不知道的情况写成一段话，让 AI 判断该改什么',
          `${input('nmNote', noteText, { type: 'textarea', rows: 4, placeholder: '例如：我们有两个工厂，一厂有冲压、焊装、涂装三个车间；二厂有总装和电池两个车间。产品按平台分 A/B 两个平台，另外还有出口批次的特殊管控要求，希望问题库里能区分出口/内销。' })}
           <div class="act-bar" style="margin-top:10px;">
             ${act('🤖 让 AI 判断如何调整', 'aiNaming', {}, 'btn btn-ai')}
             <span style="font-size:11.5px;color:#8791a5;">AI 只会给出「建议改法」，你看过之后点「应用到设置」才会真正改数据。没有接模型时会提示你先接入。</span>
           </div>
           ${r.note && r.note.ts ? `<div class="tips-line">上次保存的说明（${esc(dt(r.note.ts))}）：${esc(String(r.note.text || '').slice(0, 160))}</div>` : ''}`)}
      </div>
      <div class="act-bar" style="margin-top:14px;">
        ${act('💾 保存并应用到数据', 'saveNaming', {}, 'btn btn-primary')}
        ${act('↩️ 恢复默认名称', 'resetNaming', {}, 'btn')}
        <span style="font-size:11.5px;color:#8791a5;">保存后可随时改回，改回同样会把这些名称整体替换回去。</span>
      </div>`;
    },
  };

  /* ================= 审批中心与待办 ================= */
  Pages.approval = {
    title: '审批中心与待办', sub: 'OA 审批流 · 派工任务 · 人工确认拦截的动作',
    async render() {
      const [wfRes, todoRes] = await Promise.all([API.get('/qip/api/workflows', { limit: 200 }), API.get('/qip/api/todos', { limit: 300 })]);
      const wfs = wfRes.rows || [];
      const todos = todoRes.rows || [];
      const pending = wfs.filter((w) => w.status === 'pending');
      const openTodos = todos.filter((t) => !t.done);
      return `
      <div class="ai-strip">
        <div class="ai-ico">✅</div>
        <div class="ai-txt"><b>审批与派工：</b>平台通过 @OA 推送待办与审批流（权限继承 OA 组织架构，不另建账号）。对外承诺类动作由智能体挂起为「待确认项」，人工确认后才真正执行。当前待审批 <b>${pending.length}</b> 单，未完成待办 <b>${openTodos.length}</b> 项。</div>
        ${act('＋ 发起审批', 'newWorkflow', {}, 'btn btn-ai')}
      </div>
      <div class="grid g4" style="margin-bottom:14px;">
        ${kpi({ ico: '⏳', label: '待审批', value: pending.length, color: '#c8620a', icoBg: '#fff3e0', delta: '其中加急 ' + pending.filter((w) => w.urgent).length })}
        ${kpi({ ico: '✅', label: '已批准', value: wfs.filter((w) => w.status === 'approved').length, color: '#18a058', icoBg: '#e8f7ee' })}
        ${kpi({ ico: '📌', label: '未完成待办', value: openTodos.length, color: '#1a56db', delta: 'A 级 ' + openTodos.filter((t) => t.priority === 'A').length })}
        ${kpi({ ico: '🔒', label: '待人工确认动作', value: (global.State.bootstrap.pendingActions || []).length, color: '#e5484d', icoBg: '#feece8', delta: '智能体已挂起', act: 'goto', args: { page: 'aiwb' } })}
      </div>
      ${card('OA 审批流', '共 ' + wfs.length + ' 单',
        table(['单号', '类型', '标题', '申请人', '关联', '状态', '审批人', '提交时间', ''],
          wfs.map((w) => ({
            cells: ['<b>' + esc(w.id) + '</b>' + (w.urgent ? ' ' + tag('加急', 'red') : ''), tag(w.type, 'blue'), esc(w.title), esc(w.applicant), esc(w.relatedId || '—'),
              w.status === 'pending' ? tag('待审批', 'orange') : w.status === 'approved' ? tag('已批准', 'green') : tag(w.status, 'gray'),
              (w.approvers || []).map((a) => esc(a.name) + (a.status === 'approved' ? tag('已批', 'green') : tag('待批', 'gray'))).join(' '), dt(w.createdAt),
              w.status === 'pending' ? act('批准', 'approveWf', { id: w.id }, 'btn btn-sm btn-primary') + act('驳回', 'rejectWf', { id: w.id }, 'btn btn-sm') : act('详情', 'wfDetail', { id: w.id }, 'btn btn-sm')],
          })), { empty: '暂无审批单' }))}
      ${card('待办清单', '共 ' + openTodos.length + ' 项未完成',
        table(['级别', '事项', '责任人', '来源', '期限', ''],
          openTodos.map((t) => ({
            cells: [tag(t.priority, t.priority === 'A' ? 'red' : t.priority === 'B' ? 'orange' : 'gray'), '<b>' + esc(t.title) + '</b>', esc(t.user || ''), esc(t.source || ''), dt(t.dueAt), act('完成', 'todoDone', { id: t.id }, 'btn btn-sm')],
          })), { empty: '暂无待办' }))}
      <div class="footer-note">${brand()} · 审批中心</div>`;
    },
  };

  /* ================= 系统设置 ================= */
  const PRESETS = {
    deepseek: { label: 'DeepSeek 官方 API', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', reasonerModel: 'deepseek-reasoner', note: '在 platform.deepseek.com 创建 API Key。按量计费。' },
    onprem: { label: '厂内私有化部署（vLLM / TGI）', baseUrl: 'http://10.0.0.100:8000/v1', model: 'deepseek-r1-32b', reasonerModel: 'deepseek-r1-32b', note: '数据不出厂。需填写自建 OpenAI 兼容端点，末尾一般带 /v1。' },
    ollama: { label: '本机 Ollama（离线）', baseUrl: 'http://127.0.0.1:11434/v1', model: 'deepseek-r1:14b', reasonerModel: 'deepseek-r1:14b', note: '需先安装 Ollama 并 pull 模型；可留空 API Key。' },
    gateway: { label: '企业网关 / 中转', baseUrl: 'https://your-gateway.example.com/v1', model: 'deepseek-chat', reasonerModel: 'deepseek-reasoner', note: '适用于公司统一网关（注意其是否允许浏览器/本机直连）。' },
  };

  Pages.settings = {
    title: '系统设置', sub: '模型接入 · 智能体护栏 · 插件总线 · 数据管理',
    async render() {
      const boot = global.State.bootstrap;
      const s = boot.settings || {};
      const llm = s.llm || {}, agent = s.agent || {}, plugins = s.plugins || {}, org = s.org || {}, push = s.push || {};
      const counts = boot.counts || {};
      let dbStatus = null;
      try { dbStatus = (await API.get('/qip/api/system/db')).db || null; } catch (_) { dbStatus = null; }
      return `
      <div class="ai-strip">
        <div class="ai-ico">⚙️</div>
        <div class="ai-txt"><b>配置说明：</b>插件内的 AI 对话直接调用 <b>DeepSeek Harness 当前登录的真实 DeepSeek 模型</b>（ctx.llm 服务，默认锁定最新的 DeepSeek-V4.1-Flash），不在本平台另存任何 API Key；所有业务数据写入本机 SQLite 数据库，不上传任何第三方。</div>
        ${act('测试连通性', 'testLlm', {}, 'btn btn-ai')}
      </div>

      ${card('① 模型接入（真实 DeepSeek · 由 Harness 提供）', llm.hasApiKey ? tag('已连接真实模型', 'green') : tag('Harness 未接入模型', 'red'),
        `<div class="form-row"><div class="fl">当前模型<small>插件默认锁定 DeepSeek-V4.1-Flash；不可用时自动回落 Harness 当前模型，也可用环境变量 QIP_LLM_MODEL 覆盖</small></div><div class="fc"><b>${esc(llm.modelLabel || '未连接')}</b></div></div>
        <div class="form-row"><div class="fl">调用链路<small>真实模型调用，不是预设话术</small></div><div class="fc"><code>页面 → 插件 Host 半 → ctx.llm → ${esc(llm.provider || 'DeepSeek')} / ${esc(llm.model || '')}</code></div></div>
        <div class="form-row"><div class="fl">说明</div><div class="fc" style="color:#5e6b85;line-height:1.9;">${esc(llm.description || '')}<br>本插件不需要单独填写 API Key 或 Base URL：模型接入、密钥与账号统一由 Harness 管理，插件只负责调用。</div></div>
        <div style="margin-top:12px;display:flex;gap:8px;">${act('🔌 测试连通性（真实调用一次模型）', 'testLlm', {}, 'btn btn-ai')}</div>
        ${SetState.testing ? '<div class="test-steps"><div class="empty"><span class="spin"></span>　正在测试（会真实调用模型，约 5~20 秒）…</div></div>' : ''}
        ${SetState.steps ? '<div class="test-steps">' + SetState.steps.map((st) => `<div class="test-step"><span class="${st.ok ? 'ts-ok' : 'ts-fail'}">${st.ok ? '✓' : '✗'}</span><div><b>${esc(st.name)}</b><div style="color:#5e6b85;margin-top:2px;">${esc(st.detail)}</div><div style="color:#8791a5;font-size:11px;">${st.ms}ms</div></div></div>`).join('') + '</div>' : ''}`)}

      ${card('② 智能体护栏', '对应技术方案第五章「安全与信创治理」',
        `<div class="form-row"><div class="fl">最大工具调用轮次<small>防止无限循环</small></div><div class="fc">${input('agent.maxRounds', agent.maxRounds, { type: 'number', small: true })}</div></div>
        <div class="form-row"><div class="fl">护栏开关</div><div class="fc" style="display:flex;flex-direction:column;gap:10px;">
          ${input('agent.requireCitation', agent.requireCitation !== false, { type: 'checkbox', label: '结论必须挂接出处（无出处自动降级为「假设」）' })}
          ${input('agent.humanConfirm', agent.humanConfirm !== false, { type: 'checkbox', label: '对外发送 / 对外承诺 / 8D 关闭 三类动作强制人工确认' })}
          ${input('agent.maskSensitive', agent.maskSensitive !== false, { type: 'checkbox', label: '敏感信息脱敏（VIN / 手机号 / 身份证）' })}
        </div></div>
        <div class="form-row"><div class="fl">企业自定义要求<small>会追加到系统提示词</small></div><div class="fc">${input('agent.systemPersona', agent.systemPersona || '', { type: 'textarea', rows: 3, placeholder: '例如：本厂重点关注出口批次质量；术语请使用「FTT / QRQC / 8D」；回复请尽量简洁。' })}</div></div>
        <div class="form-row"><div class="fl">个性化设置</div><div class="fc" style="font-size:12.5px;line-height:2;">
          AI 晨报推送：每日 <b>07:30</b> · 渠道 ${(push.channels || []).join(' + ') || '企微 + 邮件'}<br>
          判异预警：<b>ABC 级质量问题实时推送</b><br>
          报告草稿默认汇报：<b>质量部部长</b>
        </div></div>
        <div style="margin-top:12px;">${act('💾 保存护栏设置', 'saveSettings', { section: 'agent' }, 'btn btn-primary')}</div>`)}

      ${card('③ 插件总线配置', '本地数据仓 ↔ HTTP 直连 可切换',
        table(['插件', '说明', '模式', '启用', '接口地址', ''],
          Object.keys(plugins).map((k) => {
            const p = plugins[k];
            return {
              cells: ['<b>' + esc(p.name) + '</b><br><span style="font-size:10.5px;color:#8791a5;">' + esc(p.desc) + '</span>',
                esc(p.desc), p.mode === 'http' ? tag('HTTP 直连', 'purple') : tag('本地数据仓', 'blue'),
                p.enabled === false ? tag('已停用', 'gray') : tag('运行中', 'green'),
                p.baseUrl || '<span style="color:#8791a5;">（未配置）</span>',
                act('配置', 'pluginConfig', { key: k }, 'btn btn-sm')],
            };
          })) +
        `<div style="font-size:11.5px;color:#5e6b85;margin-top:10px;line-height:1.9;">
          <b>如何接入真实系统？</b>把对应插件的模式切到「HTTP 直连」并填入接口地址与鉴权信息，平台即按统一协议调用真实系统；未配置时使用本地数据仓（可用「数据管理」导入 Excel）。
          当前六大业务插件的核心接口：<code>getMeasureData / getControlChart / getRuleViolations / getCpk / getBOM / getBatch / getSupplier / startWorkflow / pushTodo / submitBenefit / getDefects</code>。</div>`)}

      ${card('④ 数据管理', '本地数据仓：' + Object.entries(counts).map(([k, v]) => k + ' ' + v).join(' · '),
        `${dbStatus ? `<div style="border:1px solid #c9d8f5;background:#f7faff;border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.9;margin-bottom:12px;">
          <b>权威数据库：</b>SQLite <code>${esc(dbStatus.path)}</code>　${Math.round(dbStatus.sizeBytes / 1024)} KB　SQLite ${esc(dbStatus.sqliteVersion || '')}<br>
          <b>表行数：</b>${Object.entries(dbStatus.tables || {}).map(([k, v]) => k + ' ' + v).join(' · ')}　（另有 JSON 快照用于备份）
        </div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          ${act('📥 导入 Excel / CSV（测量数据）', 'importFile', { target: 'measurements' }, 'btn btn-primary')}
          ${act('📥 导入问题清单', 'importFile', { target: 'issues' }, 'btn')}
          ${act('📥 导入 AI 质检缺陷', 'importFile', { target: 'defects' }, 'btn')}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${act('🔄 重建初始数据', 'resetData', {}, 'btn')}
          ${act('🧹 清空业务数据（保留模型配置）', 'clearData', {}, 'btn')}
        </div>
        <div style="font-size:11.5px;color:#8791a5;margin-top:10px;line-height:1.9;">
          <b>导入格式说明：</b>Excel 第一行为表头，平台会自动识别中文/英文字段名（如「时间/测量值/特性编号/产品/车间/批号/供应商/班次/操作者/VIN」）。
          测量数据导入后即可直接用于 SPC 判异、Cpk 计算与导出。若表头是特殊叫法，导出模板后按模板填写最稳妥：${act('导出模板', 'exportData', { dataset: 'measurements', filename: '导入模板_测量数据' }, 'btn btn-sm')}
        </div>`)}
      <div class="footer-note">${brand()} · 系统设置 · 以 MIT 许可开源（可自由修改、私有化部署与二次开发）</div>`;
    },
  };

  /* ================= 审计日志 ================= */
  Pages.audit = {
    title: '审计日志', sub: '谁 · 何时 · 用了哪个插件 · 取了什么 · 用于什么',
    async render() {
      const res = await API.get('/qip/api/audit', { limit: 300 });
      const rows = res.rows || [];
      const byPlugin = {}; rows.forEach((r) => { byPlugin[r.plugin] = (byPlugin[r.plugin] || 0) + 1; });
      const byUser = {}; rows.forEach((r) => { byUser[r.user] = (byUser[r.user] || 0) + 1; });
      return `
      <div class="ai-strip">
        <div class="ai-ico">🔍</div>
        <div class="ai-txt"><b>全程审计：</b>每次工具调用都留痕（操作人、时间、插件、参数、结果摘要、用途），本地保存最近 5000 条。这是「数据不出厂 + 可追溯」的核心机制。</div>
        ${act('导出审计日志', 'exportAudit', {}, 'btn')}
      </div>
      <div class="grid g4" style="margin-bottom:14px;">
        ${kpi({ ico: '📋', label: '审计记录', value: rows.length, delta: '最近 300 条' })}
        ${kpi({ ico: '🔌', label: '覆盖插件', value: Object.keys(byPlugin).length, color: '#0a9e8f', icoBg: '#e0f6f2', delta: Object.keys(byPlugin).slice(0, 4).join(' / ') })}
        ${kpi({ ico: '👤', label: '活跃操作人', value: Object.keys(byUser).length, color: '#7a5af8', icoBg: '#f0ebff', delta: Object.keys(byUser).slice(0, 3).join(' / ') })}
        ${kpi({ ico: '🤖', label: '智能体调用', value: rows.filter((r) => (r.purpose || '').indexOf('智能体') >= 0).length, color: '#1a56db' })}
      </div>
      ${card('审计明细', '按时间倒序',
        table(['时间', '操作人', '插件', '动作', '参数', '结果摘要', '用途'],
          rows.map((r) => [dt(r.ts), esc(r.user), tag(r.plugin, 'navy'), esc(r.action), '<span style="font-size:11px;font-family:Consolas,monospace;color:#5e6b85;">' + esc(JSON.stringify(r.params || {}).slice(0, 60)) + '</span>', '<span style="font-size:11.5px;">' + esc((r.resultSummary || '').slice(0, 60)) + '</span>', esc(r.purpose || '')]),
          { empty: '暂无审计记录' }))}
      <div class="footer-note">${brand()} · 审计日志</div>`;
    },
  };
})(window);




