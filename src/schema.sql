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

CREATE TABLE IF NOT EXISTS discord_job_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'cancelled')) DEFAULT 'active',
  guild_id TEXT,
  channel_id TEXT,
  channel TEXT NOT NULL,
  thread_id TEXT NOT NULL UNIQUE,
  thread_name TEXT NOT NULL,
  source_message_id TEXT,
  customer_name TEXT,
  summary TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS discord_job_artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  discord_job_thread_id INTEGER NOT NULL,
  intake_request_id INTEGER NOT NULL,
  artifact_id INTEGER NOT NULL,
  version_label TEXT NOT NULL DEFAULT '',
  relationship TEXT NOT NULL CHECK (relationship IN ('primary', 'revision', 'plate_member')) DEFAULT 'primary',
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'rejected')) DEFAULT 'active',
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE(discord_job_thread_id, artifact_id),
  FOREIGN KEY(discord_job_thread_id) REFERENCES discord_job_threads(id),
  FOREIGN KEY(intake_request_id) REFERENCES intake_requests(id),
  FOREIGN KEY(artifact_id) REFERENCES artifacts(id)
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

CREATE TABLE IF NOT EXISTS production_workflow_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  intake_request_id INTEGER,
  artifact_id INTEGER,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('text', 'image', 'video', 'model', 'cad', 'unknown')),
  route TEXT NOT NULL CHECK (route IN (
    'search_existing',
    'cad_design',
    'mesh_generation',
    'direct_print_package',
    'needs_clarification',
    'non_print_request'
  )),
  object_query TEXT NOT NULL DEFAULT '',
  route_reason TEXT NOT NULL,
  workflow_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'in_progress', 'superseded', 'completed', 'cancelled')) DEFAULT 'planned',
  FOREIGN KEY(intake_request_id) REFERENCES intake_requests(id),
  FOREIGN KEY(artifact_id) REFERENCES artifacts(id)
);

CREATE TABLE IF NOT EXISTS model_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  production_workflow_plan_id INTEGER,
  intake_request_id INTEGER,
  artifact_id INTEGER,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  license TEXT NOT NULL DEFAULT '',
  file_url TEXT NOT NULL DEFAULT '',
  thumbnail_path TEXT NOT NULL DEFAULT '',
  local_artifact_id INTEGER,
  fit_status TEXT NOT NULL CHECK (fit_status IN ('unknown', 'fits', 'too_large', 'needs_review')) DEFAULT 'unknown',
  dimensions_json TEXT NOT NULL DEFAULT '{}',
  score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'selected', 'rejected', 'imported', 'superseded')) DEFAULT 'candidate',
  notes TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(production_workflow_plan_id) REFERENCES production_workflow_plans(id),
  FOREIGN KEY(intake_request_id) REFERENCES intake_requests(id),
  FOREIGN KEY(artifact_id) REFERENCES artifacts(id),
  FOREIGN KEY(local_artifact_id) REFERENCES artifacts(id)
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
    'revise_requested',
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
