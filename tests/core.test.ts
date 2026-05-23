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

  it("creates a print package with checklist, notes, and metadata, then updates status", () => {
    const intake = JSON.parse(
      runCli(["create-intake", "--source", "manual", "--surface", "openclaw_discord", "--channel", "intake", "--message", "Print STL.", "--json"])
    ) as { id: number };
    const artifact = JSON.parse(
      runCli(["store-artifact", "--intake-request-id", String(intake.id), "--path", "tests/fixtures/test_part.stl", "--artifact-type", "stl", "--json"])
    ) as { id: number };

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
    expect(fs.readFileSync(path.join(printPackage.package_dir, "notes.md"), "utf8")).toBe("\n");
    expect(JSON.parse(fs.readFileSync(path.join(printPackage.package_dir, "package.json"), "utf8"))).toMatchObject({
      no_autonomous_printing: true,
      quantity: 4
    });

    const updated = JSON.parse(
      runCli(["mark-print-package-status", "--id", String(printPackage.id), "--status", "awaiting_human_approval", "--json"])
    ) as { status: string };
    expect(updated.status).toBe("awaiting_human_approval");

    const shown = JSON.parse(runCli(["show-print-package", "--id", String(printPackage.id), "--json"])) as {
      print_package: { status: string };
    };
    expect(shown.print_package.status).toBe("awaiting_human_approval");
  });

  it("probes Bambu tooling as JSON without requiring Bambu to exist", () => {
    const probe = JSON.parse(runCli(["probe-bambu", "--json"])) as {
      ok: boolean;
      bambu_studio: { found: boolean; paths: string[] };
      bambu_connect: { found: boolean; paths: string[] };
      safety: { sends_to_printer: boolean; requires_login: boolean };
    };

    expect(probe.ok).toBe(true);
    expect(Array.isArray(probe.bambu_studio.paths)).toBe(true);
    expect(Array.isArray(probe.bambu_connect.paths)).toBe(true);
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
});
