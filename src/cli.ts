#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { getDb, initDb, projectRoot } from "./db.js";
import {
  addMemoryEntry,
  assertMemoryCategory,
  deprecateMemoryEntry,
  listMemoryEntries,
  parseSourceRawMessageIds,
  showMemoryEntry,
  updateMemoryEntry
} from "./memoryEntries.js";
import { addRawMessage, listRawMessages, showRawMessage } from "./rawMessages.js";
import { getSetting, listSettings, setSetting } from "./settings.js";
import { rebuildWiki } from "./wiki.js";
import {
  createIntake,
  createDiscordAttachmentIntake,
  createPrintPackage,
  createRemoteInspection,
  discordJobContextForArtifact,
  discordJobContextForPrintPackage,
  discordJobContextForThread,
  latestHumanHandoffForPrintPackage,
  linkDiscordJobArtifact,
  listArtifacts,
  listIntakes,
  listProductionWorkflowPlans,
  markPrintPackageStatus,
  openPrintPackagePreview,
  planProductionWorkflow,
  probeBambu,
  recordDiscordJobThread,
  requestBambuAutoArrange,
  reviewFile,
  showArtifact,
  showFileReview,
  showIntake,
  showLatestFileReviewForArtifact,
  showPrintPackage,
  showProductionWorkflowPlan,
  storeArtifact,
  updateIntakeStatus
} from "./intakeWorkflow.js";

const program = new Command();

function writeJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function writeOutput(value: unknown, json: boolean | undefined, human: string): void {
  if (json) {
    writeJson(value);
    return;
  }

  console.log(human);
}

function parseRequiredId(value: string, label = "id"): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return id;
}

function writeCommandError(error: unknown, json: boolean | undefined, details: Record<string, unknown> = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    writeJson({ ok: false, error: { message }, ...details });
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}

function resolveProjectPath(inputPath: string): string {
  return path.isAbsolute(inputPath) ? inputPath : path.join(projectRoot(), inputPath);
}

function readPackageJson(packageDir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(packageDir, "print_package.json"), "utf8")) as Record<string, unknown>;
}

function verifyPrintPackageFiles(packageDir: string): { checklist: string; handoff: string; metadata: string; notes: string } {
  const files = {
    checklist: path.join(packageDir, "checklist.md"),
    handoff: path.join(packageDir, "handoff.md"),
    metadata: path.join(packageDir, "print_package.json"),
    notes: path.join(packageDir, "notes.md")
  };

  for (const [label, filePath] of Object.entries(files)) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Smoke check failed: missing ${label} file at ${filePath}`);
    }
  }

  return files;
}

program
  .name("micbot")
  .description("MICBot local CLI for raw business ledger and wiki projection")
  .version("0.1.0");

program.command("init-db").description("Initialize the SQLite database").action(() => {
  initDb();
  console.log("Initialized MICBot database.");
});

program
  .command("add-raw-message")
  .requiredOption("--surface <surface>")
  .requiredOption("--channel <channel>")
  .requiredOption("--direction <direction>")
  .requiredOption("--actor <actor>")
  .requiredOption("--content <content>")
  .option("--raw-json <json>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const row = addRawMessage({
      surface: options.surface,
      channel: options.channel,
      direction: options.direction,
      actor: options.actor,
      content: options.content,
      rawJson: options.rawJson
    });
    writeOutput(row, options.json, `Created raw message ${row.id}.`);
  });

program.command("list-raw-messages").description("List raw messages").option("--json", "Output valid JSON only").action((options) => {
  initDb();
  const rows = listRawMessages();
  writeOutput(rows, options.json, rows.map((row) => `${row.id}: [${row.surface}/${row.channel}] ${row.actor}: ${row.content}`).join("\n"));
});

program.command("show-raw-message").requiredOption("--id <id>").option("--json", "Output valid JSON only").action((options) => {
  initDb();
  const row = showRawMessage(Number(options.id));
  if (!row) {
    throw new Error(`Raw message not found: ${options.id}`);
  }
  writeOutput(row, options.json, `${row.id}: [${row.surface}/${row.channel}] ${row.actor}: ${row.content}`);
});

program
  .command("add-memory")
  .requiredOption("--category <category>")
  .requiredOption("--title <title>")
  .requiredOption("--body <body>")
  .requiredOption("--source-raw-message-ids <ids>")
  .requiredOption("--status <status>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    assertMemoryCategory(options.category);
    const row = addMemoryEntry({
      category: options.category,
      title: options.title,
      body: options.body,
      sourceRawMessageIds: parseSourceRawMessageIds(options.sourceRawMessageIds),
      status: options.status
    });
    rebuildWiki();
    writeOutput(row, options.json, `Created memory entry ${row.id} and rebuilt wiki.`);
  });

program
  .command("remember")
  .description("Capture a raw message, add linked distilled memory, and rebuild the wiki")
  .requiredOption("--surface <surface>")
  .requiredOption("--channel <channel>")
  .requiredOption("--direction <direction>")
  .requiredOption("--actor <actor>")
  .requiredOption("--content <content>")
  .requiredOption("--category <category>")
  .requiredOption("--title <title>")
  .requiredOption("--body <body>")
  .requiredOption("--status <status>")
  .option("--raw-json <json>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    let dbResult:
      | {
          raw_message: ReturnType<typeof addRawMessage>;
          memory_entry: ReturnType<typeof addMemoryEntry>;
        }
      | undefined;

    try {
      assertMemoryCategory(options.category);
      const writeDb = getDb().transaction(() => {
        const rawMessage = addRawMessage({
          surface: options.surface,
          channel: options.channel,
          direction: options.direction,
          actor: options.actor,
          content: options.content,
          rawJson: options.rawJson
        });
        const memoryEntry = addMemoryEntry({
          category: options.category,
          title: options.title,
          body: options.body,
          sourceRawMessageIds: [rawMessage.id],
          status: options.status
        });
        return { raw_message: rawMessage, memory_entry: memoryEntry };
      });
      dbResult = writeDb();
    } catch (error) {
      writeCommandError(error, options.json, { phase: "db_write", db_write_succeeded: false });
      return;
    }

    try {
      const wikiFiles = rebuildWiki();
      const result = { ok: true, ...dbResult, wiki_files: wikiFiles };
      writeOutput(
        result,
        options.json,
        `Created raw message ${dbResult.raw_message.id}, memory entry ${dbResult.memory_entry.id}, and rebuilt wiki.`
      );
    } catch (error) {
      writeCommandError(error, options.json, {
        phase: "wiki_rebuild",
        db_write_succeeded: true,
        raw_message: dbResult.raw_message,
        memory_entry: dbResult.memory_entry
      });
    }
  });

program
  .command("update-memory")
  .description("Update a distilled memory entry and rebuild the wiki")
  .requiredOption("--id <id>")
  .requiredOption("--category <category>")
  .requiredOption("--title <title>")
  .requiredOption("--body <body>")
  .requiredOption("--source-raw-message-ids <ids>")
  .requiredOption("--status <status>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    assertMemoryCategory(options.category);
    const memoryEntry = updateMemoryEntry({
      id: parseRequiredId(options.id),
      category: options.category,
      title: options.title,
      body: options.body,
      sourceRawMessageIds: parseSourceRawMessageIds(options.sourceRawMessageIds),
      status: options.status
    });
    const wikiFiles = rebuildWiki();
    const result = { memory_entry: memoryEntry, wiki_files: wikiFiles };
    writeOutput(result, options.json, `Updated memory entry ${memoryEntry.id} and rebuilt wiki.`);
  });

program
  .command("deprecate-memory")
  .description("Mark a distilled memory entry deprecated without deleting source evidence")
  .requiredOption("--id <id>")
  .requiredOption("--reason <reason>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const memoryEntry = deprecateMemoryEntry(parseRequiredId(options.id), options.reason);
    const wikiFiles = rebuildWiki();
    const result = { memory_entry: memoryEntry, wiki_files: wikiFiles };
    writeOutput(result, options.json, `Deprecated memory entry ${memoryEntry.id} and rebuilt wiki.`);
  });

program.command("list-memory").option("--category <category>").option("--json", "Output valid JSON only").action((options) => {
  initDb();
  if (options.category) {
    assertMemoryCategory(options.category);
  }
  const rows = listMemoryEntries(options.category);
  writeOutput(rows, options.json, rows.map((row) => `${row.id}: [${row.category}] ${row.title}`).join("\n"));
});

program.command("show-memory").requiredOption("--id <id>").option("--json", "Output valid JSON only").action((options) => {
  initDb();
  const row = showMemoryEntry(parseRequiredId(options.id));
  if (!row) {
    throw new Error(`Memory entry not found: ${options.id}`);
  }
  writeOutput(row, options.json, `${row.id}: [${row.category}] ${row.title}\n${row.body}`);
});

program.command("rebuild-wiki").description("Rebuild Markdown wiki files from SQLite").action(() => {
  initDb();
  console.log(JSON.stringify(rebuildWiki(), null, 2));
});

program.command("set-setting").requiredOption("--key <key>").requiredOption("--value <json>").action((options) => {
  initDb();
  console.log(JSON.stringify(setSetting(options.key, options.value), null, 2));
});

program.command("get-setting").requiredOption("--key <key>").action((options) => {
  initDb();
  const row = getSetting(options.key);
  if (!row) {
    throw new Error(`Setting not found: ${options.key}`);
  }
  console.log(JSON.stringify(row, null, 2));
});

program.command("list-settings").description("List settings").option("--json", "Output valid JSON only").action((options) => {
  initDb();
  const rows = listSettings();
  writeOutput(rows, options.json, rows.map((row) => `${row.key}: ${row.value_json}`).join("\n"));
});

program
  .command("create-intake")
  .description("Create a local intake request from a human-visible source")
  .requiredOption("--source <source>")
  .requiredOption("--surface <surface>")
  .requiredOption("--channel <channel>")
  .option("--customer-name <name>")
  .option("--customer-email <email>")
  .option("--customer-phone <phone>")
  .option("--offer-slug <slug>")
  .requiredOption("--message <message>")
  .option("--raw-message-id <id>")
  .option("--metadata-json <json>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const row = createIntake({
      source: options.source,
      surface: options.surface,
      channel: options.channel,
      customerName: options.customerName,
      customerEmail: options.customerEmail,
      customerPhone: options.customerPhone,
      offerSlug: options.offerSlug,
      message: options.message,
      rawMessageId: options.rawMessageId ? parseRequiredId(options.rawMessageId, "raw-message-id") : undefined,
      metadataJson: options.metadataJson
    });
    writeOutput(row, options.json, `Created intake request ${row.id}.`);
  });

program.command("list-intakes").description("List intake requests").option("--json", "Output valid JSON only").action((options) => {
  initDb();
  const rows = listIntakes();
  writeOutput(rows, options.json, rows.map((row) => `${row.id}: [${row.status}] ${row.customer_name ?? "unknown"}: ${row.message}`).join("\n"));
});

program.command("show-intake").requiredOption("--id <id>").option("--json", "Output valid JSON only").action((options) => {
  initDb();
  const row = showIntake(parseRequiredId(options.id));
  if (!row) {
    throw new Error(`Intake request not found: ${options.id}`);
  }
  writeOutput(row, options.json, `${row.id}: [${row.status}] ${row.message}`);
});

program
  .command("update-intake-status")
  .requiredOption("--id <id>")
  .requiredOption("--status <status>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const row = updateIntakeStatus(parseRequiredId(options.id), options.status);
    writeOutput(row, options.json, `Updated intake request ${row.id} to ${row.status}.`);
  });

program
  .command("store-artifact")
  .description("Copy an uploaded/customer file into managed artifact storage")
  .requiredOption("--intake-request-id <id>")
  .requiredOption("--path <path>")
  .option("--artifact-type <type>")
  .option("--raw-message-id <id>")
  .option("--metadata-json <json>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const row = storeArtifact({
      intakeRequestId: parseRequiredId(options.intakeRequestId, "intake-request-id"),
      filePath: options.path,
      artifactType: options.artifactType,
      rawMessageId: options.rawMessageId ? parseRequiredId(options.rawMessageId, "raw-message-id") : undefined,
      metadataJson: options.metadataJson
    });
    writeOutput(row, options.json, `Stored artifact ${row.id} at ${row.stored_path}.`);
  });

program
  .command("intake-discord-attachment")
  .description("Create an intake record from a Discord printable-file attachment")
  .requiredOption("--channel <channel>")
  .requiredOption("--author <author>")
  .requiredOption("--message-id <id>")
  .requiredOption("--attachment-path <path>")
  .option("--attachment-filename <filename>")
  .option("--message-content <content>")
  .option("--guild-id <id>")
  .option("--channel-id <id>")
  .option("--author-id <id>")
  .option("--attachment-id <id>")
  .option("--attachment-url <url>")
  .option("--content-type <type>")
  .option("--customer-name <name>")
  .option("--job-thread-id <id>", "Discord thread id for the scoped job thread")
  .option("--job-thread-name <name>")
  .option("--job-thread-record-id <id>", "Existing local discord_job_threads row id")
  .option("--version-label <label>", "Version label within the job thread, such as v1 or v2")
  .option("--artifact-relationship <relationship>", "primary, revision, or plate_member", "primary")
  .option("--metadata-json <json>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const result = createDiscordAttachmentIntake({
      channel: options.channel,
      author: options.author,
      messageId: options.messageId,
      attachmentPath: resolveProjectPath(options.attachmentPath),
      attachmentFilename: options.attachmentFilename,
      messageContent: options.messageContent,
      guildId: options.guildId,
      channelId: options.channelId,
      authorId: options.authorId,
      attachmentId: options.attachmentId,
      attachmentUrl: options.attachmentUrl,
      contentType: options.contentType,
      customerName: options.customerName,
      metadataJson: options.metadataJson,
      jobThreadId: options.jobThreadId,
      jobThreadName: options.jobThreadName,
      jobThreadRecordId: options.jobThreadRecordId ? parseRequiredId(options.jobThreadRecordId, "job-thread-record-id") : undefined,
      versionLabel: options.versionLabel,
      artifactRelationship: options.artifactRelationship
    });
    writeOutput(
      result,
      options.json,
      `Created Discord attachment intake ${result.intake.id}; artifact ${result.artifact.id} is ready for review.`
    );
  });

program
  .command("record-discord-job-thread")
  .description("Record or update the Discord thread that scopes one print job/order")
  .requiredOption("--channel <channel>")
  .requiredOption("--thread-id <id>")
  .requiredOption("--thread-name <name>")
  .option("--guild-id <id>")
  .option("--channel-id <id>")
  .option("--source-message-id <id>")
  .option("--customer-name <name>")
  .option("--summary <summary>")
  .option("--metadata-json <json>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const row = recordDiscordJobThread({
      channel: options.channel,
      threadId: options.threadId,
      threadName: options.threadName,
      guildId: options.guildId,
      channelId: options.channelId,
      sourceMessageId: options.sourceMessageId,
      customerName: options.customerName,
      summary: options.summary,
      metadataJson: options.metadataJson
    });
    writeOutput(row, options.json, `Recorded Discord job thread ${row.id}: ${row.thread_name}.`);
  });

program
  .command("link-discord-job-artifact")
  .description("Attach an intake artifact to a Discord job thread as a primary file, revision, or plate member")
  .requiredOption("--job-thread-record-id <id>")
  .requiredOption("--intake-request-id <id>")
  .requiredOption("--artifact-id <id>")
  .option("--version-label <label>")
  .option("--relationship <relationship>", "primary, revision, or plate_member", "primary")
  .option("--status <status>", "active, superseded, or rejected", "active")
  .option("--notes <notes>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const row = linkDiscordJobArtifact({
      discordJobThreadId: parseRequiredId(options.jobThreadRecordId, "job-thread-record-id"),
      intakeRequestId: parseRequiredId(options.intakeRequestId, "intake-request-id"),
      artifactId: parseRequiredId(options.artifactId, "artifact-id"),
      versionLabel: options.versionLabel,
      relationship: options.relationship,
      status: options.status,
      notes: options.notes
    });
    writeOutput(row, options.json, `Linked artifact ${row.artifact_id} to Discord job thread ${row.discord_job_thread_id}.`);
  });

program
  .command("show-discord-job-context")
  .description("Show the Discord job thread and linked artifacts for an artifact or print package")
  .option("--job-thread-record-id <id>")
  .option("--artifact-id <id>")
  .option("--print-package-id <id>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const context = options.jobThreadRecordId
      ? discordJobContextForThread(parseRequiredId(options.jobThreadRecordId, "job-thread-record-id"))
      : options.artifactId
        ? discordJobContextForArtifact(parseRequiredId(options.artifactId, "artifact-id"))
        : options.printPackageId
          ? discordJobContextForPrintPackage(parseRequiredId(options.printPackageId, "print-package-id"))
          : null;
    if (!context) {
      throw new Error("Discord job context not found. Provide --job-thread-record-id, --artifact-id, or --print-package-id.");
    }
    writeOutput(context, options.json, `Discord job thread ${context.thread.id}: ${context.thread.thread_name}.`);
  });

program
  .command("list-artifacts")
  .option("--intake-request-id <id>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const rows = listArtifacts(options.intakeRequestId ? parseRequiredId(options.intakeRequestId, "intake-request-id") : undefined);
    writeOutput(rows, options.json, rows.map((row) => `${row.id}: [${row.artifact_type}] ${row.filename}`).join("\n"));
  });

program.command("show-artifact").requiredOption("--id <id>").option("--json", "Output valid JSON only").action((options) => {
  initDb();
  const row = showArtifact(parseRequiredId(options.id));
  if (!row) {
    throw new Error(`Artifact not found: ${options.id}`);
  }
  writeOutput(row, options.json, `${row.id}: [${row.artifact_type}] ${row.stored_path}`);
});

program.command("review-file").requiredOption("--artifact-id <id>").option("--json", "Output valid JSON only").action((options) => {
  initDb();
  const row = reviewFile(parseRequiredId(options.artifactId, "artifact-id"));
  writeOutput(row, options.json, `Reviewed artifact ${row.artifact_id}: ${row.status}.`);
});

program
  .command("plan-production-workflow")
  .description("Route a physical-object request into MICBot's search/CAD/mesh/package workflow")
  .requiredOption("--message <message>")
  .option("--source-kind <kind>", "text, image, video, model, cad, or unknown", "text")
  .option("--intake-request-id <id>")
  .option("--artifact-id <id>")
  .option("--record", "Persist the workflow plan in SQLite")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const result = planProductionWorkflow({
      message: options.message,
      sourceKind: options.sourceKind,
      intakeRequestId: options.intakeRequestId ? parseRequiredId(options.intakeRequestId, "intake-request-id") : undefined,
      artifactId: options.artifactId ? parseRequiredId(options.artifactId, "artifact-id") : undefined,
      record: options.record === true
    });
    writeOutput(result, options.json, `Planned production workflow route: ${result.route}.`);
  });

program
  .command("show-production-workflow-plan")
  .requiredOption("--id <id>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const row = showProductionWorkflowPlan(parseRequiredId(options.id));
    if (!row) {
      throw new Error(`Production workflow plan not found: ${options.id}`);
    }
    writeOutput(row, options.json, `Production workflow plan ${row.id}: ${row.route}.`);
  });

program
  .command("list-production-workflow-plans")
  .option("--intake-request-id <id>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const rows = listProductionWorkflowPlans(
      options.intakeRequestId ? parseRequiredId(options.intakeRequestId, "intake-request-id") : undefined
    );
    writeOutput(rows, options.json, `Found ${rows.length} production workflow plan(s).`);
  });

program
  .command("show-file-review")
  .option("--id <id>")
  .option("--artifact-id <id>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const row = options.id
      ? showFileReview(parseRequiredId(options.id))
      : options.artifactId
        ? showLatestFileReviewForArtifact(parseRequiredId(options.artifactId, "artifact-id"))
        : undefined;
    if (!row) {
      throw new Error("File review not found. Provide --id or --artifact-id.");
    }
    writeOutput(row, options.json, `${row.id}: artifact ${row.artifact_id} ${row.status}.`);
  });

program
  .command("create-print-package")
  .description("Create a human-reviewable local print package")
  .requiredOption("--intake-request-id <id>")
  .requiredOption("--artifact-id <id>")
  .requiredOption("--material-profile <profile>")
  .requiredOption("--printer-profile <profile>")
  .requiredOption("--quantity <quantity>")
  .option("--notes <notes>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const row = createPrintPackage({
      intakeRequestId: parseRequiredId(options.intakeRequestId, "intake-request-id"),
      artifactId: parseRequiredId(options.artifactId, "artifact-id"),
      materialProfile: options.materialProfile,
      printerProfile: options.printerProfile,
      quantity: parseRequiredId(options.quantity, "quantity"),
      notes: options.notes
    });
    writeOutput(row, options.json, `Created print package ${row.id} at ${row.package_dir}.`);
  });

program.command("show-print-package").requiredOption("--id <id>").option("--json", "Output valid JSON only").action((options) => {
  initDb();
  const printPackage = showPrintPackage(parseRequiredId(options.id));
  if (!printPackage) {
    throw new Error(`Print package not found: ${options.id}`);
  }
  const handoff = latestHumanHandoffForPrintPackage(printPackage.id);
  writeOutput({ print_package: printPackage, latest_handoff: handoff ?? null }, options.json, `${printPackage.id}: ${printPackage.status} ${printPackage.package_dir}`);
});

program
  .command("mark-print-package-status")
  .requiredOption("--id <id>")
  .requiredOption("--status <status>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const row = markPrintPackageStatus(parseRequiredId(options.id), options.status);
    writeOutput(row, options.json, `Updated print package ${row.id} to ${row.status}.`);
  });

program.command("probe-bambu").description("Detect local Bambu preview capabilities without login or printer send").option("--json", "Output valid JSON only").action((options) => {
  const result = probeBambu();
  writeOutput(result, options.json, result.bambu_studio.found ? "Bambu Studio detected." : "Bambu Studio not detected.");
});

program
  .command("open-print-package-preview")
  .description("Open a package in Bambu Studio if available and create a human approval handoff")
  .requiredOption("--print-package-id <id>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const result = openPrintPackagePreview(parseRequiredId(options.printPackageId, "print-package-id"));
    const human = result.opened
      ? `Opened print package ${result.print_package.id} for preview.`
      : `Preview was not opened. ${result.next_manual_step ?? ""}`.trim();
    writeOutput(result, options.json, human);
  });

program
  .command("request-bambu-auto-arrange")
  .description("Create a Bambu Studio Auto Arrange handoff, optionally attempting the UI shortcut")
  .requiredOption("--print-package-id <id>")
  .option("--attempt-ui", "Activate Bambu Studio and send the Auto Arrange keyboard shortcut")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const result = requestBambuAutoArrange(parseRequiredId(options.printPackageId, "print-package-id"), options.attemptUi === true);
    const human = result.attempted_ui_automation
      ? `Requested Auto Arrange for print package ${result.print_package.id}; UI automation ${result.ui_automation.ok ? "succeeded" : "failed"}.`
      : `Created Auto Arrange handoff ${result.handoff.id} for print package ${result.print_package.id}.`;
    writeOutput(result, options.json, human);
  });

program
  .command("create-remote-inspection")
  .description("Generate Discord-friendly remote inspection previews for a print package")
  .requiredOption("--print-package-id <id>")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const result = createRemoteInspection(parseRequiredId(options.printPackageId, "print-package-id"));
    writeOutput(result, options.json, `Created remote inspection card at ${result.review_card_path}.`);
  });

program
  .command("smoke-print-package")
  .description("Run the local intake -> review -> print package smoke path using a known-good fixture")
  .option("--fixture-path <path>", "Fixture STL/3MF/STEP path", "tests/fixtures/test_part.stl")
  .option("--material-profile <profile>", "Material profile", "PETG")
  .option("--printer-profile <profile>", "Printer profile", "default-bambu")
  .option("--quantity <quantity>", "Quantity", "1")
  .option("--open-preview", "Attempt to open Bambu Studio preview after package creation")
  .option("--skip-remote-inspection", "Skip Discord-friendly inspection image generation")
  .option("--json", "Output valid JSON only")
  .action((options) => {
    initDb();
    const fixturePath = resolveProjectPath(options.fixturePath);
    const intake = createIntake({
      source: "smoke",
      surface: "system",
      channel: "smoke",
      customerName: "Smoke Test",
      offerSlug: "print-package-smoke",
      message: `Smoke test package from ${fixturePath}`,
      metadataJson: JSON.stringify({ smoke_test: true, fixture_path: fixturePath })
    });
    const artifact = storeArtifact({
      intakeRequestId: intake.id,
      filePath: fixturePath,
      metadataJson: JSON.stringify({ smoke_test: true })
    });
    const review = reviewFile(artifact.id);
    const printPackage = createPrintPackage({
      intakeRequestId: intake.id,
      artifactId: artifact.id,
      materialProfile: options.materialProfile,
      printerProfile: options.printerProfile,
      quantity: parseRequiredId(options.quantity, "quantity"),
      notes: "Created by smoke-print-package."
    });
    const packageFiles = verifyPrintPackageFiles(printPackage.package_dir);
    const metadata = readPackageJson(printPackage.package_dir);
    const remoteInspection = options.skipRemoteInspection ? null : createRemoteInspection(printPackage.id);
    const preview = options.openPreview ? openPrintPackagePreview(printPackage.id) : null;
    const finalIntake = showIntake(intake.id);
    const finalPrintPackage = showPrintPackage(printPackage.id);
    const result = {
      ok: true,
      intake: finalIntake ?? intake,
      artifact,
      review,
      print_package: finalPrintPackage ?? printPackage,
      package_files: packageFiles,
      metadata_checks: {
        artifact_sha256_matches: metadata.artifact_sha256 === artifact.sha256,
        artifact_size_matches: metadata.artifact_size_bytes === artifact.size_bytes,
        no_unapproved_printing: metadata.no_unapproved_printing === true
      },
      remote_inspection_generated: remoteInspection !== null,
      remote_inspection: remoteInspection,
      preview_open_attempted: Boolean(options.openPreview),
      preview
    };

    writeOutput(result, options.json, `Smoke print package ${printPackage.id} created at ${printPackage.package_dir}.`);
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
