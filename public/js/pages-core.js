/* ==================================================================
   核心页面：驾驶舱 / AI 改进工作台(智能体) / 质量问题库 / 改进项目(8D)
   ================================================================== */
(function (global) {
  'use strict';
  const { esc, act, card, kpi, table, tag, sevTag, statusTag, bar, md, dt, day, num, empty, loadingBlock, infoGrid, lineChart, paretoChart, controlChart, fishbone, ring, brand } = UI;
  /* 问题清单视图状态：ABC 分类 + 分组折叠（Actions 通过 global.issueView 修改） */
  const issueView = global.issueView = { sev: 'all', open: { A: true, B: false, C: false } };
  const Pages = global.Pages = global.Pages || {};


  /* ================= P1 质量改进驾驶舱 ================= */
  Pages.dashboard = {
    title: '质量驾驶舱', sub: '实时数据 · 全部指标由平台真实计算',
  get sub() {
    return isSme() ? '两个车间 · 12 人 · 手工录数为主 · 指标按周看' : '实时数据 · 全部指标由平台真实计算';
  },
    async render() {
      const [kpiRes, trendRes, modelRes, morningRes, todoRes] = await Promise.all([
        API.get('/qip/api/kpi/overview'), API.get('/qip/api/kpi/trend', { days: 14 }),
        API.get('/qip/api/kpi/models'), API.get('/qip/api/kpi/morning'), API.get('/qip/api/todos', { done: 'false', limit: 8 }),
      ]);
      const k = kpiRes.kpi, K = k.KPI;
      const trend = trendRes.trend || [];
      const models = modelRes.models || [];
      const todoRows = (todoRes.rows || []).map((t) => ({
        __act: 'todoDone', __args: { id: t.id },
        cells: [tag(t.priority, t.priority === 'A' ? 'red' : t.priority === 'B' ? 'orange' : 'gray'), '<b>' + esc(t.title) + '</b>', esc(t.user || ''), dt(t.dueAt), act('完成', 'todoDone', { id: t.id }, 'btn btn-sm')],
      }));
      const riskList = (morningRes.risks && morningRes.risks.风险清单 || []).filter((r) => r.等级 === 'A').slice(0, 3);
      const worstChar = (k.特性状态 || []).filter((c) => c.状态 === '失控').slice(0, 3);

      return `
      <div class="ai-strip">
        <div class="ai-ico">🤖</div>
        <div class="ai-txt"><b>AI 质量晨报 · ${new Date().toISOString().slice(0, 10)}：</b>
          ${k.violations > 0 ? `昨夜/近期共判异 <b>${k.violations}</b> 起${worstChar.length ? `（${worstChar.map((c) => esc(c.特性)).join('、')}）` : ''}，建议核实失控起点与 4M 变化点；` : '近期无 SPC 判异信号；'}
          ${riskList.length ? `风险扫描发现 <b>${riskList.length}</b> 项风险（A 级 ${riskList.filter((r) => r.等级 === 'A').length} 项）；` : ''}
          未关闭质量问题 <b>${K.未关闭问题}</b> 起（A 级 ${K.A级问题} 起），在改项目 <b>${K.在改项目}</b> 个，按期率 <b>${K.项目按期率}</b>。
        </div>
        ${act('查看完整晨报', 'morningReport', {}, 'btn btn-ai')}
      </div>

      <div class="grid g4" style="margin-bottom:14px;">
        ${kpi({ ico: '🚗', label: isSme() ? '一次合格率' : '过程合格率（FTT 代理值）', value: K.一次下线合格率FTT代理值.split('（')[0], delta: '基于 ' + k.measurements + ' 个在线测量点', deltaColor: '#8791a5', color: '#0b3ea8', act: 'goto', args: { page: 'spc' } })}
        ${kpi({ ico: '📈', label: isSme() ? '控制图异常点' : 'SPC 判异信号', value: K.过程判异总数, delta: '超差点 ' + K.超差点数 + ' 个', deltaColor: K.过程判异总数 > 0 ? '#e5484d' : '#18a058', color: K.过程判异总数 > 0 ? '#e5484d' : '#18a058', icoBg: '#feece8', act: 'goto', args: { page: 'spc' } })}
        ${kpi({ ico: '🧩', label: isSme() ? '课题按期完成率' : '改进项目按期关闭率', value: K.项目按期率, delta: '在改 ' + K.在改项目 + ' · 超期 ' + K.超期项目, deltaColor: K.超期项目 ? '#e5484d' : '#18a058', color: '#c8620a', icoBg: '#fff3e0', act: 'goto', args: { page: 'eightd' } })}
        ${kpi({ ico: '💰', label: isSme() ? '已确认节省' : '已核定改进收益', value: '¥' + K.已核定收益万元 + '<span style="font-size:14px;">万</span>', delta: '待核定 ¥' + K.待核定收益万元 + ' 万', color: '#7a5af8', icoBg: '#f0ebff', act: 'goto', args: { page: 'benefit' } })}
      </div>

      <div class="grid g4" style="margin-bottom:14px;">
        ${kpi({ ico: '⚠️', label: isSme() ? '未关闭问题' : '未关闭质量问题', value: K.未关闭问题, delta: '其中 A 级 ' + K.A级问题 + ' 起', deltaColor: '#e5484d', color: '#e5484d', icoBg: '#feece8', act: 'goto', args: { page: 'problem' } })}
        ${kpi({ ico: '🔍', label: isSme() ? '待处理重大异常' : '在整改 A 级问题', value: K.A级问题, delta: '需 2h 响应 / 24h 围堵', deltaColor: '#8791a5', act: 'goto', args: { page: 'problem' } })}
        ${kpi({ ico: '📚', label: isSme() ? '经验卡与标准' : '知识库条目', value: (global.State.bootstrap.counts || {}).knowledge || 0, delta: '经验卡 / 案例 / 标准', deltaColor: '#8791a5', color: '#0a9e8f', icoBg: '#e0f6f2', act: 'goto', args: { page: 'knowledge' } })}
        ${kpi({ ico: '🔄', label: isSme() ? '在推进课题' : '在改项目（专项）', value: K.在改项目, delta: '超期 ' + K.超期项目 + ' 个', deltaColor: K.超期项目 ? '#c8620a' : '#8791a5', act: 'goto', args: { page: 'eightd' } })}
      </div>

      <div class="grid g2" style="margin-bottom:14px;">
        ${card('过程合格率与超差率双趋势', '近 14 天 · 数据源：@MES 在线测量',
        lineChart({
          width: 620, height: 210, rightAxis: true, labels: trend.map((t) => t.day),
          yDigits: 1, rDigits: 2,
          series: [{ name: '合格率', color: '#1a56db', values: trend.map((t) => t.合格率) },
                   { name: '超差率', color: '#e5484d', values: trend.map((t) => t.超差率), right: true }],
        }) + '<div class="legend"><span><i style="background:#1a56db;"></i>合格率（左轴 %）</span><span><i style="background:#e5484d;"></i>超差率（右轴 %）</span></div>',
        act('AI 解读', 'aiQuick', { q: '解读近 14 天过程合格率与超差率趋势，指出异常点并给出原因假设' }))}

        ${card('质量问题车间分布', '本月 · 真实统计',
        paretoChart((kpiRes.workshopDist || []).map((d, i, arr) => {
          const total = arr.reduce((a, c) => a + c.value, 0);
          let cum = 0; for (let j = 0; j <= i; j++) cum += arr[j].value;
          return { name: d.name, value: d.value, cumPct: (cum / total) * 100 };
        })) + `<div style="font-size:11.5px;color:#5e6b85;margin-top:6px;">共 ${kpiRes.workshopDist.reduce((a, c) => a + c.value, 0)} 起问题；${kpiRes.workshopDist[0] ? '占比最高：<b style="color:#e5484d;">' + esc(kpiRes.workshopDist[0].name) + '（' + (kpiRes.workshopDist[0].value / kpiRes.workshopDist.reduce((a, c) => a + c.value, 0) * 100).toFixed(1) + '%）</b>' : ''}</div>`,
        act('查看明细', 'goto', { page: 'problem' }))}
      </div>

      <div class="grid g2" style="margin-bottom:14px;">
        ${card('质量风险扫描', 'A 级风险前 3 项 · 跨插件综合（@SPC + @AQI + 项目管理）',
        riskList.length ? riskList.map((r) => `
          <div style="border:1px solid ${r.等级 === 'A' ? '#ffdcd9' : '#ffe9c7'};background:${r.等级 === 'A' ? '#fff5f4' : '#fffbf2'};border-radius:8px;padding:10px 12px;margin-bottom:8px;">
            <div style="display:flex;gap:8px;align-items:center;">${tag(r.等级 + ' 级', r.等级 === 'A' ? 'red' : 'orange')}<b style="font-size:12.5px;">${esc(r.对象)}</b><span style="font-size:11px;color:#8791a5;margin-left:auto;">${esc(r.风险源)}</span></div>
            <div style="font-size:11.5px;color:#5e6b85;margin-top:5px;line-height:1.7;">${esc(r.描述)}<br><span style="color:#8791a5;">数据支撑：${esc(r.数据支撑 || '')}</span></div>
            <div style="font-size:11.5px;margin-top:5px;color:#1a56db;">→ ${esc(r.建议动作)}</div>
          </div>`).join('') : empty('未发现显著风险', '✅'),
        act('重新扫描', 'refreshPage', {}))}

        ${card('分产品质量健康度', '真实计算：合格率 60% + 过程能力 25% + 问题密度 15%',
        models.map((m) => {
          const color = m.健康度评分 >= 90 ? '#18a058' : m.健康度评分 >= 85 ? '#c8620a' : '#e5484d';
          return `<div style="display:flex;gap:12px;align-items:center;padding:9px 0;border-bottom:1px solid #f2f4f8;">
            <div style="flex:1;">
              <div style="display:flex;gap:8px;align-items:center;"><b style="font-size:13px;">${esc(m.model)}</b>${tag('Cpk ' + m.平均Cpk, m.平均Cpk >= 1.33 ? 'green' : 'orange')}${m.A级未关闭 ? tag('A 级 ' + m.A级未关闭, 'red') : ''}</div>
              <div style="font-size:11px;color:#5e6b85;margin-top:4px;">合格率 ${m.合格率}% · 测量点 ${m.测量点数} · 超差 ${m.超差点} · 未关闭问题 ${m.未关闭问题}</div>
              ${m.风险提示 ? `<div style="font-size:11px;color:#e5484d;margin-top:3px;">⚠ ${esc(m.风险提示)}</div>` : ''}
            </div>
            <div style="text-align:center;"><div class="score-ring" style="font-size:24px;color:${color};">${m.健康度评分}</div><div style="font-size:10px;color:#8791a5;">健康度</div></div>
          </div>`;
        }).join(''), act('下钻分析', 'aiQuick', { q: '对各产品质量健康度做对比分析，指出最需要关注的产品和原因' }))}
      </div>

      <div style="margin-bottom:14px;">
        ${card('今日待办', new Date().toISOString().slice(0, 10),
        table(['级别', '事项', '责任人', '期限', ''], todoRows), act('审批中心', 'goto', { page: 'approval' }))}
      </div>
      <div class="footer-note">${brand()} · 质量驾驶舱</div>`;
    },
  };

  /* ================= P2 AI 改进工作台（智能体） ================= */
  const Chat = global.Chat = {
    sessionId: 's-' + new Date().toISOString().slice(0, 10),
    messages: [],     // {role, content, thinking, trace[], pending[], ts, error}
    busy: false,
    ctrl: null,
  };

  Pages.aiwb = {
    title: 'AI 改进工作台', sub: '自然语言驱动插件协同 · 真实数据 · 真实工具调用',
    async render() {
      const boot = global.State.bootstrap;
      const tools = (boot.tools || []);
      const byPlugin = {};
      tools.forEach((t) => { (byPlugin[t.plugin] = byPlugin[t.plugin] || []).push(t); });
      const cfg = boot.settings && boot.settings.llm || {};
      const configured = !!(boot.settings && boot.settings.llm && boot.settings.llm.hasApiKey);
      const pluginChips = Object.keys(byPlugin).map((p) => `<span class="plugin-chip ok" data-act="showPlugin" data-args='${esc(JSON.stringify({ plugin: p }))}'>✅ ${esc(p)} <b>${byPlugin[p].length}</b></span>`).join('');

      setTimeout(renderChat, 0);
      return `
      ${configured ? '' : `<div class="ai-strip" style="background:linear-gradient(90deg,#fff5f4,#fff3e0);border-color:#ffdcd9;">
        <div class="ai-ico" style="background:linear-gradient(135deg,#c8620a,#e5484d);">⚠️</div>
        <div class="ai-txt"><b>尚未接入大模型，智能体无法推理。</b>请点击右侧按钮填写 DeepSeek API Key（或厂内私有化 OpenAI 兼容地址）。配置后即可真实对话、真实调用 ${tools.length} 个工具。</div>
        ${act('立即配置模型', 'goto', { page: 'settings' }, 'btn btn-primary')}
      </div>`}
      <div class="ai-strip">
        <div class="ai-ico">🤖</div>
        <div class="ai-txt"><b>DeepSeek Harness 工作台：</b>一句话驱动 ${Object.keys(byPlugin).length} 个插件、${tools.length} 个工具协同——查数、判异、根因、写报告、发流程。当前模型：<b>${esc(cfg.model || '未配置')}</b>${cfg.hasApiKey ? '（已配置）' : '（未配置）'}，护栏：结论必须有出处 · 三类动作强制人工确认 · 全程审计。</div>
        ${act('使用指南', 'wbGuide', {}, 'btn')}
      </div>
      <div class="wb wb-solo">
        <div class="chat-wrap">
          <div class="chat-head">
            <span class="t">对话式改进工作台</span>
            <span class="s" id="chatMeta">${Chat.messages.length ? Chat.messages.length + ' 条消息' : '新会话'}</span>
            <span style="margin-left:auto;display:flex;gap:6px;">
              ${act('🗑 清空', 'chatClear', {}, 'btn btn-sm')}
              ${act('📂 历史', 'chatHistory', {}, 'btn btn-sm')}
            </span>
          </div>
          <div class="chat-body" id="chatBody"></div>
          <div class="chat-foot">
            <textarea class="chat-input" id="chatInput" rows="2" placeholder="输入指令，可直接 @插件 定向查询（如「@SPC 检查 CT-0378 判异并给出根因假设」）…&#10;Enter 发送，Shift+Enter 换行"></textarea>
            <div class="chat-actions">
              <span class="quick-cmd" data-act="quickAsk" data-args='${esc(JSON.stringify({ q: '分析上周产品C 充电口盖间隙超差问题，给出根因假设排序和处置建议' }))}'>分析充电口盖间隙超差根因</span>
              <span class="quick-cmd" data-act="quickAsk" data-args='${esc(JSON.stringify({ q: '@SPC 检查全部关键特性的判异情况，按严重度排序，并给出每个失控特性的排查方向' }))}'>@SPC 全面判异体检</span>
              <span class="quick-cmd" data-act="quickAsk" data-args='${esc(JSON.stringify({ q: '生成本周质量周报（Word 文档）' }))}'>一键生成质量周报</span>
              <span class="quick-cmd" data-act="quickAsk" data-args='${esc(JSON.stringify({ q: '扫描当前质量风险并给出今天最该处理的 3 件事' }))}'>风险扫描＋今日重点</span>
              <span class="spacer"></span>
              <span id="chatState" style="font-size:11px;color:#8791a5;"></span>
              ${act('⏹ 停止', 'chatStop', {}, 'btn btn-sm')}
              ${act('发送', 'chatSend', {}, 'btn btn-primary')}
            </div>
          </div>
        </div>
      </div>
      <div class="footer-note">${brand()} · AI 工作台</div>`;
    },
  };

  /** 渲染聊天区域 */
  function renderChat() {
    const body = document.getElementById('chatBody');
    if (!body) return;
    if (!Chat.messages.length) {
      body.innerHTML = `<div class="empty" style="padding:60px 20px;">
        <span class="e-ico">🤖</span>
        <div style="font-size:13.5px;color:#33415c;font-weight:600;margin-bottom:8px;">我可以用真实数据帮你做质量改进</div>
        <div style="text-align:left;max-width:560px;margin:0 auto;font-size:12.5px;line-height:2;color:#5e6b85;">
          · <b>查数取证</b>：「@MES 查四车间三线充电口盖间隙近 7 日数据」<br>
          · <b>判异分析</b>：「@SPC 检查 CT-0378 的八大判异准则」<br>
          · <b>根因假设</b>：「分析充电口盖间隙超差，给出根因假设排序」<br>
          · <b>经验检索</b>：「知识库里有没有类似案例？师傅怎么处理的？」<br>
          · <b>立项闭环</b>：「把这个升级为 8D 项目并推荐团队」<br>
          · <b>成文成表</b>：「生成根因分析报告（Word）」/「把测量数据导出 Excel」<br>
          · <b>收益测算</b>：「测算定位销整改后的年化收益（财务口径）」
        </div>
        <div style="margin-top:14px;font-size:11.5px;color:#8791a5;">所有数字来自真实计算，结论自动挂接出处；对外承诺类动作会请你确认后才执行。</div>
      </div>`;
      return;
    }
    body.innerHTML = Chat.messages.map((m, i) => renderMsg(m, i)).join('');
    body.scrollTop = body.scrollHeight;
  }
  global.renderChat = renderChat;

  function renderMsg(m, i) {
    if (m.role === 'user') {
      return `<div class="msg user"><div class="av">我</div><div class="bubble">${esc(m.content).replace(/\n/g, '<br>')}</div></div>`;
    }
    let inner = '';
    if (m.thinking) inner += `<div class="think" id="think-${i}"><div class="think-hd" data-act="toggleThink" data-args='${esc(JSON.stringify({ i }))}'>💭 深度推理过程 ${m.thinkingDone ? '（点击展开/收起）' : '<span class="typing"><i></i><i></i><i></i></span>'}</div><div class="think-body">${esc(m.thinking.slice(-4000))}</div></div>`;
    if (m.trace && m.trace.length) {
      inner += `<div class="trace"><div class="trace-hd">🔎 插件调用链（${m.trace.filter((t) => t.ok).length}/${m.trace.length} 成功）</div>` +
        m.trace.map((t, ti) => `<div class="tool-step">
          <div class="ts-ico ${t.running ? 'run' : t.ok ? 'ok' : 'err'}">${t.running ? '<span class="spin"></span>' : t.ok ? '✓' : '✕'}</div>
          <div style="flex:1;"><b>${esc(t.plugin)}</b> ${esc(t.label)}${t.ms ? `<span style="color:#8791a5;font-size:10.5px;">　${t.ms}ms</span>` : ''}
            <div class="ts-args">${esc(JSON.stringify(t.args || {}))}</div>
            <div class="ts-res">${esc(t.summary || '执行中…')}</div>
            ${t.result ? `<span class="ts-more" data-act="showToolResult" data-args='${esc(JSON.stringify({ i, ti }))}'>查看原始返回 ›</span>` : ''}
          </div></div>`).join('') + '</div>';
    }
    if (m.content) inner += `<div class="md-body">${md(m.content)}</div>`;
    if (m.pending && m.pending.length) {
      inner += m.pending.map((p) => `<div class="confirm-card">
        <div class="cc-t">⚠️ 待人工确认：${esc(p.label)}　<span style="font-weight:400;color:#8791a5;font-size:11px;">${esc(p.plugin)} / ${esc(p.id)}</span></div>
        <div class="cc-d">该动作属于「对外发送 / 对外承诺 / 8D 关闭」类，按平台护栏必须由人确认后才会真正执行。<br>参数：<code style="font-size:11px;">${esc(JSON.stringify(p.args))}</code></div>
        <div class="cc-a">${act('✓ 确认执行', 'confirmAction', { id: p.id, i }, 'btn btn-primary btn-sm')}${act('✕ 拒绝', 'rejectAction', { id: p.id, i }, 'btn btn-sm')}</div>
      </div>`).join('');
    }
    if (m.running) inner += `<div class="run-status"><span class="dot"></span>${esc(m.statusText || '正在推理…')}</div>`;
    if (m.error) inner += `<div style="color:#e5484d;font-size:12.5px;">❌ ${esc(m.error)}</div>`;
    if (m.trace && m.trace.length) {
      inner += `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
        <span class="quick-cmd" data-act="chatFollowup" data-args='${esc(JSON.stringify({ q: '把上面的分析结论写入根因分析报告（Word）并给出下载链接' }))}'>📄 生成报告</span>
        <span class="quick-cmd" data-act="chatFollowup" data-args='${esc(JSON.stringify({ q: '把这次分析结论沉淀为知识库经验卡' }))}'>📚 沉淀经验卡</span>
        <span class="quick-cmd" data-act="chatFollowup" data-args='${esc(JSON.stringify({ q: '把这次分析涉及的数据导出为 Excel' }))}'>📊 导出数据</span>
        <span class="quick-cmd" data-act="chatFollowup" data-args='${esc(JSON.stringify({ q: '基于这个问题创立 8D 改进项目并推荐团队' }))}'>🧩 一键立项</span>
      </div>`;
    }
    return `<div class="msg"><div class="av">AI</div><div class="bubble">${inner}</div></div>`;
  }

  /* ================= P3 质量问题库 ================= */
  Pages.problem = {
    title: '质量问题库', sub: 'AI 去重 / 自动定级 / 相似案例匹配 · 真实数据',
    async render() {
      const res = await API.get('/qip/api/issues', { limit: 300 });
      const rows = res.rows || [];
      const open = rows.filter((r) => r.status !== '已关闭');
      const byWs = {};
      rows.forEach((r) => { byWs[r.workshop || '未分类'] = (byWs[r.workshop || '未分类'] || 0) + 1; });
      const total = rows.length || 1;
      let cum = 0;
      const paretoRows = Object.entries(byWs).sort((a, b) => b[1] - a[1]).map(([name, value]) => { cum += value; return { name, value, cumPct: (cum / total) * 100 }; });
      const bySource = {}; rows.forEach((r) => { bySource[r.source || '其他'] = (bySource[r.source || '其他'] || 0) + 1; });

      return `
      <div class="ai-strip">
        <div class="ai-ico">🤖</div>
        <div class="ai-txt"><b>AI 问题治理：</b>问题库共 <b>${rows.length}</b> 起，未关闭 <b>${open.length}</b> 起（A 级 ${open.filter((r) => r.severity === 'A').length} 起）；来源分布：${Object.entries(bySource).map(([k, v]) => esc(k) + ' ' + v).join(' · ')}。发现问题时会自动做同构去重与相似案例匹配。</div>
        ${act('＋ 发现问题', 'newIssue', {}, 'btn btn-ai')}
      </div>
      <div class="imp-hint">
        <span class="big">📱 可以手机拍拍拍导入问题</span>
        <span class="imp-sub">现场拿手机拍照片/拍视频，顺手说一句现象，AI 自动识别并录入；也支持直接导入 Excel / CSV 问题清单。</span>
        ${act('📥 导入问题（Excel / CSV）', 'importFile', { target: 'issues' }, 'btn btn-primary btn-sm')}
      </div>
      <div class="grid g4" style="margin-bottom:14px;">
        ${kpi({ ico: '📋', label: '问题总数', value: rows.length, delta: '本月新增 ' + rows.filter((r) => (r.createdAt || '').slice(0, 7) === new Date().toISOString().slice(0, 7)).length, act: 'filterIssues', args: {} })}
        ${kpi({ ico: '🚨', label: '未关闭 A 级', value: open.filter((r) => r.severity === 'A').length, color: '#e5484d', icoBg: '#feece8', delta: '需 2h 响应 / 24h 围堵', deltaColor: '#e5484d' })}
        ${kpi({ ico: '🔄', label: '已关联改进项目', value: rows.filter((r) => r.projectId).length, color: '#7a5af8', icoBg: '#f0ebff', delta: '升级率 ' + ((rows.filter((r) => r.projectId).length / (rows.length || 1)) * 100).toFixed(1) + '%' })}
        ${kpi({ ico: '✅', label: '已关闭', value: rows.filter((r) => r.status === '已关闭').length, color: '#18a058', icoBg: '#e8f7ee', delta: '关闭率 ' + ((rows.filter((r) => r.status === '已关闭').length / (rows.length || 1)) * 100).toFixed(1) + '%' })}
      </div>
      ${card('问题清单', '共 ' + rows.length + ' 起 · 按 A/B/C 分类折叠 · 点击行查看详情',
        `<div class="sev-chips">
          ${[['all', '全部 ' + rows.length], ['A', 'A 级 ' + rows.filter((r) => r.severity === 'A').length], ['B', 'B 级 ' + rows.filter((r) => r.severity === 'B').length], ['C', 'C 级 ' + rows.filter((r) => r.severity === 'C').length]].map(([v, label]) =>
            `<span class="chip ${issueView.sev === v ? 'on' : ''}" data-act="issueSev" data-args='${esc(JSON.stringify({ sev: v }))}'>${label}</span>`).join('')}
          <span style="margin-left:auto;display:flex;gap:6px;">
            ${act('全部展开', 'issueOpenAll', { open: true }, 'btn btn-sm')}
            ${act('全部收起', 'issueOpenAll', { open: false }, 'btn btn-sm')}
            ${act('导出 Excel', 'exportData', { dataset: 'issues' }, 'btn btn-sm')}
          </span>
        </div>` +
        issueGroups(rows, issueView),
        act('导出 Excel', 'exportData', { dataset: 'issues' }))}
      <div class="grid g2">
        ${card('问题类别帕累托', '按车间统计 · 真实数据', paretoChart(paretoRows) + `<div style="font-size:11.5px;color:#5e6b85;margin-top:6px;">${paretoRows[0] ? '「' + esc(paretoRows[0].name) + '」占比最高（' + (paretoRows[0].value / total * 100).toFixed(1) + '%）' : ''}</div>`)}
        ${card('AI 同构问题预警', '重复发生识别（相似度实算）',
          repeatWarnings(rows) || empty('暂未发现重复发生的同构问题', '✅'))}
      </div>
      <div class="footer-note">${brand()} · 问题库</div>`;
    },
  };

  function repeatWarnings(rows) {
    // 客户端聚类：同车间 + 标题相似（用字符 bigram 粗算）
    const groups = [];
    const used = new Set();
    rows.forEach((a, i) => {
      if (used.has(a.id)) return;
      const g = [a];
      rows.forEach((b, j) => {
        if (i === j || used.has(b.id)) return;
        if (a.workshop && b.workshop && a.workshop !== b.workshop) return;
        if (sim(a.title, b.title) >= 0.42) { g.push(b); used.add(b.id); }
      });
      if (g.length >= 2) { used.add(a.id); groups.push(g); }
    });
    if (!groups.length) return '';
    return groups.slice(0, 4).map((g) => `<div style="border:1px solid #ffdcd9;background:#fff5f4;border-radius:8px;padding:10px 12px;margin-bottom:8px;">
      <b style="color:#e5484d;">🔴 ${esc(g[0].workshop || '')}「${esc(g[0].title.slice(0, 16))}」类问题重复发生 ${g.length} 次</b>
      <div style="font-size:11.5px;color:#5e6b85;margin-top:4px;">聚类成员：${g.map((x) => esc(x.id) + '（' + esc(x.status) + '）').join(' / ')}</div>
      <div style="font-size:11.5px;margin-top:6px;">${tag('AI 建议：升级为质量改进项目 + 设计端横展', 'red')} ${act('一键立项', 'projectFromGroup', { ids: g.map((x) => x.id), title: g[0].title, workshop: g[0].workshop, model: g[0].model }, 'btn btn-primary btn-sm')}</div>
    </div>`).join('');
  }
  function sim(a, b) {
    const bg = (s) => { const t = String(s || '').toLowerCase().replace(/[\s\u3000，。、；：！？（）]/g, ''); const o = []; for (let i = 0; i < t.length - 1; i++) o.push(t.slice(i, i + 2)); return o; };
    const A = bg(a), B = bg(b);
    if (!A.length || !B.length) return 0;
    const m = {}; A.forEach((x) => m[x] = (m[x] || 0) + 1);
    let dot = 0; B.forEach((x) => { if (m[x]) dot++; });
    return dot / Math.sqrt(A.length * B.length);
  }

  /* 问题清单：按 A/B/C 折叠分组（数量大时优先看 A 级） */
  function issueGroups(rows, view) {
    const META = {
      A: ['A 级 · 严重', 'red', '涉及安全/法规或已流出，须 2h 响应'],
      B: ['B 级 · 批量风险', 'orange', '存在批量风险，24h 内围堵'],
      C: ['C 级 · 个案', 'gray', '个案问题，按常规节奏闭环'],
    };
    const sevs = view.sev === 'all' ? ['A', 'B', 'C'] : [view.sev];
    const html = sevs.map((sev) => {
      const list = rows.filter((r) => String(r.severity || '').toUpperCase() === sev);
      const openCnt = list.filter((r) => r.status !== '已关闭').length;
      const body = list.length
        ? table(['编号', '产品', '车间/工位', '问题描述', '来源', '状态', '责任人', '关联项目'],
          list.map((r) => ({
            __act: 'issueDetail', __args: { id: r.id },
            cells: ['<b>' + esc(r.id) + '</b>', esc(r.model), esc(r.workshop) + (r.station ? (r.station.indexOf(r.workshop) === 0 ? '·' + esc(r.station.slice(r.workshop.length).replace(/^[·\-\s]+/, '')) : '·' + esc(r.station)) : ''), esc(r.title), tag(r.source, r.source === 'AI 质检' ? 'purple' : r.source === 'MES' ? 'navy' : r.source === '市场' ? 'green' : 'gray'), statusTag(r.status), esc(r.owner || '—'), r.projectId ? tag(r.projectId, 'blue') : '—'],
          })), { empty: '该等级暂无问题' })
        : empty('该等级暂无问题', '—');
      return `<details class="acc" ${view.open[sev] ? 'open' : ''}>
        <summary><span class="caret2">▶</span>${tag(META[sev][0], META[sev][1])}<span style="font-weight:500;font-size:12px;color:#5e6b85;">${esc(META[sev][2])}</span><span class="cnt">${list.length} 起 · 未关闭 ${openCnt}</span></summary>
        <div class="acc-body">${body}</div>
      </details>`;
    }).join('');
    return html || empty('暂无问题记录', '📭');
  }

  /* ================= P4 质量改进项目（8D） ================= */
  const STAGE_DEF = [['D1', '组建团队', '24h'], ['D2', '描述问题', '24h'], ['D3', '临时措施', '48h'], ['D4', '根因分析', '10 日历日'], ['D5', '永久对策', '15 日历日'], ['D6', '实施验证', '30 日历日'], ['D7', '预防横展', '15 日历日'], ['D8', '关闭表彰', '—']];
  const STAGE_COLOR = { D1: '#95a3bd', D2: '#5a8bff', D3: '#5a8bff', D4: '#7a5af8', D5: '#0a9e8f', D6: '#0a9e8f', D7: '#18a058', D8: '#18a058' };
// 中小型企业版：课题不做八步，按 PDCA 四步走（周期短、一人多岗）
const PDCA_DEF = [['P', '计划', '#5a8bff', '3 日'], ['D', '执行', '#7a5af8', '7 日'], ['C', '检查', '#0a9e8f', '3 日'], ['A', '处置', '#18a058', '1 日']];
const PDCA_AI = {
  P: '定目标值 / 现状数据对比（手工录数 AI 校验）',
  D: '对策清单 + 作业指导书草稿',
  C: '效果对比表 + 控制图复判',
  A: '固化成 SOP / 横展到另一车间',
};
function pdcaOf(p) {
  const i = typeof p.stageIndex === 'number' ? p.stageIndex : 0;
  return i < 3 ? 'P' : i < 6 ? 'D' : i === 6 ? 'C' : 'A';
}
const isSme = () => !!(global.Scale && global.Scale.isSme && global.Scale.isSme());

  Pages.eightd = {
    get title() { return isSme() ? 'QC 小组课题' : '质量改进项目'; },
  get sub() { return isSme() ? 'PDCA 四步 · 小改小革 · 周循环' : '8D / 专项改进 · 阶段流转 · SLA 计时'; },
    async render() {
      const res = await API.get('/qip/api/projects', { limit: 300 });
      const rows = res.rows || [];
      const open = rows.filter((r) => r.stage !== 'D8');
      const overdue = open.filter((r) => r.overdue);
      const aiDraft = rows.length ? Math.round(rows.filter((r) => r.aiDrafted).length / rows.length * 100) : 0;
      const tasks = global.State.bootstrap.todos || [];
      const focus = open.filter((r) => r.stage === 'D4' || r.overdue)[0] || open[0];
      const SLA_AI = {
        D1: '按技能图谱推荐团队', D2: '5W2H 自动成文', D3: '围堵方案库匹配（含历史有效率）', D4: '因果图 / 5Why / 数据取证 / DOE 方案',
        D5: '对策库匹配 + OA 审批流自动发起', D6: '@MES 自动采集验证数据做前后对比', D7: '五维横展清单自动生成', D8: '收益核定 + 案例自动归档',
      };
      const slaRows = isSme()
        ? PDCA_DEF.map(([k, name, color, sla]) => [k + ' ' + name, sla, PDCA_AI[k], open.filter((r) => pdcaOf(r) === k).length])
        : STAGE_DEF.map(([k, name, sla]) => [k + ' ' + name, sla, SLA_AI[k], open.filter((r) => r.stage === k).length]);
      const projRows = rows.map((p) => ({
        __act: 'projectDetail', __args: { id: p.id },
        cells: ['<b>' + esc(p.id) + '</b>', esc(p.title), tag(p.stage, p.stage === 'D8' ? 'green' : 'purple'), esc(p.owner),
          bar(p.progress, p.overdue ? '#e5484d' : '#1a56db') + '<span style="font-size:10.5px;color:#8791a5;">' + p.progress + '%</span>',
          day(p.dueAt), p.stage === 'D8' ? tag('已关闭', 'green') : p.overdue ? tag('超期 ' + p.overdueDays + ' 天', 'red') : tag('进行中', 'blue')],
      }));

      return `
      <div class="ai-strip">
        <div class="ai-ico">🧩</div>
        <div class="ai-txt">${isSme()
          ? '<b>课题推进：</b>按 PDCA 四步走（计划 3 日、执行 7 日、检查 3 日、处置 1 日），周例会同步进度，超期由质量主管直接协调。AI 可帮写现状对比、对策清单、效果验证表与固化 SOP。'
          : '<b>改进项目智能推进：</b>平台按 D1–D8 阶段 SLA 自动计时（临时措施 48h、根因分析 10 日、实施验证 30 日），超期自动升级厂级 QRQC 并抄送主管。AI 可起草 5W2H、因果图、5Why、DOE 方案与对策清单。'}</div>
        ${act('＋ 立项（AI 推荐团队）', 'newProject', {}, 'btn btn-ai')}
      </div>
      <div class="grid g4" style="margin-bottom:14px;">
        ${kpi({ ico: '🔄', label: '在改项目', value: open.length, delta: 'A ' + open.filter((r) => r.severity === 'A').length + ' · B ' + open.filter((r) => r.severity === 'B').length + ' · C ' + open.filter((r) => r.severity === 'C').length })}
        ${kpi({ ico: '🚨', label: '超期项目', value: overdue.length, color: '#e5484d', icoBg: '#feece8', delta: overdue.length ? '已自动升级厂级 QRQC' : '无超期', deltaColor: overdue.length ? '#e5484d' : '#18a058' })}
        ${kpi({ ico: '🤖', label: 'AI 起草内容占比', value: aiDraft + '%', color: '#7a5af8', icoBg: '#f0ebff', delta: '人工复核修改 ' + (100 - aiDraft) + '%' })}
        ${kpi({ ico: '📅', label: '今日待办', value: tasks.length, color: '#c8620a', icoBg: '#fff3e0', delta: '点击查看', act: 'goto', args: { page: 'approval' } })}
      </div>

      ${card(isSme() ? 'QC 小组课题看板' : '质量改进阶段看板', (isSme() ? '按 PDCA 四步推进 · 共 ' + open.length + ' 个在改课题' : '共 ' + open.length + ' 个在改项目 · 点击卡片查看/推进'),
        `<div class="kanban">${(isSme() ? PDCA_DEF.map(([k, name, color, sla]) => {
          const list = open.filter((r) => pdcaOf(r) === k);
          return `<div class="kb-col"><h5><span class="kb-dot" style="background:${color};"></span>${k} ${name}<span style="margin-left:auto;color:#8791a5;">${list.length}</span></h5>
            ${list.map((p) => `<div class="kb-card" data-act="projectDetail" data-args='${esc(JSON.stringify({ id: p.id }))}' ${p.overdue ? 'style="border-color:#ffdcd9;"' : ''}>
              <b>${esc(p.id)} ${esc(p.title.slice(0, 14))}</b>
              ${p.overdue ? tag('超期 ' + p.overdueDays + ' 天', 'red') : tag(p.severity + ' 级', p.severity === 'A' ? 'red' : 'orange')}
              <div class="meta"><span>${esc(p.model || '')} · ${esc(p.workshop || '')}</span><span>${esc(p.owner || '')}</span></div>
            </div>`).join('') || '<div style="font-size:10.5px;color:#b8c0cf;text-align:center;padding:8px 0;">—</div>'}
          </div>`;
        }).join('') : STAGE_DEF.map(([k, name]) => {
          const list = open.filter((r) => r.stage === k);
          return `<div class="kb-col"><h5><span class="kb-dot" style="background:${STAGE_COLOR[k]};"></span>${k} ${name}<span style="margin-left:auto;color:#8791a5;">${list.length}</span></h5>
            ${list.map((p) => `<div class="kb-card" data-act="projectDetail" data-args='${esc(JSON.stringify({ id: p.id }))}' ${p.overdue ? 'style="border-color:#ffdcd9;"' : ''}>
              <b>${esc(p.id)} ${esc(p.title.slice(0, 14))}</b>
              ${p.overdue ? tag('超期 ' + p.overdueDays + ' 天', 'red') : tag(p.severity + ' 级', p.severity === 'A' ? 'red' : 'orange')}
              <div class="meta"><span>${esc(p.model || '')} · ${esc(p.workshop || '')}</span><span>${esc(p.owner || '')}</span></div>
            </div>`).join('') || '<div style="font-size:10.5px;color:#b8c0cf;text-align:center;padding:8px 0;">—</div>'}
          </div>`;
        }).join(''))}</div>`)}
      ${focus ? card('焦点项目：' + esc(focus.id) + ' ' + esc(focus.title), '阶段 ' + focus.stage + ' · SLA ' + ((STAGE_DEF.find((s) => s[0] === focus.stage) || [])[2] || '') + ' · 责任人 ' + esc(focus.owner),
        infoGrid([['项目编号', esc(focus.id)], ['当前阶段', focus.stage + ' ' + ((STAGE_DEF.find((s) => s[0] === focus.stage) || [])[1] || '')], ['责任人', esc(focus.owner || '')], ['产品/车间', esc(focus.model + ' / ' + focus.workshop)], ['截止日期', day(focus.dueAt) + (focus.overdue ? '　' + tag('已超期 ' + focus.overdueDays + ' 天', 'red') : '')], ['来源问题', esc(focus.issueId || '—')], ['预估收益', (focus.benefitEstimate || 0) + ' 万元'], ['进度', focus.progress + '%']].concat([['项目描述', esc(focus.description || '—'), true]]), 'g4c') +
        '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">' +
        act('查看详情 / 推进阶段', 'projectDetail', { id: focus.id }, 'btn btn-primary') +
        act('AI 生成因果图与根因假设', 'aiQuick', { q: '针对项目 ' + focus.id + '（' + focus.title + '）做根因分析：先查数据，再给出按置信度排序的根因假设与验证方法' }, 'btn btn-ai') +
        act('AI 起草 5W2H', 'aiQuick', { q: '为项目 ' + focus.id + ' 起草 D2 问题描述（5W2H），要包含量化数据' }, 'btn') +
        '</div>') : ''}
      <div style="margin-top:14px;">
        ${card('项目清单', '共 ' + rows.length + ' 个',
          table(['编号', '项目名称', '阶段', '责任人', '进度', '截止', '状态'], projRows),
          act('导出 Excel', 'exportData', { dataset: 'projects' }))}
        ${card(isSme() ? 'PDCA 节奏与 AI 支持' : '8D 阶段 SLA 与 AI 支持', isSme() ? '周例会同步 · 超期由质量主管协调' : '超期自动升级 · 抄送主管',
          table(['阶段', 'SLA', 'AI 支持能力', '在改'], slaRows))}
      </div>
      <div class="footer-note">${brand()} · 质量改进项目</div>`;
    },
  };

  global.ChatState = Chat;
  global.renderMsgFn = renderMsg;
  global.STAGE_DEF = STAGE_DEF;
  global.STAGE_COLOR = STAGE_COLOR;
})(window);




