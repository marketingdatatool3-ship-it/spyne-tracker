// db/database.js  –  sql.js wrapper with file persistence via fs
const initSqlJs = require('sql.js');
const fs        = require('fs');
const path      = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'tracker.sqlite');

let db   = null;
let SQL  = null;

// Persist to disk after every mutating call
function save() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function init() {
  SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  // ── Schema ──────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT UNIQUE NOT NULL,
      password    TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'content',  -- admin | content | design
      avatar_color TEXT DEFAULT '#D94F04',
      created_at  TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS content_items (
      id                    TEXT PRIMARY KEY,
      keywords              TEXT NOT NULL,
      type                  TEXT,
      category              TEXT,
      cluster               TEXT,
      ams                   TEXT,
      content_status        TEXT DEFAULT 'Not Started',
      content_writer_id     TEXT,
      content_delivery_date TEXT,
      seo_assigned_date     TEXT,
      design_status         TEXT DEFAULT 'Not Assigned',
      design_assignee_id    TEXT,
      design_assign_date    TEXT,
      design_delivery_date  TEXT,
      overall_status        TEXT DEFAULT 'In Progress',
      approved              TEXT,
      live_url              TEXT,
      new_content_link      TEXT,
      notes                 TEXT,
      created_by            TEXT,
      created_at            TEXT DEFAULT (datetime('now')),
      updated_at            TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (content_writer_id) REFERENCES users(id),
      FOREIGN KEY (design_assignee_id) REFERENCES users(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id         TEXT PRIMARY KEY,
      item_id    TEXT,
      user_id    TEXT,
      action     TEXT,
      details    TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  save();
  console.log('✅ Database ready at', DB_PATH);
}

// ── Generic helpers ──────────────────────────────────────────────────────────
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  save();
}

module.exports = { init, all, get, run, save };
