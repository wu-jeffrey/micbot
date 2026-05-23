import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let db: Database.Database | undefined;

export function projectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function dbPath(): string {
  return process.env.MICBOT_DB_PATH ?? path.join(projectRoot(), "data", "micbot.db");
}

export function wikiDir(): string {
  return process.env.MICBOT_WIKI_DIR ?? path.join(projectRoot(), "data", "wiki");
}

export function dataDir(): string {
  return process.env.MICBOT_DATA_DIR ?? path.join(projectRoot(), "data");
}

export function artifactsDir(): string {
  return path.join(dataDir(), "artifacts");
}

export function printPackagesDir(): string {
  return path.join(dataDir(), "print_packages");
}

export function getDb(): Database.Database {
  if (!db) {
    const filename = dbPath();
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    db = new Database(filename);
    db.pragma("foreign_keys = ON");
  }

  return db;
}

export function closeDb(): void {
  db?.close();
  db = undefined;
}

export function initDb(): void {
  const schemaPath = path.join(projectRoot(), "src", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  getDb().exec(schema);
}
