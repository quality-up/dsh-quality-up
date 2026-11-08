/**
 * 自检脚本（不需要 DeepSeek Harness，也不需要联网）
 * ------------------------------------------------------------------
 * 用法： node 自检.cjs
 * 做四件事：① 校验包内文件与 package.json；② 校验 Node 版本与 node:sqlite 可用；
 *          ③ 在临时目录建库 → 灌初始数据 → 调统计工具算一个 Cpk；④ 打印结论。
 * 任何一项失败都会以退出码 1 结束，方便做成安装后的第一道检查。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HERE = __dirname;
let failed = 0;
function ok(label, detail) { console.log('  ✓ ' + label + (detail ? '：' + detail : '')); }
function bad(label, detail) { failed += 1; console.log('  ✗ ' + label + (detail ? '：' + detail : '')); }

console.log('\n== 质上开源质量平台 · 插件自检 ==\n');

// ① 包与文件
console.log('[1/4] 包文件');
let pkg = null;
try {
  pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));
  ok('package.json 可解析', pkg.name + ' ' + pkg.version + '（' + pkg.license + '）');
} catch (e) {
  bad('package.json 解析失败', e.message + '（常见原因：文件被编辑器加了 BOM）');
}
const must = ['index.js', 'client.js', 'host.cjs', 'agent-host.cjs', 'llm-bridge.cjs', 'db.cjs', 'tools-dsh.cjs',
  'cordis.patch.yml', 'LICENSE.md', 'README.md', '安装说明.md', 'public/index.html', 'public/app.js', 'src/lib/store.js'];
must.forEach((f) => { if (fs.existsSync(path.join(HERE, f))) ok(f); else bad('缺少文件', f); });
if (pkg && pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch) ok('bundle 声明', pkg.dsh.bundle.patch + ' / client=' + (pkg.dsh.client && pkg.dsh.client.platform));

// ② 运行时
console.log('\n[2/4] 运行时');
const major = Number(process.versions.node.split('.')[0]);
if (major >= 22) ok('Node 版本', process.version); else bad('Node 版本过低', process.version + '（需要 22.x 或 24.x）');
let sqliteOk = false;
try { require('node:sqlite'); sqliteOk = true; ok('node:sqlite 可用（无需另装数据库）'); }
catch (e) { bad('node:sqlite 不可用', e.message); }

// ③ 建库 + 统计引擎
console.log('\n[3/4] 建库与统计引擎（临时目录，不影响你的正式数据）');
(async () => {
  const tmp = path.join(os.tmpdir(), 'qip-selftest-' + Date.now());
  process.env.QIP_DATA_DIR = tmp;
  try {
    const host = require(path.join(HERE, 'host.cjs'));
    await host.init();
    const counts = (host.countAll && host.countAll()) || {};
    const total = Object.keys(counts).reduce((n, k) => n + Number(counts[k] || 0), 0);
    ok('建库成功', '数据目录 ' + tmp + '，集合 ' + Object.keys(counts).length + ' 个，记录约 ' + total + ' 条');
    const { buildTools } = require(path.join(HERE, 'tools-dsh.cjs'));
    const tools = buildTools();
    const names = tools.map((t) => t.name);
    const prefixed = names.filter((n) => /^qip_/.test(n)).length;
    if (names.length === prefixed && names.length > 0) ok('交给智能体的工具', names.length + ' 个，全部 qip_ 前缀');
    else bad('工具有命名异常', '总数 ' + names.length + '，qip_ 前缀 ' + prefixed);
    const cap = tools.find((t) => t.name === 'qip_spc_capability');
    if (cap) {
      const r = await cap.execute({ charId: 'CT-0378', days: 30 }, { outputDir: host.OUTPUT_DIR });
      const cpk = r && r.能力指数 ? r.能力指数.Cpk : (r && r.Cpk);
      if (r && r.ok !== false && cpk !== undefined) ok('统计引擎实算 Cpk(CT-0378)', cpk + '（样本 ' + r.样本量 + '，判定：' + r.判定 + '）');
      else bad('统计引擎返回异常', JSON.stringify(r).slice(0, 140));
    } else bad('找不到 qip_spc_capability 工具');
  } catch (e) {
    bad('初始化失败', e && e.message ? e.message : String(e));
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }

  // ④ 结论
  console.log('\n[4/4] 结论');
  if (failed === 0) {
    console.log('  ✅ 全部通过。下一步：重开 DeepSeek Harness → 左侧栏点图标 → 系统设置里点「测试连通性」。\n');
  } else {
    console.log('  ❌ 有 ' + failed + ' 项未通过，请把上面的 ✗ 行原文发给 DSH 助手排查。\n');
  }
  process.exit(failed === 0 ? 0 : 1);
})();
