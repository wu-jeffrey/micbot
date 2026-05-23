import { getDb } from "./db.js";

export interface RawMessageInput {
  surface: string;
  channel: string;
  direction: string;
  actor: string;
  content: string;
  rawJson?: string;
}

export interface RawMessageRow {
  id: number;
  created_at: string;
  surface: string;
  channel: string;
  direction: string;
  actor: string;
  content: string;
  raw_json: string | null;
}

export function addRawMessage(input: RawMessageInput): RawMessageRow {
  if (input.rawJson) {
    JSON.parse(input.rawJson);
  }

  const result = getDb()
    .prepare(
      `INSERT INTO raw_messages
       (surface, channel, direction, actor, content, raw_json)
       VALUES (@surface, @channel, @direction, @actor, @content, @rawJson)`
    )
    .run({
      surface: input.surface,
      channel: input.channel,
      direction: input.direction,
      actor: input.actor,
      content: input.content,
      rawJson: input.rawJson ?? null
    });

  return showRawMessage(Number(result.lastInsertRowid))!;
}

export function listRawMessages(): RawMessageRow[] {
  return getDb()
    .prepare(
      `SELECT id, created_at, surface, channel, direction, actor, content, raw_json
       FROM raw_messages
       ORDER BY id`
    )
    .all() as RawMessageRow[];
}

export function showRawMessage(id: number): RawMessageRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, created_at, surface, channel, direction, actor, content, raw_json
       FROM raw_messages
       WHERE id = ?`
    )
    .get(id) as RawMessageRow | undefined;
}
