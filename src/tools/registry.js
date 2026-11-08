'use strict';
/**
 * 工具注册中心
 * ------------------------------------------------------------------
 * 每个工具 = 一个真实可执行的能力，声明：
 *   plugin   归属插件（@MES / @SPC / … / 知识库 / 本平台），用于调用链可视化
 *   name     函数名（暴露给模型的 function name，唯一）
 *   label    中文名
 *   description 给模型看的说明（写清楚什么时候用、返回什么）
 *   parameters JSON Schema
 *   confirm  是否需要人工确认后才执行（对外承诺类动作）
 *   write    是否为写操作（审计日志中标记）
 *   run(args, ctx) => any
 */
const registry = new Map();

function define(def) {
  if (!def.name) throw new Error('工具必须有 name');
  // 同一个工具被再次注册（插件热重载 / 模块被两条路径各加载一次）时不再抛错：
  // 以「后注册的实现为准」覆盖，并只提示一次，避免整包 import 失败。
  if (registry.has(def.name)) {
    if (!define._warned.has(def.name)) {
      define._warned.add(def.name);
      console.warn('[dsh-quality-up] 工具重复注册，已用新实现覆盖：' + def.name);
    }
    registry.delete(def.name);
  }
  registry.set(def.name, Object.assign({ plugin: '本平台', write: false, confirm: false }, def));
  return def;
}
define._warned = new Set();

function all() { return [...registry.values()]; }
function get(name) { return registry.get(name) || null; }

/** 转成 OpenAI tools 参数（按开关过滤插件） */
function schemas(pluginFilter, confirmActions) {
  return all()
    .filter((t) => !pluginFilter || pluginFilter(t))
    .map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters || { type: 'object', properties: {}, required: [] },
      },
    }));
}

/** 判断某工具是否需要人工确认 */
function needsConfirm(name, confirmList) {
  const t = get(name);
  if (!t) return false;
  return !!t.confirm || (Array.isArray(confirmList) && confirmList.indexOf(name) >= 0);
}

module.exports = { define, all, get, schemas, needsConfirm, registry };
