import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { artifactsDir, getDb, printPackagesDir } from "./db.js";

export const intakeStatuses = [
  "received",
  "file_stored",
  "file_validated",
  "print_package_ready",
  "awaiting_human_approval",
  "approved_to_send",
  "sent_to_printer",
  "printing",
  "awaiting_bed_clear",
  "physical_object_done",
  "failed_needs_intervention",
  "cancelled"
] as const;

export const artifactTypes = ["stl", "3mf", "step", "image", "pdf", "other"] as const;
export const fileReviewStatuses = ["pending", "valid_enough", "needs_human_review", "rejected"] as const;
export const printPackageStatuses = [
  "pending",
  "ready_for_preview",
  "opened_for_preview",
  "awaiting_human_approval",
  "approved_to_send",
  "rejected",
  "sent_to_printer",
  "printing",
  "failed",
  "completed"
] as const;

export type IntakeStatus = (typeof intakeStatuses)[number];
export type ArtifactType = (typeof artifactTypes)[number];
export type FileReviewStatus = (typeof fileReviewStatuses)[number];
export type PrintPackageStatus = (typeof printPackageStatuses)[number];

export interface IntakeRequestRow {
  id: number;
  created_at: string;
  updated_at: string;
  source: string;
  surface: string;
  channel: string;
  status: IntakeStatus;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  offer_slug: string | null;
  message: string;
  raw_message_id: number | null;
  metadata_json: string;
}

export interface ArtifactRow {
  id: number;
  created_at: string;
  intake_request_id: number;
  raw_message_id: number | null;
  filename: string;
  original_path: string;
  stored_path: string;
  content_type: string | null;
  size_bytes: number;
  sha256: string;
  artifact_type: ArtifactType;
  metadata_json: string;
}

export interface FileReviewRow {
  id: number;
  created_at: string;
  artifact_id: number;
  status: FileReviewStatus;
  detected_type: string;
  size_bytes: number | null;
  sha256: string | null;
  dimensions_json: string;
  warnings_json: string;
  review_notes: string;
}

export interface PrintPackageRow {
  id: number;
  created_at: string;
  updated_at: string;
  intake_request_id: number;
  artifact_id: number;
  status: PrintPackageStatus;
  package_dir: string;
  source_file_path: string;
  prepared_file_path: string;
  bambu_project_path: string | null;
  preview_path: string;
  printer_profile: string;
  material_profile: string;
  quantity: number;
  notes: string;
}

export interface HumanHandoffRow {
  id: number;
  created_at: string;
  updated_at: string;
  type: string;
  status: string;
  related_object_type: string;
  related_object_id: number;
  instructions: string;
  assigned_to: string | null;
  completed_at: string | null;
  notes: string;
}

function assertChoice<T extends readonly string[]>(value: string, allowed: T, label: string): asserts value is T[number] {
  if (!allowed.includes(value)) {
    throw new Error(`Invalid ${label} "${value}". Allowed: ${allowed.join(", ")}`);
  }
}

function parseJsonOrDefault(value: string | undefined, fallback: string): string {
  const json = value ?? fallback;
  JSON.parse(json);
  return json;
}

function safeFilename(filename: string): string {
  const cleaned = path.basename(filename).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "artifact";
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function inferArtifactType(filePath: string): ArtifactType {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".stl") return "stl";
  if (ext === ".3mf") return "3mf";
  if (ext === ".step" || ext === ".stp") return "step";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  return "other";
}

function contentTypeFor(type: ArtifactType): string {
  switch (type) {
    case "stl":
      return "model/stl";
    case "3mf":
      return "model/3mf";
    case "step":
      return "model/step";
    case "image":
      return "image/*";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

export function createIntake(input: {
  source: string;
  surface: string;
  channel: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  offerSlug?: string;
  message: string;
  rawMessageId?: number;
  metadataJson?: string;
}): IntakeRequestRow {
  const metadataJson = parseJsonOrDefault(input.metadataJson, "{}");
  const result = getDb()
    .prepare(
      `INSERT INTO intake_requests
       (source, surface, channel, status, customer_name, customer_email, customer_phone, offer_slug, message, raw_message_id, metadata_json)
       VALUES (@source, @surface, @channel, 'received', @customerName, @customerEmail, @customerPhone, @offerSlug, @message, @rawMessageId, @metadataJson)`
    )
    .run({
      source: input.source,
      surface: input.surface,
      channel: input.channel,
      customerName: input.customerName ?? null,
      customerEmail: input.customerEmail ?? null,
      customerPhone: input.customerPhone ?? null,
      offerSlug: input.offerSlug ?? null,
      message: input.message,
      rawMessageId: input.rawMessageId ?? null,
      metadataJson
    });

  return showIntake(Number(result.lastInsertRowid))!;
}

export function listIntakes(): IntakeRequestRow[] {
  return getDb()
    .prepare(
      `SELECT id, created_at, updated_at, source, surface, channel, status, customer_name, customer_email,
              customer_phone, offer_slug, message, raw_message_id, metadata_json
       FROM intake_requests
       ORDER BY id`
    )
    .all() as IntakeRequestRow[];
}

export function showIntake(id: number): IntakeRequestRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, created_at, updated_at, source, surface, channel, status, customer_name, customer_email,
              customer_phone, offer_slug, message, raw_message_id, metadata_json
       FROM intake_requests
       WHERE id = ?`
    )
    .get(id) as IntakeRequestRow | undefined;
}

export function updateIntakeStatus(id: number, status: string): IntakeRequestRow {
  assertChoice(status, intakeStatuses, "intake status");
  if (!showIntake(id)) {
    throw new Error(`Intake request not found: ${id}`);
  }
  getDb()
    .prepare("UPDATE intake_requests SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, id);
  return showIntake(id)!;
}

export function storeArtifact(input: {
  intakeRequestId: number;
  filePath: string;
  artifactType?: string;
  rawMessageId?: number;
  metadataJson?: string;
}): ArtifactRow {
  const intake = showIntake(input.intakeRequestId);
  if (!intake) {
    throw new Error(`Intake request not found: ${input.intakeRequestId}`);
  }

  const sourcePath = path.resolve(input.filePath);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`Artifact file not found or unreadable: ${input.filePath}`);
  }

  const inferredType = inferArtifactType(sourcePath);
  const artifactType = input.artifactType ?? inferredType;
  assertChoice(artifactType, artifactTypes, "artifact type");

  const metadataJson = parseJsonOrDefault(input.metadataJson, "{}");
  const stats = fs.statSync(sourcePath);
  const sha256 = sha256File(sourcePath);
  const filename = safeFilename(sourcePath);

  fs.mkdirSync(artifactsDir(), { recursive: true });
  const placeholderPath = path.join(artifactsDir(), `pending_${process.pid}_${filename}`);
  fs.copyFileSync(sourcePath, placeholderPath);

  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO artifacts
       (intake_request_id, raw_message_id, filename, original_path, stored_path, content_type, size_bytes, sha256, artifact_type, metadata_json)
       VALUES (@intakeRequestId, @rawMessageId, @filename, @originalPath, @storedPath, @contentType, @sizeBytes, @sha256, @artifactType, @metadataJson)`
    )
    .run({
      intakeRequestId: input.intakeRequestId,
      rawMessageId: input.rawMessageId ?? intake.raw_message_id,
      filename,
      originalPath: sourcePath,
      storedPath: placeholderPath,
      contentType: contentTypeFor(artifactType),
      sizeBytes: stats.size,
      sha256,
      artifactType,
      metadataJson
    });

  const artifactId = Number(result.lastInsertRowid);
  const storedPath = path.join(artifactsDir(), `${artifactId}_${filename}`);
  fs.renameSync(placeholderPath, storedPath);
  db.prepare("UPDATE artifacts SET stored_path = ? WHERE id = ?").run(storedPath, artifactId);
  updateIntakeStatus(input.intakeRequestId, "file_stored");
  return showArtifact(artifactId)!;
}

export function listArtifacts(intakeRequestId?: number): ArtifactRow[] {
  const sql = `SELECT id, created_at, intake_request_id, raw_message_id, filename, original_path, stored_path,
                      content_type, size_bytes, sha256, artifact_type, metadata_json
               FROM artifacts`;
  if (intakeRequestId) {
    return getDb().prepare(`${sql} WHERE intake_request_id = ? ORDER BY id`).all(intakeRequestId) as ArtifactRow[];
  }
  return getDb().prepare(`${sql} ORDER BY id`).all() as ArtifactRow[];
}

export function showArtifact(id: number): ArtifactRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, created_at, intake_request_id, raw_message_id, filename, original_path, stored_path,
              content_type, size_bytes, sha256, artifact_type, metadata_json
       FROM artifacts
       WHERE id = ?`
    )
    .get(id) as ArtifactRow | undefined;
}

export function reviewFile(artifactId: number): FileReviewRow {
  const artifact = showArtifact(artifactId);
  if (!artifact) {
    throw new Error(`Artifact not found: ${artifactId}`);
  }

  let status: FileReviewStatus = "valid_enough";
  const warnings: string[] = [];
  let reviewNotes = "Basic deterministic review passed. No mesh repair or slicer analysis was performed.";
  let sizeBytes: number | null = artifact.size_bytes;
  let sha256: string | null = artifact.sha256;

  if (!fs.existsSync(artifact.stored_path) || !fs.statSync(artifact.stored_path).isFile()) {
    status = "rejected";
    sizeBytes = null;
    sha256 = null;
    warnings.push("Stored artifact file is missing or unreadable.");
    reviewNotes = "Rejected because the stored artifact file is missing or unreadable.";
  } else {
    sizeBytes = fs.statSync(artifact.stored_path).size;
    sha256 = sha256File(artifact.stored_path);
    const detectedType = inferArtifactType(artifact.stored_path);
    if (detectedType === "other" || artifact.artifact_type === "other") {
      status = "needs_human_review";
      warnings.push("File type is not one of the currently supported deterministic model/document types.");
      reviewNotes = "Stored file exists, but its type needs human review.";
    }
  }

  const detectedType = fs.existsSync(artifact.stored_path) ? inferArtifactType(artifact.stored_path) : artifact.artifact_type;
  const result = getDb()
    .prepare(
      `INSERT INTO file_reviews
       (artifact_id, status, detected_type, size_bytes, sha256, dimensions_json, warnings_json, review_notes)
       VALUES (@artifactId, @status, @detectedType, @sizeBytes, @sha256, '{}', @warningsJson, @reviewNotes)`
    )
    .run({
      artifactId,
      status,
      detectedType,
      sizeBytes,
      sha256,
      warningsJson: JSON.stringify(warnings),
      reviewNotes
    });

  if (status === "valid_enough") {
    updateIntakeStatus(artifact.intake_request_id, "file_validated");
  }

  return showFileReview(Number(result.lastInsertRowid))!;
}

export function showFileReview(id: number): FileReviewRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, created_at, artifact_id, status, detected_type, size_bytes, sha256,
              dimensions_json, warnings_json, review_notes
       FROM file_reviews
       WHERE id = ?`
    )
    .get(id) as FileReviewRow | undefined;
}

export function showLatestFileReviewForArtifact(artifactId: number): FileReviewRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, created_at, artifact_id, status, detected_type, size_bytes, sha256,
              dimensions_json, warnings_json, review_notes
       FROM file_reviews
       WHERE artifact_id = ?
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(artifactId) as FileReviewRow | undefined;
}

export function createPrintPackage(input: {
  intakeRequestId: number;
  artifactId: number;
  materialProfile: string;
  printerProfile: string;
  quantity: number;
  notes?: string;
}): PrintPackageRow {
  const intake = showIntake(input.intakeRequestId);
  if (!intake) {
    throw new Error(`Intake request not found: ${input.intakeRequestId}`);
  }
  const artifact = showArtifact(input.artifactId);
  if (!artifact) {
    throw new Error(`Artifact not found: ${input.artifactId}`);
  }
  if (artifact.intake_request_id !== input.intakeRequestId) {
    throw new Error(`Artifact ${input.artifactId} is not linked to intake request ${input.intakeRequestId}`);
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new Error(`Invalid quantity: ${input.quantity}`);
  }
  if (!fs.existsSync(artifact.stored_path)) {
    throw new Error(`Stored artifact file is missing: ${artifact.stored_path}`);
  }

  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO print_packages
       (intake_request_id, artifact_id, status, package_dir, source_file_path, prepared_file_path,
        bambu_project_path, preview_path, printer_profile, material_profile, quantity, notes)
       VALUES (@intakeRequestId, @artifactId, 'pending', '', @sourceFilePath, '', NULL, '', @printerProfile, @materialProfile, @quantity, @notes)`
    )
    .run({
      intakeRequestId: input.intakeRequestId,
      artifactId: input.artifactId,
      sourceFilePath: artifact.stored_path,
      printerProfile: input.printerProfile,
      materialProfile: input.materialProfile,
      quantity: input.quantity,
      notes: input.notes ?? ""
    });

  const packageId = Number(result.lastInsertRowid);
  const packageDir = path.join(printPackagesDir(), String(packageId));
  const originalDir = path.join(packageDir, "original");
  const workingDir = path.join(packageDir, "working");
  const bambuDir = path.join(packageDir, "bambu");
  const previewDir = path.join(packageDir, "preview");
  fs.mkdirSync(originalDir, { recursive: true });
  fs.mkdirSync(workingDir, { recursive: true });
  fs.mkdirSync(bambuDir, { recursive: true });
  fs.mkdirSync(previewDir, { recursive: true });

  const preparedFilePath = path.join(originalDir, artifact.filename);
  fs.copyFileSync(artifact.stored_path, preparedFilePath);
  const checklistPath = path.join(packageDir, "checklist.md");
  const metadataPath = path.join(packageDir, "package.json");
  const notesPath = path.join(packageDir, "notes.md");

  fs.writeFileSync(
    checklistPath,
    [
      "# Print Package Checklist",
      "",
      `- Source file: ${artifact.filename}`,
      `- Stored source: ${artifact.stored_path}`,
      `- Material: ${input.materialProfile}`,
      `- Quantity: ${input.quantity}`,
      `- Printer profile: ${input.printerProfile}`,
      "- Human preview: open the source/package in Bambu Studio or Bambu Connect and verify scale, orientation, material, quantity, and supports.",
      "- Approval gate: print send requires explicit human approval. MICBot must not send this package to a printer autonomously.",
      ""
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(notesPath, `${input.notes ?? ""}\n`, "utf8");
  fs.writeFileSync(
    metadataPath,
    JSON.stringify(
      {
        id: packageId,
        intake_request_id: input.intakeRequestId,
        artifact_id: input.artifactId,
        status: "ready_for_preview",
        source_file_path: artifact.stored_path,
        prepared_file_path: preparedFilePath,
        material_profile: input.materialProfile,
        printer_profile: input.printerProfile,
        quantity: input.quantity,
        no_autonomous_printing: true
      },
      null,
      2
    ),
    "utf8"
  );

  db.prepare(
    `UPDATE print_packages
     SET status = 'ready_for_preview',
         package_dir = @packageDir,
         prepared_file_path = @preparedFilePath,
         preview_path = @previewPath,
         updated_at = datetime('now')
     WHERE id = @id`
  ).run({ id: packageId, packageDir, preparedFilePath, previewPath: previewDir });
  updateIntakeStatus(input.intakeRequestId, "print_package_ready");

  return showPrintPackage(packageId)!;
}

export function showPrintPackage(id: number): PrintPackageRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, created_at, updated_at, intake_request_id, artifact_id, status, package_dir, source_file_path,
              prepared_file_path, bambu_project_path, preview_path, printer_profile, material_profile, quantity, notes
       FROM print_packages
       WHERE id = ?`
    )
    .get(id) as PrintPackageRow | undefined;
}

export function markPrintPackageStatus(id: number, status: string): PrintPackageRow {
  assertChoice(status, printPackageStatuses, "print package status");
  if (!showPrintPackage(id)) {
    throw new Error(`Print package not found: ${id}`);
  }
  getDb().prepare("UPDATE print_packages SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  return showPrintPackage(id)!;
}

function maybeAppPath(appName: string): string | null {
  const locations = [`/Applications/${appName}.app`, path.join(process.env.HOME ?? "", "Applications", `${appName}.app`)];
  return locations.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

export function probeBambu(): {
  ok: true;
  platform: string;
  bambu_studio: { found: boolean; paths: string[] };
  bambu_connect: { found: boolean; paths: string[] };
  cli_candidates: { found: boolean; paths: string[] };
  capabilities: string[];
  safety: { sends_to_printer: false; requires_login: false };
} {
  const studioPaths = [maybeAppPath("Bambu Studio"), maybeAppPath("BambuStudio")].filter(Boolean) as string[];
  const connectPaths = [maybeAppPath("Bambu Connect"), maybeAppPath("BambuConnect")].filter(Boolean) as string[];
  const cliCandidates = [
    "/Applications/Bambu Studio.app/Contents/MacOS/BambuStudio",
    "/Applications/Bambu Studio.app/Contents/MacOS/bambu-studio",
    "/Applications/Bambu Connect.app/Contents/MacOS/Bambu Connect"
  ].filter((candidate) => fs.existsSync(candidate));

  return {
    ok: true,
    platform: process.platform,
    bambu_studio: { found: studioPaths.length > 0, paths: studioPaths },
    bambu_connect: { found: connectPaths.length > 0, paths: connectPaths },
    cli_candidates: { found: cliCandidates.length > 0, paths: cliCandidates },
    capabilities: studioPaths.length > 0 ? ["human_visible_preview"] : [],
    safety: { sends_to_printer: false, requires_login: false }
  };
}

export function createHumanHandoff(input: {
  type: string;
  relatedObjectType: string;
  relatedObjectId: number;
  instructions: string;
  assignedTo?: string;
  notes?: string;
}): HumanHandoffRow {
  const result = getDb()
    .prepare(
      `INSERT INTO human_handoffs
       (type, status, related_object_type, related_object_id, instructions, assigned_to, notes)
       VALUES (@type, 'open', @relatedObjectType, @relatedObjectId, @instructions, @assignedTo, @notes)`
    )
    .run({
      type: input.type,
      relatedObjectType: input.relatedObjectType,
      relatedObjectId: input.relatedObjectId,
      instructions: input.instructions,
      assignedTo: input.assignedTo ?? null,
      notes: input.notes ?? ""
    });
  return showHumanHandoff(Number(result.lastInsertRowid))!;
}

export function showHumanHandoff(id: number): HumanHandoffRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, created_at, updated_at, type, status, related_object_type, related_object_id,
              instructions, assigned_to, completed_at, notes
       FROM human_handoffs
       WHERE id = ?`
    )
    .get(id) as HumanHandoffRow | undefined;
}

export function latestHumanHandoffForPrintPackage(printPackageId: number): HumanHandoffRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, created_at, updated_at, type, status, related_object_type, related_object_id,
              instructions, assigned_to, completed_at, notes
       FROM human_handoffs
       WHERE related_object_type = 'print_package' AND related_object_id = ?
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(printPackageId) as HumanHandoffRow | undefined;
}

export function openPrintPackagePreview(printPackageId: number): {
  ok: boolean;
  print_package: PrintPackageRow;
  handoff?: HumanHandoffRow;
  probe: ReturnType<typeof probeBambu>;
  opened: boolean;
  next_manual_step?: string;
  error?: string;
} {
  const printPackage = showPrintPackage(printPackageId);
  if (!printPackage) {
    throw new Error(`Print package not found: ${printPackageId}`);
  }

  const probe = probeBambu();
  const targetPath = printPackage.prepared_file_path || printPackage.source_file_path;
  if (!fs.existsSync(targetPath)) {
    const handoff = createHumanHandoff({
      type: "approve_print_send",
      relatedObjectType: "print_package",
      relatedObjectId: printPackageId,
      assignedTo: "Jeff",
      instructions: `Preview target is missing. Find the package at ${printPackage.package_dir}, restore or revise the source file, then approve, reject, or revise before any future printer send step.`
    });
    return {
      ok: false,
      print_package: printPackage,
      handoff,
      probe,
      opened: false,
      next_manual_step: `Find the package at ${printPackage.package_dir} and open the original source manually.`,
      error: `Preview target is missing: ${targetPath}`
    };
  }

  if (!probe.bambu_studio.found) {
    const handoff = createHumanHandoff({
      type: "approve_print_send",
      relatedObjectType: "print_package",
      relatedObjectId: printPackageId,
      assignedTo: "Jeff",
      instructions: `Open ${targetPath} manually in Bambu Studio or Bambu Connect. Approve, reject, or revise before any future printer send step.`
    });
    return {
      ok: false,
      print_package: printPackage,
      handoff,
      probe,
      opened: false,
      next_manual_step: `Install or open Bambu Studio manually, then open ${targetPath}. Do not send to printer without approval.`
    };
  }

  try {
    execFileSync("open", ["-a", probe.bambu_studio.paths[0], targetPath], { stdio: "ignore" });
  } catch (error) {
    const handoff = createHumanHandoff({
      type: "approve_print_send",
      relatedObjectType: "print_package",
      relatedObjectId: printPackageId,
      assignedTo: "Jeff",
      instructions: `Bambu preview open failed. Open ${targetPath} manually in Bambu Studio/Bambu Connect, then approve, reject, or revise before any future printer send step.`
    });
    return {
      ok: false,
      print_package: printPackage,
      handoff,
      probe,
      opened: false,
      next_manual_step: `Open ${targetPath} manually in Bambu Studio. Do not send to printer without approval.`,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  const updatedPackage = markPrintPackageStatus(printPackageId, "opened_for_preview");
  const handoff = createHumanHandoff({
    type: "approve_print_send",
    relatedObjectType: "print_package",
    relatedObjectId: printPackageId,
    assignedTo: "Jeff",
    instructions:
      "Review the package in Bambu Studio/Bambu Connect. Approve, reject, or revise before any future printer send step."
  });

  return {
    ok: true,
    print_package: updatedPackage,
    handoff,
    probe,
    opened: true
  };
}
