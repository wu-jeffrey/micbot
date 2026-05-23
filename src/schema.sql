CREATE TABLE IF NOT EXISTS raw_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  surface TEXT NOT NULL,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL,
  actor TEXT NOT NULL,
  content TEXT NOT NULL,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS memory_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  category TEXT NOT NULL CHECK (category IN (
    'business',
    'materials',
    'printers',
    'website',
    'marketplace',
    'open_loops',
    'operating_model',
    'runbooks'
  )),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_raw_message_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
