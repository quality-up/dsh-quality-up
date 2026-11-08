/* ==================================================================
   体系文件（中小型企业版）：填写体系调研 → 一键生成手册 / 程序文件
   ================================================================== */
(function (global) {
  'use strict';
  const { esc, act, card, kpi, table, tag, dt, empty, infoGrid, input, readForm, toast, modal } = UI;
  const Pages = global.Pages;
  const QS = global.QS = { survey: null, completion: 0, orgRows: 8, docs: { manual: [], procedure: [] } };

  const CERTS = [['ISO9001', 'ISO 9001 质量管理体系'], ['IATF16949', 'IATF 16949 汽车行业质量体系'], ['ISO14001', 'ISO 14001 环境管理体系'], ['ISO45001', 'ISO 45001 职业健康安全']];
  const DEFAULT_ORG = [['综合管理', '综合管理部'], ['研发/技术', '技术部'], ['采购', '采购部'], ['市场', '市场部'], ['财务', '财务部'], ['制造/生产', '生产部'], ['质量', '质量部']];

  const row2 = (label, small, field, value, ph, opt) => `
    <div class="form-row"><div class="fl">${label}<small>${small || ''}</small></div>
    <div class="fc">${input(field, value, Object.assign({ placeholder: ph || '' }, opt || {}))}</div></div>`;
  const rowT = (label, small, field, value, ph) => `
    <div class="form-row"><div class="fl">${label}<small>${small || ''}</small></div>
    <div class="fc">${input(field, value, { type: 'textarea', placeholder: ph || '' })}</div></div>`;

  /** 按部门名猜职能（保存时只存部门名与负责人，职能用来对齐版面） */
  function guessDuty(dept) {
    const t = String(dept || '');
    if (!t) return '';
    const map = [[/质量|品管|品质/, '质量'], [/技术|研发|工艺|设计/, '研发/技术'], [/采购|供应/, '采购'],
      [/市场|销售|业务|客户/, '市场'], [/财务|会计/, '财务'], [/生产|制造|车间|装配/, '制造/生产'], [/综合|行政|人事|办公室/, '综合管理']];
    for (const [re, name] of map) if (re.test(t)) return name;
    return '';
  }

  function orgRows(sv) {
    const src = (sv && Array.isArray(sv.orgs) && sv.orgs.length) ? sv.orgs.slice() : DEFAULT_ORG.map(([duty, dept]) => ({ duty, dept, owner: '' }));
    while (src.length < 3) src.push({ duty: '', dept: '', owner: '' });
    return src.map((o, i) => `
      <div class="qms-org-row">
        <span class="qms-org-duty">${esc(o.duty || guessDuty(o.dept) || (o.dept ? '其他' : '自定义'))}</span>
        ${input('org' + i + 'd', o.dept || '', { placeholder: '部门名称，如质量部' })}
        ${input('org' + i + 'o', o.owner || '', { placeholder: '负责人姓名' })}
      </div>`).join('');
  }

  function summaryCard(sv, goPage) {
    const b = sv || {};
    const certs = (b.certs || []).map((c) => (CERTS.find((x) => x[0] === c) || [c, c])[1]).join(' + ') || '未选择';
    return card('调研摘要', '生成文件时按这里的信息组织内容', infoGrid([
      ['公司名称', esc(b.company || '—')],
      ['认证类型', esc(certs)],
      ['覆盖产品', esc(b.products || '—')],
      ['员工规模', b.staff ? esc(b.staff) + ' 人' : '—'],
      ['管理者代表', esc(b.mgmtRep || '—')],
      ['有无设计开发', esc(b.design || '—')],
      ['质量方针', esc(b.policy || '—'), true],
      ['质量目标', esc(b.objective || '—'), true],
      ['部门设置', esc((b.orgs || []).map((o) => o.dept).filter(Boolean).join('、') || '—'), true],
    ]), act('去完善调研', 'goto', { page: goPage || 'qmsSurvey' }));
  }

  function docsCard(type, docs) {
    const rows = (docs || []).map((d) => [
      `<b>${esc(d.code || '')}</b> ${esc(d.title || '')}`,
      d.source === 'ai' ? tag('AI 生成', 'blue') : tag('模板生成', 'gray'),
      String(d.chars || 0) + ' 字',
      dt(d.createdAt),
      act('查看', 'qmsDoc', { id: d.id }, 'btn btn-sm') + act('下载 .md', 'qmsDown', { id: d.id }, 'btn btn-sm'),
    ]);
    const extra = type === 'procedure' && rows.length
      ? act('全部下载为一个文件', 'qmsDownAll', { type }, 'btn btn-sm')
      : '';
    return card(type === 'manual' ? '已生成的质量手册' : '已生成的程序文件',
      rows.length ? '共 ' + rows.length + ' 份 · 每次生成会覆盖上一次' : '还没有生成，点上方按钮生成',
      rows.length ? table(['文件', '来源', '字数', '生成时间', '操作'], rows) : empty('还没有生成文件'),
      extra);
  }

  /* ---------------- 填写体系调研 ---------------- */
  Pages.qmsSurvey = {
    title: '填写体系调研', sub: '一步填全企业信息 · 后面「一键生成手册 / 程序文件」都按这份信息写',
    async render() {
      let r = null;
      try { r = await API.get('/qip/api/qms/survey'); } catch (e) { r = { survey: null, completion: 0 }; }
      QS.survey = r.survey || null; QS.completion = r.completion || 0;
      const sv = QS.survey || {};
      const pct = QS.completion;
      const bar = `<div class="qms-progress"><div class="qms-bar"><span style="width:${pct}%;"></span></div><b>${pct}%</b><span>必填与关键项完成度</span></div>`;
      return `
      <div class="ai-strip">
        <div class="ai-ico">📝</div>
        <div class="ai-txt"><b>体系调研表：</b>公司信息、组织机构、贯标团队、产品与过程、方针目标、认证计划填一次，后面生成质量手册与程序文件都按这份信息写。可以随时暂存草稿，填完点「✓ 填写完毕」。${sv.completed ? ' <span style="color:#18a058;font-weight:600;">（已标记填写完毕）</span>' : ''}</div>
        ${act('✓ 填写完毕', 'qmsComplete', {}, 'btn btn-ai')}
      </div>
      ${bar}
      <div class="grid g2">
        <div>
          ${card('一、基本信息', '公司名称与要拿的证书是必填',
            row2('公司名称', '必填', 'qmsCompany', sv.company, '请输入公司全称') +
            row2('需要取得的证书', '主认证', 'qmsCert', (sv.certs || [])[0] || 'ISO9001', '', { type: 'select', options: CERTS.map(([v, label]) => ({ value: v, label })) }) +
            row2('其他证书', '选填', 'qmsOtherCert', sv.otherCert, '如 ISO 13485、顾客特殊要求等'))}
          ${card('二、领导层', '',
            row2('董事长', '', 'qmsChairman', sv.chairman, '姓名') +
            row2('法人代表', '', 'qmsLegalRep', sv.legalRep, '姓名') +
            row2('总经理', '', 'qmsGm', sv.gm, '姓名') +
            row2('管理者代表', '体系日常负责人', 'qmsMgmtRep', sv.mgmtRep, '姓名'))}
          ${card('三、机构设置', '部门名称与负责人，生成手册时会写进职责分配',
            `<div class="qms-org-head"><span>职能</span><span>部门名称</span><span>负责人</span></div>${orgRows(sv)}`)}
          ${card('四、贯标团队', '',
            row2('贯标领导小组', '组长与组员', 'qmsTeam', sv.teamMembers, '如 张三（组长）、李四、王五') +
            row2('贯标办主任', '', 'qmsCertOffice', sv.certOffice, '姓名') +
            row2('内审员', '多人用顿号分隔', 'qmsAuditors', sv.auditors, '如 李四、王五'))}
        </div>
        <div>
          ${card('五、产品与过程', '',
            rowT('体系覆盖的产品', '与现场一致', 'qmsProducts', sv.products, '如 精密冲压件、焊接总成') +
            rowT('主导产品生产过程', '按顺序写主要工序', 'qmsProcessFlow', sv.processFlow, '如来料检验 → 冲压 → 焊接 → 装配 → 检验 → 入库'))}
          ${card('六、公司简介', '',
            rowT('地理位置与交通', '', 'qmsGeo', sv.geo, '如 位于 XX 市 XX 区，距高速出口 5 公里') +
            `<div class="grid g2" style="gap:0 14px;">
              ${row2('占地面积', '㎡', 'qmsArea', sv.area)}
              ${row2('建筑面积', '㎡', 'qmsBuilding', sv.building)}
              ${row2('正式员工', '人', 'qmsStaff', sv.staff)}
              ${row2('管理技术人员', '人', 'qmsTechStaff', sv.techStaff)}
            </div>` +
            rowT('设备情况', '', 'qmsEquipment', sv.equipment, '如 冲床 8 台、焊机 6 台、三坐标 1 台') +
            rowT('主要客户', '', 'qmsCustomers', sv.customers, '如 甲汽车零部件、乙电器') +
            row2('公司地址', '', 'qmsAddr', sv.addr) +
            row2('联系人 / 手机', '', 'qmsContactPerson', sv.contactPerson) +
            row2('电话 / 传真', '', 'qmsTel', sv.tel))}
          ${card('七、质量方针与目标', '生成手册时直接引用',
            rowT('公司宗旨', '', 'qmsMission', sv.mission, '如 以质量求生存，以改进求发展') +
            rowT('质量方针', '', 'qmsPolicy', sv.policy, '如 全员参与、过程受控、持续改进、顾客满意') +
            rowT('质量目标', '', 'qmsObjective', sv.objective, '如 一次合格率≥99%、顾客投诉≤2 起/年'))}
          ${card('八、认证计划', '',
            row2('计划取证日期', '', 'qmsCertDate', sv.certDate, '如 2027-06') +
            row2('第一阶段开始', '选填', 'qmsPhase1Date', sv.phase1Date, '如 2026-12') +
            row2('周六周日', '', 'qmsWeekend', sv.weekend || '周六周日都休息', '', { type: 'select', options: ['周六周日都休息', '仅周日休息', '都不休息', '大小周休息'] }) +
            row2('有无设计开发', '', 'qmsDesign', sv.design || '无', '', { type: 'select', options: ['无', '有'] }))}
          ${card('九、填写人', '',
            row2('姓名', '必填', 'qmsContactName', sv.contactName) +
            row2('手机', '必填', 'qmsContactPhone', sv.contactPhone))}
        </div>
      </div>
      <div class="act-bar">
        ${act('💾 暂存草稿', 'qmsDraft', {}, 'btn')}
        ${act('✓ 填写完毕，去生成手册', 'qmsComplete', { go: 'qmsManual' }, 'btn btn-primary')}
        ${act('前往「一键生成程序文件」', 'goto', { page: 'qmsProc' }, 'btn')}
      </div>`;
    },
  };

  /* ---------------- 一键生成手册 ---------------- */
  Pages.qmsManual = {
    title: '一键生成手册', sub: '按调研信息生成企业质量手册（Markdown，可下载）',
    async render() {
      let s = { survey: null, completion: 0 }, d = { rows: [] };
      try { s = await API.get('/qip/api/qms/survey'); } catch (e) { /* 旧后端 */ }
      try { d = await API.get('/qip/api/qms/docs?type=manual'); } catch (e) { /* 旧后端 */ }
      const sv = s.survey || null;
      const ready = !!(sv && sv.company);
      return `
      <div class="ai-strip">
        <div class="ai-ico">📕</div>
        <div class="ai-txt"><b>一键生成质量手册：</b>按调研表里的公司信息、组织机构、方针目标与认证类型，生成含「发布令、公司简介、方针目标、第 1~10 章、附录（术语 / 过程清单 / 文件清单）」的 Markdown 手册；接了模型由模型写，没接模型用内置模板生成骨架。</div>
        ${act(ready ? '一键生成手册' : '先填写调研', ready ? 'qmsGen' : 'goto', ready ? { type: 'manual' } : { page: 'qmsSurvey' }, 'btn btn-ai')}
      </div>
      ${ready ? '' : '<div class="dm-note" style="margin-bottom:12px;">还没有调研信息：请先到「填写体系调研」填写公司名称等基本信息。</div>'}
      <div class="grid g2-1">
        <div>${summaryCard(sv)}</div>
        <div>${card('手册包含的章节', '生成后可在下方查看与下载',
          `<ul class="qms-list">
            <li>发布令 · 公司简介</li>
            <li>质量方针与质量目标</li>
            <li>1 范围 / 2 引用文件 / 3 术语</li>
            <li>4 组织环境 / 5 领导作用 / 6 策划</li>
            <li>7 支持 / 8 运行 / 9 绩效评价 / 10 改进</li>
            <li>附录 A 术语 · B 过程清单 · C 文件清单</li>
          </ul>`)}</div>
      </div>
      ${docsCard('manual', d.rows || [])}`;
    },
  };

  /* ---------------- 一键生成程序文件 ---------------- */
  Pages.qmsProc = {
    title: '一键生成程序文件', sub: '按调研信息生成 10 个程序文件（Markdown，可逐个下载或打包）',
    async render() {
      let s = { survey: null, completion: 0 }, d = { rows: [] };
      try { s = await API.get('/qip/api/qms/survey'); } catch (e) { /* 旧后端 */ }
      try { d = await API.get('/qip/api/qms/docs?type=procedure'); } catch (e) { /* 旧后端 */ }
      const sv = s.survey || null;
      const ready = !!(sv && sv.company);
      const planned = ['文件控制程序', '记录控制程序', '管理评审程序', '内部审核程序', '不合格品控制程序',
        '纠正措施程序', '采购与供应商控制程序', '生产与服务提供控制程序', '监视和测量资源控制程序', '人力资源与培训控制程序'];
      return `
      <div class="ai-strip">
        <div class="ai-ico">📗</div>
        <div class="ai-txt"><b>一键生成程序文件：</b>生成中小型制造企业最常备的 10 个二级程序文件，每个含「编号、目的、适用范围、职责、工作流程、相关记录、相关文件」，可直接下载成 .md 后转 Word 使用。</div>
        ${act(ready ? '一键生成程序文件' : '先填写调研', ready ? 'qmsGen' : 'goto', ready ? { type: 'procedure' } : { page: 'qmsSurvey' }, 'btn btn-ai')}
      </div>
      ${ready ? '' : '<div class="dm-note" style="margin-bottom:12px;">还没有调研信息：请先到「填写体系调研」填写公司名称等基本信息。</div>'}
      <div class="grid g2-1">
        <div>${summaryCard(sv)}</div>
        <div>${card('将生成的 10 个程序文件', '编号 QP-01 ~ QP-10',
          `<ol class="qms-list">${planned.map((p) => '<li>' + p + '</li>').join('')}</ol>`)}</div>
      </div>
      ${docsCard('procedure', d.rows || [])}`;
    },
  };
})(window);
