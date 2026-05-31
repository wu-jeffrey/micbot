import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, initDb } from "../src/db.js";
import { addMemoryEntry, listMemoryEntries } from "../src/memoryEntries.js";
import { addRawMessage, listRawMessages, showRawMessage } from "../src/rawMessages.js";
import { getSetting, setSetting } from "../src/settings.js";
import { rebuildWiki, wikiPathForCategory } from "../src/wiki.js";

let tempDir: string;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "micbot-test-"));
  process.env.MICBOT_DB_PATH = path.join(tempDir, "micbot.db");
  process.env.MICBOT_DATA_DIR = path.join(tempDir, "data");
  process.env.MICBOT_WIKI_DIR = path.join(tempDir, "data", "wiki");
});

afterEach(() => {
  closeDb();
  delete process.env.MICBOT_DB_PATH;
  delete process.env.MICBOT_DATA_DIR;
  delete process.env.MICBOT_WIKI_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("MICBot raw ledger and wiki projection", () => {
  function runCli(args: string[]): string {
    return execFileSync("npm", ["run", "cli", "--", ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        MICBOT_DB_PATH: process.env.MICBOT_DB_PATH!,
        MICBOT_DATA_DIR: process.env.MICBOT_DATA_DIR!,
        MICBOT_WIKI_DIR: process.env.MICBOT_WIKI_DIR!
      },
      encoding: "utf8"
    });
  }

  function runCliWithEnv(args: string[], env: NodeJS.ProcessEnv): string {
    return execFileSync("npm", ["run", "cli", "--", ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...env
      },
      encoding: "utf8"
    });
  }

  it("initializes the DB", () => {
    initDb();
    expect(fs.existsSync(path.join(tempDir, "micbot.db"))).toBe(true);
  });

  it("adds, lists, and reads raw messages", () => {
    initDb();
    const added = addRawMessage({
      surface: "openclaw_discord",
      channel: "general",
      direction: "inbound",
      actor: "Jeff",
      content: "Remember black PETG is default for outdoor brackets."
    });

    expect(added.id).toBe(1);
    expect(listRawMessages()).toHaveLength(1);
    expect(showRawMessage(1)?.content).toBe("Remember black PETG is default for outdoor brackets.");
  });

  it("adds memory, stores it in SQLite, and projects Markdown wiki", () => {
    initDb();
    addRawMessage({
      surface: "openclaw_discord",
      channel: "general",
      direction: "inbound",
      actor: "Jeff",
      content: "Remember black PETG is default for outdoor brackets."
    });

    const memory = addMemoryEntry({
      category: "materials",
      title: "Default outdoor bracket material",
      body: "Black PETG is the default material for outdoor brackets.",
      sourceRawMessageIds: [1],
      status: "active"
    });
    rebuildWiki();

    expect(memory.id).toBe(1);
    expect(listMemoryEntries()).toHaveLength(1);

    const markdown = fs.readFileSync(wikiPathForCategory("materials"), "utf8");
    expect(markdown).toContain("# Materials Policy");
    expect(markdown).toContain("## Default outdoor bracket material");
    expect(markdown).toContain("Source raw messages: 1");
    expect(markdown).toContain("Black PETG is the default material for outdoor brackets.");
  });

  it("uses data/wiki as the canonical wiki path", () => {
    initDb();
    rebuildWiki();

    expect(wikiPathForCategory("materials")).toBe(path.join(tempDir, "data", "wiki", "policies", "materials.md"));
    expect(fs.existsSync(path.join(tempDir, "data", "wiki", "index.md"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "wiki"))).toBe(false);
  });

  it("stores surface-neutral OpenClaw surface values", () => {
    initDb();
    for (const surface of ["openclaw_discord", "openclaw_slack", "openclaw_web"]) {
      addRawMessage({
        surface,
        channel: surface.replace("openclaw_", ""),
        direction: "inbound",
        actor: "Jeff",
        content: `Message from ${surface}`
      });
    }

    expect(listRawMessages().map((row) => row.surface)).toEqual(["openclaw_discord", "openclaw_slack", "openclaw_web"]);
  });

  it("remember creates linked raw message, memory entry, regenerated wiki, and valid JSON", () => {
    const output = runCli([
      "remember",
      "--surface",
      "openclaw_discord",
      "--channel",
      "general",
      "--direction",
      "inbound",
      "--actor",
      "Jeff",
      "--content",
      "Remember black PETG is default for outdoor brackets.",
      "--category",
      "materials",
      "--title",
      "Default outdoor bracket material",
      "--body",
      "Black PETG is the default material for outdoor brackets.",
      "--status",
      "active",
      "--json"
    ]);
    const parsed = JSON.parse(output) as {
      raw_message: { id: number; content: string };
      memory_entry: { id: number; source_raw_message_ids: string };
      wiki_files: string[];
    };

    expect(parsed.raw_message.id).toBe(1);
    expect(parsed.memory_entry.id).toBe(1);
    expect(JSON.parse(parsed.memory_entry.source_raw_message_ids)).toEqual([parsed.raw_message.id]);
    expect(parsed.wiki_files).toContain(path.join(tempDir, "data", "wiki", "policies", "materials.md"));

    const markdown = fs.readFileSync(path.join(tempDir, "data", "wiki", "policies", "materials.md"), "utf8");
    expect(markdown).toContain("## Default outdoor bracket material");
    expect(markdown).toContain("Source raw messages: 1");
  });

  it("remember rolls back raw capture when DB write fails and reports valid JSON", () => {
    try {
      runCli([
        "remember",
        "--surface",
        "openclaw_discord",
        "--channel",
        "general",
        "--direction",
        "inbound",
        "--actor",
        "Jeff",
        "--content",
        "Remember black PETG is default for outdoor brackets.",
        "--category",
        "materials",
        "--title",
        "Default outdoor bracket material",
        "--body",
        "Black PETG is the default material for outdoor brackets.",
        "--status",
        "active",
        "--raw-json",
        "{bad",
        "--json"
      ]);
      throw new Error("Expected remember to fail");
    } catch (error) {
      const stdout = (error as { stdout: Buffer | string }).stdout.toString();
      const parsed = JSON.parse(stdout) as { ok: boolean; phase: string; db_write_succeeded: boolean };
      expect(parsed.ok).toBe(false);
      expect(parsed.phase).toBe("db_write");
      expect(parsed.db_write_succeeded).toBe(false);
    }

    initDb();
    expect(listRawMessages()).toHaveLength(0);
    expect(listMemoryEntries()).toHaveLength(0);
  });

  it("remember reports wiki projection failure after successful DB write", () => {
    const blockedWikiPath = path.join(tempDir, "blocked-wiki");
    fs.writeFileSync(blockedWikiPath, "not a directory", "utf8");

    try {
      runCliWithEnv(
        [
          "remember",
          "--surface",
          "openclaw_discord",
          "--channel",
          "general",
          "--direction",
          "inbound",
          "--actor",
          "Jeff",
          "--content",
          "Remember black PETG is default for outdoor brackets.",
          "--category",
          "materials",
          "--title",
          "Default outdoor bracket material",
          "--body",
          "Black PETG is the default material for outdoor brackets.",
          "--status",
          "active",
          "--json"
        ],
        {
          MICBOT_DB_PATH: process.env.MICBOT_DB_PATH!,
          MICBOT_WIKI_DIR: blockedWikiPath
        }
      );
      throw new Error("Expected remember to fail");
    } catch (error) {
      const stdout = (error as { stdout: Buffer | string }).stdout.toString();
      const parsed = JSON.parse(stdout) as {
        ok: boolean;
        phase: string;
        db_write_succeeded: boolean;
        raw_message: { id: number };
        memory_entry: { id: number };
      };
      expect(parsed.ok).toBe(false);
      expect(parsed.phase).toBe("wiki_rebuild");
      expect(parsed.db_write_succeeded).toBe(true);
      expect(parsed.raw_message.id).toBe(1);
      expect(parsed.memory_entry.id).toBe(1);
    }

    initDb();
    expect(listRawMessages()).toHaveLength(1);
    expect(listMemoryEntries()).toHaveLength(1);
  });

  it("update-memory updates fields, rebuilds wiki, emits valid JSON, and leaves raw messages immutable", () => {
    const remembered = JSON.parse(
      runCli([
        "remember",
        "--surface",
        "openclaw_discord",
        "--channel",
        "general",
        "--direction",
        "inbound",
        "--actor",
        "Jeff",
        "--content",
        "Remember black PETG is default for outdoor brackets.",
        "--category",
        "materials",
        "--title",
        "Default outdoor bracket material",
        "--body",
        "Black PETG is the default material for outdoor brackets.",
        "--status",
        "active",
        "--json"
      ])
    ) as { raw_message: { id: number }; memory_entry: { id: number } };

    initDb();
    getDb().prepare("UPDATE memory_entries SET updated_at = '2000-01-01 00:00:00' WHERE id = ?").run(remembered.memory_entry.id);
    closeDb();

    const correction = JSON.parse(
      runCli([
        "add-raw-message",
        "--surface",
        "openclaw_discord",
        "--channel",
        "general",
        "--direction",
        "inbound",
        "--actor",
        "Jeff",
        "--content",
        "Actually, outdoor brackets can be black PETG or ASA depending on UV exposure.",
        "--json"
      ])
    ) as { id: number };

    const output = runCli([
      "update-memory",
      "--id",
      String(remembered.memory_entry.id),
      "--category",
      "materials",
      "--title",
      "Default outdoor bracket materials",
      "--body",
      "Outdoor brackets should default to black PETG unless UV exposure or customer requirements make ASA a better fit.",
      "--source-raw-message-ids",
      `${remembered.raw_message.id},${correction.id}`,
      "--status",
      "active",
      "--json"
    ]);
    const parsed = JSON.parse(output) as {
      memory_entry: {
        title: string;
        body: string;
        category: string;
        source_raw_message_ids: string;
        status: string;
        updated_at: string;
      };
      wiki_files: string[];
    };

    expect(parsed.memory_entry.title).toBe("Default outdoor bracket materials");
    expect(parsed.memory_entry.body).toContain("ASA");
    expect(parsed.memory_entry.category).toBe("materials");
    expect(JSON.parse(parsed.memory_entry.source_raw_message_ids)).toEqual([remembered.raw_message.id, correction.id]);
    expect(parsed.memory_entry.status).toBe("active");
    expect(parsed.memory_entry.updated_at).not.toBe("2000-01-01 00:00:00");
    expect(parsed.wiki_files).toContain(path.join(tempDir, "data", "wiki", "policies", "materials.md"));

    const markdown = fs.readFileSync(path.join(tempDir, "data", "wiki", "policies", "materials.md"), "utf8");
    expect(markdown).toContain("## Default outdoor bracket materials");
    expect(markdown).toContain("Source raw messages: 1, 2");
    expect(markdown).toContain("ASA");

    const raw = JSON.parse(runCli(["show-raw-message", "--id", String(remembered.raw_message.id), "--json"])) as { content: string };
    expect(raw.content).toBe("Remember black PETG is default for outdoor brackets.");
  });

  it("deprecate-memory marks entry deprecated, rebuilds wiki, emits valid JSON, and leaves raw messages immutable", () => {
    const remembered = JSON.parse(
      runCli([
        "remember",
        "--surface",
        "openclaw_web",
        "--channel",
        "webui",
        "--direction",
        "inbound",
        "--actor",
        "Jeff",
        "--content",
        "Remember black PETG is default for outdoor brackets.",
        "--category",
        "materials",
        "--title",
        "Default outdoor bracket material",
        "--body",
        "Black PETG is the default material for outdoor brackets.",
        "--status",
        "active",
        "--json"
      ])
    ) as { raw_message: { id: number }; memory_entry: { id: number } };

    initDb();
    getDb().prepare("UPDATE memory_entries SET updated_at = '2000-01-01 00:00:00' WHERE id = ?").run(remembered.memory_entry.id);
    closeDb();

    const output = runCli([
      "deprecate-memory",
      "--id",
      String(remembered.memory_entry.id),
      "--reason",
      "Replaced by a UV-aware material policy.",
      "--json"
    ]);
    const parsed = JSON.parse(output) as {
      memory_entry: { body: string; status: string; updated_at: string };
      wiki_files: string[];
    };

    expect(parsed.memory_entry.status).toBe("deprecated");
    expect(parsed.memory_entry.body).toContain("Deprecation reason: Replaced by a UV-aware material policy.");
    expect(parsed.memory_entry.updated_at).not.toBe("2000-01-01 00:00:00");
    expect(parsed.wiki_files).toContain(path.join(tempDir, "data", "wiki", "policies", "materials.md"));

    const markdown = fs.readFileSync(path.join(tempDir, "data", "wiki", "policies", "materials.md"), "utf8");
    expect(markdown).toContain("Status: deprecated");
    expect(markdown).toContain("Deprecation reason: Replaced by a UV-aware material policy.");

    const raw = JSON.parse(runCli(["show-raw-message", "--id", String(remembered.raw_message.id), "--json"])) as { content: string };
    expect(raw.content).toBe("Remember black PETG is default for outdoor brackets.");
  });

  it("add-raw-message emits valid JSON and creates a raw message for openclaw_web", () => {
    const output = runCli([
      "add-raw-message",
      "--surface",
      "openclaw_web",
      "--channel",
      "webui",
      "--direction",
      "inbound",
      "--actor",
      "Jeff",
      "--content",
      "Make MICBot treat printer bed clearing as a human handoff step.",
      "--json"
    ]);
    const parsed = JSON.parse(output) as { id: number; surface: string; content: string };

    expect(parsed.id).toBe(1);
    expect(parsed.surface).toBe("openclaw_web");
    expect(parsed.content).toBe("Make MICBot treat printer bed clearing as a human handoff step.");
  });

  it("saves and reads settings", () => {
    initDb();
    setSetting("business_name", "\"Made In Canada Industries\"");
    expect(getSetting("business_name")?.value_json).toBe("\"Made In Canada Industries\"");
  });
});

describe("MICBot intake to print package workflow", () => {
  function runCli(args: string[]): string {
    return execFileSync("npm", ["run", "cli", "--", ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        MICBOT_DB_PATH: process.env.MICBOT_DB_PATH!,
        MICBOT_DATA_DIR: process.env.MICBOT_DATA_DIR!,
        MICBOT_WIKI_DIR: process.env.MICBOT_WIKI_DIR!
      },
      encoding: "utf8"
    });
  }

  it("creates, lists, and reads an intake request", () => {
    const created = JSON.parse(
      runCli([
        "create-intake",
        "--source",
        "manual",
        "--surface",
        "openclaw_discord",
        "--channel",
        "intake",
        "--customer-name",
        "Test Customer",
        "--customer-email",
        "test@example.com",
        "--offer-slug",
        "custom-print",
        "--message",
        "Print this in black PETG, quantity 4.",
        "--json"
      ])
    ) as { id: number; status: string; message: string };

    expect(created.id).toBe(1);
    expect(created.status).toBe("received");

    const listed = JSON.parse(runCli(["list-intakes", "--json"])) as Array<{ id: number }>;
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);

    const shown = JSON.parse(runCli(["show-intake", "--id", String(created.id), "--json"])) as { message: string };
    expect(shown.message).toBe("Print this in black PETG, quantity 4.");
  });

  it("stores and hashes an artifact under ignored runtime storage", () => {
    const intake = JSON.parse(
      runCli(["create-intake", "--source", "manual", "--surface", "openclaw_discord", "--channel", "intake", "--message", "Print STL.", "--json"])
    ) as { id: number };

    const artifact = JSON.parse(
      runCli([
        "store-artifact",
        "--intake-request-id",
        String(intake.id),
        "--path",
        "tests/fixtures/test_part.stl",
        "--artifact-type",
        "stl",
        "--json"
      ])
    ) as { id: number; stored_path: string; sha256: string; size_bytes: number; artifact_type: string };

    expect(artifact.id).toBe(1);
    expect(artifact.artifact_type).toBe("stl");
    expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.size_bytes).toBeGreaterThan(0);
    expect(artifact.stored_path).toContain(path.join("data", "artifacts"));
    expect(fs.existsSync(artifact.stored_path)).toBe(true);

    const stored = fs.readFileSync(artifact.stored_path, "utf8");
    expect(stored).toContain("solid test_part");
  });

  it("creates a Discord attachment intake for a supported printable model", () => {
    const result = JSON.parse(
      runCli([
        "intake-discord-attachment",
        "--channel",
        "general",
        "--author",
        "mynamejeef",
        "--author-id",
        "discord-user-1",
        "--message-id",
        "discord-message-1",
        "--attachment-id",
        "discord-attachment-1",
        "--attachment-path",
        "tests/fixtures/test_part.stl",
        "--attachment-filename",
        "customer-bracket.stl",
        "--message-content",
        "Can you print this?",
        "--json"
      ])
    ) as {
      ok: boolean;
      raw_message: { id: number; surface: string; actor: string; raw_json: string };
      intake: { id: number; source: string; status: string; raw_message_id: number; metadata_json: string };
      artifact: { id: number; artifact_type: string; filename: string; raw_message_id: number; metadata_json: string };
      next_step: string;
    };

    expect(result.ok).toBe(true);
    expect(result.raw_message.surface).toBe("openclaw_discord");
    expect(result.raw_message.actor).toBe("mynamejeef");
    expect(result.intake.source).toBe("discord_attachment");
    expect(result.intake.status).toBe("file_stored");
    expect(result.intake.raw_message_id).toBe(result.raw_message.id);
    expect(result.artifact.raw_message_id).toBe(result.raw_message.id);
    expect(result.artifact.artifact_type).toBe("stl");
    expect(result.artifact.filename).toBe("customer-bracket.stl");
    expect(result.next_step).toBe("review_file");

    const metadata = JSON.parse(result.artifact.metadata_json) as { discord: { message_id: string; attachment_filename: string; size_bytes: number } };
    expect(metadata.discord.message_id).toBe("discord-message-1");
    expect(metadata.discord.attachment_filename).toBe("customer-bracket.stl");
    expect(metadata.discord.size_bytes).toBeGreaterThan(0);
  });

  it("scopes Discord uploads to a reusable job thread for revisions and plate members", () => {
    const first = JSON.parse(
      runCli([
        "intake-discord-attachment",
        "--channel",
        "general",
        "--author",
        "mynamejeef",
        "--message-id",
        "discord-message-job-1",
        "--attachment-path",
        "tests/fixtures/test_part.stl",
        "--attachment-filename",
        "bracket-v1.stl",
        "--message-content",
        "Can you print this bracket?",
        "--job-thread-id",
        "discord-thread-job-1",
        "--job-thread-name",
        "print job bracket",
        "--version-label",
        "v1",
        "--json"
      ])
    ) as {
      intake: { id: number };
      artifact: { id: number };
      discord_job_thread: { id: number; thread_id: string; thread_name: string };
      discord_job_artifact: { relationship: string; version_label: string };
    };

    const second = JSON.parse(
      runCli([
        "intake-discord-attachment",
        "--channel",
        "general",
        "--author",
        "mynamejeef",
        "--message-id",
        "discord-message-job-2",
        "--attachment-path",
        "tests/fixtures/test_part.stl",
        "--attachment-filename",
        "bracket-v2.stl",
        "--message-content",
        "Revision with thicker wall.",
        "--job-thread-record-id",
        String(first.discord_job_thread.id),
        "--version-label",
        "v2",
        "--artifact-relationship",
        "revision",
        "--json"
      ])
    ) as {
      artifact: { id: number };
      discord_job_thread: { id: number };
      discord_job_artifact: { relationship: string; version_label: string };
    };

    expect(first.discord_job_thread.thread_id).toBe("discord-thread-job-1");
    expect(first.discord_job_thread.thread_name).toBe("print job bracket");
    expect(first.discord_job_artifact).toMatchObject({ relationship: "primary", version_label: "v1" });
    expect(second.discord_job_thread.id).toBe(first.discord_job_thread.id);
    expect(second.discord_job_artifact).toMatchObject({ relationship: "revision", version_label: "v2" });

    const context = JSON.parse(runCli(["show-discord-job-context", "--artifact-id", String(second.artifact.id), "--json"])) as {
      thread: { id: number; thread_id: string };
      links: Array<{ artifact_id: number; relationship: string; version_label: string }>;
    };
    expect(context.thread.id).toBe(first.discord_job_thread.id);
    expect(context.thread.thread_id).toBe("discord-thread-job-1");
    expect(context.links.map((link) => link.artifact_id)).toEqual([first.artifact.id, second.artifact.id]);
    expect(context.links.map((link) => link.version_label)).toEqual(["v1", "v2"]);
  });

  it("rejects unsupported Discord attachment types before creating intake records", () => {
    const unsupportedPath = path.join(tempDir, "notes.txt");
    fs.writeFileSync(unsupportedPath, "not a model", "utf8");

    expect(() =>
      runCli([
        "intake-discord-attachment",
        "--channel",
        "general",
        "--author",
        "mynamejeef",
        "--message-id",
        "discord-message-2",
        "--attachment-path",
        unsupportedPath,
        "--attachment-filename",
        "notes.txt",
        "--json"
      ])
    ).toThrow(/Unsupported Discord attachment type/);

    const intakes = JSON.parse(runCli(["list-intakes", "--json"])) as unknown[];
    expect(intakes).toHaveLength(0);
  });

  it("marks an STL file review as valid_enough", () => {
    const intake = JSON.parse(
      runCli(["create-intake", "--source", "manual", "--surface", "openclaw_discord", "--channel", "intake", "--message", "Print STL.", "--json"])
    ) as { id: number };
    const artifact = JSON.parse(
      runCli(["store-artifact", "--intake-request-id", String(intake.id), "--path", "tests/fixtures/test_part.stl", "--artifact-type", "stl", "--json"])
    ) as { id: number; sha256: string };

    const review = JSON.parse(runCli(["review-file", "--artifact-id", String(artifact.id), "--json"])) as {
      status: string;
      detected_type: string;
      sha256: string;
    };

    expect(review.status).toBe("valid_enough");
    expect(review.detected_type).toBe("stl");
    expect(review.sha256).toBe(artifact.sha256);

    const shown = JSON.parse(runCli(["show-file-review", "--artifact-id", String(artifact.id), "--json"])) as { status: string };
    expect(shown.status).toBe("valid_enough");
  });

  it("routes production 3D requests into search, CAD, mesh, and package lanes", () => {
    const search = JSON.parse(
      runCli(["plan-production-workflow", "--message", "I need a phone holder for my desk", "--source-kind", "text", "--json"])
    ) as { route: string; next_steps: string[]; safety: { sends_to_printer: boolean } };
    expect(search.route).toBe("search_existing");
    expect(search.next_steps.join(" ")).toContain("Search model libraries");
    expect(search.safety.sends_to_printer).toBe(false);

    const cad = JSON.parse(
      runCli([
        "plan-production-workflow",
        "--message",
        "Make a bracket with two M4 holes and tight fit dimensions",
        "--source-kind",
        "image",
        "--json"
      ])
    ) as { route: string; micbot_outputs: string[] };
    expect(cad.route).toBe("cad_design");
    expect(cad.micbot_outputs).toContain("STEP/source artifact");

    const mesh = JSON.parse(
      runCli(["plan-production-workflow", "--message", "Generate a custom figurine from this video", "--source-kind", "video", "--json"])
    ) as { route: string; required_user_inputs: string[] };
    expect(mesh.route).toBe("mesh_generation");
    expect(mesh.required_user_inputs.join(" ")).toContain("max physical size");

    const intake = JSON.parse(
      runCli(["create-intake", "--source", "manual", "--surface", "openclaw_discord", "--channel", "intake", "--message", "Print supplied STL.", "--json"])
    ) as { id: number };
    const artifact = JSON.parse(
      runCli(["store-artifact", "--intake-request-id", String(intake.id), "--path", "tests/fixtures/test_part.stl", "--artifact-type", "stl", "--json"])
    ) as { id: number };
    const recorded = JSON.parse(
      runCli([
        "plan-production-workflow",
        "--message",
        "Please prep this STL for PETG",
        "--source-kind",
        "model",
        "--intake-request-id",
        String(intake.id),
        "--artifact-id",
        String(artifact.id),
        "--record",
        "--json"
      ])
    ) as { route: string; workflow_plan: { id: number; route: string; intake_request_id: number; artifact_id: number } };
    expect(recorded.route).toBe("direct_print_package");
    expect(recorded.workflow_plan).toMatchObject({
      route: "direct_print_package",
      intake_request_id: intake.id,
      artifact_id: artifact.id
    });

    const listed = JSON.parse(runCli(["list-production-workflow-plans", "--intake-request-id", String(intake.id), "--json"])) as Array<{
      id: number;
      route: string;
    }>;
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(recorded.workflow_plan.id);
  });

  it("records and selects model candidates with provenance", () => {
    const intake = JSON.parse(
      runCli([
        "create-intake",
        "--source",
        "manual",
        "--surface",
        "openclaw_discord",
        "--channel",
        "intake",
        "--message",
        "Find a phone holder.",
        "--json"
      ])
    ) as { id: number };
    const plan = JSON.parse(
      runCli([
        "plan-production-workflow",
        "--message",
        "Find a phone holder.",
        "--source-kind",
        "text",
        "--intake-request-id",
        String(intake.id),
        "--record",
        "--json"
      ])
    ) as { workflow_plan: { id: number } };

    const first = JSON.parse(
      runCli([
        "record-model-candidate",
        "--production-workflow-plan-id",
        String(plan.workflow_plan.id),
        "--intake-request-id",
        String(intake.id),
        "--source",
        "thingiverse",
        "--source-url",
        "https://www.thingiverse.com/thing:111",
        "--title",
        "Phone holder A",
        "--author",
        "maker-a",
        "--license",
        "CC-BY",
        "--fit-status",
        "fits",
        "--dimensions-json",
        "{\"x\":80,\"y\":70,\"z\":120}",
        "--score",
        "90",
        "--json"
      ])
    ) as { id: number; source_url: string; status: string; fit_status: string; score: number };
    const second = JSON.parse(
      runCli([
        "record-model-candidate",
        "--production-workflow-plan-id",
        String(plan.workflow_plan.id),
        "--intake-request-id",
        String(intake.id),
        "--source",
        "printables",
        "--source-url",
        "https://www.printables.com/model/222",
        "--title",
        "Phone holder B",
        "--license",
        "CC-BY-SA",
        "--fit-status",
        "needs_review",
        "--score",
        "50",
        "--json"
      ])
    ) as { id: number; status: string };

    expect(first.source_url).toBe("https://www.thingiverse.com/thing:111");
    expect(first.fit_status).toBe("fits");
    expect(first.score).toBe(90);
    expect(second.status).toBe("candidate");

    const selected = JSON.parse(runCli(["select-model-candidate", "--id", String(first.id), "--notes", "Best commercial fit.", "--json"])) as {
      id: number;
      status: string;
      notes: string;
    };
    expect(selected).toMatchObject({ id: first.id, status: "selected", notes: "Best commercial fit." });

    const listed = JSON.parse(
      runCli(["list-model-candidates", "--production-workflow-plan-id", String(plan.workflow_plan.id), "--json"])
    ) as Array<{ id: number; status: string; score: number }>;
    expect(listed.map((candidate) => candidate.id)).toEqual([first.id, second.id]);
    expect(listed.find((candidate) => candidate.id === first.id)?.status).toBe("selected");
  });

  it("creates a print package with checklist, notes, and metadata, then updates status", () => {
    const intake = JSON.parse(
      runCli(["create-intake", "--source", "manual", "--surface", "openclaw_discord", "--channel", "intake", "--message", "Print STL.", "--json"])
    ) as { id: number };
    const artifact = JSON.parse(
      runCli(["store-artifact", "--intake-request-id", String(intake.id), "--path", "tests/fixtures/test_part.stl", "--artifact-type", "stl", "--json"])
    ) as { id: number };
    runCli(["review-file", "--artifact-id", String(artifact.id), "--json"]);

    const printPackage = JSON.parse(
      runCli([
        "create-print-package",
        "--intake-request-id",
        String(intake.id),
        "--artifact-id",
        String(artifact.id),
        "--material-profile",
        "PETG",
        "--printer-profile",
        "default-bambu",
        "--quantity",
        "4",
        "--json"
      ])
    ) as { id: number; status: string; package_dir: string; prepared_file_path: string; preview_path: string };

    expect(printPackage.status).toBe("ready_for_preview");
    expect(fs.existsSync(path.join(printPackage.package_dir, "original"))).toBe(true);
    expect(fs.existsSync(path.join(printPackage.package_dir, "working"))).toBe(true);
    expect(fs.existsSync(path.join(printPackage.package_dir, "bambu"))).toBe(true);
    expect(fs.existsSync(printPackage.preview_path)).toBe(true);
    expect(fs.existsSync(printPackage.prepared_file_path)).toBe(true);
    expect(fs.readFileSync(path.join(printPackage.package_dir, "checklist.md"), "utf8")).toContain("print send requires explicit human approval");
    expect(fs.readFileSync(path.join(printPackage.package_dir, "handoff.md"), "utf8")).toContain("Bambu Studio Handoff");
    expect(fs.readFileSync(path.join(printPackage.package_dir, "notes.md"), "utf8")).toBe("\n");
    expect(JSON.parse(fs.readFileSync(path.join(printPackage.package_dir, "print_package.json"), "utf8"))).toMatchObject({
      artifact_type: "stl",
      material_profile: "PETG",
      no_unapproved_printing: true,
      quantity: 4
    });

    const updated = JSON.parse(
      runCli(["mark-print-package-status", "--id", String(printPackage.id), "--status", "opened_for_preview", "--json"])
    ) as { status: string };
    expect(updated.status).toBe("opened_for_preview");

    const awaitingApproval = JSON.parse(
      runCli(["mark-print-package-status", "--id", String(printPackage.id), "--status", "awaiting_human_approval", "--json"])
    ) as { status: string };
    expect(awaitingApproval.status).toBe("awaiting_human_approval");

    const shown = JSON.parse(runCli(["show-print-package", "--id", String(printPackage.id), "--json"])) as {
      print_package: { status: string };
    };
    expect(shown.print_package.status).toBe("awaiting_human_approval");
  });

  it("requires reviewed printable artifacts and valid package status transitions", () => {
    const intake = JSON.parse(
      runCli(["create-intake", "--source", "manual", "--surface", "openclaw_discord", "--channel", "intake", "--message", "Print STL.", "--json"])
    ) as { id: number };
    const artifact = JSON.parse(
      runCli(["store-artifact", "--intake-request-id", String(intake.id), "--path", "tests/fixtures/test_part.stl", "--artifact-type", "stl", "--json"])
    ) as { id: number };

    expect(() =>
      runCli([
        "create-print-package",
        "--intake-request-id",
        String(intake.id),
        "--artifact-id",
        String(artifact.id),
        "--material-profile",
        "PETG",
        "--printer-profile",
        "default-bambu",
        "--quantity",
        "4",
        "--json"
      ])
    ).toThrow(/must be reviewed/);

    runCli(["review-file", "--artifact-id", String(artifact.id), "--json"]);
    const printPackage = JSON.parse(
      runCli([
        "create-print-package",
        "--intake-request-id",
        String(intake.id),
        "--artifact-id",
        String(artifact.id),
        "--material-profile",
        "PETG",
        "--printer-profile",
        "default-bambu",
        "--quantity",
        "4",
        "--json"
      ])
    ) as { id: number };

    expect(() => runCli(["mark-print-package-status", "--id", String(printPackage.id), "--status", "approved_to_send", "--json"])).toThrow(
      /Invalid print package status transition/
    );
  });

  it("runs the fixture-backed print package smoke path without opening Bambu Studio by default", () => {
    const smoke = JSON.parse(runCli(["smoke-print-package", "--json"])) as {
      ok: boolean;
      intake: { id: number; source: string; status: string };
      artifact: { id: number; artifact_type: string; sha256: string; size_bytes: number };
      review: { status: string };
      print_package: { id: number; status: string; package_dir: string; prepared_file_path: string };
      package_files: { checklist: string; handoff: string; metadata: string; notes: string };
      metadata_checks: { artifact_sha256_matches: boolean; artifact_size_matches: boolean; no_unapproved_printing: boolean };
      remote_inspection_generated: boolean;
      remote_inspection: {
        review_card_path: string;
        preview_files: Record<string, string>;
        raster_preview_files: Record<string, string>;
      };
      preview_open_attempted: boolean;
      preview: null;
    };

    expect(smoke.ok).toBe(true);
    expect(smoke.intake.source).toBe("smoke");
    expect(smoke.intake.status).toBe("print_package_ready");
    expect(smoke.artifact.artifact_type).toBe("stl");
    expect(smoke.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(smoke.artifact.size_bytes).toBeGreaterThan(0);
    expect(smoke.review.status).toBe("valid_enough");
    expect(smoke.print_package.status).toBe("ready_for_preview");
    expect(fs.existsSync(smoke.print_package.prepared_file_path)).toBe(true);
    expect(fs.existsSync(smoke.package_files.checklist)).toBe(true);
    expect(fs.existsSync(smoke.package_files.handoff)).toBe(true);
    expect(fs.existsSync(smoke.package_files.metadata)).toBe(true);
    expect(fs.existsSync(smoke.package_files.notes)).toBe(true);
    expect(smoke.metadata_checks).toEqual({
      artifact_sha256_matches: true,
      artifact_size_matches: true,
      no_unapproved_printing: true
    });
    expect(smoke.remote_inspection_generated).toBe(true);
    expect(fs.existsSync(smoke.remote_inspection.review_card_path)).toBe(true);
    expect(Object.keys(smoke.remote_inspection.preview_files).sort()).toEqual(["prepare_view_1", "prepare_view_2", "prepare_view_3"]);
    for (const filePath of Object.values(smoke.remote_inspection.preview_files)) {
      expect(fs.existsSync(filePath)).toBe(true);
      expect(filePath).toMatch(/\.png$/);
    }
    expect(smoke.preview_open_attempted).toBe(false);
    expect(smoke.preview).toBeNull();
  });

  it("probes Bambu tooling as JSON without requiring Bambu to exist", () => {
    const probe = JSON.parse(runCli(["probe-bambu", "--json"])) as {
      ok: boolean;
      bambu_studio: { found: boolean; paths: string[] };
      studio_config: { configured_printers: unknown[] };
      safety: { sends_to_printer: boolean; requires_login: boolean };
    };

    expect(probe.ok).toBe(true);
    expect(Array.isArray(probe.bambu_studio.paths)).toBe(true);
    expect(Array.isArray(probe.studio_config.configured_printers)).toBe(true);
    expect(probe.safety.sends_to_printer).toBe(false);
    expect(probe.safety.requires_login).toBe(false);
  });

  it("open preview fails gracefully when Bambu Studio is missing and never sends to a printer", () => {
    const intake = JSON.parse(
      runCli(["create-intake", "--source", "manual", "--surface", "openclaw_discord", "--channel", "intake", "--message", "Print STL.", "--json"])
    ) as { id: number };
    const artifact = JSON.parse(
      runCli(["store-artifact", "--intake-request-id", String(intake.id), "--path", "tests/fixtures/test_part.stl", "--artifact-type", "stl", "--json"])
    ) as { id: number };
    runCli(["review-file", "--artifact-id", String(artifact.id), "--json"]);
    const printPackage = JSON.parse(
      runCli([
        "create-print-package",
        "--intake-request-id",
        String(intake.id),
        "--artifact-id",
        String(artifact.id),
        "--material-profile",
        "PETG",
        "--printer-profile",
        "default-bambu",
        "--quantity",
        "4",
        "--json"
      ])
    ) as { id: number };

    const opened = JSON.parse(runCli(["open-print-package-preview", "--print-package-id", String(printPackage.id), "--json"])) as {
      ok: boolean;
      opened: boolean;
      handoff?: { type: string; status: string };
      probe: { bambu_studio: { found: boolean }; safety: { sends_to_printer: boolean } };
      next_manual_step?: string;
    };

    expect(opened.probe.safety.sends_to_printer).toBe(false);
    if (!opened.probe.bambu_studio.found) {
      expect(opened.ok).toBe(false);
      expect(opened.opened).toBe(false);
      expect(opened.handoff).toMatchObject({ type: "approve_print_send", status: "open" });
      expect(opened.next_manual_step).toContain("Do not send to printer without approval");
    }
  });

  it("creates Auto Arrange handoff without sending to a printer", () => {
    const intake = JSON.parse(
      runCli(["create-intake", "--source", "manual", "--surface", "openclaw_discord", "--channel", "intake", "--message", "Print STL.", "--json"])
    ) as { id: number };
    const artifact = JSON.parse(
      runCli(["store-artifact", "--intake-request-id", String(intake.id), "--path", "tests/fixtures/test_part.stl", "--artifact-type", "stl", "--json"])
    ) as { id: number };
    runCli(["review-file", "--artifact-id", String(artifact.id), "--json"]);
    const printPackage = JSON.parse(
      runCli([
        "create-print-package",
        "--intake-request-id",
        String(intake.id),
        "--artifact-id",
        String(artifact.id),
        "--material-profile",
        "PETG",
        "--printer-profile",
        "default-bambu",
        "--quantity",
        "1",
        "--json"
      ])
    ) as { id: number; package_dir: string };

    const result = JSON.parse(runCli(["request-bambu-auto-arrange", "--print-package-id", String(printPackage.id), "--json"])) as {
      handoff: { type: string; status: string; instructions: string };
      attempted_ui_automation: boolean;
      safety: { sends_to_printer: boolean; requires_human_approval: boolean };
    };

    expect(result.handoff).toMatchObject({ type: "preview_print_package", status: "open" });
    expect(result.handoff.instructions).toContain("Auto Arrange");
    expect(result.attempted_ui_automation).toBe(false);
    expect(result.safety).toEqual({ sends_to_printer: false, requires_human_approval: true });
    expect(fs.readFileSync(path.join(printPackage.package_dir, "notes.md"), "utf8")).toContain("Auto Arrange Request");
  });

  it("generates Discord-friendly remote inspection previews", () => {
    const intake = JSON.parse(
      runCli(["create-intake", "--source", "manual", "--surface", "openclaw_discord", "--channel", "intake", "--message", "Print STL.", "--json"])
    ) as { id: number };
    const artifact = JSON.parse(
      runCli(["store-artifact", "--intake-request-id", String(intake.id), "--path", "tests/fixtures/test_part.stl", "--artifact-type", "stl", "--json"])
    ) as { id: number };
    runCli(["review-file", "--artifact-id", String(artifact.id), "--json"]);
    const printPackage = JSON.parse(
      runCli([
        "create-print-package",
        "--intake-request-id",
        String(intake.id),
        "--artifact-id",
        String(artifact.id),
        "--material-profile",
        "PETG",
        "--printer-profile",
        "default-bambu",
        "--quantity",
        "1",
        "--json"
      ])
    ) as { id: number };
    const thread = JSON.parse(
      runCli([
        "record-discord-job-thread",
        "--channel",
        "general",
        "--thread-id",
        "discord-thread-inspection-1",
        "--thread-name",
        "inspection thread",
        "--json"
      ])
    ) as { id: number };
    runCli([
      "link-discord-job-artifact",
      "--job-thread-record-id",
      String(thread.id),
      "--intake-request-id",
      String(intake.id),
      "--artifact-id",
      String(artifact.id),
      "--relationship",
      "plate_member",
      "--json"
    ]);

    const inspection = JSON.parse(runCli(["create-remote-inspection", "--print-package-id", String(printPackage.id), "--json"])) as {
      geometry: { format: string; triangles: number; bounds: { dimensions_mm: number[] } };
      printability: {
        orientation_source: string;
        plate_layout_source: string;
        bed_size_mm: number[];
        arranged_instances: Array<{ label: string; mirrored: boolean }>;
        fits_estimated_layout: boolean;
        likely_support_triangles: number;
      };
      review_card_path: string;
      preview_type: string;
      preview_files: Record<string, string>;
      raster_preview_files: Record<string, string>;
      auto_arrange: {
        attempted_ui_automation: boolean;
        safety: { sends_to_printer: boolean; requires_human_approval: boolean };
      };
      discord_target_thread: { thread_id: string; thread_name: string } | null;
      discord_summary: string;
      safety: { sends_to_printer: boolean; requires_human_approval: boolean };
    };

    expect(inspection.geometry.format).toBe("ascii_stl");
    expect(inspection.geometry.triangles).toBe(1);
    expect(inspection.geometry.bounds.dimensions_mm).toEqual([1, 1, 0]);
    expect(inspection.preview_type).toBe("bambu_studio_style_raster");
    expect(Object.keys(inspection.preview_files).sort()).toEqual(["prepare_view_1", "prepare_view_2", "prepare_view_3"]);
    expect(inspection.preview_files).toEqual(inspection.raster_preview_files);
    expect(inspection.auto_arrange.attempted_ui_automation).toBe(true);
    expect(inspection.auto_arrange.safety).toEqual({ sends_to_printer: false, requires_human_approval: true });
    expect(inspection.printability.orientation_source).toBe("package_coordinates");
    expect(inspection.printability.plate_layout_source).toBe("estimated_centered_grid");
    expect(inspection.printability.bed_size_mm).toEqual([256, 256]);
    expect(inspection.printability.arranged_instances).toHaveLength(1);
    expect(inspection.printability.arranged_instances[0].mirrored).toBe(false);
    expect(inspection.printability.fits_estimated_layout).toBe(true);
    expect(fs.existsSync(inspection.review_card_path)).toBe(true);
    expect(inspection.discord_summary).toContain("MICBot remote inspection");
    expect(inspection.discord_summary).toContain("Bambu Studio style raster screenshots only");
    expect(inspection.discord_summary).toContain("Auto Arrange");
    expect(inspection.discord_target_thread).toMatchObject({ thread_id: "discord-thread-inspection-1", thread_name: "inspection thread" });
    expect(inspection.safety).toEqual({ sends_to_printer: false, requires_human_approval: true });
    for (const filePath of Object.values(inspection.preview_files)) {
      expect(fs.existsSync(filePath)).toBe(true);
      expect(filePath).toMatch(/\.png$/);
    }
  });
});
