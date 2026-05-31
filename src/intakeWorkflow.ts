import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { artifactsDir, getDb, printPackagesDir, projectRoot } from "./db.js";
import { addRawMessage } from "./rawMessages.js";

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
  "revise_requested",
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

export interface DiscordJobThreadRow {
  id: number;
  created_at: string;
  updated_at: string;
  status: "active" | "archived" | "cancelled";
  guild_id: string | null;
  channel_id: string | null;
  channel: string;
  thread_id: string;
  thread_name: string;
  source_message_id: string | null;
  customer_name: string | null;
  summary: string;
  metadata_json: string;
}

export interface DiscordJobArtifactRow {
  id: number;
  created_at: string;
  updated_at: string;
  discord_job_thread_id: number;
  intake_request_id: number;
  artifact_id: number;
  version_label: string;
  relationship: "primary" | "revision" | "plate_member";
  status: "active" | "superseded" | "rejected";
  notes: string;
}

export type ProductionSourceKind = "text" | "image" | "video" | "model" | "cad" | "unknown";
export type ProductionRoute =
  | "search_existing"
  | "cad_design"
  | "mesh_generation"
  | "direct_print_package"
  | "needs_clarification"
  | "non_print_request";

export interface ProductionWorkflowPlanRow {
  id: number;
  created_at: string;
  updated_at: string;
  intake_request_id: number | null;
  artifact_id: number | null;
  source_kind: ProductionSourceKind;
  route: ProductionRoute;
  object_query: string;
  route_reason: string;
  workflow_json: string;
  status: "planned" | "in_progress" | "superseded" | "completed" | "cancelled";
}

export interface ProductionWorkflowPlan {
  route: ProductionRoute;
  source_kind: ProductionSourceKind;
  object_query: string;
  route_reason: string;
  next_steps: string[];
  required_user_inputs: string[];
  micbot_outputs: string[];
  approval_gate: string;
  safety: { sends_to_printer: false; requires_explicit_approval_before_send: true };
}

export interface DiscordJobContext {
  thread: DiscordJobThreadRow;
  links: DiscordJobArtifactRow[];
}

export interface StlGeometrySummary {
  format: "binary_stl" | "ascii_stl";
  triangles: number;
  size_bytes: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
    dimensions_mm: [number, number, number];
  };
}

export interface PrintabilityEstimate {
  orientation_source: "package_coordinates";
  plate_layout_source: "estimated_centered_grid";
  bed_size_mm: [number, number];
  arranged_instances: Array<{
    label: string;
    x_mm: number;
    y_mm: number;
    width_mm: number;
    depth_mm: number;
    mirrored: false;
  }>;
  fits_estimated_layout: boolean;
  build_height_mm: number;
  bed_contact_area_mm2: number;
  xy_footprint_area_mm2: number;
  bed_contact_ratio: number;
  likely_support_area_mm2: number;
  likely_support_triangles: number;
  total_surface_area_mm2: number;
  overhang_threshold_degrees: number;
  limitations: string[];
}

export interface RemoteInspectionResult {
  ok: true;
  print_package: PrintPackageRow;
  artifact: ArtifactRow;
  geometry: StlGeometrySummary;
  review_card_path: string;
  preview_type: "bambu_studio_style_raster";
  preview_files: {
    prepare_view_1: string;
    prepare_view_2: string;
    prepare_view_3: string;
  };
  raster_preview_files: {
    prepare_view_1: string;
    prepare_view_2: string;
    prepare_view_3: string;
  };
  auto_arrange: AutoArrangeRequestResult;
  printability: PrintabilityEstimate;
  discord_target_thread: DiscordJobThreadRow | null;
  discord_summary: string;
  safety: { sends_to_printer: false; requires_human_approval: true };
}

export interface SlicerReviewResult {
  ok: true;
  print_package: PrintPackageRow;
  artifact: ArtifactRow;
  geometry: StlGeometrySummary;
  review_card_path: string;
  bambu: {
    cli_path: string | null;
    studio_version: string | null;
    profile_source: string;
    requested_printer_profile: string;
    requested_material_profile: string;
    effective_machine_profile: string | null;
    effective_process_profile: string | null;
    effective_filament_profile: string | null;
  };
  normalized_model_path: string | null;
  bambu_project_path: string | null;
  slicer_result_path: string | null;
  slicer_result: Record<string, unknown> | null;
  slice: {
    ok: boolean;
    error: string | null;
    print_time_seconds: number | null;
    filament_used_g: number | null;
    filament_used_mm: number | null;
    estimated_cost: number | null;
  };
  preview_files: Record<string, string>;
  raster_preview_files: Record<string, string>;
  callouts: string[];
  recommendations: string[];
  discord_target_thread: DiscordJobThreadRow | null;
  discord_summary: string;
  safety: { sends_to_printer: false; requires_human_approval: true };
}

export interface AutoArrangeRequestResult {
  ok: true;
  print_package: PrintPackageRow;
  handoff: HumanHandoffRow;
  attempted_ui_automation: boolean;
  ui_automation: { ok: boolean; method: string | null; error?: string };
  safety: { sends_to_printer: false; requires_human_approval: true };
}

export interface DiscordAttachmentIntakeResult {
  ok: true;
  raw_message: ReturnType<typeof addRawMessage>;
  intake: IntakeRequestRow;
  artifact: ArtifactRow;
  discord_job_thread: DiscordJobThreadRow | null;
  discord_job_artifact: DiscordJobArtifactRow | null;
  next_step: "review_file";
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

function parseJsonObject(value: string | undefined, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  const parsed = JSON.parse(value ?? JSON.stringify(fallback)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected JSON object");
  }
  return parsed as Record<string, unknown>;
}

function mergeMetadataJson(baseJson: string | undefined, extra: Record<string, unknown>): string {
  return JSON.stringify({ ...parseJsonObject(baseJson), ...extra });
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

function formatMm(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "unknown";
}

function assertNonBlank(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`${label} is required`);
  }
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

const printableArtifactTypes = new Set<ArtifactType>(["stl", "3mf", "step"]);

function assertSupportedPrintableUpload(type: ArtifactType, filename: string): void {
  if (!printableArtifactTypes.has(type)) {
    throw new Error(`Unsupported Discord attachment type for print intake: ${filename}. Allowed extensions: .stl, .3mf, .step, .stp`);
  }
}

function assertPrintableArtifact(artifact: ArtifactRow): void {
  if (!printableArtifactTypes.has(artifact.artifact_type)) {
    throw new Error(`Artifact ${artifact.id} is not a supported printable model type: ${artifact.artifact_type}`);
  }

  const stat = fs.statSync(artifact.stored_path);
  if (!stat.isFile()) {
    throw new Error(`Stored artifact path is not a file: ${artifact.stored_path}`);
  }
  if (stat.size < 1) {
    throw new Error(`Stored artifact file is empty: ${artifact.stored_path}`);
  }
  if (stat.size !== artifact.size_bytes) {
    throw new Error(`Stored artifact size changed: expected ${artifact.size_bytes}, found ${stat.size}`);
  }

  const sha256 = sha256File(artifact.stored_path);
  if (sha256 !== artifact.sha256) {
    throw new Error(`Stored artifact hash changed: expected ${artifact.sha256}, found ${sha256}`);
  }

  const review = showLatestFileReviewForArtifact(artifact.id);
  if (!review) {
    throw new Error(`Artifact ${artifact.id} must be reviewed before creating a print package`);
  }
  if (review.status !== "valid_enough") {
    throw new Error(`Artifact ${artifact.id} is not valid enough for print package creation: ${review.status}`);
  }
}

function normalizeSourceKind(value: string | undefined): ProductionSourceKind {
  const sourceKind = (value ?? "unknown").toLowerCase();
  assertChoice(sourceKind, ["text", "image", "video", "model", "cad", "unknown"] as const, "production source kind");
  return sourceKind;
}

function extractObjectQuery(message: string): string {
  return message
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\b(can you|could you|please|pls|make|create|generate|find|search|look for|print|3d print|prototype|need|want|me|a|an|the|this|that|for|to|of|with|from|like)\b/g, " ")
    .replace(/[^a-z0-9._ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

const commonPrintableObjects = [
  "adapter",
  "bin",
  "box",
  "bracket",
  "cable",
  "case",
  "clip",
  "cover",
  "desk",
  "drawer",
  "fixture",
  "holder",
  "hook",
  "jig",
  "mount",
  "organizer",
  "phone",
  "rack",
  "shelf",
  "spacer",
  "stand",
  "tray",
  "vase"
];

const mechanicalCadSignals = [
  "bolt",
  "boss",
  "bracket",
  "bushing",
  "cad",
  "clearance",
  "counterbore",
  "countersink",
  "dimension",
  "fit",
  "hole",
  "lid",
  "m3",
  "m4",
  "m5",
  "mount",
  "parametric",
  "plate",
  "slot",
  "step",
  "stp",
  "thread",
  "tolerance"
];

function includesAny(text: string, values: string[]): boolean {
  return values.some((value) => text.includes(value));
}

function workflowFor(route: ProductionRoute, sourceKind: ProductionSourceKind, objectQuery: string, routeReason: string): ProductionWorkflowPlan {
  const base = {
    route,
    source_kind: sourceKind,
    object_query: objectQuery,
    route_reason: routeReason,
    safety: { sends_to_printer: false as const, requires_explicit_approval_before_send: true as const }
  };

  switch (route) {
    case "search_existing":
      return {
        ...base,
        next_steps: [
          "Search model libraries for commercially usable candidates.",
          "Store source URL, author, license, files, and thumbnails.",
          "Present candidate options for selection.",
          "Package the selected model, auto-arrange in Bambu Studio, and generate Bambu-style raster previews."
        ],
        required_user_inputs: ["Pick candidate model or request another search round.", "Approve exact package/material/quantity/printer before send."],
        micbot_outputs: ["candidate option card", "model provenance record", "print package", "Bambu preview screenshots", "approval handoff"],
        approval_gate: "candidate selection before packaging; explicit print-send approval before final Bambu send"
      };
    case "cad_design":
      return {
        ...base,
        next_steps: [
          "Create a natural-language CAD brief with dimensions, fit constraints, and assumptions.",
          "Generate or modify STEP-first CAD source, then export STL/3MF sidecars.",
          "Validate geometry with deterministic checks and snapshots.",
          "Package the export, auto-arrange in Bambu Studio, and generate Bambu-style raster previews."
        ],
        required_user_inputs: ["Confirm missing fit-critical dimensions if needed.", "Approve CAD snapshot/package before print send."],
        micbot_outputs: ["CAD brief", "STEP/source artifact", "STL/3MF export", "validation notes", "Bambu preview screenshots", "approval handoff"],
        approval_gate: "CAD review before package approval; explicit print-send approval before final Bambu send"
      };
    case "mesh_generation":
      return {
        ...base,
        next_steps: [
          "Extract the best image/frame reference if media was supplied.",
          "Generate a mesh model for organic/decorative geometry.",
          "Ask for real-world max size before slicing.",
          "Package the generated mesh, auto-arrange in Bambu Studio, and generate Bambu-style raster previews."
        ],
        required_user_inputs: ["Provide or approve max physical size.", "Approve generated shape and exact print package before send."],
        micbot_outputs: ["generated mesh", "size assumptions", "print package", "Bambu preview screenshots", "approval handoff"],
        approval_gate: "shape and scale approval before packaging; explicit print-send approval before final Bambu send"
      };
    case "direct_print_package":
      return {
        ...base,
        next_steps: [
          "Store and review the supplied printable artifact.",
          "Create a print package with material, quantity, and target printer.",
          "Auto-arrange in Bambu Studio and generate Bambu-style raster previews.",
          "Wait for explicit approval before sending."
        ],
        required_user_inputs: ["Material, quantity, and target printer if missing.", "Explicit package/material/quantity/printer approval before send."],
        micbot_outputs: ["file review", "print package", "Bambu preview screenshots", "approval handoff"],
        approval_gate: "explicit print-send approval before final Bambu send"
      };
    case "needs_clarification":
      return {
        ...base,
        next_steps: ["Ask one focused question to identify the object or missing fit-critical constraint.", "Resume routing after the answer."],
        required_user_inputs: ["Clarify the object or key constraint."],
        micbot_outputs: ["clarification prompt"],
        approval_gate: "no print package until request is clear"
      };
    case "non_print_request":
      return {
        ...base,
        next_steps: ["Handle outside the production print workflow."],
        required_user_inputs: [],
        micbot_outputs: ["non-print response"],
        approval_gate: "not applicable"
      };
  }
}

export function planProductionWorkflow(input: {
  message: string;
  sourceKind?: string;
  intakeRequestId?: number;
  artifactId?: number;
  record?: boolean;
}): ProductionWorkflowPlan | (ProductionWorkflowPlan & { workflow_plan: ProductionWorkflowPlanRow }) {
  const message = input.message.trim();
  const sourceKind = normalizeSourceKind(input.sourceKind);
  if (!message && sourceKind === "unknown") {
    throw new Error("Message or source kind is required to plan a production workflow");
  }

  const lower = message.toLowerCase();
  const objectQuery = extractObjectQuery(message);
  const hasPrintIntent = /\b(print|3d print|prototype|model|stl|3mf|step|cad|part|object|case|holder|mount|bracket|hook|fixture|stand)\b/i.test(lower);
  const replicateIntent = /\b(copy|clone|replicate|duplicate|same as|make another|exact|scan)\b/i.test(lower);
  const generateIntent = /\b(generate|ai|custom|unique|from scratch|don't search|do not search)\b/i.test(lower);
  const searchIntent = /\b(find|search|look up|existing|thingiverse|printables|thangs)\b/i.test(lower);
  const suppliedPrintable = sourceKind === "model" || sourceKind === "cad";
  const mediaReference = sourceKind === "image" || sourceKind === "video";

  let route: ProductionRoute;
  let routeReason: string;

  if (suppliedPrintable) {
    route = "direct_print_package";
    routeReason = "A printable/CAD artifact was supplied, so MICBot should review and package it before approval.";
  } else if (!hasPrintIntent && !mediaReference) {
    route = "non_print_request";
    routeReason = "No physical-object or print intent was detected.";
  } else if (!objectQuery && !mediaReference) {
    route = "needs_clarification";
    routeReason = "The request does not identify a physical object clearly enough to route.";
  } else if (includesAny(lower, mechanicalCadSignals) || (replicateIntent && includesAny(lower, ["part", "fit", "mount", "bracket", "case", "hole"]))) {
    route = "cad_design";
    routeReason = "The request appears mechanical or fit-critical, so MICBot should use a STEP-first CAD lane.";
  } else if (generateIntent || replicateIntent || (mediaReference && !searchIntent && !includesAny(lower, commonPrintableObjects))) {
    route = "mesh_generation";
    routeReason = "The request appears custom, media-driven, or exact-replication oriented rather than a generic library search.";
  } else if (searchIntent || includesAny(lower, commonPrintableObjects) || mediaReference) {
    route = "search_existing";
    routeReason = "The object appears common enough that existing model search should be tried before generation.";
  } else {
    route = "needs_clarification";
    routeReason = "MICBot needs one more constraint before choosing search, CAD, or mesh generation.";
  }

  const plan = workflowFor(route, sourceKind, objectQuery, routeReason);
  if (!input.record) {
    return plan;
  }

  if (input.intakeRequestId && !showIntake(input.intakeRequestId)) {
    throw new Error(`Intake request not found: ${input.intakeRequestId}`);
  }
  if (input.artifactId && !showArtifact(input.artifactId)) {
    throw new Error(`Artifact not found: ${input.artifactId}`);
  }

  const result = getDb()
    .prepare(
      `INSERT INTO production_workflow_plans
       (intake_request_id, artifact_id, source_kind, route, object_query, route_reason, workflow_json)
       VALUES (@intakeRequestId, @artifactId, @sourceKind, @route, @objectQuery, @routeReason, @workflowJson)`
    )
    .run({
      intakeRequestId: input.intakeRequestId ?? null,
      artifactId: input.artifactId ?? null,
      sourceKind,
      route,
      objectQuery,
      routeReason,
      workflowJson: JSON.stringify(plan)
    });

  return { ...plan, workflow_plan: showProductionWorkflowPlan(Number(result.lastInsertRowid))! };
}

export function showProductionWorkflowPlan(id: number): ProductionWorkflowPlanRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, created_at, updated_at, intake_request_id, artifact_id, source_kind, route, object_query,
              route_reason, workflow_json, status
       FROM production_workflow_plans
       WHERE id = ?`
    )
    .get(id) as ProductionWorkflowPlanRow | undefined;
}

export function listProductionWorkflowPlans(intakeRequestId?: number): ProductionWorkflowPlanRow[] {
  const sql = `SELECT id, created_at, updated_at, intake_request_id, artifact_id, source_kind, route, object_query,
                      route_reason, workflow_json, status
               FROM production_workflow_plans`;
  if (intakeRequestId) {
    return getDb().prepare(`${sql} WHERE intake_request_id = ? ORDER BY id`).all(intakeRequestId) as ProductionWorkflowPlanRow[];
  }
  return getDb().prepare(`${sql} ORDER BY id`).all() as ProductionWorkflowPlanRow[];
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

export function recordDiscordJobThread(input: {
  channel: string;
  threadId: string;
  threadName: string;
  guildId?: string;
  channelId?: string;
  sourceMessageId?: string;
  customerName?: string;
  summary?: string;
  metadataJson?: string;
}): DiscordJobThreadRow {
  assertNonBlank(input.channel, "Discord channel");
  assertNonBlank(input.threadId, "Discord thread id");
  assertNonBlank(input.threadName, "Discord thread name");
  const metadataJson = parseJsonOrDefault(input.metadataJson, "{}");
  const existing = showDiscordJobThreadByDiscordThreadId(input.threadId);
  const values = {
    guildId: input.guildId ?? null,
    channelId: input.channelId ?? null,
    channel: input.channel,
    threadId: input.threadId,
    threadName: input.threadName,
    sourceMessageId: input.sourceMessageId ?? null,
    customerName: input.customerName ?? null,
    summary: input.summary ?? "",
    metadataJson
  };

  if (existing) {
    getDb()
      .prepare(
        `UPDATE discord_job_threads
         SET guild_id = COALESCE(@guildId, guild_id),
             channel_id = COALESCE(@channelId, channel_id),
             channel = @channel,
             thread_name = @threadName,
             source_message_id = COALESCE(@sourceMessageId, source_message_id),
             customer_name = COALESCE(@customerName, customer_name),
             summary = CASE WHEN @summary = '' THEN summary ELSE @summary END,
             metadata_json = @metadataJson,
             updated_at = datetime('now')
         WHERE id = @id`
      )
      .run({ id: existing.id, ...values });
    return showDiscordJobThread(existing.id)!;
  }

  const result = getDb()
    .prepare(
      `INSERT INTO discord_job_threads
       (guild_id, channel_id, channel, thread_id, thread_name, source_message_id, customer_name, summary, metadata_json)
       VALUES (@guildId, @channelId, @channel, @threadId, @threadName, @sourceMessageId, @customerName, @summary, @metadataJson)`
    )
    .run(values);
  return showDiscordJobThread(Number(result.lastInsertRowid))!;
}

export function showDiscordJobThread(id: number): DiscordJobThreadRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, created_at, updated_at, status, guild_id, channel_id, channel, thread_id, thread_name,
              source_message_id, customer_name, summary, metadata_json
       FROM discord_job_threads
       WHERE id = ?`
    )
    .get(id) as DiscordJobThreadRow | undefined;
}

export function showDiscordJobThreadByDiscordThreadId(threadId: string): DiscordJobThreadRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, created_at, updated_at, status, guild_id, channel_id, channel, thread_id, thread_name,
              source_message_id, customer_name, summary, metadata_json
       FROM discord_job_threads
       WHERE thread_id = ?`
    )
    .get(threadId) as DiscordJobThreadRow | undefined;
}

export function linkDiscordJobArtifact(input: {
  discordJobThreadId: number;
  intakeRequestId: number;
  artifactId: number;
  versionLabel?: string;
  relationship?: string;
  status?: string;
  notes?: string;
}): DiscordJobArtifactRow {
  const thread = showDiscordJobThread(input.discordJobThreadId);
  if (!thread) {
    throw new Error(`Discord job thread not found: ${input.discordJobThreadId}`);
  }
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
  const relationship = input.relationship ?? "primary";
  const status = input.status ?? "active";
  assertChoice(relationship, ["primary", "revision", "plate_member"] as const, "Discord job artifact relationship");
  assertChoice(status, ["active", "superseded", "rejected"] as const, "Discord job artifact status");

  const existing = getDb()
    .prepare("SELECT id FROM discord_job_artifacts WHERE discord_job_thread_id = ? AND artifact_id = ?")
    .get(input.discordJobThreadId, input.artifactId) as { id: number } | undefined;
  if (existing) {
    getDb()
      .prepare(
        `UPDATE discord_job_artifacts
         SET intake_request_id = @intakeRequestId,
             version_label = @versionLabel,
             relationship = @relationship,
             status = @status,
             notes = @notes,
             updated_at = datetime('now')
         WHERE id = @id`
      )
      .run({
        id: existing.id,
        intakeRequestId: input.intakeRequestId,
        versionLabel: input.versionLabel ?? "",
        relationship,
        status,
        notes: input.notes ?? ""
      });
    return showDiscordJobArtifact(existing.id)!;
  }

  const result = getDb()
    .prepare(
      `INSERT INTO discord_job_artifacts
       (discord_job_thread_id, intake_request_id, artifact_id, version_label, relationship, status, notes)
       VALUES (@discordJobThreadId, @intakeRequestId, @artifactId, @versionLabel, @relationship, @status, @notes)`
    )
    .run({
      discordJobThreadId: input.discordJobThreadId,
      intakeRequestId: input.intakeRequestId,
      artifactId: input.artifactId,
      versionLabel: input.versionLabel ?? "",
      relationship,
      status,
      notes: input.notes ?? ""
    });
  return showDiscordJobArtifact(Number(result.lastInsertRowid))!;
}

export function showDiscordJobArtifact(id: number): DiscordJobArtifactRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, created_at, updated_at, discord_job_thread_id, intake_request_id, artifact_id,
              version_label, relationship, status, notes
       FROM discord_job_artifacts
       WHERE id = ?`
    )
    .get(id) as DiscordJobArtifactRow | undefined;
}

export function discordJobContextForArtifact(artifactId: number): DiscordJobContext | null {
  const links = getDb()
    .prepare(
      `SELECT id, created_at, updated_at, discord_job_thread_id, intake_request_id, artifact_id,
              version_label, relationship, status, notes
       FROM discord_job_artifacts
       WHERE discord_job_thread_id = (
         SELECT discord_job_thread_id FROM discord_job_artifacts WHERE artifact_id = ? ORDER BY id DESC LIMIT 1
       )
       ORDER BY id`
    )
    .all(artifactId) as DiscordJobArtifactRow[];
  if (links.length === 0) {
    return null;
  }
  const thread = showDiscordJobThread(links[0].discord_job_thread_id);
  return thread ? { thread, links } : null;
}

export function discordJobContextForThread(discordJobThreadId: number): DiscordJobContext | null {
  const thread = showDiscordJobThread(discordJobThreadId);
  if (!thread) {
    return null;
  }
  const links = getDb()
    .prepare(
      `SELECT id, created_at, updated_at, discord_job_thread_id, intake_request_id, artifact_id,
              version_label, relationship, status, notes
       FROM discord_job_artifacts
       WHERE discord_job_thread_id = ?
       ORDER BY id`
    )
    .all(discordJobThreadId) as DiscordJobArtifactRow[];
  return { thread, links };
}

export function discordJobContextForPrintPackage(printPackageId: number): DiscordJobContext | null {
  const printPackage = showPrintPackage(printPackageId);
  return printPackage ? discordJobContextForArtifact(printPackage.artifact_id) : null;
}

export function storeArtifact(input: {
  intakeRequestId: number;
  filePath: string;
  filename?: string;
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
  const filename = safeFilename(input.filename ?? sourcePath);

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

export function createDiscordAttachmentIntake(input: {
  channel: string;
  author: string;
  messageId: string;
  attachmentPath: string;
  attachmentFilename?: string;
  messageContent?: string;
  guildId?: string;
  channelId?: string;
  authorId?: string;
  attachmentId?: string;
  attachmentUrl?: string;
  contentType?: string;
  customerName?: string;
  metadataJson?: string;
  jobThreadId?: string;
  jobThreadName?: string;
  jobThreadRecordId?: number;
  versionLabel?: string;
  artifactRelationship?: string;
}): DiscordAttachmentIntakeResult {
  assertNonBlank(input.channel, "Discord channel");
  assertNonBlank(input.author, "Discord author");
  assertNonBlank(input.messageId, "Discord message id");

  const attachmentPath = path.resolve(input.attachmentPath);
  if (!fs.existsSync(attachmentPath) || !fs.statSync(attachmentPath).isFile()) {
    throw new Error(`Discord attachment file not found or unreadable: ${input.attachmentPath}`);
  }

  const attachmentFilename = safeFilename(input.attachmentFilename ?? attachmentPath);
  const artifactType = inferArtifactType(attachmentFilename);
  assertSupportedPrintableUpload(artifactType, attachmentFilename);

  const stats = fs.statSync(attachmentPath);
  const userMetadata = parseJsonObject(input.metadataJson);
  const discordJobMetadata =
    input.jobThreadId || input.jobThreadName || input.jobThreadRecordId
      ? {
          discord_job: {
            thread_id: input.jobThreadId ?? null,
            thread_name: input.jobThreadName ?? null,
            thread_record_id: input.jobThreadRecordId ?? null,
            version_label: input.versionLabel ?? null,
            relationship: input.artifactRelationship ?? "primary"
          }
        }
      : {};
  const discordMetadata = {
    discord: {
      guild_id: input.guildId ?? null,
      channel_id: input.channelId ?? null,
      channel: input.channel,
      message_id: input.messageId,
      author_id: input.authorId ?? null,
      author: input.author,
      attachment_id: input.attachmentId ?? null,
      attachment_filename: attachmentFilename,
      attachment_url: input.attachmentUrl ?? null,
      content_type: input.contentType ?? contentTypeFor(artifactType),
      size_bytes: stats.size
    },
    ...discordJobMetadata,
    ...userMetadata
  };
  const rawContent = input.messageContent?.trim()
    ? input.messageContent.trim()
    : `Discord attachment intake: ${attachmentFilename}`;

  const rawMessage = addRawMessage({
    surface: "openclaw_discord",
    channel: input.channel,
    direction: "inbound",
    actor: input.author,
    content: rawContent,
    rawJson: JSON.stringify(discordMetadata)
  });

  const intake = createIntake({
    source: "discord_attachment",
    surface: "openclaw_discord",
    channel: input.channel,
    customerName: input.customerName ?? input.author,
    message: rawContent,
    rawMessageId: rawMessage.id,
    metadataJson: JSON.stringify(discordMetadata)
  });

  const artifact = storeArtifact({
    intakeRequestId: intake.id,
    filePath: attachmentPath,
    filename: attachmentFilename,
    artifactType,
    rawMessageId: rawMessage.id,
    metadataJson: JSON.stringify(discordMetadata)
  });

  let discordJobThread: DiscordJobThreadRow | null = null;
  if (input.jobThreadRecordId) {
    discordJobThread = showDiscordJobThread(input.jobThreadRecordId) ?? null;
    if (!discordJobThread) {
      throw new Error(`Discord job thread not found: ${input.jobThreadRecordId}`);
    }
  } else if (input.jobThreadId) {
    discordJobThread = recordDiscordJobThread({
      channel: input.channel,
      threadId: input.jobThreadId,
      threadName: input.jobThreadName ?? `print-${intake.id}-${attachmentFilename}`,
      guildId: input.guildId,
      channelId: input.channelId,
      sourceMessageId: input.messageId,
      customerName: input.customerName ?? input.author,
      summary: rawContent
    });
  }

  const discordJobArtifact = discordJobThread
    ? linkDiscordJobArtifact({
        discordJobThreadId: discordJobThread.id,
        intakeRequestId: intake.id,
        artifactId: artifact.id,
        versionLabel: input.versionLabel,
        relationship: input.artifactRelationship ?? "primary",
        status: "active"
      })
    : null;

  return {
    ok: true,
    raw_message: rawMessage,
    intake: showIntake(intake.id)!,
    artifact,
    discord_job_thread: discordJobThread,
    discord_job_artifact: discordJobArtifact,
    next_step: "review_file"
  };
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
  assertNonBlank(input.materialProfile, "Material profile");
  assertNonBlank(input.printerProfile, "Printer profile");
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new Error(`Invalid quantity: ${input.quantity}`);
  }
  if (!fs.existsSync(artifact.stored_path)) {
    throw new Error(`Stored artifact file is missing: ${artifact.stored_path}`);
  }
  assertPrintableArtifact(artifact);

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
      printerProfile: input.printerProfile.trim(),
      materialProfile: input.materialProfile.trim(),
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
  const handoffPath = path.join(packageDir, "handoff.md");
  const metadataPath = path.join(packageDir, "print_package.json");
  const notesPath = path.join(packageDir, "notes.md");

  fs.writeFileSync(
    checklistPath,
    [
      "# Print Package Checklist",
      "",
      "- [ ] Open the prepared source file in Bambu Studio.",
      "- [ ] Verify scale, orientation, material, quantity, printer profile, and supports.",
      "- [ ] Confirm the source hash and file size match `print_package.json`.",
      "- [ ] Choose exactly one outcome: approve, reject, or revise.",
      "- [ ] Confirm print send requires explicit human approval before any printer action.",
      ""
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    handoffPath,
    [
      "# Bambu Studio Handoff",
      "",
      `Package ID: ${packageId}`,
      `Prepared file: ${preparedFilePath}`,
      `Source file: ${artifact.stored_path}`,
      `Artifact: ${artifact.filename}`,
      `Artifact type: ${artifact.artifact_type}`,
      `SHA256: ${artifact.sha256}`,
      `Size bytes: ${artifact.size_bytes}`,
      `Material: ${input.materialProfile.trim()}`,
      `Quantity: ${input.quantity}`,
      `Printer profile: ${input.printerProfile.trim()}`,
      "",
      "## Required Review",
      "",
      "- Open the prepared file in Bambu Studio.",
      "- Verify scale, orientation, selected material, quantity, printer profile, and support assumptions.",
      "- If the preview is acceptable, mark the package `approved_to_send` only after human review.",
      "- If the request cannot be printed safely or correctly, mark it `rejected`.",
      "- If the file or print assumptions need changes, mark it `revise_requested`.",
      "",
      "MICBot may send this package only after explicit human approval for the exact package, material, quantity, and target printer.",
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
        artifact_filename: artifact.filename,
        artifact_type: artifact.artifact_type,
        artifact_size_bytes: artifact.size_bytes,
        artifact_sha256: artifact.sha256,
        source_file_path: artifact.stored_path,
        prepared_file_path: preparedFilePath,
        material_profile: input.materialProfile.trim(),
        printer_profile: input.printerProfile.trim(),
        quantity: input.quantity,
        required_human_checks: ["scale", "orientation", "material", "quantity", "printer_profile", "supports"],
        no_unapproved_printing: true
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

const printPackageStatusTransitions: Record<PrintPackageStatus, PrintPackageStatus[]> = {
  pending: ["ready_for_preview", "failed"],
  ready_for_preview: ["opened_for_preview", "failed"],
  opened_for_preview: ["awaiting_human_approval", "revise_requested", "rejected", "failed"],
  awaiting_human_approval: ["approved_to_send", "rejected", "revise_requested", "failed"],
  approved_to_send: ["sent_to_printer", "failed"],
  rejected: [],
  revise_requested: ["ready_for_preview", "rejected", "failed"],
  sent_to_printer: ["printing", "failed"],
  printing: ["completed", "failed"],
  failed: ["ready_for_preview"],
  completed: []
};

export function markPrintPackageStatus(id: number, status: string): PrintPackageRow {
  assertChoice(status, printPackageStatuses, "print package status");
  const printPackage = showPrintPackage(id);
  if (!printPackage) {
    throw new Error(`Print package not found: ${id}`);
  }
  if (printPackage.status === status) {
    return printPackage;
  }
  const allowedNextStatuses = printPackageStatusTransitions[printPackage.status];
  if (!allowedNextStatuses.includes(status)) {
    throw new Error(
      `Invalid print package status transition from ${printPackage.status} to ${status}. Allowed next statuses: ${
        allowedNextStatuses.join(", ") || "none"
      }`
    );
  }
  getDb().prepare("UPDATE print_packages SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  return showPrintPackage(id)!;
}

function maybeAppPath(appName: string): string | null {
  const locations = [`/Applications/${appName}.app`, path.join(process.env.HOME ?? "", "Applications", `${appName}.app`)];
  return locations.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

export interface BambuConfiguredPrinter {
  serial: string;
  selected: boolean;
  has_access_code: boolean;
  model: string | null;
}

function maybeBambuStudioConfigPath(): string | null {
  const home = process.env.HOME;
  if (!home) return null;
  const candidate = path.join(home, "Library", "Application Support", "BambuStudio", "BambuStudio.conf");
  return fs.existsSync(candidate) ? candidate : null;
}

function readConfiguredBambuPrinters(): {
  found: boolean;
  config_path: string | null;
  selected_serial: string | null;
  current_machine_profile: string | null;
  current_filament_profiles: string[];
  configured_printers: BambuConfiguredPrinter[];
} {
  const configPath = maybeBambuStudioConfigPath();
  if (!configPath) {
    return {
      found: false,
      config_path: null,
      selected_serial: null,
      current_machine_profile: null,
      current_filament_profiles: [],
      configured_printers: []
    };
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    access_code?: Record<string, unknown>;
    app?: { user_last_selected_machine?: unknown };
    models?: Array<{ model?: unknown }>;
    presets?: { machine?: unknown; filaments?: unknown };
    user_access_code?: Record<string, unknown>;
  };

  const selectedSerial = typeof config.app?.user_last_selected_machine === "string" ? config.app.user_last_selected_machine : null;
  const accessCodeSerials = Object.keys(config.access_code ?? {});
  const userAccessCodeSerials = Object.keys(config.user_access_code ?? {});
  const serials = Array.from(new Set([...accessCodeSerials, ...userAccessCodeSerials])).sort();
  const configuredModel =
    Array.isArray(config.models) && typeof config.models[0]?.model === "string" ? (config.models[0].model as string) : null;
  const currentMachineProfile = typeof config.presets?.machine === "string" ? config.presets.machine : null;
  const currentFilamentProfiles = Array.isArray(config.presets?.filaments)
    ? config.presets.filaments.filter((filament): filament is string => typeof filament === "string")
    : [];

  return {
    found: true,
    config_path: configPath,
    selected_serial: selectedSerial,
    current_machine_profile: currentMachineProfile,
    current_filament_profiles: currentFilamentProfiles,
    configured_printers: serials.map((serial) => ({
      serial,
      selected: serial === selectedSerial,
      has_access_code: userAccessCodeSerials.includes(serial) || accessCodeSerials.includes(serial),
      model: configuredModel
    }))
  };
}

function readStlGeometry(filePath: string): {
  summary: StlGeometrySummary;
  triangles: Array<[[number, number, number], [number, number, number], [number, number, number]]>;
} {
  const buffer = fs.readFileSync(filePath);
  const sizeBytes = buffer.length;
  const headerTriangleCount = sizeBytes >= 84 ? buffer.readUInt32LE(80) : 0;
  const expectedBinaryBytes = 84 + headerTriangleCount * 50;
  const triangles: Array<[[number, number, number], [number, number, number], [number, number, number]]> = [];

  if (sizeBytes >= 84 && expectedBinaryBytes === sizeBytes) {
    for (let index = 0, offset = 84; index < headerTriangleCount; index += 1, offset += 50) {
      const vertices = [0, 1, 2].map((vertexIndex) => {
        const base = offset + 12 + vertexIndex * 12;
        return [buffer.readFloatLE(base), buffer.readFloatLE(base + 4), buffer.readFloatLE(base + 8)] as [number, number, number];
      }) as [[number, number, number], [number, number, number], [number, number, number]];
      triangles.push(vertices);
    }
  } else {
    const text = buffer.toString("utf8");
    const vertices = Array.from(text.matchAll(/vertex\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/gi)).map(
      (match) => [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number]
    );
    for (let index = 0; index + 2 < vertices.length; index += 3) {
      triangles.push([vertices[index], vertices[index + 1], vertices[index + 2]]);
    }
  }

  if (triangles.length < 1) {
    throw new Error(`No STL triangles could be parsed from ${filePath}`);
  }

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const triangle of triangles) {
    for (const vertex of triangle) {
      for (let axis = 0; axis < 3; axis += 1) {
        if (!Number.isFinite(vertex[axis])) {
          throw new Error(`Invalid STL vertex coordinate in ${filePath}`);
        }
        min[axis] = Math.min(min[axis], vertex[axis]);
        max[axis] = Math.max(max[axis], vertex[axis]);
      }
    }
  }

  return {
    summary: {
      format: sizeBytes >= 84 && expectedBinaryBytes === sizeBytes ? "binary_stl" : "ascii_stl",
      triangles: triangles.length,
      size_bytes: sizeBytes,
      bounds: {
        min,
        max,
        dimensions_mm: [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
      }
    },
    triangles
  };
}

function triangleArea(triangle: [[number, number, number], [number, number, number], [number, number, number]]): number {
  const [a, b, c] = triangle;
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0]
  ];
  return Math.hypot(cross[0], cross[1], cross[2]) / 2;
}

function triangleNormal(triangle: [[number, number, number], [number, number, number], [number, number, number]]): [number, number, number] {
  const [a, b, c] = triangle;
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross: [number, number, number] = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0]
  ];
  const length = Math.hypot(cross[0], cross[1], cross[2]);
  return length > 0 ? [cross[0] / length, cross[1] / length, cross[2] / length] : [0, 0, 0];
}

function inferBuildPlateSizeMm(printerProfile: string): [number, number] {
  return /p1s|p1p|x1|a1/i.test(printerProfile) ? [256, 256] : [256, 256];
}

function estimatePlateInstances(input: {
  dimensionsMm: [number, number, number];
  quantity: number;
  bedSizeMm: [number, number];
}): PrintabilityEstimate["arranged_instances"] {
  const [bedWidth, bedDepth] = input.bedSizeMm;
  const [partWidth, partDepth] = input.dimensionsMm;
  const gap = 8;
  const quantity = Math.max(1, input.quantity);
  const columns = Math.max(1, Math.floor((bedWidth + gap) / Math.max(partWidth + gap, 1)));
  const rows = Math.ceil(quantity / columns);
  const usedColumns = Math.min(quantity, columns);
  const usedWidth = usedColumns * partWidth + Math.max(usedColumns - 1, 0) * gap;
  const usedDepth = rows * partDepth + Math.max(rows - 1, 0) * gap;
  const startX = Math.max((bedWidth - usedWidth) / 2, 0);
  const startY = Math.max((bedDepth - usedDepth) / 2, 0);

  return Array.from({ length: quantity }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      label: `copy ${index + 1}`,
      x_mm: startX + column * (partWidth + gap),
      y_mm: startY + row * (partDepth + gap),
      width_mm: partWidth,
      depth_mm: partDepth,
      mirrored: false as const
    };
  });
}

function estimatePrintability(geometry: ReturnType<typeof readStlGeometry>, printPackage: PrintPackageRow): PrintabilityEstimate {
  const minZ = geometry.summary.bounds.min[2];
  const dims = geometry.summary.bounds.dimensions_mm;
  const bedSize = inferBuildPlateSizeMm(printPackage.printer_profile);
  const arrangedInstances = estimatePlateInstances({
    dimensionsMm: dims,
    quantity: printPackage.quantity,
    bedSizeMm: bedSize
  });
  const bedToleranceMm = 0.05;
  const overhangThresholdDegrees = 45;
  const downwardThreshold = -Math.cos((overhangThresholdDegrees * Math.PI) / 180);
  let bedContactArea = 0;
  let likelySupportArea = 0;
  let likelySupportTriangles = 0;
  let totalSurfaceArea = 0;

  for (const triangle of geometry.triangles) {
    const area = triangleArea(triangle);
    const normal = triangleNormal(triangle);
    const vertexZ = triangle.map((vertex) => vertex[2]);
    const triangleMinZ = Math.min(...vertexZ);
    const triangleMaxZ = Math.max(...vertexZ);
    totalSurfaceArea += area;

    if (triangleMaxZ <= minZ + bedToleranceMm) {
      bedContactArea += area;
    } else if (normal[2] < downwardThreshold && triangleMinZ > minZ + bedToleranceMm) {
      likelySupportArea += area;
      likelySupportTriangles += 1;
    }
  }

  const xyFootprintArea = Math.max(dims[0], 0) * Math.max(dims[1], 0);
  return {
    orientation_source: "package_coordinates",
    plate_layout_source: "estimated_centered_grid",
    bed_size_mm: bedSize,
    arranged_instances: arrangedInstances,
    fits_estimated_layout: arrangedInstances.every(
      (instance) => instance.x_mm + instance.width_mm <= bedSize[0] && instance.y_mm + instance.depth_mm <= bedSize[1]
    ),
    build_height_mm: dims[2],
    bed_contact_area_mm2: bedContactArea,
    xy_footprint_area_mm2: xyFootprintArea,
    bed_contact_ratio: xyFootprintArea > 0 ? bedContactArea / xyFootprintArea : 0,
    likely_support_area_mm2: likelySupportArea,
    likely_support_triangles: likelySupportTriangles,
    total_surface_area_mm2: totalSurfaceArea,
    overhang_threshold_degrees: overhangThresholdDegrees,
    limitations: [
      "This estimates support risk from STL facet normals in package coordinates.",
      "Plate placement is an estimated centered grid for the package quantity, not Bambu Studio's live Auto Arrange result.",
      "It does not read Bambu Studio's live plate after Auto Arrange unless a future saved 3MF/project export is available.",
      "Mirror state is shown as false because MICBot does not yet create mirrored copies.",
      "It does not replace slicer support preview."
    ]
  };
}

function inspectionSummary(printPackage: PrintPackageRow, artifact: ArtifactRow, geometry: StlGeometrySummary, printability: PrintabilityEstimate): string {
  const dims = geometry.bounds.dimensions_mm;
  return [
    `MICBot remote inspection for print package ${printPackage.id}`,
    "",
    `File: ${artifact.filename}`,
    `Status: ${printPackage.status}`,
    `Approx dimensions: ${formatMm(dims[0])} x ${formatMm(dims[1])} x ${formatMm(dims[2])} mm`,
    `Triangles: ${geometry.triangles}`,
    `Material: ${printPackage.material_profile}`,
    `Printer profile: ${printPackage.printer_profile}`,
    `Quantity: ${printPackage.quantity}`,
    `Current build height: ${formatMm(printability.build_height_mm)} mm`,
    `Estimated bed contact: ${formatMm(printability.bed_contact_area_mm2)} mm^2 (${Math.round(printability.bed_contact_ratio * 100)}% of XY footprint)`,
    `Estimated support-risk area: ${formatMm(printability.likely_support_area_mm2)} mm^2 across ${printability.likely_support_triangles} facets`,
    "",
    "Images: Bambu Studio style raster screenshots only.",
    "Auto Arrange handoff/shortcut is attempted before screenshot generation; printer send is allowed only after explicit human approval.",
    "Orientation source: current package coordinates rendered in the Bambu-style preview frame.",
    "Human checks required: final orientation, slicer support preview, scale, material, quantity, and selected printer.",
    "Commands to support later from Discord: approve, reject, revise orientation, show build plate/front/side/support risk.",
    "MICBot may send this to a printer only after explicit human approval for the exact package, material, quantity, and target printer."
  ].join("\n");
}

function bambuCliPath(): string | null {
  const candidates = [
    "/Applications/BambuStudio.app/Contents/MacOS/BambuStudio",
    "/Applications/Bambu Studio.app/Contents/MacOS/BambuStudio",
    "/Applications/Bambu Studio.app/Contents/MacOS/bambu-studio"
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function runBambuCli(args: string[], cwd: string): { ok: boolean; exitCode: number; stdout: string; stderr: string } {
  const cliPath = bambuCliPath();
  if (!cliPath) {
    return { ok: false, exitCode: 127, stdout: "", stderr: "Bambu Studio CLI was not found." };
  }
  try {
    const stdout = execFileSync(cliPath, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { ok: true, exitCode: 0, stdout, stderr: "" };
  } catch (error) {
    const execError = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    return {
      ok: false,
      exitCode: typeof execError.status === "number" ? execError.status : 1,
      stdout: Buffer.isBuffer(execError.stdout) ? execError.stdout.toString("utf8") : String(execError.stdout ?? ""),
      stderr: Buffer.isBuffer(execError.stderr) ? execError.stderr.toString("utf8") : String(execError.stderr ?? execError.message ?? "")
    };
  }
}

function findBambuSystemProfile(kind: "machine" | "process" | "filament", filename: string): string | null {
  const home = process.env.HOME;
  if (!home) return null;
  const root = path.join(home, "Library", "Application Support", "BambuStudio", "system", "BBL", kind);
  const direct = path.join(root, filename);
  if (fs.existsSync(direct)) return direct;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (!fs.existsSync(current)) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(candidate);
      if (entry.isFile() && entry.name === filename) return candidate;
    }
  }
  return null;
}

function defaultBambuProfiles(printPackage: PrintPackageRow): {
  profileSource: string;
  machine: string | null;
  process: string | null;
  filament: string | null;
} {
  const wantsPetg = /petg/i.test(printPackage.material_profile);
  const machine = findBambuSystemProfile("machine", "Bambu Lab P1P 0.4 nozzle.json");
  const processProfile = findBambuSystemProfile("process", "0.20mm Standard @BBL P1P.json");
  const filament = findBambuSystemProfile(
    "filament",
    wantsPetg ? "Bambu PETG HF @BBL P1P 0.4 nozzle.json" : "Bambu PLA Basic @BBL P1P 0.4 nozzle.json"
  );
  return {
    profileSource: /p1s/i.test(printPackage.printer_profile)
      ? "Bambu CLI-compatible P1P 0.4 profiles used as local stand-ins for the P1S fleet profile."
      : "Bambu CLI-compatible default 0.4 nozzle profiles.",
    machine,
    process: processProfile,
    filament
  };
}

function writeNormalizedBinaryStl(sourcePath: string, outputPath: string): string | null {
  const buffer = fs.readFileSync(sourcePath);
  if (buffer.length < 84) return null;
  const triangleCount = buffer.readUInt32LE(80);
  if (84 + triangleCount * 50 !== buffer.length) return null;

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let index = 0, offset = 84; index < triangleCount; index += 1, offset += 50) {
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const base = offset + 12 + vertex * 12;
      for (let axis = 0; axis < 3; axis += 1) {
        const value = buffer.readFloatLE(base + axis * 4);
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    }
  }

  const shift: [number, number, number] = [
    -((min[0] + max[0]) / 2),
    -((min[1] + max[1]) / 2),
    -min[2]
  ];
  const output = Buffer.from(buffer);
  for (let index = 0, offset = 84; index < triangleCount; index += 1, offset += 50) {
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const base = offset + 12 + vertex * 12;
      for (let axis = 0; axis < 3; axis += 1) {
        output.writeFloatLE(buffer.readFloatLE(base + axis * 4) + shift[axis], base + axis * 4);
      }
    }
  }
  fs.writeFileSync(outputPath, output);
  return outputPath;
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function firstNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function isLikelyBlankPng(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    return stats.size < 2_000;
  } catch {
    return true;
  }
}

function createBambuStyleInspectionPreviews(targetPath: string, outputDir: string): RemoteInspectionResult["raster_preview_files"] {
  const workspaceRoot = path.dirname(projectRoot());
  const scriptPath = path.join(workspaceRoot, "scripts", "make_bambu_style_screenshots.mjs");
  const prefix = "bambu_prepare";
  fs.mkdirSync(outputDir, { recursive: true });
  execFileSync(
    "node",
    [
      scriptPath,
      "--stl",
      targetPath,
      "--out-dir",
      outputDir,
      "--prefix",
      prefix
    ],
    { cwd: workspaceRoot, stdio: "ignore" }
  );

  const files = {
    prepare_view_1: path.join(outputDir, `${prefix}_1.png`),
    prepare_view_2: path.join(outputDir, `${prefix}_2.png`),
    prepare_view_3: path.join(outputDir, `${prefix}_3.png`)
  };
  for (const filePath of Object.values(files)) {
    if (!fs.existsSync(filePath) || isLikelyBlankPng(filePath)) {
      throw new Error(`Bambu-style preview generation failed or produced a blank image: ${filePath}`);
    }
  }
  return files;
}

export function probeBambu(): {
  ok: true;
  platform: string;
  bambu_studio: { found: boolean; paths: string[] };
  cli_candidates: { found: boolean; paths: string[] };
  studio_config: ReturnType<typeof readConfiguredBambuPrinters>;
  capabilities: string[];
  safety: { sends_to_printer: false; requires_login: false };
} {
  const studioPaths = [maybeAppPath("Bambu Studio"), maybeAppPath("BambuStudio")].filter(Boolean) as string[];
  const cliCandidates = [bambuCliPath()].filter(Boolean) as string[];

  return {
    ok: true,
    platform: process.platform,
    bambu_studio: { found: studioPaths.length > 0, paths: studioPaths },
    cli_candidates: { found: cliCandidates.length > 0, paths: cliCandidates },
    studio_config: readConfiguredBambuPrinters(),
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
      instructions: `Open ${targetPath} manually in Bambu Studio. Approve, reject, or revise before any future printer send step.`
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
      instructions: `Bambu preview open failed. Open ${targetPath} manually in Bambu Studio, then approve, reject, or revise before any future printer send step.`
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

  markPrintPackageStatus(printPackageId, "opened_for_preview");
  const updatedPackage = markPrintPackageStatus(printPackageId, "awaiting_human_approval");
  const handoff = createHumanHandoff({
    type: "approve_print_send",
    relatedObjectType: "print_package",
    relatedObjectId: printPackageId,
    assignedTo: "Jeff",
    instructions: "Review the package in Bambu Studio. Approve, reject, or revise before any future printer send step."
  });

  return {
    ok: true,
    print_package: updatedPackage,
    handoff,
    probe,
    opened: true
  };
}

export function createRemoteInspection(printPackageId: number): RemoteInspectionResult {
  const printPackage = showPrintPackage(printPackageId);
  if (!printPackage) {
    throw new Error(`Print package not found: ${printPackageId}`);
  }
  const artifact = showArtifact(printPackage.artifact_id);
  if (!artifact) {
    throw new Error(`Artifact not found: ${printPackage.artifact_id}`);
  }
  if (artifact.artifact_type !== "stl") {
    throw new Error(`Remote visual inspection currently supports STL artifacts only; found ${artifact.artifact_type}`);
  }
  const targetPath = printPackage.prepared_file_path || printPackage.source_file_path;
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Prepared file is missing: ${targetPath}`);
  }

  const geometry = readStlGeometry(targetPath);
  const printability = estimatePrintability(geometry, printPackage);
  const autoArrange = requestBambuAutoArrange(printPackageId, true);
  const inspectionDir = path.join(printPackage.preview_path, "bambu-style");
  fs.mkdirSync(inspectionDir, { recursive: true });

  const rasterPreviewFiles = createBambuStyleInspectionPreviews(targetPath, inspectionDir);

  const discordSummary = inspectionSummary(printPackage, artifact, geometry.summary, printability);
  const reviewCardPath = path.join(inspectionDir, "discord-review-card.md");
  fs.writeFileSync(reviewCardPath, `${discordSummary}\n`, "utf8");
  const discordContext = discordJobContextForPrintPackage(printPackage.id);

  return {
    ok: true,
    print_package: printPackage,
    artifact,
    geometry: geometry.summary,
    review_card_path: reviewCardPath,
    preview_type: "bambu_studio_style_raster",
    preview_files: rasterPreviewFiles,
    raster_preview_files: rasterPreviewFiles,
    auto_arrange: autoArrange,
    printability,
    discord_target_thread: discordContext?.thread ?? null,
    discord_summary: discordSummary,
    safety: { sends_to_printer: false, requires_human_approval: true }
  };
}

export function requestBambuAutoArrange(printPackageId: number, attemptUiAutomation = false): AutoArrangeRequestResult {
  const printPackage = showPrintPackage(printPackageId);
  if (!printPackage) {
    throw new Error(`Print package not found: ${printPackageId}`);
  }

  let uiAutomation: AutoArrangeRequestResult["ui_automation"] = { ok: false, method: null };
  if (attemptUiAutomation) {
    try {
      execFileSync(
        "osascript",
        [
          "-e",
          'tell application "BambuStudio" to activate',
          "-e",
          "delay 0.5",
          "-e",
          'tell application "System Events" to keystroke "a"'
        ],
        { stdio: "ignore" }
      );
      uiAutomation = { ok: true, method: "BambuStudio activate + keyboard shortcut A" };
    } catch (error) {
      uiAutomation = {
        ok: false,
        method: "BambuStudio activate + keyboard shortcut A",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const handoff = createHumanHandoff({
    type: "preview_print_package",
    relatedObjectType: "print_package",
    relatedObjectId: printPackageId,
    assignedTo: "Jeff",
    instructions: [
      "Use Bambu Studio Auto Arrange on this package, then inspect orientation, scale, supports, material, quantity, and selected printer.",
      "Approve, reject, or request revision before any printer send step.",
      "MICBot may send this package only after explicit human approval for the exact package, material, quantity, and target printer."
    ].join(" ")
  });

  const notesPath = path.join(printPackage.package_dir, "notes.md");
  if (fs.existsSync(notesPath)) {
    fs.appendFileSync(
      notesPath,
      [
        "",
        "## Auto Arrange Request",
        "",
        `Created handoff ${handoff.id}.`,
        attemptUiAutomation
          ? `UI automation attempted: ${uiAutomation.ok ? "ok" : `failed (${uiAutomation.error ?? "unknown error"})`}.`
          : "UI automation was not attempted; human should press Auto Arrange in Bambu Studio.",
        ""
      ].join("\n"),
      "utf8"
    );
  }

  return {
    ok: true,
    print_package: showPrintPackage(printPackageId) ?? printPackage,
    handoff,
    attempted_ui_automation: attemptUiAutomation,
    ui_automation: uiAutomation,
    safety: { sends_to_printer: false, requires_human_approval: true }
  };
}
