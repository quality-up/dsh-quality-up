'use strict';
/**
 * 数据持久层（零依赖）
 * ------------------------------------------------------------------
 * 单文件 JSON 库，原子写入（临时文件 + rename），支持集合级操作、
 * 人类可读的业务编号自增（QI-2026-0412 / QP-0377 / 8D 等）、
 * 变更订阅（供前端 SSE 推送实时刷新）。
 *
 * 用法：
 *   const store = require('./lib/store');
 *   await store.init('./data');
 *   store.col('issues').insert({...});
 */
const fs = require('fs');
const path = require('path');

/** 业务编号规则：集合 -> {prefix, key, width}
 *  注意：质量问题/改进项目/知识条目在业务上习惯写作 #QI-2026-0412、#QP-0377、#C-0231，
 *  这里把 '#' 作为编号的一部分统一存储，避免"新建的没有 #、初始数据有 #"的不一致。 */
const ID_RULES = {
  issues: { prefix: '#QI-', year: true, width: 4, counter: 'issue' },
  projects: { prefix: '#QP-', width: 4, counter: 'project' },
  qrqc: { prefix: 'QR-', year: true, width: 4, counter: 'qrqc' },
  workflows: { prefix: 'OA-', year: true, width: 5, counter: 'workflow' },
  todos: { prefix: 'TD-', width: 5, counter: 'todo' },
  benefits: { prefix: 'BN-', year: true, width: 4, counter: 'benefit' },
  reports: { prefix: 'RP-', year: true, width: 4, counter: 'report' },
  knowledge: { prefix: '#C-', width: 4, counter: 'knowledge' },
  chats: { prefix: 'CH-', width: 5, counter: 'chat' },
  audit: { prefix: 'AU-', width: 7, counter: 'audit' },
  measurements: { prefix: 'MS-', width: 8, counter: 'measurement' },
  spcChars: { prefix: 'CT-', width: 4, counter: 'spcChar' },
  members: { prefix: 'U-', width: 3, counter: 'member' },
  defects: { prefix: 'AQ-', width: 6, counter: 'defect' },
};

const DEFAULT_DB = {
  meta: { name: '质量平台', version: '2.0', createdAt: null, updatedAt: null },
  counters: {},
  settings: {},
  issues: [],
  projects: [],
  qrqc: [],
  workflows: [],
  todos: [],
  benefits: [],
  reports: [],
  knowledge: [],
  chats: [],
  audit: [],
  measurements: [],
  spcChars: [],
  members: [],
  defects: [],
  pendingActions: [],
};

class Store {
  constructor() {
    this.db = JSON.parse(JSON.stringify(DEFAULT_DB));
    this.file = null;
    this._dirty = false;
    this._timer = null;
    this._listeners = new Set();
  }

  async init(dataDir, opts) {
    fs.mkdirSync(dataDir, { recursive: true });
    const scale = (opts && opts.scale) === 'sme' ? 'sme' : 'large';
    this.scale = scale;
    const suffix = scale === 'sme' ? '-sme' : '';
    this.dir = dataDir;
    this.file = path.join(dataDir, 'qip-db' + suffix + '.json');
    // 切版式时重新装载：先回到空状态，避免上一套数据残留
    this.db = JSON.parse(JSON.stringify(DEFAULT_DB));
    // SQLite 作为权威存储；不可用时（旧 Node）自动退回 JSON。
    try {
      this.persist = require('../../db.cjs').open(path.join(dataDir, 'qip' + suffix + '.db'));
    } catch (err) {
      this.persist = null;
      console.error('[store] SQLite 不可用，退回 JSON 存储：' + (err && err.message));
    }
    const persisted = this.persist ? this.persist.load() : null;
    if (persisted) {
      this.db = Object.assign(JSON.parse(JSON.stringify(DEFAULT_DB)), persisted);
    } else if (fs.existsSync(this.file)) {
      try {
        const raw = fs.readFileSync(this.file, 'utf8');
        const parsed = JSON.parse(raw);
        this.db = Object.assign(JSON.parse(JSON.stringify(DEFAULT_DB)), parsed);
      } catch (e) {
        // 数据损坏：备份后重建，避免整个平台不可用
        const bak = this.file + '.corrupt-' + Date.now();
        try { fs.copyFileSync(this.file, bak); } catch (_) {}
        console.error('[store] 数据文件损坏，已备份到 ' + bak + '，将重建：' + e.message);
        this.db = JSON.parse(JSON.stringify(DEFAULT_DB));
      }
    }
    if (!this.db.meta.createdAt) this.db.meta.createdAt = new Date().toISOString();
    return this;
  }

  /** 是否已有业务数据（用于首启动时灌入初始数据） */
  isEmpty() {
    return (this.db.issues || []).length === 0 && (this.db.knowledge || []).length === 0;
  }

  // ---------------- 基础读写 ----------------
  col(name) {
    if (!this.db[name]) this.db[name] = [];
    const self = this;
    return {
      all: () => self.db[name],
      get: (id) => self.resolve(name, id),
      find: (fn) => self.db[name].filter(fn),
      one: (fn) => self.db[name].find(fn) || null,
      insert: (doc) => self.insert(name, doc),
      insertMany: (docs) => docs.map((d) => self.insert(name, d, true)) && (self.touch(), docs),
      update: (id, patch) => self.update(name, id, patch),
      remove: (id) => self.remove(name, id),
      count: () => self.db[name].length,
      name,
    };
  }

  /** 宽松解析编号：'#QP-0377' 与 'QP-0377' 视为同一条，避免智能体传入的编号形式影响查找 */
  resolve(collection, id) {
    const arr = this.db[collection] || [];
    if (id === undefined || id === null) return null;
    const s = String(id).trim();
    let d = arr.find((x) => x.id === s);
    if (!d) d = arr.find((x) => x.id === s.replace(/^#/, ''));
    if (!d) d = arr.find((x) => x.id === '#' + s.replace(/^#/, ''));
    return d || null;
  }

  nextId(collection, extra) {
    const rule = ID_RULES[collection];
    const now = new Date();
    const y = now.getFullYear();
    if (!rule) {
      this.db.counters['_seq_' + collection] = (this.db.counters['_seq_' + collection] || 0) + 1;
      this._dirty = true;
      return collection + '-' + this.db.counters['_seq_' + collection];
    }
    const key = rule.counter;
    this.db.counters[key] = (this.db.counters[key] || 0) + 1;
    let id = rule.prefix;
    if (rule.year) id += y + '-';
    id += String(this.db.counters[key]).padStart(rule.width, '0');
    this._dirty = true;
    if (extra && extra.forcePrefix) id = extra.forcePrefix + id.replace(/^[A-Z0-9]+-(\d{4}-)?/, '');
    return id;
  }

  insert(collection, doc, deferTouch) {
    if (!this.db[collection]) this.db[collection] = [];
    const d = Object.assign({}, doc);
    if (!d.id) d.id = this.nextId(collection, doc);
    if (!d.createdAt) d.createdAt = new Date().toISOString();
    d.updatedAt = d.createdAt;
    this.db[collection].push(d);
    if (!deferTouch) this.touch();
    return d;
  }

  update(collection, id, patch) {
    const doc = this.resolve(collection, id);
    if (!doc) return null;
    Object.assign(doc, patch, { updatedAt: new Date().toISOString() });
    this.touch();
    return doc;
  }

  patchNested(collection, id, pathStr, value) {
    const doc = this.col(collection).get(id);
    if (!doc) return null;
    const parts = pathStr.split('.');
    let cur = doc;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    doc.updatedAt = new Date().toISOString();
    this.touch();
    return doc;
  }

  remove(collection, id) {
    const arr = this.db[collection] || [];
    const doc = this.resolve(collection, id);
    if (!doc) return false;
    arr.splice(arr.indexOf(doc), 1);
    this.touch();
    return true;
  }

  getSetting(keyPath, fallback) {
    const parts = keyPath.split('.');
    let cur = this.db.settings || {};
    for (const p of parts) {
      if (cur === undefined || cur === null || typeof cur !== 'object') return fallback;
      cur = cur[p];
    }
    return cur === undefined ? fallback : cur;
  }

  setSetting(keyPath, value) {
    const parts = keyPath.split('.');
    if (!this.db.settings) this.db.settings = {};
    let cur = this.db.settings;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    this.touch();
    this.emit();
    return value;
  }

  /** 全量替换某集合（用于导入/重置） */
  replace(collection, docs) {
    this.db[collection] = docs || [];
    this.touch();
    return this.db[collection].length;
  }

  // ---------------- 审计 ----------------
  audit(entry) {
    const rec = Object.assign(
      { id: this.nextId('audit'), ts: new Date().toISOString(), user: '当前用户' },
      entry
    );
    this.db.audit.push(rec);
    // 审计库只保留最近 5000 条，避免无限膨胀
    if (this.db.audit.length > 5000) this.db.audit.splice(0, this.db.audit.length - 5000);
    this.touch();
    return rec;
  }

  // ---------------- 持久化 ----------------
  touch() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.saveSync();
    }, 400);
    if (this._timer.unref) this._timer.unref();
  }

  saveSync(force) {
    if ((!this._dirty && !force) || !this.file) return;
    this.db.meta.updatedAt = new Date().toISOString();
    try {
      // ① 全部业务数据写入 SQLite（权威存储，事务提交）
      if (this.persist) this.persist.save(this.db);
      // ② 同时留一份 JSON 快照，便于备份/人工核对/迁移
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.db), 'utf8');
      fs.renameSync(tmp, this.file);
      this._dirty = false;
      this.emit();
    } catch (e) {
      console.error('[store] 保存失败：' + e.message);
    }
  }

  // ---------------- 变更订阅 ----------------
  on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  emit() { for (const fn of this._listeners) { try { fn(); } catch (_) {} } }
}

module.exports = new Store();
module.exports.Store = Store;
module.exports.ID_RULES = ID_RULES;

