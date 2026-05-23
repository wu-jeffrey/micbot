import { getDb } from "./db.js";

export interface SettingRow {
  key: string;
  value_json: string;
  updated_at: string;
}

export function setSetting(key: string, valueJson: string): SettingRow {
  JSON.parse(valueJson);
  const db = getDb();
  db.prepare(
    `INSERT INTO settings (key, value_json, updated_at)
     VALUES (@key, @valueJson, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = datetime('now')`
  ).run({ key, valueJson });

  return getSetting(key)!;
}

export function getSetting(key: string): SettingRow | undefined {
  return getDb()
    .prepare("SELECT key, value_json, updated_at FROM settings WHERE key = ?")
    .get(key) as SettingRow | undefined;
}

export function listSettings(): SettingRow[] {
  return getDb()
    .prepare("SELECT key, value_json, updated_at FROM settings ORDER BY key")
    .all() as SettingRow[];
}
