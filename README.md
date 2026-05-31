# MICBot

MICBot is the future AI operator for Made In Canada Industries, a small 3D print farm and light manufacturing business.

Chunk 1C keeps MICBot as a local business memory/tool substrate that OpenClaw can call from any interface surface, with hardened capture and correction commands.

The current durable memory primitive is:

OpenClaw message -> CLI command -> SQLite write -> SQLite read -> Markdown wiki projection -> tests

It intentionally does not build a standalone Discord bot, Slack bot integration, Web UI listeners, jobs, approvals, printer automation, browser automation, marketplace automation, website automation, STL inspection, embeddings, vector search, RAG, or automatic summarization.

## Memory Layers

MICBot uses three distinct memory layers:

- OpenClaw native memory: agent recall and assistant continuity.
- MICBot raw ledger: durable business evidence in SQLite.
- MICBot wiki: human-readable operating knowledge projected from SQLite into `data/wiki/`.

Raw messages are source material because they preserve exact business-relevant evidence: what was said, received, approved, uploaded, changed, or triggered. Distilled memory entries summarize what the business should remember, but they link back to raw source message IDs.

SQLite is the source of truth. Raw messages are evidence. Distilled memory entries are business understanding linked back to raw source message IDs. Markdown wiki files are generated projections for Jeff, OpenClaw, and future agents to read directly.

The canonical generated MICBot wiki path is `data/wiki/`. Do not use a root-level `wiki/` folder as an active wiki location.

## How OpenClaw Should Use This

Jeff should not need to run CLI commands manually during normal operation. The CLI is a deterministic local tool surface for OpenClaw.

Example raw capture from Discord as an OpenClaw surface:

```bash
npm run cli -- add-raw-message --surface openclaw_discord --channel general --direction inbound --actor Jeff --content "Need to remember later that Kijiji listings should mention pickup in Toronto."
```

Example remember/distill from any OpenClaw surface:

```bash
npm run cli -- remember --surface openclaw_web --channel webui --direction inbound --actor Jeff --content "Make MICBot treat printer bed clearing as a human handoff step." --category runbooks --title "Bed clearing is a human handoff" --body "Printer bed clearing is handled as a human handoff step until MICBot has a stable approval and safety model." --status active
```

Use `add-raw-message` for business-relevant raw capture. Use `remember` only for explicit durable memory or clear operating policy. Use `update-memory` for corrections and refinements. Use `deprecate-memory` instead of deleting outdated memory. Raw messages are immutable evidence and should never be modified. Do not capture casual chatter.

The recommended surface values are `openclaw_discord`, `openclaw_slack`, `openclaw_web`, `manual`, and `system`. The `channel` field stores the specific channel, session, or context such as `general`, `micbot`, or `webui`.

OpenClaw remains the operator; MICBot remains the local tool layer. Discord attachment intake is exposed as a CLI command that OpenClaw can call after it has access to the attachment file.

## Setup

```bash
npm install
npm run init-db
```

## CLI

```bash
npm run cli -- add-raw-message --surface discord --channel general --direction inbound --actor Jeff --content "Remember black PETG is default for outdoor brackets."
npm run cli -- list-raw-messages
npm run cli -- show-raw-message --id 1
npm run cli -- add-memory --category materials --title "Default outdoor bracket material" --body "Black PETG is the default material for outdoor brackets." --source-raw-message-ids "1" --status active
npm run cli -- remember --surface openclaw_discord --channel general --direction inbound --actor Jeff --content "Remember black PETG is default for outdoor brackets." --category materials --title "Default outdoor bracket material" --body "Black PETG is the default material for outdoor brackets." --status active --json
npm run cli -- update-memory --id 1 --category materials --title "Default outdoor bracket materials" --body "Outdoor brackets should default to black PETG unless UV exposure or customer requirements make ASA a better fit." --source-raw-message-ids "1,2" --status active --json
npm run cli -- deprecate-memory --id 1 --reason "Replaced by a more specific materials policy." --json
npm run cli -- list-memory
npm run cli -- show-memory --id 1
npm run cli -- rebuild-wiki
npm run cli -- set-setting --key business_name --value "\"Made In Canada Industries\""
npm run cli -- get-setting --key business_name
npm run cli -- list-settings
```

Use `--json` when OpenClaw needs machine-readable output. Commands with JSON support emit valid JSON only when `--json` is passed. The `remember` command writes the raw message and linked memory entry in a SQLite transaction, then rebuilds the wiki projection. If wiki rebuild fails after the DB write, it exits non-zero and reports that the DB write succeeded while projection failed.

## Discord Attachment Intake

OpenClaw can hand MICBot a printable Discord attachment after downloading or otherwise resolving it to a local file path:

```bash
npm run cli -- intake-discord-attachment \
 --channel general \
 --author mynamejeef \
 --message-id "123" \
 --attachment-id "456" \
 --attachment-path "tests/fixtures/test_part.stl" \
 --attachment-filename "customer-part.stl" \
 --message-content "Can you print this?" \
 --json
```

This accepts `.stl`, `.3mf`, `.step`, and `.stp` only. It creates a raw message, an intake request, and a stored artifact with Discord metadata, then stops at `next_step: "review_file"`.

## Remote Print Inspection

MICBot can prepare a Discord-friendly inspection card for a print package without sending anything to a printer:

```bash
npm run cli -- create-remote-inspection --print-package-id 1 --json
```

For STL packages this generates only Bambu Studio style raster PNG screenshots. MICBot attempts the Bambu Studio Auto Arrange shortcut before creating the preview and records that attempt in `remote_inspection.auto_arrange`. It still never sends anything to a printer.

If Bambu Studio is open, MICBot can also create an Auto Arrange handoff and optionally try Bambu Studio's keyboard shortcut:

```bash
npm run cli -- request-bambu-auto-arrange --print-package-id 1 --attempt-ui --json
```

This is still human-gated. The command records that Auto Arrange was requested; it does not approve or send a print.

## Production 3D Workflow Planning

MICBot has a claw3d-inspired routing gate for physical-object requests:

```bash
npm run cli -- plan-production-workflow \
 --message "I need a phone holder for my desk" \
 --source-kind text \
 --json
```

Routes are `search_existing`, `cad_design`, `mesh_generation`, `direct_print_package`, `needs_clarification`, and `non_print_request`. Add `--record` to persist the plan in SQLite. See `docs/production_3d_workflow.md`.

Search results or generated options should be captured as model candidates before selection:

```bash
npm run cli -- record-model-candidate \
 --production-workflow-plan-id 1 \
 --source thingiverse \
 --source-url "https://www.thingiverse.com/thing:123" \
 --title "Desk phone holder" \
 --license "CC-BY" \
 --fit-status fits \
 --json
```

## Tests

```bash
npm test
```

## Print Package Smoke Test

```bash
npm run smoke:print-package -- --json
```

This runs the local intake -> artifact -> review -> print package path with `tests/fixtures/test_part.stl` and verifies the generated handoff files. Add `-- --open-preview --json` only when you want it to attempt opening Bambu Studio.
By default it also creates the same remote inspection assets as `create-remote-inspection` and returns their paths in `remote_inspection.preview_files` plus any PNG paths in `remote_inspection.raster_preview_files`. Add `-- --skip-remote-inspection --json` when you only want the package smoke path.

## Next Chunk

The next chunk should keep the same local boundary and add targeted reliability around memory review and conflict handling before adding any external automation.
