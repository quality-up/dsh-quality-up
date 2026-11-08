/**
 * 质量平台插件 —— Host 半
 * ------------------------------------------------------------------
 * 这一半跑在 DSH 主进程里，是三件真事：
 *   ① 真数据：所有业务数据写入 SQLite（<DSH_HOME>/qip-platform/data/qip.db），
 *      统计、控制图、Cpk、判异、GR&R 全部由内置统计引擎实算；
 *   ② 真模型：对话走 ctx.llm（DeepSeek Harness 当前模型，真实 DeepSeek），
 *      并把 51 个真实工具里的 16 个注册给 Harness 智能体；
 *   ③ 真文件：Word/.docx、Excel/.xlsx 由 OOXML 引擎写出到
 *      <DSH_HOME>/qip-platform/data/reports/ 并可下载。
 *
 * 浏览器半（client.js）把 /qip/ 这个完整应用整页挂在主面板里；
 * 应用自己的 REST/SSE 全部由这里在 /qip/api/* 提供。
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export const name = 'qip-platform-real'
export const inject = ['webServer', 'tools']

const BASE = '/qip'

const host = require('./host.cjs')
const agentHost = require('./agent-host.cjs')
const { createBridge } = require('./llm-bridge.cjs')
const { buildTools } = require('./tools-dsh.cjs')

export function apply(ctx) {
  const bridge = createBridge(ctx)
  const refreshModel = () => {
    const model = bridge.selection()
    host.setRuntime({ llm: bridge, model })
    agentHost.setRuntime({ llm: bridge, model })
    return model
  }
  const model = refreshModel()
  console.log('[dsh-quality-up] 模型：' + (model ? model.provider + ' / ' + model.model : '尚未就绪（会在首次请求时再探测）'))

  // 数据层初始化（建库 / 首次灌入初始数据 / 建报告目录）；失败不拖垮宿主启动
  const ready = host
    .init()
    .then(() => {
      refreshModel()
      return true
    })
    .catch((err) => {
      console.error('[dsh-quality-up] 初始化失败：', err)
      return false
    })

  // 模型可能在插件加载后才就绪：最近一次请求时刷新，保证展示的是当前真实模型
  const guard = (handler) => (req, res) => {
    refreshModel()
    ready.then(() => handler(req, res))
  }

  // 真实工具 → 交给 Harness 智能体（对话里可直接查数/算 SPC/出报告）
  for (const def of buildTools()) {
    try {
      ctx.tools.register(def)
    } catch (err) {
      console.error('[dsh-quality-up] 注册工具失败 ' + def.name + '：' + err.message)
    }
  }

  // 整页应用 + REST + SSE，全部挂在 /qip 前缀下
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: BASE,
      handler: guard((req, res) => {
        const url = new URL(req.url || '/', 'http://x')
        let rest = url.pathname.slice(BASE.length)
        if (!rest) rest = '/'
        req.url = rest + (url.search || '')
        host.handle(req, res)
      }),
    }),
  )
}


