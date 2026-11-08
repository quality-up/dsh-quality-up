/* ==================================================================
   UI 基础库：DOM 生成、Markdown 渲染、SVG 图表、Toast、弹窗
   ================================================================== */
(function (global) {
  'use strict';

  /* ---------------- 基础工具 ---------------- */
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function attr(obj) {
    return Object.keys(obj || {}).filter((k) => obj[k] !== undefined && obj[k] !== null && obj[k] !== false)
      .map((k) => k + '="' + esc(obj[k]) + '"').join(' ');
  }
  /** 声明式操作按钮：data-act + data-args(JSON) */
  function act(label, action, args, cls) {
    return '<span class="' + (cls || 'btn') + '" data-act="' + esc(action) + '" data-args=\'' + esc(JSON.stringify(args || {})) + '\'>' + label + '</span>';
  }
  function tag(text, color) { return '<span class="tag tag-' + (color || 'blue') + '">' + esc(text) + '</span>'; }
  function sevTag(s) { return tag(s || '—', s === 'A' ? 'red' : s === 'B' ? 'orange' : 'gray'); }
  function statusTag(s) {
    const m = { '已关闭': 'green', '整改中': 'blue', '监控中': 'gray', 'QRQC 跟踪': 'orange' };
    return tag(s || '—', m[s] || 'blue');
  }
  function num(n, d) { return (n === null || n === undefined || n === '' || isNaN(n)) ? '—' : Number(n).toFixed(d === undefined ? 2 : d); }
  function pct(n, d) { return (n === null || n === undefined || isNaN(n)) ? '—' : Number(n).toFixed(d === undefined ? 1 : d) + '%'; }
  function dt(s) { return s ? String(s).slice(0, 16).replace('T', ' ') : '—'; }
  function day(s) { return s ? String(s).slice(0, 10) : '—'; }
  function bar(p, color) {
    const w = Math.max(0, Math.min(100, Number(p) || 0));
    return '<div class="bar-track"><div class="bar-fill" style="width:' + w + '%;background:' + (color || '#1a56db') + ';"></div></div>';
  }
  function card(title, sub, body, extra) {
    return '<div class="card"><div class="card-hd"><span class="t">' + esc(title) + '</span>' +
      (sub ? '<span class="s">' + sub + '</span>' : '') + (extra ? '<span class="more">' + extra + '</span>' : '') +
      '</div>' + body + '</div>';
  }
  function kpi(o) {
    return '<div class="kpi"' + (o.act ? ' data-act="' + esc(o.act) + '" data-args=\'' + esc(JSON.stringify(o.args || {})) + '\'' : '') + '>' +
      (o.ico ? '<div class="k-ico" style="background:' + (o.icoBg || '#e4edff') + ';">' + o.ico + '</div>' : '') +
      '<div class="k-label">' + esc(o.label) + '</div>' +
      '<div class="k-value" style="color:' + (o.color || '#0b3ea8') + ';">' + (o.value === undefined ? '—' : o.value) + '</div>' +
      '<div class="k-delta" style="' + (o.deltaColor ? 'color:' + o.deltaColor : '') + '">' + (o.delta || '') + '</div></div>';
  }
  function table(headers, rows, opts) {
    opts = opts || {};
    let h = '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + headers.map((x) => '<th>' + (x.html || esc(x)) + '</th>').join('') + '</tr></thead><tbody>';
    if (!rows || !rows.length) h += '<tr><td colspan="' + headers.length + '"><div class="empty"><span class="e-ico">📭</span>' + esc(opts.empty || '暂无数据') + '</div></td></tr>';
    else rows.forEach((r) => {
      const rowAttr = r.__act ? ' class="rowlink" data-act="' + esc(r.__act) + '" data-args=\'' + esc(JSON.stringify(r.__args || {})) + '\'' : '';
      h += '<tr' + rowAttr + '>' + (r.cells || r).map((c) => '<td>' + (c === undefined || c === null ? '—' : c) + '</td>').join('') + '</tr>';
    });
    return h + '</tbody></table></div>';
  }
  function empty(text, ico) { return '<div class="empty"><span class="e-ico">' + (ico || '📭') + '</span>' + esc(text || '暂无数据') + '</div>'; }
  function loadingBlock(text) { return '<div class="empty"><span class="spin"></span>　' + esc(text || '加载中…') + '</div>'; }
  function infoGrid(items, cls) {
    return '<div class="info-grid' + (cls ? ' ' + cls : '') + '">' + items.map(([l, v, span]) =>
      '<div class="info-item"' + (span ? ' style="grid-column:1/-1"' : '') + '><div class="lbl">' + esc(l) + '</div><div class="val">' + (v === undefined || v === null || v === '' ? '—' : v) + '</div></div>').join('') + '</div>';
  }

  /* ---------------- Toast ---------------- */
  function toast(msg, type, ms) {
    let wrap = document.getElementById('toastWrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toastWrap'; document.body.appendChild(wrap); }
    const el = document.createElement('div');
    el.className = 'toast-item ' + (type || '');
    const ico = { ok: '✅', ai: '🤖', warn: '⚠️', err: '❌' }[type] || 'ℹ️';
    el.innerHTML = '<span>' + ico + '</span><span>' + esc(msg) + '</span>';
    wrap.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms || (type === 'err' ? 7000 : 3600));
  }

  /* ---------------- 弹窗 ---------------- */
  let curModal = null;
  function modal(o) {
    closeModal();
    const div = document.createElement('div');
    div.className = 'dm-overlay show';
    div.innerHTML = '<div class="dm-panel ' + (o.width || '') + '">' +
      '<div class="dm-head"><div><div class="dm-t">' + (o.title || '') + '</div>' + (o.sub ? '<div class="dm-s">' + o.sub + '</div>' : '') + '</div><div class="dm-close" data-act="__closeModal">✕</div></div>' +
      '<div class="dm-body">' + (o.body || '') + '</div>' +
      (o.footer ? '<div class="dm-footer">' + o.footer + '</div>' : '') + '</div>';
    div.addEventListener('click', (e) => { if (e.target === div) closeModal(); });
    document.body.appendChild(div);
    curModal = div;
    if (o.onMount) o.onMount(div);
    return div;
  }
  function closeModal() { if (curModal) { curModal.remove(); curModal = null; } }

  /* ---------------- Markdown 渲染（够用且安全） ---------------- */
  function md(text) {
    if (!text) return '';
    let s = String(text);
    const codeBlocks = [];
    s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
      codeBlocks.push('<pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>');
      return '\u0000CB' + (codeBlocks.length - 1) + '\u0000';
    });
    s = esc(s);
    // 表格
    s = s.replace(/(?:^\|.+\|\s*$\n?){2,}/gm, (block) => {
      const lines = block.trim().split('\n').filter(Boolean);
      if (lines.length < 2 || !/^\|[\s:|-]+\|$/.test(lines[1].trim())) return block;
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(lines[0]);
      const body = lines.slice(2).map(cells);
      return '<table><thead><tr>' + head.map((c) => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + r.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>\n';
    });
    s = s.replace(/^######\s+(.+)$/gm, '<h3>$1</h3>').replace(/^#{4,5}\s+(.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>').replace(/^##\s+(.+)$/gm, '<h2>$1</h2>').replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
    s = s.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
    s = s.replace(/^[\-\*]\s+(.+)$/gm, '<li>$1</li>').replace(/^(\d+)[.、]\s+(.+)$/gm, '<li>$2</li>');
    s = s.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, (m) => '<ul>' + m + '</ul>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/^---+$/gm, '<hr>');
    s = s.split(/\n{2,}/).map((p) => {
      const t = p.trim();
      if (!t) return '';
      if (/^<(h1|h2|h3|ul|ol|table|pre|blockquote|hr)/.test(t) || /^\u0000CB\d+\u0000$/.test(t)) return t;
      return '<p>' + t.replace(/\n/g, '<br>') + '</p>';
    }).join('');
    s = s.replace(/\u0000CB(\d+)\u0000/g, (m, i) => codeBlocks[Number(i)]);
    return s;
  }

  /* ---------------- SVG 图表 ---------------- */
  /** 折线图（可多序列、双 Y 轴） */
  function lineChart(o) {
    const W = o.width || 560, H = o.height || 200, pad = { l: 46, r: o.rightAxis ? 46 : 16, t: 16, b: 28 };
    const series = (o.series || []).filter((s) => s.values && s.values.length);
    if (!series.length) return empty('暂无趋势数据');
    const all = series.filter((s) => !s.right).flatMap((s) => s.values);
    const allR = series.filter((s) => s.right).flatMap((s) => s.values);
    const labels = o.labels || series[0].values.map((_, i) => String(i + 1));
    let min = o.min !== undefined ? o.min : Math.min.apply(null, all.length ? all : [0]);
    let max = o.max !== undefined ? o.max : Math.max.apply(null, all.length ? all : [1]);
    if (min === max) { min -= 1; max += 1; }
    const padY = (max - min) * 0.12; min -= padY; max += padY;
    let rmin = allR.length ? Math.min.apply(null, allR) : 0, rmax = allR.length ? Math.max.apply(null, allR) : 1;
    if (rmin === rmax) { rmin -= 1; rmax += 1; }
    const rp = (rmax - rmin) * 0.12; rmin -= rp; rmax += rp;
    const px = (i) => pad.l + (W - pad.l - pad.r) * (labels.length <= 1 ? 0.5 : i / (labels.length - 1));
    const py = (v) => H - pad.b - (H - pad.t - pad.b) * ((v - min) / (max - min));
    const pry = (v) => H - pad.b - (H - pad.t - pad.b) * ((v - rmin) / (rmax - rmin));
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (H - pad.t - pad.b) * i / 4;
      const v = max - (max - min) * i / 4;
      g += '<line x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y.toFixed(1) + '" stroke="#eef1f6"/>' +
        '<text x="' + (pad.l - 6) + '" y="' + (y + 3.5).toFixed(1) + '" font-size="9" fill="#8791a5" text-anchor="end">' + v.toFixed(o.yDigits === undefined ? 1 : o.yDigits) + '</text>';
      if (o.rightAxis && allR.length) g += '<text x="' + (W - pad.r + 6) + '" y="' + (y + 3.5).toFixed(1) + '" font-size="9" fill="#18a058">' + (rmax - (rmax - rmin) * i / 4).toFixed(o.rDigits === undefined ? 2 : o.rDigits) + '</text>';
    }
    series.forEach((s) => {
      const pts = s.values.map((v, i) => px(i).toFixed(1) + ',' + (s.right ? pry(v) : py(v)).toFixed(1)).join(' ');
      g += '<polyline points="' + pts + '" fill="none" stroke="' + (s.color || '#1a56db') + '" stroke-width="' + (s.width || 2) + '"' + (s.dash ? ' stroke-dasharray="' + s.dash + '"' : '') + '/>';
      if (s.dots !== false) s.values.forEach((v, i) => { g += '<circle cx="' + px(i).toFixed(1) + '" cy="' + (s.right ? pry(v) : py(v)).toFixed(1) + '" r="2.6" fill="' + (s.color || '#1a56db') + '"/>'; });
    });
    // X 轴标签（抽样显示，避免重叠）
    const step = Math.max(1, Math.ceil(labels.length / 8));
    labels.forEach((l, i) => { if (i % step === 0 || i === labels.length - 1) g += '<text x="' + px(i).toFixed(1) + '" y="' + (H - 8) + '" font-size="9" fill="#8791a5" text-anchor="middle">' + esc(String(l).length > 10 ? String(l).slice(5) : l) + '</text>'; });
    return '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '">' + g + '</svg>';
  }

  /** 控制图：数据点 + UCL/CL/LCL + 规格限 + 判异点高亮 */
  function controlChart(o) {
    const W = o.width || 640, H = o.height || 240, pad = { l: 52, r: 18, t: 18, b: 34 };
    const pts = o.points && o.points.length ? o.points : (o.values || []);
    const values = pts.map((p) => (typeof p === 'number' ? p : p.value));
    if (!values.length) return empty('暂无控制图数据');
    const lines = [o.ucl, o.cl, o.lcl].filter((x) => typeof x === 'number');
    const spec = [o.usl, o.lsl].filter((x) => typeof x === 'number');
    let min = Math.min.apply(null, values.concat(lines, spec.length ? spec : lines));
    let max = Math.max.apply(null, values.concat(lines, spec.length ? spec : lines));
    const pAdv = (max - min) * 0.1 || 1; min -= pAdv; max += pAdv;
    const px = (i) => pad.l + (W - pad.l - pad.r) * (values.length <= 1 ? 0.5 : i / (values.length - 1));
    const py = (v) => H - pad.b - (H - pad.t - pad.b) * ((v - min) / (max - min));
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (H - pad.t - pad.b) * i / 4, v = max - (max - min) * i / 4;
      g += '<line x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y.toFixed(1) + '" stroke="#eef1f6"/>' +
        '<text x="' + (pad.l - 6) + '" y="' + (y + 3.5).toFixed(1) + '" font-size="9" fill="#8791a5" text-anchor="end">' + v.toFixed(3) + '</text>';
    }
    function hline(v, color, dash, label) {
      if (typeof v !== 'number') return '';
      const y = py(v).toFixed(1);
      return '<line x1="' + pad.l + '" y1="' + y + '" x2="' + (W - pad.r) + '" y2="' + y + '" stroke="' + color + '" stroke-width="1.3"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>' +
        '<text x="' + (W - pad.r - 2) + '" y="' + (Number(y) - 3) + '" font-size="9" fill="' + color + '" text-anchor="end">' + label + '</text>';
    }
    g += hline(o.ucl, '#e5484d', '6 4', 'UCL ' + (o.ucl !== undefined ? Number(o.ucl).toFixed(3) : ''));
    g += hline(o.cl, '#18a058', '', 'CL ' + (o.cl !== undefined ? Number(o.cl).toFixed(3) : ''));
    g += hline(o.lcl, '#e5484d', '6 4', 'LCL ' + (o.lcl !== undefined ? Number(o.lcl).toFixed(3) : ''));
    if (typeof o.usl === 'number') g += hline(o.usl, '#c8620a', '2 3', 'USL ' + o.usl);
    if (typeof o.lsl === 'number') g += hline(o.lsl, '#c8620a', '2 3', 'LSL ' + o.lsl);
    const poly = values.map((v, i) => px(i).toFixed(1) + ',' + py(v).toFixed(1)).join(' ');
    g += '<polyline points="' + poly + '" fill="none" stroke="#1a56db" stroke-width="1.8"/>';
    values.forEach((v, i) => {
      const p = pts[i];
      const ooc = typeof p === 'object' ? p.outOfControl : (typeof o.ucl === 'number' && (v > o.ucl || v < o.lcl));
      g += '<circle cx="' + px(i).toFixed(1) + '" cy="' + py(v).toFixed(1) + '" r="' + (ooc ? 4.2 : 2.6) + '" fill="' + (ooc ? '#e5484d' : '#1a56db') + '"' + (ooc ? ' stroke="#fff" stroke-width="1.2"' : '') + '><title>' + (p && p.time ? p.time + '　' : '') + v + '</title></circle>';
    });
    const labels = o.labels || [];
    const step = Math.max(1, Math.ceil(values.length / 10));
    values.forEach((v, i) => { if (i % step === 0 || i === values.length - 1) g += '<text x="' + px(i).toFixed(1) + '" y="' + (H - 10) + '" font-size="8.5" fill="#8791a5" text-anchor="middle">' + (labels[i] !== undefined ? esc(String(labels[i]).slice(5, 10)) : (i + 1)) + '</text>'; });
    return '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '">' + g + '</svg>';
  }

  /** 帕累托图（柱 + 累计折线 + 80% 线） */
  function paretoChart(rows, o) {
    o = o || {};
    if (!rows || !rows.length) return empty('暂无数据');
    const W = 620, H = 250, pad = { l: 44, r: 46, t: 20, b: 46 };
    const max = Math.max.apply(null, rows.map((r) => r.value));
    const bw = (W - pad.l - pad.r) / rows.length;
    const py = (v) => H - pad.b - (H - pad.t - pad.b) * (v / max);
    const pyc = (p) => H - pad.b - (H - pad.t - pad.b) * (p / 100);
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (H - pad.t - pad.b) * i / 4;
      g += '<line x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y.toFixed(1) + '" stroke="#eef1f6"/>' +
        '<text x="' + (pad.l - 5) + '" y="' + (y + 3.5).toFixed(1) + '" font-size="9" fill="#8791a5" text-anchor="end">' + Math.round(max - max * i / 4) + '</text>' +
        '<text x="' + (W - pad.r + 5) + '" y="' + (y + 3.5).toFixed(1) + '" font-size="9" fill="#e5484d">' + Math.round(100 - 100 * i / 4) + '%</text>';
    }
    const colors = ['#1a56db', '#5a8bff', '#7a5af8', '#0a9e8f', '#95a3bd', '#c3cbd9'];
    rows.forEach((r, i) => {
      const x = pad.l + i * bw + bw * 0.15, w = bw * 0.7, y = py(r.value);
      g += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + (H - pad.b - y).toFixed(1) + '" rx="3" fill="' + colors[i % colors.length] + '"><title>' + esc(r.name) + '：' + r.value + '</title></rect>' +
        '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (y - 4).toFixed(1) + '" font-size="9.5" fill="' + colors[i % colors.length] + '" text-anchor="middle" font-weight="600">' + r.value + '</text>' +
        '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 30) + '" font-size="9" fill="#5e6b85" text-anchor="middle">' + esc(String(r.name).slice(0, 5)) + '</text>';
    });
    if (rows[0].cumPct !== undefined) {
      const pts = rows.map((r, i) => (pad.l + i * bw + bw / 2).toFixed(1) + ',' + pyc(r.cumPct).toFixed(1)).join(' ');
      g += '<polyline points="' + pts + '" fill="none" stroke="#e5484d" stroke-width="1.8"/>';
      rows.forEach((r, i) => { g += '<circle cx="' + (pad.l + i * bw + bw / 2).toFixed(1) + '" cy="' + pyc(r.cumPct).toFixed(1) + '" r="3" fill="#e5484d"><title>累计 ' + r.cumPct.toFixed(1) + '%</title></circle>'; });
      g += '<line x1="' + pad.l + '" y1="' + pyc(80).toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + pyc(80).toFixed(1) + '" stroke="#e5484d" stroke-dasharray="5 4"/>' +
        '<text x="' + (pad.l + 4) + '" y="' + (pyc(80) - 4).toFixed(1) + '" font-size="9" fill="#e5484d">80% 关键少数线</text>';
    }
    g += '<line x1="' + pad.l + '" y1="' + (H - pad.b) + '" x2="' + (W - pad.r) + '" y2="' + (H - pad.b) + '" stroke="#e4e8f0"/>';
    return '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '">' + g + '</svg>';
  }

  /** 直方图 + 规格限 */
  function histogramChart(bins, lsl, usl) {
    if (!bins || !bins.length) return empty('暂无分布数据');
    const W = 620, H = 210, pad = { l: 44, r: 18, t: 16, b: 34 };
    const max = Math.max.apply(null, bins.map((b) => b.count)) || 1;
    const lo = bins[0].from, hi = bins[bins.length - 1].to;
    const bw = (W - pad.l - pad.r) / bins.length;
    const px = (v) => pad.l + (W - pad.l - pad.r) * ((v - lo) / ((hi - lo) || 1));
    let g = '';
    for (let i = 0; i <= 3; i++) {
      const y = pad.t + (H - pad.t - pad.b) * i / 3;
      g += '<line x1="' + pad.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + y.toFixed(1) + '" stroke="#eef1f6"/><text x="' + (pad.l - 5) + '" y="' + (y + 3.5).toFixed(1) + '" font-size="9" fill="#8791a5" text-anchor="end">' + Math.round(max - max * i / 3) + '</text>';
    }
    bins.forEach((b, i) => {
      const h = (H - pad.t - pad.b) * (b.count / max);
      const x = pad.l + i * bw, y = H - pad.b - h;
      const out = (usl !== undefined && b.from >= usl) || (lsl !== undefined && b.to <= lsl);
      g += '<rect x="' + (x + 1).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw - 2).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + (out ? '#e5484d' : '#5a8bff') + '" rx="2"><title>' + b.from + ' ~ ' + b.to + '：' + b.count + ' 个</title></rect>';
    });
    if (lsl !== undefined) g += '<line x1="' + px(lsl).toFixed(1) + '" y1="' + pad.t + '" x2="' + px(lsl).toFixed(1) + '" y2="' + (H - pad.b) + '" stroke="#c8620a" stroke-dasharray="4 3"/><text x="' + (px(lsl) + 3).toFixed(1) + '" y="' + (pad.t + 10) + '" font-size="9" fill="#c8620a">LSL</text>';
    if (usl !== undefined) g += '<line x1="' + px(usl).toFixed(1) + '" y1="' + pad.t + '" x2="' + px(usl).toFixed(1) + '" y2="' + (H - pad.b) + '" stroke="#c8620a" stroke-dasharray="4 3"/><text x="' + (px(usl) - 24).toFixed(1) + '" y="' + (pad.t + 10) + '" font-size="9" fill="#c8620a">USL</text>';
    g += '<line x1="' + pad.l + '" y1="' + (H - pad.b) + '" x2="' + (W - pad.r) + '" y2="' + (H - pad.b) + '" stroke="#e4e8f0"/>';
    g += '<text x="' + pad.l + '" y="' + (H - 12) + '" font-size="9" fill="#8791a5">' + lo + '</text><text x="' + (W - pad.r) + '" y="' + (H - 12) + '" font-size="9" fill="#8791a5" text-anchor="end">' + hi + '</text>';
    return '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '">' + g + '</svg>';
  }

  /** 因果图（鱼骨图）：按【人机料法环测】六分支渲染 */
  function fishbone(o) {
    const W = 720, H = 300;
    const cats = o.categories || [];
    const spineY = H / 2;
    let g = '<line x1="40" y1="' + spineY + '" x2="600" y2="' + spineY + '" stroke="#33415c" stroke-width="2"/>' +
      '<polygon points="600,' + spineY + ' 586,' + (spineY - 8) + ' 586,' + (spineY + 8) + '" fill="#33415c"/>' +
      '<rect x="602" y="' + (spineY - 26) + '" width="108" height="52" rx="7" fill="#e5484d"/>' +
      '<text x="656" y="' + (spineY - 4) + '" font-size="11.5" fill="#fff" text-anchor="middle">' + esc(String(o.effect || '问题').slice(0, 10)) + '</text>' +
      '<text x="656" y="' + (spineY + 12) + '" font-size="9" fill="#fff" text-anchor="middle">' + esc(String(o.effectValue || '').slice(0, 14)) + '</text>';
    const top = cats.filter((_, i) => i % 2 === 0).slice(0, 3);
    const bottom = cats.filter((_, i) => i % 2 === 1).slice(0, 3);
    const xs = [120, 280, 440];
    function branch(cat, x, up) {
      const y = up ? 60 : H - 60;
      let s = '<line x1="' + x + '" y1="' + spineY + '" x2="' + (x + 24) + '" y2="' + y + '" stroke="#95a3bd"/>';
      s += '<rect x="' + (x - 46) + '" y="' + (up ? y - 22 : y + 4) + '" width="92" height="19" rx="5" fill="#e4edff"/>' +
        '<text x="' + x + '" y="' + (up ? y - 9 : y + 17) + '" font-size="10.5" fill="#1a56db" text-anchor="middle" font-weight="600">' + esc(cat.name || '') + '</text>';
      (cat.items || []).slice(0, 3).forEach((it, i) => {
        const iy = up ? y + 14 + i * 15 : y - 14 - i * 15;
        const p = it.p !== undefined ? ' P=' + it.p : '';
        s += '<text x="' + (x + 30) + '" y="' + iy + '" font-size="9.5" fill="' + (it.p >= 0.5 ? '#e5484d' : it.p >= 0.2 ? '#c8620a' : '#8791a5') + '">' + esc(String(it.text || it).slice(0, 22)) + p + '</text>';
      });
      return s;
    }
    top.forEach((c, i) => { g += branch(c, xs[i], true); });
    bottom.forEach((c, i) => { g += branch(c, xs[i], false); });
    return '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '">' + g + '</svg>';
  }

  /** 环形进度 */
  function ring(p, color, label) {
    const r = 26, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(100, p)) / 100);
    return '<svg width="66" height="66" viewBox="0 0 66 66"><circle cx="33" cy="33" r="' + r + '" fill="none" stroke="#eef1f6" stroke-width="7"/>' +
      '<circle cx="33" cy="33" r="' + r + '" fill="none" stroke="' + (color || '#1a56db') + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 33 33)"/>' +
      '<text x="33" y="37" font-size="13" font-weight="700" fill="' + (color || '#1a56db') + '" text-anchor="middle">' + Math.round(p) + '</text></svg>' + (label ? '<div style="font-size:10.5px;color:#8791a5;text-align:center;">' + esc(label) + '</div>' : '');
  }

  /* ---------------- 表单 ---------------- */
  function input(name, value, o) {
    o = o || {};
    if (o.type === 'select') {
      return '<select class="inp" data-field="' + esc(name) + '"' + (o.style ? ' style="' + o.style + '"' : '') + '>' +
        (o.options || []).map((op) => '<option value="' + esc(op.value !== undefined ? op.value : op) + '"' + (String(op.value !== undefined ? op.value : op) === String(value) ? ' selected' : '') + '>' + esc(op.label || op) + '</option>').join('') + '</select>';
    }
    if (o.type === 'textarea') return '<textarea class="inp" rows="' + (o.rows || 3) + '" data-field="' + esc(name) + '" placeholder="' + esc(o.placeholder || '') + '">' + esc(value || '') + '</textarea>';
    if (o.type === 'checkbox') return '<label class="switch"><input type="checkbox" data-field="' + esc(name) + '"' + (value ? ' checked' : '') + '/> ' + esc(o.label || '') + '</label>';
    return '<input class="inp' + (o.small ? ' inp-sm' : '') + '" type="' + (o.type || 'text') + '" data-field="' + esc(name) + '" value="' + esc(value === undefined ? '' : value) + '" placeholder="' + esc(o.placeholder || '') + '"' + (o.style ? ' style="' + o.style + '"' : '') + '/>';
  }
  function readForm(scope) {
    const out = {};
    scope.querySelectorAll('[data-field]').forEach((el) => {
      out[el.getAttribute('data-field')] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value);
    });
    return out;
  }

  /* ---------------- 平台显示名 ---------------- */
  /** 初始设置里填了公司名称就用公司名称，否则用「质上开源质量平台」 */
  function brand() {
    const b = (global.State && global.State.bootstrap) || {};
    const v = typeof b.brand === 'string' && b.brand.trim();
    return v || '质上开源质量平台';
  }

  global.UI = {
    esc, attr, act, tag, sevTag, statusTag, num, pct, dt, day, bar, card, kpi, table, empty, loadingBlock, infoGrid,
    toast, modal, closeModal, md, lineChart, controlChart, paretoChart, histogramChart, fishbone, ring, input, readForm, brand,
  };
})(window);
