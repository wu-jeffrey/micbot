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

CREATE TABLE IF NOT EXISTS intake_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL,
  surface TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'received',
    'file_stored',
    'file_validated',
    'print_package_ready',
    'awaiting_human_approval',
    'approved_to_send',
    'sent_to_printer',
    'printing',
    'awaiting_bed_clear',
    'physical_object_done',
    'failed_needs_intervention',
    'cancelled'
  )),
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  offer_slug TEXT,
  message TEXT NOT NULL,
  raw_message_id INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(raw_message_id) REFERENCES raw_messages(id)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  intake_request_id INTEGER NOT NULL,
  raw_message_id INTEGER,
  filename TEXT NOT NULL,
  original_path TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('stl', '3mf', 'step', 'image', 'pdf', 'other')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(intake_request_id) REFERENCES intake_requests(id),
  FOREIGN KEY(raw_message_id) REFERENCES raw_messages(id)
);

CREATE TABLE IF NOT EXISTS file_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  artifact_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'valid_enough', 'needs_human_review', 'rejected')),
  detected_type TEXT NOT NULL,
  size_bytes INTEGER,
  sha256 TEXT,
  dimensions_json TEXT NOT NULL DEFAULT '{}',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  review_notes TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(artifact_id) REFERENCES artifacts(id)
);

CREATE TABLE IF NOT EXISTS print_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  intake_request_id INTEGER NOT NULL,
  artifact_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'pending',
    'ready_for_preview',
    'opened_for_preview',
    'awaiting_human_approval',
    'approved_to_send',
    'rejected',
    'sent_to_printer',
    'printing',
    'failed',
    'completed'
  )),
  package_dir TEXT NOT NULL,
  source_file_path TEXT NOT NULL,
  prepared_file_path TEXT NOT NULL,
  bambu_project_path TEXT,
  preview_path TEXT NOT NULL,
  printer_profile TEXT NOT NULL,
  material_profile TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(intake_request_id) REFERENCES intake_requests(id),
  FOREIGN KEY(artifact_id) REFERENCES artifacts(id)
);

CREATE TABLE IF NOT EXISTS human_handoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL CHECK (type IN (
    'preview_print_package',
    'approve_print_send',
    'clear_bed',
    'swap_filament',
    'inspect_failed_print',
    'package_part'
  )),
  status TEXT NOT NULL CHECK (status IN ('open', 'completed', 'cancelled')),
  related_object_type TEXT NOT NULL,
  related_object_id INTEGER NOT NULL,
  instructions TEXT NOT NULL,
  assigned_to TEXT,
  completed_at TEXT,
  notes TEXT NOT NULL DEFAULT ''
);
