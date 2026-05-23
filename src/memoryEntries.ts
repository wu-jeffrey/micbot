import { getDb } from "./db.js";

export const memoryCategories = [
  "business",
  "materials",
  "printers",
  "website",
  "marketplace",
  "open_loops",
  "operating_model",
  "runbooks"
] as const;

export type MemoryCategory = (typeof memoryCategories)[number];

export interface MemoryEntryInput {
  category: MemoryCategory;
  title: string;
  body: string;
  sourceRawMessageIds: number[];
  status: string;
}

export interface MemoryEntryUpdateInput extends MemoryEntryInput {
  id: number;
}

export interface MemoryEntryRow {
  id: number;
  created_at: string;
  updated_at: string;
  category: MemoryCategory;
  title: string;
  body: string;
  source_raw_message_ids: string;
  status: string;
}

export function parseSourceRawMessageIds(value: string): number[] {
  if (!value.trim()) {
    return [];
  }

  return value.split(",").map((part) => {
    const id = Number(part.trim());
    if (!Number.isInteger(id) || id < 1) {
      throw new Error(`Invalid raw message id: ${part}`);
    }
    return id;
  });
}

export function assertMemoryCategory(category: string): asserts category is MemoryCategory {
  if (!memoryCategories.includes(category as MemoryCategory)) {
    throw new Error(`Invalid category "${category}". Allowed: ${memoryCategories.join(", ")}`);
  }
}

export function addMemoryEntry(input: MemoryEntryInput): MemoryEntryRow {
  const result = getDb()
    .prepare(
      `INSERT INTO memory_entries
       (category, title, body, source_raw_message_ids, status)
       VALUES (@category, @title, @body, @sourceRawMessageIds, @status)`
    )
    .run({
      category: input.category,
      title: input.title,
      body: input.body,
      sourceRawMessageIds: JSON.stringify(input.sourceRawMessageIds),
      status: input.status
    });

  return showMemoryEntry(Number(result.lastInsertRowid))!;
}

export function updateMemoryEntry(input: MemoryEntryUpdateInput): MemoryEntryRow {
  const existing = showMemoryEntry(input.id);
  if (!existing) {
    throw new Error(`Memory entry not found: ${input.id}`);
  }

  getDb()
    .prepare(
      `UPDATE memory_entries
       SET category = @category,
           title = @title,
           body = @body,
           source_raw_message_ids = @sourceRawMessageIds,
           status = @status,
           updated_at = datetime('now')
       WHERE id = @id`
    )
    .run({
      id: input.id,
      category: input.category,
      title: input.title,
      body: input.body,
      sourceRawMessageIds: JSON.stringify(input.sourceRawMessageIds),
      status: input.status
    });

  return showMemoryEntry(input.id)!;
}

export function deprecateMemoryEntry(id: number, reason: string): MemoryEntryRow {
  const existing = showMemoryEntry(id);
  if (!existing) {
    throw new Error(`Memory entry not found: ${id}`);
  }

  const body = `${existing.body}\n\nDeprecation reason: ${reason}`;
  getDb()
    .prepare(
      `UPDATE memory_entries
       SET body = @body,
           status = 'deprecated',
           updated_at = datetime('now')
       WHERE id = @id`
    )
    .run({ id, body });

  return showMemoryEntry(id)!;
}

export function listMemoryEntries(category?: MemoryCategory): MemoryEntryRow[] {
  if (category) {
    return getDb()
      .prepare(
        `SELECT id, created_at, updated_at, category, title, body, source_raw_message_ids, status
         FROM memory_entries
         WHERE category = ?
         ORDER BY category, title, id`
      )
      .all(category) as MemoryEntryRow[];
  }

  return getDb()
    .prepare(
      `SELECT id, created_at, updated_at, category, title, body, source_raw_message_ids, status
       FROM memory_entries
       ORDER BY category, title, id`
    )
    .all() as MemoryEntryRow[];
}

export function showMemoryEntry(id: number): MemoryEntryRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, created_at, updated_at, category, title, body, source_raw_message_ids, status
       FROM memory_entries
       WHERE id = ?`
    )
    .get(id) as MemoryEntryRow | undefined;
}
