/* ==================================================================
   分析类页面：QRQC / SPC 智能判异 / 市场质量 / 收益核算 / 报表中心
   ================================================================== */
(function (global) {
  'use strict';
  const { esc, act, card, kpi, table, tag, sevTag, statusTag, bar, md, dt, day, num, pct, empty, loadingBlock, infoGrid, lineChart, paretoChart, controlChart, histogramChart, ring, brand } = UI;
  const Pages = global.Pages;

  /* ================= P5 QRQC 快速响应 ================= */
  Pages.qrqc = {
    title: 'QRQC 快速响应', sub: '班组 / 车间 / 厂级三级快速响应 · 2h 响应计时',
    async render() {
      const [qrqcRes, todoRes] = await Promise.all([API.get('/qip/api/qrqc', { limit: 100 }), API.get('/qip/api/todos', { limit: 100 })]);
      const rows = qrqcRes.rows || [];
      const open = rows.filter((r) => r.status !== 'closed');
      const todos = (todoRes.rows || []).filter((t) => !t.done);
      const onTime = rows.length ? (rows.filter((r) => r.responseAt).length / rows.length * 100).toFixed(1) : '—';
      return `
      <div class="ai-strip">
        <div class="ai-ico">🎙️</div>
        <div class="ai-txt"><b>QRQC 智能会议：</b>现场描述/录音转写 → AI 提取「问题 / 临时措施 / 责任人 / 期限」四要素 → 自动生成纪要并经 @OA 派工到人。当前 <b>${open.length}</b> 场进行中，累计 <b>${rows.length}</b> 场，2h 响应率 <b>${onTime}%</b>。</div>
        ${act('发起 QRQC', 'newQrqc', {}, 'btn btn-ai')}
        ${act('现场语音报问题', 'voiceReport', {}, 'btn')}
      </div>
      <div class="grid g3" style="margin-bottom:14px;">
        ${kpi({ ico: '📅', label: '进行中 QRQC', value: open.length, delta: '班组/车间/厂级三级' })}
        ${kpi({ ico: '✅', label: '累计场次', value: rows.length, color: '#18a058', icoBg: '#e8f7ee', delta: '已闭环 ' + rows.filter((r) => r.status === 'closed').length })}
        ${kpi({ ico: '📌', label: '未完成派工任务', value: todos.length, color: '#c8620a', icoBg: '#fff3e0', delta: '点击进入审批中心', act: 'goto', args: { page: 'approval' } })}
      </div>
      ${card('QRQC 会议清单', '共 ' + rows.length + ' 场',
        table(['编号', '层级', '车间', '议题', '问题', '临时措施', '责任人', '状态', ''],
          rows.map((r) => ({
            cells: ['<b>' + esc(r.id) + '</b>', tag(r.level, r.level === '厂级' ? 'red' : r.level === '车间' ? 'orange' : 'blue'), esc(r.workshop || '—'), esc(r.topic || ''), esc((r.problem || '').slice(0, 40)), esc((r.tempAction || '').slice(0, 30)), esc(r.owner || ''), r.status === 'closed' ? tag('已闭环', 'green') : tag('进行中', 'orange'), r.status === 'closed' ? '' : act('生成纪要', 'qrqcMinutes', { id: r.id }, 'btn btn-sm')],
          }))),
        act('导出 Excel', 'exportData', { dataset: 'all' }))}
      <div class="grid g2">
        ${card('车间语音报问题', '自然语言 → 结构化问题单',
          `<div style="font-size:12.5px;color:#5e6b85;line-height:1.9;margin-bottom:10px;">现场只需一句话，AI 自动识别<b>产品 / 车间 / 工位 / 缺陷类别 / 等级</b>，回填 MES 工位批次，并匹配相似历史案例。例如：<br>
            <span style="color:#1a56db;">「四车间三线右后门关门声发闷，连续第三台」</span></div>
          ${act('🎤 试一条（预置话术）', 'voiceReport', { text: '四车间三线右后门关门声发闷，连续第三台' }, 'btn btn-ai')}
          ${act('输入自定义描述', 'voiceReport', {}, 'btn')}`)}
        ${card('QRQC 有效性指标', '真实统计',
          infoGrid([
            ['累计会议场次', rows.length], ['已闭环', rows.filter((r) => r.status === 'closed').length],
            ['进行中', open.length], ['2h 响应率', onTime + '%'],
            ['派工任务总数', (todoRes.rows || []).length], ['未完成任务', todos.length],
            ['涉及车间', [...new Set(rows.map((r) => r.workshop).filter(Boolean))].join(' / ') || '—', true],
          ]))}
      </div>
      <div class="footer-note">${brand()} · QRQC</div>`;
    },
  };

  /* ================= P6 SPC 智能判异 ================= */
  const SpcState = global.SpcState = { charId: null, days: 7, data: null };

  Pages.spc = {
    title: 'SPC 智能判异', sub: 'GB/T 4091 八大判异准则 · 控制图 · Cpk/Ppk · 真实统计引擎',
    async render() {
      const charsRes = await API.get('/qip/api/spc/chars');
      const chars = charsRes.chars || [];
      if (!SpcState.charId && chars.length) {
        const worst = chars.slice().sort((a, b) => (a.近7日Cpk === null ? 9 : a.近7日Cpk) - (b.近7日Cpk === null ? 9 : b.近7日Cpk))[0];
        SpcState.charId = worst ? worst.编号 : chars[0].编号;
      }
      SpcState.data = await API.get('/qip/api/spc/detail', { charId: SpcState.charId, days: SpcState.days });
      return renderSpc(chars);
    },
  };

  function renderSpc(chars) {
    const d = SpcState.data || {};
    const chart = d.chart || {}, cap = d.capability || {}, rules = d.rules || {}, hist = d.histogram || {};
    const cur = chars.find((c) => c.编号 === SpcState.charId) || {};
    const pts = chart.全部点值 || [];
    const times = (chart.最近12点 || []).map((p) => p.时间);
    const hits = rules.判异结果 || [];
    const capColor = cap.能力指数 ? (cap.能力指数.Cpk >= 1.33 ? '#18a058' : cap.能力指数.Cpk >= 1 ? '#c8620a' : '#e5484d') : '#8791a5';

    return `
      <div class="ai-strip">
        <div class="ai-ico">📈</div>
        <div class="ai-txt"><b>SPC 智能判异引擎：</b>平台监控 <b>${chars.length}</b> 个关键特性，控制图与控制限由统计引擎实算（Xbar-R / I-MR / Xbar-S / EWMA），判异严格按 GB/T 4091 八大准则执行，<b>不是目测趋势</b>。</div>
        ${act('AI 全体检', 'aiQuick', { q: '@SPC 检查全部关键特性的判异情况，按严重度排序，并给出每个失控特性的排查方向' }, 'btn btn-ai')}
      </div>

      ${card('关键特性一览', 'Cpk 由统计引擎实算（近 7 天）',
        table(['编号', '特性名称', '产品', '车间', '规格', '控制图', 'CTQ', 'Cpk', '超差', '判异', '状态', ''],
          chars.map((c) => ({
            __act: 'spcSelect', __args: { charId: c.编号 },
            cells: ['<b>' + esc(c.编号) + '</b>', esc(c.名称), esc(c.产品), esc(c.车间), esc(c.规格), esc(c.控制图), c.CTQ ? tag('CTQ', 'red') : '—',
              c.近7日Cpk === null ? '—' : `<b style="color:${c.近7日Cpk >= 1.33 ? '#18a058' : c.近7日Cpk >= 1 ? '#c8620a' : '#e5484d'}">${c.近7日Cpk}</b>`,
              c.近7日超差数, (c.状态 === '失控' ? tag('有', 'red') : '—'), tag(c.状态, c.状态 === '受控' ? 'green' : c.状态 === '失控' ? 'red' : c.状态 === '需关注' ? 'orange' : 'gray'),
              SpcState.charId === c.编号 ? tag('当前', 'blue') : act('查看', 'spcSelect', { charId: c.编号 }, 'btn btn-sm')],
            __style: SpcState.charId === c.编号 ? 'background:#f6f9ff;' : '',
          }))), act('导出 Excel', 'exportData', { dataset: 'spc', charId: SpcState.charId }))}

      <div class="grid g2" style="margin-bottom:14px;">
        ${card('控制图 · ' + esc(SpcState.charId) + ' ' + esc(cur.名称 || ''), (chart.图类型 || '') + ' · 近 ' + SpcState.days + ' 天 · 红点为超出控制限',
          controlChart({ points: pts, ucl: chart.控制限 ? chart.控制限.UCL : undefined, cl: chart.控制限 ? chart.控制限.CL : undefined, lcl: chart.控制限 ? chart.控制限.LCL : undefined, usl: cur.规格 ? parseFloat(String(cur.规格).split('~')[1]) : undefined, lsl: cur.规格 ? parseFloat(String(cur.规格).split('~')[0]) : undefined, labels: times }) +
          `<div class="legend" style="margin-top:6px;"><span><i style="background:#1a56db;"></i>测量值</span><span><i style="background:#e5484d;"></i>UCL/LCL（超出即红色）</span><span><i style="background:#18a058;"></i>中心线</span><span><i style="background:#c8620a;"></i>规格限 USL/LSL</span></div>
           <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">${[1, 3, 7, 14, 30].map((n) => act(n + ' 天', 'spcDays', { days: n }, 'btn btn-sm' + (SpcState.days === n ? ' btn-primary' : ''))).join('')}</div>`)}
        ${card('判异结果', hits.length ? '⚠ 命中 ' + hits.length + ' 条准则 · GB/T 4091' : '✅ 过程受控',
          hits.length ? hits.map((h) => `<div style="border:1px solid ${h.严重度 === 'high' ? '#ffdcd9' : '#ffe9c7'};background:${h.严重度 === 'high' ? '#fff5f4' : '#fffbf2'};border-radius:8px;padding:10px 12px;margin-bottom:8px;">
            <div style="display:flex;gap:8px;align-items:center;">${tag('准则 ' + h.准则, h.严重度 === 'high' ? 'red' : 'orange')}<b style="font-size:12.5px;">${esc(h.名称)}</b><span style="margin-left:auto;font-size:11px;color:#8791a5;">${esc(h.严重度)}</span></div>
            <div style="font-size:11.5px;color:#5e6b85;margin-top:5px;line-height:1.7;">${esc(h.说明)}</div>
            <div style="font-size:11px;color:#8791a5;margin-top:4px;">涉及点位：${esc((h.涉及时间 || []).join('、'))}<br>涉及值：${esc((h.涉及值 || []).join(', '))}</div>
          </div>`).join('') : `<div style="font-size:12.5px;color:#18a058;">近 ${SpcState.days} 天未发现判异信号。控制限：UCL ${rules.单值图控制限 ? rules.单值图控制限.UCL : '—'}，CL ${rules.单值图控制限 ? rules.单值图控制限.CL : '—'}，LCL ${rules.单值图控制限 ? rules.单值图控制限.LCL : '—'}。</div>`,
          act('判异写入 D4', 'aiQuick', { q: '把 ' + SpcState.charId + ' 的判异结论写入对应改进项目的 D4 根因分析阶段，并给出排查方向' }))}
      </div>

      <div class="grid g3" style="margin-bottom:14px;">
        ${card('过程能力 Cpk/Ppk', cur.名称 || '',
          `<div style="text-align:center;margin-bottom:8px;"><div class="score-ring" style="font-size:34px;color:${capColor};">${cap.能力指数 ? cap.能力指数.Cpk : '—'}</div><div style="font-size:11px;color:#8791a5;">Cpk　${cap.判定 || ''}</div></div>` +
          infoGrid([
            ['Cp', cap.能力指数 ? cap.能力指数.Cp : '—'], ['Cpk', cap.能力指数 ? cap.能力指数.Cpk : '—'],
            ['Pp', cap.能力指数 ? cap.能力指数.Pp : '—'], ['Ppk', cap.能力指数 ? cap.能力指数.Ppk : '—'],
            ['均值', cap.均值], ['标准差', cap.标准差],
            ['预估不良率', cap.预估不良率 ? cap.预估不良率.合计ppm + ' ppm' : '—'], ['西格玛水平', cap.西格玛水平],
            ['偏离方向', cap.偏离中心方向 || '—', true],
            ['改进建议', cap.改进建议 || '—', true],
          ].map(([a, b, c]) => [a, b === undefined ? '—' : b, c])))}
        ${card('分布直方图', '近 30 天 · 橙线为规格限', histogramChart(hist.分箱, cur.规格 ? parseFloat(String(cur.规格).split('~')[0]) : undefined, cur.规格 ? parseFloat(String(cur.规格).split('~')[1]) : undefined))}
        ${card('判异准则说明（GB/T 4091）', '八大准则',
          `<div style="font-size:11.5px;line-height:2;color:#33415c;">
           <b>准则1</b> 1 点落在 A 区之外（超 UCL/LCL）<br>
           <b>准则2</b> 连续 9 点在中心线同侧<br>
           <b>准则3</b> 连续 6 点递增或递减<br>
           <b>准则4</b> 连续 14 点上下交替<br>
           <b>准则5</b> 连续 3 点中有 2 点在 B 区以外（同侧）<br>
           <b>准则6</b> 连续 5 点中有 4 点在 C 区以外（同侧）<br>
           <b>准则7</b> 连续 15 点集中在 C 区之内<br>
           <b>准则8</b> 连续 8 点落在中心线两侧且无点在 C 区<br>
           <span style="color:#8791a5;">A/B/C 区 = 以 1σ/2σ/3σ 划分的三段区域。</span></div>`)}
      </div>
      ${card('特性明细数据', esc(SpcState.charId) + ' · 近 ' + SpcState.days + ' 天',
        `<div style="max-height:300px;overflow:auto;">${table(['序号', '时间', '班次', '测量值', '超限'], (chart.最近12点 || []).map((p) => [p.序号, p.时间, p.班次, p.值, p.超限 ? tag('超出控制限', 'red') : '—']))}</div>`,
        act('导出该特性测量数据', 'exportData', { dataset: 'measurements', charId: SpcState.charId, days: SpcState.days }))}
      <div class="footer-note">${brand()} · SPC 智能判异</div>`;
  }

  /* ================= P7 市场质量与客诉 ================= */
  Pages.market = {
    title: '市场质量与客诉', sub: 'AI 质检 + 售后线索 + 制造过程关联分析',
    async render() {
      const [defRes, riskRes, issuesRes] = await Promise.all([
        API.get('/qip/api/defects', { limit: 500 }), API.tool('aqi_risk_scan', { days: 30 }), API.get('/qip/api/issues', { source: '市场', limit: 100 }),
      ]);
      const defects = defRes.rows || [];
      const byType = {}; defects.forEach((d) => { byType[d.type] = (byType[d.type] || 0) + 1; });
      const total = defects.length || 1; let cum = 0;
      const pareto = Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([name, value]) => { cum += value; return { name, value, cumPct: cum / total * 100 }; });
      const byDay = {}; defects.forEach((d) => { const k = d.ts.slice(0, 10); byDay[k] = (byDay[k] || 0) + 1; });
      const days = Object.keys(byDay).sort();
      const market = issuesRes.rows || [];
      return `
      <div class="ai-strip">
        <div class="ai-ico">🌍</div>
        <div class="ai-txt"><b>市场质量分析：</b>平台汇总 AI 视觉质检 <b>${defects.length}</b> 条缺陷记录与市场来源问题 <b>${market.length}</b> 起，自动交叉分析制造端缺陷与市场反馈的<b>时间与部位相关性</b>。</div>
        ${act('AI 归因分析', 'aiQuick', { q: '分析 AI 质检缺陷与市场投诉的相关性，判断哪些制造缺陷可能已经流出到市场，并给出风险等级' }, 'btn btn-ai')}
      </div>
      <div class="grid g4" style="margin-bottom:14px;">
        ${kpi({ ico: '🔍', label: 'AI 质检缺陷（30 天）', value: defects.length, delta: '平均置信度 ' + (defects.length ? (defects.reduce((a, c) => a + c.confidence, 0) / defects.length).toFixed(3) : '—') })}
        ${kpi({ ico: '📣', label: '市场来源问题', value: market.length, color: '#c8620a', icoBg: '#fff3e0', delta: '未关闭 ' + market.filter((r) => r.status !== '已关闭').length })}
        ${kpi({ ico: '⚠️', label: 'A 级市场问题', value: market.filter((r) => r.severity === 'A').length, color: '#e5484d', icoBg: '#feece8', delta: '需 2h 响应' })}
        ${kpi({ ico: '📈', label: '缺陷检出趋势', value: days.length ? byDay[days[days.length - 1]] : 0, delta: '最近一日 · ' + (days[days.length - 1] || '—'), deltaColor: '#8791a5' })}
      </div>
      <div class="grid g2" style="margin-bottom:14px;">
        ${card('缺陷类型帕累托', 'AI 视觉质检 · 近 30 天', paretoChart(pareto) + `<div style="font-size:11.5px;color:#5e6b85;margin-top:6px;">${pareto[0] ? '「' + esc(pareto[0].name) + '」最多（' + pareto[0].value + ' 起，' + (pareto[0].value / total * 100).toFixed(1) + '%）' : ''}</div>`)}
        ${card('缺陷检出日趋势', 'AI 质检', lineChart({ width: 620, height: 210, labels: days, yDigits: 0, series: [{ name: '缺陷数', color: '#7a5af8', values: days.map((d) => byDay[d]) }] }))}
      </div>
      ${card('风险扫描结果', '跨插件综合 · ' + (riskRes.result ? riskRes.result.风险总数 : 0) + ' 项',
        (riskRes.result && riskRes.result.风险清单 || []).map((r) => `<div style="border-left:3px solid ${r.等级 === 'A' ? '#e5484d' : '#c8620a'};background:#fbfcfe;border-radius:0 8px 8px 0;padding:9px 12px;margin-bottom:8px;">
          <div style="display:flex;gap:8px;align-items:center;">${tag(r.等级 + ' 级', r.等级 === 'A' ? 'red' : 'orange')}<b style="font-size:12.5px;">${esc(r.对象)}</b><span style="margin-left:auto;font-size:11px;color:#8791a5;">${esc(r.风险源)}</span></div>
          <div style="font-size:11.5px;color:#5e6b85;margin-top:4px;">${esc(r.描述)}</div>
          <div style="font-size:11.5px;color:#1a56db;margin-top:4px;">→ ${esc(r.建议动作)}</div></div>`).join('') || empty('未发现显著风险', '✅'))}
      ${card('市场来源问题清单', '共 ' + market.length + ' 起',
        table(['编号', '产品', '问题', '等级', '状态', '责任人', '登记时间', ''],
          market.map((r) => ({ __act: 'issueDetail', __args: { id: r.id }, cells: ['<b>' + esc(r.id) + '</b>', esc(r.model), esc(r.title), sevTag(r.severity), statusTag(r.status), esc(r.owner), day(r.createdAt), act('AI 生成客诉回复草稿', 'aiQuick', { q: '为问题 ' + r.id + '（' + r.title + '）生成对外客诉回复草稿，口径要与在改项目一致，发送前需人工确认' }, 'btn btn-sm')] }))))}
      <div class="footer-note">${brand()} · 市场质量</div>`;
    },
  };

  /* ================= P8 改进收益核算 ================= */
  Pages.benefit = {
    title: '改进收益核算', sub: 'AI 测算 → 财务核定 双签闭环',
    async render() {
      const res = await API.get('/qip/api/benefits', { limit: 200 });
      const rows = res.rows || [];
      const verified = rows.filter((r) => r.status === 'verified');
      const pending = rows.filter((r) => r.status !== 'verified');
      const byType = {}; rows.forEach((r) => { byType[r.type] = (byType[r.type] || 0) + r.amount; });
      const total = rows.reduce((a, c) => a + c.amount, 0);
      const vt = verified.reduce((a, c) => a + c.amount, 0);
      return `
      <div class="ai-strip">
        <div class="ai-ico">💰</div>
        <div class="ai-txt"><b>收益核算口径（财务可核定版）：</b>仅计已发生且可追溯的直接损失（报废料、返工工时、停线损失、索赔）；单价取 @ERP 当期标准价；摊销期不超过 12 个月；同一损失不得重复计入。<br>
          已核定 <b>¥${vt.toFixed(1)} 万</b>，待核定 <b>¥${(total - vt).toFixed(1)} 万</b>，核定通过率 <b>${rows.length ? (verified.length / rows.length * 100).toFixed(1) : '—'}%</b>。</div>
        ${act('AI 收益测算', 'benefitCalc', {}, 'btn btn-ai')}
      </div>
      <div class="grid g4" style="margin-bottom:14px;">
        ${kpi({ ico: '💰', label: '台账合计', value: '¥' + total.toFixed(1) + '<span style="font-size:14px;">万</span>', delta: rows.length + ' 笔', color: '#7a5af8', icoBg: '#f0ebff' })}
        ${kpi({ ico: '✅', label: '财务已核定', value: '¥' + vt.toFixed(1) + '<span style="font-size:14px;">万</span>', color: '#18a058', icoBg: '#e8f7ee', delta: '通过率 ' + (rows.length ? (verified.length / rows.length * 100).toFixed(1) : '—') + '%' })}
        ${kpi({ ico: '⏳', label: '待核定', value: '¥' + (total - vt).toFixed(1) + '<span style="font-size:14px;">万</span>', color: '#c8620a', icoBg: '#fff3e0', delta: pending.length + ' 笔' })}
        ${kpi({ ico: '🤖', label: 'AI 促成占比', value: (rows.length ? (rows.filter((r) => r.aiDriven).length / rows.length * 100).toFixed(0) : 0) + '%', delta: 'AI 直接促成项目收益', deltaColor: '#8791a5' })}
      </div>
      <div class="grid g2-1" style="margin-bottom:14px;">
        ${card('收益构成分析', '按类型', paretoChart(Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([name, value], i, arr) => { let c = 0; for (let j = 0; j <= i; j++) c += arr[j][1]; return { name, value: Number(value.toFixed(1)), cumPct: c / (total || 1) * 100 }; }), {}))}
        ${card('人均年收益', '质量改进部门 16 人',
          `<div style="text-align:center;padding:10px 0;"><div class="score-ring" style="font-size:34px;color:#7a5af8;">¥${(vt / 16).toFixed(1)}<span style="font-size:13px;color:#8791a5;">万/人</span></div>
           <div style="font-size:11.5px;color:#8791a5;margin-top:6px;">按已核定收益 / 16 人测算</div></div>` +
          infoGrid([['已核定总额', '¥' + vt.toFixed(1) + ' 万'], ['待核定', '¥' + (total - vt).toFixed(1) + ' 万'], ['台账笔数', rows.length], ['最快回收期项目', rows.slice().sort((a, b) => b.amount - a.amount)[0] ? rows.slice().sort((a, b) => b.amount - a.amount)[0].projectId : '—']]))}
      </div>
      ${card('收益台账', '共 ' + rows.length + ' 笔 · 点击可提交财务核定',
        table(['单号', '关联项目', '类型', '金额（万元）', '期间', '状态', '核定人', ''],
          rows.map((b) => ({
            cells: ['<b>' + esc(b.id) + '</b>', esc(b.projectId || '—') + (b.projectTitle ? '<br><span style="font-size:11px;color:#8791a5;">' + esc(b.projectTitle.slice(0, 22)) + '</span>' : ''), tag(b.type, 'blue'), '<b>' + b.amount + '</b>', esc(b.period || ''), b.status === 'verified' ? tag('财务已核定', 'green') : tag('待核定', 'orange'), esc(b.verifiedBy || '—'),
              b.status === 'verified' ? '' : act('提交核定', 'submitBenefit', { id: b.id }, 'btn btn-sm')],
          }))),
        act('导出 Excel', 'exportData', { dataset: 'benefits' }))}
      <div class="footer-note">${brand()} · 收益核算</div>`;
    },
  };

  /* ================= P9 报表中心 ================= */
  Pages.report = {
    title: '报表中心', sub: '周报 / 月报 / 专项 / 根因分析 / 8D 报告 · 真实 Word 与 Excel',
    async render() {
      const res = await API.get('/qip/api/reports');
      const rows = res.rows || [];
      const types = ['质量周报', '质量月报', '专项分析报告', '根因分析报告', 'SPC分析报告', '8D报告'];
      return `
      <div class="ai-strip">
        <div class="ai-ico">📑</div>
        <div class="ai-txt"><b>报表中心：</b>报告由智能体按真实数据生成真正的 <b>.docx</b>（含 KPI、过程能力表、问题清单、项目进度、收益台账与结论建议），导出为真正的 <b>.xlsx</b> 多工作表文件。全流程留痕，发布前需人工确认。</div>
        ${act('AI 一键生成周报', 'aiQuick', { q: '生成本周质量周报（Word 文档），包含 KPI、判异情况、重点问题、项目进度与收益，并给出结论建议' }, 'btn btn-ai')}
      </div>
      <div class="grid g3" style="margin-bottom:14px;">
        ${types.map((t) => `<div class="card" style="margin-bottom:0;cursor:pointer;" data-act="genReport" data-args='${esc(JSON.stringify({ type: t }))}'>
          <div style="display:flex;align-items:center;gap:10px;"><div style="width:36px;height:36px;border-radius:9px;background:#e4edff;display:flex;align-items:center;justify-content:center;font-size:18px;">${t.indexOf('周报') >= 0 ? '📅' : t.indexOf('月报') >= 0 ? '🗓️' : t.indexOf('根因') >= 0 ? '🔍' : t.indexOf('SPC') >= 0 ? '📈' : t.indexOf('8D') >= 0 ? '🧩' : '📊'}</div>
          <div><b style="font-size:13px;">${esc(t)}</b><div style="font-size:11px;color:#8791a5;">Word (.docx) · 真实数据</div></div></div></div>`).join('')}
      </div>
      ${card('已生成报表', '共 ' + rows.length + ' 份',
        table(['编号', '类型', '标题', '期间', '格式', '大小', '状态', '生成时间', ''],
          rows.map((r) => ({
            cells: ['<b>' + esc(r.id) + '</b>', tag(r.type, 'blue'), esc(r.title), esc(r.period || ''), esc(r.format || ''), r.size ? Math.round(r.size / 1024) + ' KB' : '—', r.status === 'published' ? tag('已发布', 'green') : tag('草稿', 'gray'), dt(r.createdAt),
              r.downloadUrl ? '<a class="btn btn-sm" href="' + esc(r.downloadUrl) + '">⬇ 下载</a>' : ''],
          })), { empty: '还没有生成过报表，点击上方卡片生成' }))}
      ${card('数据导出', '导出真实数据为 Excel / CSV',
        `<div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${[['issues', '质量问题库'], ['projects', '改进项目'], ['measurements', '测量数据'], ['spc', 'SPC 过程能力'], ['knowledge', '知识库'], ['benefits', '收益台账'], ['defects', 'AI 质检缺陷'], ['all', '全部（多工作表）']].map(([k, n]) => act(n, 'exportData', { dataset: k }, 'btn btn-sm')).join('')}
        </div>
        <div style="font-size:11.5px;color:#8791a5;margin-top:8px;">导出的 .xlsx 为真正的 OOXML 格式，可直接用 Excel / WPS 打开并做数据透视。</div>`)}
      <div class="footer-note">${brand()} · 报表中心</div>`;
    },
  };

  global.renderSpc = renderSpc;
})(window);



