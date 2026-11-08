'use strict';
/**
 * SQLite 持久层（node:sqlite 内置驱动，零第三方依赖）
 * ------------------------------------------------------------------
 * 所有业务数据写入 SQLite 数据库（权威存储）；同时由 store.js 留一份 JSON 快照便于备份/核对。
 *
 * 表结构（关系表 + JSON 文档表混用，兼顾"真数据库"与"字段灵活"）：
 *   meta(key, value)                平台元信息 / 计数器 / 设置（JSON 文本）
 *   records(collection, ordinal, id, payload, created_at, updated_at)  业务集合逐条
 *   measurements(...)               测量值展开成真列，可直接 SQL 统计
 *   audit_log(...)                  审计留痕
 *   reports(...)                    生成的报告文件登记
 *
 * 数据库路径：<DATA_DIR>/qip.db（默认 DSH_HOME/qip-platform/data/qip.db，可用 QIP_DATA_DIR 覆盖）
 */
const fs = require('fs');
const path = require('path');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  DatabaseSync = null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  path  TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  collection TEXT NOT NULL,
  ordinal    INTEGER NOT NULL DEFAULT 0,
  id         TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS idx_records_collection ON records(collection, ordinal);
CREATE TABLE IF NOT EXISTS measurements (
  id         TEXT PRIMARY KEY,
  char_id    TEXT,
  char_name  TEXT,
  model      TEXT,
  workshop   TEXT,
  station    TEXT,
  ts         TEXT,
  value      REAL,
  usl        REAL,
  lsl        REAL,
  unit       TEXT,
  shift      TEXT,
  batch      TEXT,
  supplier   TEXT,
  operator   TEXT,
  vin        TEXT,
  source     TEXT
);
CREATE INDEX IF NOT EXISTS idx_measurements_char_ts ON measurements(char_id, ts);
CREATE TABLE IF NOT EXISTS audit_log (
  id             TEXT PRIMARY KEY,
  ts             TEXT,
  user           TEXT,
  plugin         TEXT,
  action         TEXT,
  params         TEXT,
  result_summary TEXT,
  purpose        TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
CREATE TABLE IF NOT EXISTS reports (
  id         TEXT PRIMARY KEY,
  type       TEXT,
  title      TEXT,
  period     TEXT,
  file       TEXT,
  created_at TEXT
);
`;

const SKIP = new Set(['meta', 'counters', 'settings', 'pendingActionsUnused']);

function flatten(obj, prefix, out) {
  for (const key of Object.keys(obj || {})) {
    const value = obj[key];
    const full = prefix ? prefix + '.' + key : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, full, out);
    else out[full] = value;
  }
  return out;
}

function unflatten(flat) {
  const root = {};
  for (const [full, value] of Object.entries(flat || {})) {
    const parts = full.split('.');
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }
  return root;
}

function open(file) {
  if (!DatabaseSync) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(SCHEMA);

  const st = {
    metaSet: db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)'),
    metaGet: db.prepare('SELECT value FROM meta WHERE key = ?'),
    recDel: db.prepare('DELETE FROM records'),
    recIns: db.prepare('INSERT OR REPLACE INTO records(collection, ordinal, id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'),
    recAll: db.prepare('SELECT collection, id, payload FROM records ORDER BY collection, ordinal'),
    setDel: db.prepare('DELETE FROM settings'),
    setIns: db.prepare('INSERT OR REPLACE INTO settings(path, value) VALUES (?, ?)'),
    setAll: db.prepare('SELECT path, value FROM settings'),
    meaDel: db.prepare('DELETE FROM measurements'),
    meaIns: db.prepare(`INSERT OR REPLACE INTO measurements
      (id, char_id, char_name, model, workshop, station, ts, value, usl, lsl, unit, shift, batch, supplier, operator, vin, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    audDel: db.prepare('DELETE FROM audit_log'),
    audIns: db.prepare(`INSERT OR REPLACE INTO audit_log
      (id, ts, user, plugin, action, params, result_summary, purpose) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    repDel: db.prepare('DELETE FROM reports'),
    repIns: db.prepare('INSERT OR REPLACE INTO reports(id, type, title, period, file, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  };
  const adapter = {
    engine: 'sqlite',
    file,
    load() {
      const n = db.prepare('SELECT COUNT(*) AS c FROM records').get();
      const hasMeta = st.metaGet.get('state');
      if ((!n || Number(n.c) === 0) && !hasMeta) return null;
      const state = { meta: {}, counters: {}, settings: {} };
      for (const row of st.setAll.all()) {
        const parts = String(row.path).split('.');
        let cur = state.settings;
        for (let i = 0; i < parts.length - 1; i++) {
          if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        let value = row.value;
        try { value = JSON.parse(row.value); } catch (_) { /* 普通字符串 */ }
        cur[parts[parts.length - 1]] = value;
      }
      const metaRow = hasMeta ? hasMeta.value : null;
      if (metaRow) {
        try {
          const parsed = JSON.parse(metaRow);
          state.meta = parsed.meta || {};
          state.counters = parsed.counters || {};
        } catch (_) { /* 忽略 */ }
      }
      for (const row of st.recAll.all()) {
        const collection = String(row.collection);
        if (!Array.isArray(state[collection])) state[collection] = [];
        try {
          state[collection].push(JSON.parse(row.payload));
        } catch (_) { /* 跳过坏行 */ }
      }
      return state;
    },
    save(state) {
      const now = new Date().toISOString();
      const chars = {};
      for (const ch of state.spcChars || []) chars[ch.id] = ch;
      const flatSettings = flatten(state.settings || {}, '', {});
      db.exec('BEGIN IMMEDIATE');
      try {
        st.metaSet.run('state', JSON.stringify({ meta: state.meta || {}, counters: state.counters || {} }));
        st.metaSet.run('updatedAt', now);
        st.metaSet.run('engine', 'sqlite (' + (db.prepare('SELECT sqlite_version() AS v').get().v || '') + ')');
        st.setDel.run();
        for (const [key, value] of Object.entries(flatSettings)) {
          st.setIns.run(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
        st.recDel.run();
        for (const [collection, rows] of Object.entries(state)) {
          if (SKIP.has(collection) || !Array.isArray(rows)) continue;
          for (let i = 0; i < rows.length; i++) {
            const doc = rows[i];
            if (!doc || typeof doc !== 'object') continue;
            const id = String(doc.id === undefined ? collection + '-' + i : doc.id);
            st.recIns.run(collection, i, id, JSON.stringify(doc), doc.createdAt || null, doc.updatedAt || null);
          }
        }
        st.meaDel.run();
        for (const m of state.measurements || []) {
          const ch = chars[m.charId] || {};
          st.meaIns.run(
            String(m.id || ''), m.charId || null, m.charName || ch.name || null, m.model || ch.model || null,
            m.workshop || ch.workshop || null, m.station || ch.station || null, m.ts || null,
            Number.isFinite(Number(m.value)) ? Number(m.value) : null,
            ch.usl === undefined ? null : Number(ch.usl), ch.lsl === undefined ? null : Number(ch.lsl),
            m.unit || ch.unit || null, m.shift || null, m.batch || null, m.supplier || null,
            m.operator || null, m.vin || null, m.source || null,
          );
        }
        st.audDel.run();
        for (const a of state.audit || []) {
          st.audIns.run(String(a.id || ''), a.ts || null, a.user || null, a.plugin || null, a.action || null,
            JSON.stringify(a.params === undefined ? null : a.params), a.resultSummary || null, a.purpose || null);
        }
        st.repDel.run();
        for (const r of state.reports || []) {
          st.repIns.run(String(r.id || ''), r.type || null, r.title || null, r.period || null,
            r.file || r.path || null, r.createdAt || null);
        }
        db.exec('COMMIT');
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
        throw err;
      }
      return true;
    },
    info() {
      const count = (table) => {
        try { return Number(db.prepare('SELECT COUNT(*) AS c FROM ' + table).get().c); } catch (_) { return 0; }
      };
      let size = 0;
      try { size = fs.statSync(file).size; } catch (_) { /* ignore */ }
      const updatedAt = st.metaGet.get('updatedAt');
      return {
        engine: 'sqlite',
        path: file,
        sizeBytes: size,
        sqliteVersion: (db.prepare('SELECT sqlite_version() AS v').get() || {}).v || '',
        updatedAt: updatedAt ? updatedAt.value : null,
        tables: {
          records: count('records'),
          measurements: count('measurements'),
          audit_log: count('audit_log'),
          reports: count('reports'),
          settings: count('settings'),
        },
      };
    },
    /** 只读 SQL（供自检/运维核对），仅允许 SELECT */
    query(sql, params) {
      const text = String(sql || '').trim();
      if (!/^select\b/i.test(text)) throw new Error('只允许 SELECT 查询');
      return db.prepare(text).all(...(params || []));
    },
    close() { try { db.close(); } catch (_) { /* ignore */ } },
  };
  return adapter;
}

module.exports = { open, DatabaseSync };
