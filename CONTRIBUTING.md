# 参与贡献（CONTRIBUTING）

感谢你愿意让这个开源质量平台更好用。下面是最短的上手路径。

## 1. 本地跑起来

本插件没有构建步骤：原生 ESM + 浏览器原生 JS，改完刷新页面（`Ctrl+Shift+R`）即生效。

```bash
# 语法自检（改动后随手跑，CI 也会跑）
node --check host.cjs
for f in public/app.js public/js/*.js src/lib/*.js src/tools/*.js; do node --check "$f"; done

# 不需要 Harness 的引擎自检（会临时建库、跑统计与导出）
node 自检.cjs
```

安装到 Harness 的方式见 `安装说明.md`；开发期可以用 `plugin_manager set_bundle` 开关插件来验证加载。

## 2. 提 Issue

请写清三件事：**哪个页面/接口**、**复现步骤**、**期望结果**。
数据相关的 issue 请附上「车间/产品名称被改成了什么」（初始设置页截图即可），这类问题多数和口径迁移有关。

## 3. 提 Pull Request

- 一个 PR 只做一件事；重构与新功能不要混在一起。
- 提交前跑一遍上面的 `node --check`；改 UI 的请附截图。
- 不要提交 `node_modules/`、数据库文件（`*.db`、`*.db-wal`）、`reports/` 或任何真实企业数据。
- 新增页面请同时更新：`public/index.html` 的菜单项、`README.md` 的页面清单、必要时 `tool-wizards.js` 的工具清单。

## 4. 代码约定

| 位置 | 说明 |
| --- | --- |
| `host.cjs` | 宿主半：HTTP 路由（`route(method, regexp, handler)`）、静态资源、SQLite 读写 |
| `client.js` | Harness 左侧栏入口与 iframe 挂载 |
| `public/` | 插件页面：`app.js` 壳与动作、`js/pages-*.js` 各页、`js/ui.js` 组件、`app.css` 样式 |
| `src/tools/` | 交给智能体的工具（`define({name, description, input, run})`，重名会被注册中心拦） |
| `src/lib/` | 业务能力：`store`（内存态 + SQLite 落盘）、`stats`、`office`、`qms`（体系文件模板） |
| `src/data/` | 两套初始数据：`seed.js`（大中型）、`seed-sme.js`（中小型） |

约定：文案用中文、不要出现具体车企/品牌等第三方名称；数据口径（公司/部门/车间/产品）一律走「初始设置」，不要在代码里写死。

## 5. 许可

提交即表示你同意以 [MIT](LICENSE.md) 许可发布你的贡献。
