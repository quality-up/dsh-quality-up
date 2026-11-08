/* ==================================================================
   知识与团队页面：知识库 / 员工成长中心 / 插件架构 / 移动端
   ================================================================== */
(function (global) {
  'use strict';
  const { esc, act, card, kpi, table, tag, bar, md, dt, day, num, empty, infoGrid, ring, lineChart, paretoChart, brand } = UI;
  const Pages = global.Pages;
  const KB = global.KBState = { query: '', type: '', category: '', results: null };

  /* ================= P10 知识库与经验传承 ================= */
  Pages.knowledge = {
    title: '知识库与经验传承', sub: '师傅经验数字化 · 语义检索（BM25 + 中文 bigram）',
    async render() {
      const [statRes, kr] = await Promise.all([API.tool('kb_stats', {}), API.get('/qip/api/knowledge', { limit: 300 })]);
      const rows = kr.rows || [];
      const st = statRes.result || {};
      const types = st.按类型 || {};
      const cats = st.按类别 || {};
      let results = KB.results;
      let searchInfo = '';
      if (KB.query) {
        const r = await API.tool('kb_search', { query: KB.query, topK: 10, type: KB.type || undefined, category: KB.category || undefined });
        results = (r.result && r.result.结果) || [];
        searchInfo = `<div style="font-size:11.5px;color:#5e6b85;margin-bottom:8px;">检索「<b>${esc(KB.query)}</b>」命中 <b>${results.length}</b> 条（BM25 + 中文 bigram 语义匹配）${KB.type ? '，类型限定：' + esc(KB.type) : ''}</div>`;
      }
      return `
      <div class="ai-strip">
        <div class="ai-ico">📚</div>
        <div class="ai-txt"><b>经验传承：</b>师傅访谈转写 → AI 抽取「问题-原因-对策-效果」四元组入库 → 语义检索 → AI 起草时自动引用出处。当前知识库 <b>${rows.length}</b> 条（经验卡 ${types['经验卡'] || 0} · 历史案例 ${types['历史案例'] || 0} · 标准 ${types['标准'] || 0}）。</div>
        ${act('＋ 新增经验卡', 'newKnowledge', {}, 'btn btn-ai')}
      </div>
      <div class="grid g4" style="margin-bottom:14px;">
        ${kpi({ ico: '📚', label: '知识条目总量', value: rows.length, delta: Object.entries(types).map(([k, v]) => k + ' ' + v).join(' · ') })}
        ${kpi({ ico: '👨‍🏭', label: '经验卡（师傅经验）', value: types['经验卡'] || 0, color: '#7a5af8', icoBg: '#f0ebff', delta: '访谈转写结构化入库' })}
        ${kpi({ ico: '🗂️', label: '历史故障案例', value: types['历史案例'] || 0, color: '#0a9e8f', icoBg: '#e0f6f2', delta: '项目关闭自动归档' })}
        ${kpi({ ico: '📖', label: '标准 / 规范条款', value: types['标准'] || 0, color: '#c8620a', icoBg: '#fff3e0', delta: '检索即引用出处' })}
      </div>

      ${card('语义检索', '问知识库：以前有没有类似问题？师傅怎么处理的？',
        `<div style="display:flex;gap:8px;margin-bottom:10px;">
          <input class="inp" id="kbQuery" placeholder="例如：充电口盖间隙超差怎么排查 / 漆面颗粒污染源定位 / Cpk 判定准则" value="${esc(KB.query)}" onkeydown="if(event.key==='Enter')Actions.kbSearch()"/>
          ${act('检索', 'kbSearch', {}, 'btn btn-primary')}
          ${act('清空', 'kbClear', {}, 'btn')}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
          ${['', '经验卡', '历史案例', '标准'].map((t) => `<span class="quick-cmd" data-act="kbType" data-args='${esc(JSON.stringify({ type: t }))}' style="${KB.type === t ? 'border-color:#1a56db;color:#1a56db;background:#f7faff;' : ''}">${t || '全部类型'}</span>`).join('')}
          ${(() => {
            const wsNames = (((global.State.bootstrap || {}).naming || {}).workshops || ['一车间', '二车间', '三车间', '四车间', '五车间']);
            const cats = [''].concat([wsNames[2], wsNames[0], wsNames[1]], ['尺寸工程', '三电', '数据分析', '标准法规']);
            return cats.map((c) => `<span class="quick-cmd" data-act="kbCat" data-args='${esc(JSON.stringify({ category: c }))}' style="${KB.category === c ? 'border-color:#1a56db;color:#1a56db;background:#f7faff;' : ''}">${c || '全部类别'}</span>`).join('');
          })()}
        </div>
        ${searchInfo}
        ${results ? (results.length ? results.map((r) => `
          <div class="list-row" data-act="kbDetail" data-args='${esc(JSON.stringify({ id: r.编号 }))}' style="display:block;">
            <div style="display:flex;gap:8px;align-items:center;"><b style="font-size:13px;">${esc(r.标题)}</b>${tag(r.类型, 'purple')}${tag(r.类别, 'gray')}<span style="margin-left:auto;font-size:11px;color:#1a56db;">相关度 ${r.相关度}</span></div>
            <div style="font-size:11.5px;color:#5e6b85;margin-top:5px;line-height:1.75;"><b>问题：</b>${esc((r.问题 || '').slice(0, 90))}<br><b>对策：</b>${esc((r.对策 || '').slice(0, 150))}</div>
            <div style="font-size:11px;color:#8791a5;margin-top:4px;">出处：${esc(r.出处 || '')}${r.编号 ? '　编号：' + esc(r.编号) : ''}</div>
          </div>`).join('') : empty('未检索到相关内容，换个更具体的工艺/缺陷关键词试试', '🔍')) : ''}`)}

      <div class="grid g2-1">
        ${card('知识库条目', '共 ' + rows.length + ' 条 · 点击查看全文',
          table(['编号', '类型', '类别', '标题', '作者', '浏览', ''],
            rows.map((r) => ({
              __act: 'kbDetail', __args: { id: r.id },
              cells: ['<b>' + esc(r.id) + '</b>', tag(r.type, r.type === '经验卡' ? 'purple' : r.type === '标准' ? 'orange' : 'teal'), esc(r.category || ''), esc(r.title), esc(r.author || ''), r.views || 0, act('查看', 'kbDetail', { id: r.id }, 'btn btn-sm')],
            }))))}
        <div>
          ${card('经验数字化计划', '三批次推进',
            `<div style="font-size:12px;line-height:2.1;">
              ✅ 第一批：12 位资深工程师访谈（一车间/二车间/三车间/四车间/五车间）<br>
              ✅ 转写 → AI 抽取「问题-原因-对策-效果」四元组入库<br>
              🔄 第二批：故障案例库已上线 ${types['历史案例'] || 0} 个，项目关闭自动归档中<br>
              ⬜ 第三批：标准/规范已上线 ${types['标准'] || 0} 个，持续同步中
            </div>`)}
          ${card('类别分布', '知识库结构', paretoChart(Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })), {}))}
        </div>
      </div>
      <div class="footer-note">${brand()} · 知识库</div>`;
    },
  };

  /* ================= P11 员工成长中心 ================= */
  Pages.growth = {
    title: '员工成长中心', sub: 'AI 师傅带教 · 30/60/90 天成长地图 · 能力雷达',
    async render() {
      const [membersRes, kb] = await Promise.all([API.get('/qip/api/members', { limit: 100 }), API.tool('kb_stats', {})]);
      // 部门名可由「系统 → 初始设置」改动，这里按当前命名匹配（同时兜住「质量改进」这类核心词）
      const deptName = ((global.State.bootstrap || {}).org || {}).dept || '质量改进部门';
      const deptCore = deptName.split(/[·\s/]+/).pop();
      const members = (membersRes.rows || []).filter((m) => m.dept && (m.dept.indexOf(deptName) >= 0 || m.dept.indexOf(deptCore) >= 0 || m.dept.indexOf('质量改进') >= 0));
      const newbies = members.filter((m) => (m.seniority || 0) <= 2);
      const skillKeys = ['8D', '数据分析', '现场工艺', '沟通协调', '标准法规', 'AI应用'];
      const avg = {};
      skillKeys.forEach((k) => { avg[k] = members.length ? Number((members.reduce((a, c) => a + ((c.skills || {})[k] || 0), 0) / members.length).toFixed(1)) : 0; });
      const xp = Number(kb.result && kb.result.总量) || 0;
      return `
      <div class="ai-strip">
        <div class="ai-ico">🎓</div>
        <div class="ai-txt"><b>AI 带教：</b>新人可随时向「陈老师 AI 分身」提问，AI 的回答自动挂接知识库出处（当前 <b>${xp}</b> 条知识），等于把 18 年现场经验随身携带。平台可跟踪 30/60/90 天成长节点与能力雷达变化。</div>
        ${act('陈老师 AI 分身', 'aiQuick', { q: '我是刚入职的质量改进工程师，请以陈老师（18年三车间/四车间经验）的口吻，教我如何系统地排查一个间隙超差问题，并给出本周的学习任务' }, 'btn btn-ai')}
      </div>
      <div class="grid g4" style="margin-bottom:14px;">
        ${kpi({ ico: '🎓', label: '部门人数', value: members.length, delta: '司龄 ≤2 年：' + newbies.length + ' 人' })}
        ${kpi({ ico: '📚', label: '可检索知识条目', value: xp, color: '#7a5af8', icoBg: '#f0ebff', delta: '随时问答并给出处' })}
        ${kpi({ ico: '⚡', label: '独立上手目标周期', value: '3<span style="font-size:14px;">周</span>', color: '#18a058', icoBg: '#e8f7ee', delta: '原 12 周 · AI 带教后' })}
        ${kpi({ ico: '✅', label: '8D 一次通过率目标', value: '89%', color: '#0a9e8f', icoBg: '#e0f6f2', delta: '原 61%' })}
      </div>
      <div class="grid g2-1" style="margin-bottom:14px;">
        ${card('30 / 60 / 90 天成长地图', '跟学 → 辅做 → 独立',
          `<div class="stepper"><div class="st done" data-n="1">第 1 周<br>基础认知</div><div class="st on" data-n="2">第 2 周<br>辅做</div><div class="st" data-n="3">第 3 周<br>独立跟单</div><div class="st" data-n="4">30 天<br>考核</div><div class="st" data-n="5">60 天<br>独立项目</div><div class="st" data-n="6">90 天<br>带教他人</div></div>
          <table class="tbl">
            <tr><th>阶段</th><th>任务</th><th>AI 支持</th><th>通关标准</th></tr>
            <tr><td>第 1 周</td><td>知识库闯关（8D/SPC/因果图/5W2H 等 12 关）</td><td>AI 问答 + 出处引用</td><td>12 关全部通过</td></tr>
            <tr><td>第 2 周</td><td>在师傅选题下撰写 D1–D3</td><td>AI 起草 + 师傅/AI 双评</td><td>D1–D3 一次通过</td></tr>
            <tr><td>第 3 周</td><td>独立跟一个 C 级问题全流程</td><td>AI 旁站记录 + 关键节点把关</td><td>问题按期闭环</td></tr>
            <tr><td>30/60/90 天</td><td>阶段考核 + 独立承担 B/A 级项目</td><td>能力雷达自动更新</td><td>8D 一次通过率 ≥85%</td></tr>
          </table>`)}
        ${card('团队能力雷达', '部门平均（真实数据）',
          skillKeys.map((k) => `<div style="margin-bottom:10px;"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;"><span>${esc(k)}</span><b style="color:#1a56db;">${avg[k]}</b></div>${bar(avg[k], k === 'AI应用' ? '#7a5af8' : '#1a56db')}</div>`).join('') +
          `<div style="font-size:11.5px;color:#5e6b85;margin-top:8px;">AI 应用能力当前 ${avg['AI应用']} 分，是相对优势项；建议补强「标准法规」与「数据分析」。</div>`)}
      </div>
      ${card('A 级质量问题处理 · AI 模拟演练', 'AI 扮演质量部部长/客户，全过程评分',
        `<div style="display:flex;gap:10px;flex-wrap:wrap;">
          ${['A 级漆面颗粒流出风险处置', 'A 级模组绝缘电阻偏低', 'A 级二车间虚焊流出', '客户投诉高压快充异常'].map((s) => `<div class="list-row" style="flex:1;min-width:240px;" data-act="aiQuick" data-args='${esc(JSON.stringify({ q: '开始演练：场景「' + s + '」。你扮演质量部部长，先给我这个 A 级问题的背景与我的角色，然后逐步向我提问，考察我的处置思路（响应时效、围堵、根因、对策、横展、合规），最后从「沟通/取证/合规」三个维度给我评分和改进建议。' }))}'>
            <div style="flex:1;"><b>${esc(s)}</b><div style="font-size:11px;color:#8791a5;margin-top:3px;">AI 扮演上级/客户 · 三维评分</div></div><span style="color:#1a56db;">开始 ›</span></div>`).join('')}
        </div>`)}
      <div class="footer-note">${brand()} · 成长中心</div>`;
    },
  };

  /* ================= P12 DeepSeek 插件架构 ================= */
  Pages.arch = {
    title: 'DeepSeek 插件架构', sub: 'Harness 运行状态 · 插件总线 · 安全护栏 · 审计',
    async render() {
      const boot = global.State.bootstrap;
      const tools = boot.tools || [];
      const settings = boot.settings || {};
      const plugins = settings.plugins || {};
      const auditRes = await API.get('/qip/api/audit', { limit: 60 });
      const audit = auditRes.rows || [];
      const byPlugin = {};
      tools.forEach((t) => { (byPlugin[t.plugin] = byPlugin[t.plugin] || []).push(t); });
      const auditByPlugin = {};
      audit.forEach((a) => { auditByPlugin[a.plugin] = (auditByPlugin[a.plugin] || 0) + 1; });
      const llm = settings.llm || {};

      return `
      <div class="ai-strip">
        <div class="ai-ico">🧱</div>
        <div class="ai-txt"><b>架构：</b>以 <b>DeepSeek 大模型作为「装配式 Harness」</b>、企业信息系统作为<b>热插拔插件</b>。插件按统一协议 <code>manifest（能力声明/参数 schema）+ execute() + healthCheck()</code> 注册，新增系统只需开发适配器，主平台零改造。</div>
        ${act('插件接入说明', 'pluginGuide', {}, 'btn')}
      </div>

      <div class="card">
        <div class="card-hd"><span class="t">三层架构与数据流</span><span class="s">当前实际运行状态</span></div>
        <svg viewBox="0 0 900 250" style="width:100%;">
          <rect x="10" y="12" width="880" height="40" rx="8" fill="#e4edff" stroke="#c9d8f5"/>
          <text x="24" y="38" font-size="12" fill="#0b3ea8" font-weight="700">用户层</text>
          <text x="110" y="38" font-size="11.5" fill="#33415c">桌面 Web 工作台（本页面） · 移动端适配 · 车间语音报障 · 看板大屏 · 全局搜索</text>
          <path d="M450 52 L450 72" stroke="#95a3bd" stroke-width="2" marker-end="url(#ar)"/>
          <defs><marker id="ar" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#95a3bd"/></marker></defs>
          <rect x="10" y="72" width="880" height="58" rx="8" fill="#f0ebff" stroke="#ddd6ff"/>
          <text x="24" y="96" font-size="12" fill="#7a5af8" font-weight="700">AI 中台</text>
          <text x="110" y="96" font-size="11.5" fill="#33415c">DeepSeek Harness：意图理解 → 任务规划(ReAct) → 插件编排 → 知识检索(RAG) → 深度推理 → 结果整合 → 安全护栏</text>
          <text x="110" y="116" font-size="11" fill="#7a5af8">当前模型：${esc(llm.model || '未配置')}　Base URL：${esc(llm.baseUrl || '—')}　API Key：${llm.hasApiKey ? '已配置 ' + esc(llm.apiKeyMasked || '') : '未配置'}　工具数：${tools.length}</text>
          <path d="M450 130 L450 150" stroke="#95a3bd" stroke-width="2" marker-end="url(#ar)"/>
          <rect x="10" y="150" width="880" height="46" rx="8" fill="#e0f6f2" stroke="#bfe3d2"/>
          <text x="24" y="178" font-size="12" fill="#0a9e8f" font-weight="700">插件总线</text>
          ${Object.keys(byPlugin).slice(0, 9).map((p, i) => `<rect x="${110 + i * 86}" y="160" width="80" height="26" rx="6" fill="#fff" stroke="#bfe3d2"/><text x="${150 + i * 86}" y="177" font-size="10.5" fill="#0a9e8f" text-anchor="middle">${esc(p)} (${byPlugin[p].length})</text>`).join('')}
          <path d="M450 196 L450 212" stroke="#95a3bd" stroke-width="2" marker-end="url(#ar)"/>
          <rect x="10" y="212" width="880" height="32" rx="8" fill="#f2f4f8" stroke="#e4e8f0"/>
          <text x="24" y="233" font-size="11.5" fill="#5e6b85">企业信息系统：MES · ERP(SAP) · OA · 财务共享 · SPC · AI 质检 · 售后 DMS　|　当前均为<b>本地数据仓</b>模式，可在下方填入真实接口地址切换为直连</text>
        </svg>
      </div>

      <div class="grid g2" style="margin-bottom:14px;">
        ${card('插件清单与运行状态', '共 ' + Object.keys(byPlugin).length + ' 个插件 / ' + tools.length + ' 个工具',
          table(['插件', '工具数', '模式', '状态', '近 60 条审计调用', ''],
            Object.keys(byPlugin).map((p) => {
              const key = Object.keys(plugins).find((k) => plugins[k].name === p);
              const cfg = key ? plugins[key] : null;
              return {
                cells: ['<b>' + esc(p) + '</b><br><span style="font-size:10.5px;color:#8791a5;">' + esc(cfg ? cfg.desc : '') + '</span>', byPlugin[p].length,
                  cfg ? (cfg.mode === 'http' ? tag('HTTP 直连', 'purple') : tag('本地数据仓', 'blue')) : tag('内置', 'blue'),
                  cfg && cfg.enabled === false ? tag('已停用', 'gray') : tag('运行中', 'green'),
                  auditByPlugin[p] || 0,
                  act('工具', 'showPlugin', { plugin: p }, 'btn btn-sm') + (key ? act('配置', 'pluginConfig', { key }, 'btn btn-sm') : '')],
              };
            })))}
        ${card('Harness 运行状态', '真实统计',
          infoGrid([
            ['模型', esc(llm.model || '未配置')], ['深度推理', llm.deepThinking ? '已开启' : '关闭'],
            ['温度', llm.temperature], ['最大 Token', llm.maxTokens],
            ['最大工具轮次', (settings.agent || {}).maxRounds || 8], ['自动工具调用', (settings.agent || {}).autoTool !== false ? '开启' : '关闭'],
            ['结论必须有出处', (settings.agent || {}).requireCitation !== false ? '强制' : '关闭'], ['三类动作人工确认', (settings.agent || {}).humanConfirm !== false ? '强制' : '关闭'],
            ['敏感信息脱敏', (settings.agent || {}).maskSensitive !== false ? '开启（VIN/手机号）' : '关闭'], ['全程审计', '开启（保留最近 5000 条）'],
            ['数据存储', '本地文件数据仓（data/qip-db.json）', true],
          ]))}
      </div>

      <div class="grid g2">
        ${card('安全与信创治理', '技术方案第五章落地情况',
          table(['治理项', '机制', '当前状态'], [
            ['数据不出厂', '模型可指向厂内私有化部署（OpenAI 兼容端点），数据全程本地存储', tag('已支持', 'green')],
            ['权限继承', '沿用 OA 组织架构（oa_org_tree），本平台不另建账号', tag('已支持', 'green')],
            ['敏感脱敏', 'VIN / 手机号 / 身份证在进入 Prompt 前自动脱敏', tag('已开启', 'green')],
            ['全程审计', '每次工具调用留痕：谁·何时·取了什么·用途', tag('已开启', 'green')],
            ['幻觉抑制', '结论强制挂接出处，无出处降级为「假设」', tag('已开启', 'green')],
            ['人工确认', '对外发送 / 对外承诺 / 8D 关闭三类动作强制确认', tag('已开启', 'green')],
          ]))}
        ${card('审计日志', '最近 ' + audit.length + ' 条工具调用',
          table(['时间', '操作人', '插件', '动作', '结果摘要'],
            audit.slice(0, 20).map((a) => [dt(a.ts), esc(a.user), tag(a.plugin, 'navy'), esc(a.action), '<span style="font-size:11.5px;">' + esc((a.resultSummary || '').slice(0, 50)) + '</span>'])),
          act('查看全部', 'goto', { page: 'audit' }))}
      </div>
      <div class="footer-note">${brand()} · 插件架构</div>`;
    },
  };

  /* ================= P13 移动端适配 ================= */
  Pages.mobile = {
    title: '移动端适配', sub: '同账号同 Harness · 车间弱网可用',
    async render() {
      const [kpiRes, todoRes] = await Promise.all([API.get('/qip/api/kpi/overview'), API.get('/qip/api/todos', { limit: 6 })]);
      const K = kpiRes.kpi.KPI, k = kpiRes.kpi;
      const todos = (todoRes.rows || []).filter((t) => !t.done).slice(0, 4);
      const counts = (global.State && global.State.bootstrap && global.State.bootstrap.counts) || {};
      const org = (global.State && global.State.bootstrap && global.State.bootstrap.org) || {};
      const TABS = ['驾驶舱', 'AI 助手', '报问题', '审批', '我的'];
      const TAB_ICONS = ['📊', '🤖', '📷', '✅', '👤'];
      const screen = (title, body, badge, activeTab) => `<div style="display:flex;flex-direction:column;gap:12px;">
        <div style="font-size:13px;font-weight:700;color:#16233c;">${esc(title)} ${badge ? tag(badge, 'blue') : ''}</div>
        <div class="phone-frame"><div class="phone-screen">
          <div class="phone-notch"></div>
          <div class="phone-status"><span>9:41</span><span>5G 专网</span><span>🔋 86%</span></div>
          <div style="flex:1;min-height:0;overflow-y:auto;padding:10px 12px 14px;">${body}</div>
          <div style="display:flex;border-top:1px solid #e4e8f0;background:#fff;padding:7px 2px 11px;">${TABS.map((t, i) => `<div style="flex:1;min-width:0;text-align:center;font-size:9px;white-space:nowrap;letter-spacing:-.2px;line-height:1.3;color:${i === (activeTab || 0) ? '#1a56db' : '#8791a5'};"><div style="font-size:13px;line-height:1.15;">${TAB_ICONS[i]}</div>${t}</div>`).join('')}</div>
        </div></div></div>`;
      const menuRow = (icon, label, extra, on) => `<div style="display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:8px;${on ? 'background:#e8f0ff;' : ''}margin-bottom:6px;">
        <span style="font-size:14px;">${icon}</span>
        <span style="flex:1;font-size:11.5px;color:${on ? '#1a56db' : '#1a2233'};font-weight:${on ? 600 : 400};">${esc(label)}</span>
        <span style="font-size:10px;color:#8791a5;">${esc(extra || '')}</span>
        <span style="font-size:11px;color:#c3cad8;">›</span>
      </div>`;
      const meHead = `<div style="background:#fff;border-radius:10px;padding:11px 12px;margin-bottom:9px;display:flex;align-items:center;gap:9px;">
        <div style="width:34px;height:34px;border-radius:50%;background:#1a56db;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;">李工</div>
        <div style="flex:1;"><div style="font-size:12px;font-weight:700;">李工</div><div style="font-size:10px;color:#8791a5;">${esc(org.company || '某制造型企业')} · ${esc(org.dept || '质量改进部门')}</div></div>
      </div>`;
      const card2 = (t, v, c) => `<div style="background:#fff;border-radius:9px;padding:10px 12px;margin-bottom:8px;"><div style="font-size:10.5px;color:#8791a5;">${t}</div><div style="font-size:19px;font-weight:700;color:${c || '#0b3ea8'};margin-top:3px;">${v}</div></div>`;
      return `
      <div class="ai-strip">
        <div class="ai-ico">📱</div>
        <div class="ai-txt"><b>移动端：</b>与桌面端同账号、同 Harness，车间现场可语音报障、拍照识别、扫二维码回填；弱网下草稿本地保存。移动审批带 AI 摘要辅助秒级决策。</div>
        ${act('说明与限制', 'mobileGuide', {}, 'btn')}
      </div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;justify-content:center;max-width:1100px;margin:0 auto;">
        ${screen('① 质量驾驶舱（主管视图）',
          `<div style="background:linear-gradient(135deg,#7a5af8,#1a56db);border-radius:10px;padding:11px 13px;color:#fff;margin-bottom:9px;font-size:11px;line-height:1.75;">
            <b>AI 质量晨报 · ${new Date().toISOString().slice(0, 10)}</b><br>判异 ${K.过程判异总数} 起 · 风险 ${(k.violationRows || []).length} 项 · 未关闭问题 ${K.未关闭问题} 起（A 级 ${K.A级问题}）</div>
          ${card2('过程合格率（FTT 代理值）', K.一次下线合格率FTT代理值.split('（')[0], '#0b3ea8')}
          ${card2('改进项目按期率', K.项目按期率, '#c8620a')}
          ${card2('已核定收益', '¥' + K.已核定收益万元 + ' 万', '#7a5af8')}
          ${card2('超期项目', K.超期项目 + ' 个', K.超期项目 ? '#e5484d' : '#18a058')}`)}
        ${screen('② AI 助手（一句话作业）',
          `<div style="background:#fff;border-radius:9px;padding:10px;font-size:11px;line-height:1.7;margin-bottom:8px;">
            <div style="background:#e4edff;border-radius:8px;padding:7px 9px;margin-bottom:6px;">@MES 查昨日二车间报废</div>
            <div style="background:#f8fafc;border:1px solid #eef1f6;border-radius:8px;padding:7px 9px;">已调用 @MES：昨日二车间报废 3 起，折算 ¥1,440。是否创建 QRQC？</div></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">${['@MES 查报废', '@SPC 解读判异', '生成周报', '发起 QRQC'].map((t) => `<span style="font-size:10.5px;border:1px solid #dde2ec;border-radius:12px;padding:3px 9px;">${t}</span>`).join('')}</div>
          <div style="display:flex;gap:6px;"><div style="flex:1;border:1px solid #dde2ec;border-radius:8px;padding:7px 9px;color:#8791a5;font-size:11px;">输入指令…</div><div style="background:#1a56db;color:#fff;border-radius:8px;padding:7px 12px;font-size:11px;">发送</div></div>
          <div style="margin-top:8px;font-size:10.5px;color:#8791a5;text-align:center;">🎤 支持语音输入</div>`, '', 1)}
        ${screen('③ 现场报问题（零培训）',
          `<div style="background:#fff;border-radius:9px;padding:10px;font-size:11px;margin-bottom:8px;">
            <div style="color:#8791a5;margin-bottom:5px;">扫二维码自动回填</div>
            <div style="border:1px dashed #c9d8f5;border-radius:8px;padding:14px;text-align:center;color:#1a56db;margin-bottom:8px;">📷 扫描二维码 / 拍照识别缺陷</div>
            <div style="background:#f8fafc;border-radius:8px;padding:7px 9px;line-height:1.7;">产品：产品A<br>车间：四车间 · 三线<br>缺陷：左前门漆面颗粒<br>置信度：0.89</div>
            <div style="margin-top:7px;font-size:10.5px;color:#8791a5;">🎤 语音描述：「左前门有颗粒，第三台」</div></div>
          <div style="background:#fff;border-radius:9px;padding:10px;font-size:11px;">
            <div style="color:#e5484d;font-weight:600;margin-bottom:4px;">⚠ AI 关联到 3 起相似案例</div>
            <div style="color:#5e6b85;line-height:1.7;">#C-0232 漆面颗粒污染源定位（送风过滤棉）</div>
            <div style="margin-top:8px;background:#1a56db;color:#fff;border-radius:8px;padding:8px;text-align:center;">提交问题单</div></div>`, '', 2)}
        ${screen('④ 移动审批（AI 摘要）',
          todos.length ? todos.map((t) => `<div style="background:#fff;border-radius:9px;padding:10px;margin-bottom:8px;font-size:11px;">
            <div style="display:flex;gap:6px;align-items:center;"><b style="flex:1;">${esc(t.title.slice(0, 26))}</b>${tag(t.priority, t.priority === 'A' ? 'red' : 'orange')}</div>
            <div style="color:#8791a5;margin-top:4px;">${esc(t.user)} · 期限 ${dt(t.dueAt)}</div>
            <div style="background:#f7f4ff;border:1px solid #e4dcff;border-radius:7px;padding:6px 8px;margin-top:6px;color:#5b4b9e;line-height:1.6;">🤖 AI 摘要：围堵成本 ¥1.2 万 vs 未拦截潜在损失 ¥18 万，建议批准。</div>
            <div style="display:flex;gap:6px;margin-top:7px;"><div style="flex:1;background:#18a058;color:#fff;border-radius:7px;padding:6px;text-align:center;">批准</div><div style="flex:1;border:1px solid #dde2ec;border-radius:7px;padding:6px;text-align:center;">驳回</div></div></div>`).join('') : empty('暂无待办', '✅'), '', 3)}
        ${screen('⑤ 我的 · 我的工作与报表（上）',
          `${meHead}
          <div style="background:#fff;border-radius:10px;padding:8px;margin-bottom:8px;">
            <div style="font-size:10px;color:#8791a5;padding:2px 4px 6px;">① 我的工作</div>
            ${menuRow('📑', '报表中心', counts.reports ? counts.reports + ' 份报告' : '周报 · 月报 · 专项', true)}
            ${menuRow('📄', '质量周报', '本周五 07:30 推送')}
            ${menuRow('📊', '质量月报', '10 月已生成')}
            ${menuRow('🧾', '专项分析报告', '按需生成')}
          </div>
          <div style="background:#fff;border-radius:10px;padding:8px;">
            <div style="font-size:10px;color:#8791a5;padding:2px 4px 6px;">② 导出与订阅</div>
            ${menuRow('📥', '导出 Excel / Word', '一键下载')}
            ${menuRow('🔔', '订阅日报', '每工作日 07:30')}
            ${menuRow('⚙️', '报表偏好设置', '含指标口径')}
          </div>
          <div style="margin-top:8px;text-align:center;font-size:10px;color:#1a56db;">下滑继续 ③ 学习与知识 · ④ 推荐给我 ↓</div>`, '', 4)}
        ${screen('⑥ 我的 · 学习与成长（下）',
          `<div style="margin-bottom:8px;text-align:center;font-size:10px;color:#8791a5;">↑ 上接 ① 我的工作 · ② 导出与订阅</div>
          <div style="background:#fff;border-radius:10px;padding:8px;margin-bottom:8px;">
            <div style="font-size:10px;color:#8791a5;padding:2px 4px 6px;">③ 学习与知识</div>
            ${menuRow('📚', '知识库与经验传承', (counts.knowledge || 0) + ' 条', true)}
            ${menuRow('🎓', '员工成长中心', (counts.members || 18) + ' 人 · 3 阶段')}
            ${menuRow('🏅', '我的证书与积分', '积分 860')}
          </div>
          <div style="background:#fff;border-radius:10px;padding:8px;">
            <div style="font-size:10px;color:#8791a5;padding:2px 4px 6px;">④ 推荐给我</div>
            ${menuRow('🎯', '8D 问题解决实战', '30 分钟 · 推荐')}
            ${menuRow('📐', 'Cpk 与过程能力', '20 分钟 · 未学')}
            ${menuRow('🎤', '现场问题识别口诀', '8 分钟 · 高频')}
          </div>`, '', 4)}
      </div>
      <div class="grid g3" style="margin-top:16px;">
        ${card('移动端设计要点', '', `<div style="font-size:12px;line-height:2;">
          · <b>零培训上手</b>：扫二维码 → 自动回填 → 拍照/语音 → 提交，全程无需打字<br>
          · <b>同 Harness</b>：与桌面端共用同一套工具与数据，结论一致<br>
          · <b>弱网可用</b>：草稿本地保存，网络恢复后自动同步<br>
          · <b>审批提速</b>：AI 摘要给出「成本 vs 风险」量化对比，辅助秒级决策</div>`)}
        ${card('建议落地形态', '', `<div style="font-size:12px;line-height:2;">
          · ① <b>企业微信/钉钉 H5</b>：复用本平台移动端视图，零安装、最快上线<br>
          · ② <b>微信小程序</b>：体验最好（项目目录中已有小程序工程可复用）<br>
          · ③ <b>原生 App</b>：仅在需要离线扫描二维码/离线拍照时考虑<br>
          推荐路径：一期先上企微 H5，二期再做小程序。</div>`)}
        ${card('当前工程状态', '', infoGrid([['Web 工作台', tag('已可用', 'green')], ['API 接口', tag('已就绪', 'green')], ['移动端 H5', tag('复用同一 API', 'blue')], ['小程序', tag('可复用', 'blue')]]))}
      </div>
      <div class="footer-note">${brand()} · 移动端</div>`;
    },
  };
})(window);




