# Intake to Physical Object

MICBot now has a local deterministic vertical slice for moving a request from customer/file intake toward a human-reviewed print package.

## Current Slice

The current workflow is:

```txt
intake -> artifact storage -> file review -> print package -> Bambu preview attempt -> human approval handoff
```

This chunk automates local records, file preservation, basic deterministic validation, package folder creation, and a best-effort Bambu Studio preview handoff.

## Automated Now

- Create an intake request from a manual/OpenClaw source.
- Create an intake request from a supported Discord printable-file attachment once OpenClaw has a local file path.
- Copy an uploaded model or related file into managed runtime artifact storage.
- Compute SHA256 and file size.
- Infer a basic artifact type from the extension.
- Review stored files with basic deterministic checks.
- Create a print package directory with original, working, Bambu, and preview folders.
- Require a reviewed printable artifact before package creation.
- Generate `checklist.md`, `handoff.md`, `notes.md`, and `print_package.json`.
- Probe for local Bambu Studio capabilities without login.
- Try to open a package preview in Bambu Studio when available.
- Create a human approval handoff when preview opening succeeds.
- Create a Bambu Studio Auto Arrange handoff and optionally attempt the local UI shortcut.
- Generate Discord-friendly remote inspection cards and STL preview images.
- Run an end-to-end fixture-backed smoke path without opening Bambu Studio unless explicitly requested.

## Not Automated Yet

- Discord bot listening or autonomous customer replies.
- Website or email intake.
- Mesh repair, slicing analysis, or printability scoring.
- Autonomous orientation analysis.
- Bambu account login.
- Printer cloud/API control.
- Unapproved print sending.
- Customer messaging.
- Invoicing or QuickBooks integration.

MICBot may trigger the final Bambu Studio print/send action only after Jeff explicitly approves the exact package, material, quantity, and target printer in the current conversation. The approval and send attempt/result must be logged.

## Commands

Run the known-good smoke path:

```bash
npm run smoke:print-package -- --json
```

This creates a smoke intake, stores `tests/fixtures/test_part.stl`, reviews it, creates a package, and verifies `checklist.md`, `handoff.md`, `notes.md`, and `print_package.json` exist. It does not open Bambu Studio by default.

To include a human-visible Studio preview attempt:

```bash
npm run smoke:print-package -- --open-preview --json
```

Create an intake:

```bash
npm run cli -- create-intake \
 --source manual \
 --surface openclaw_discord \
 --channel intake \
 --customer-name "Test Customer" \
 --customer-email "test@example.com" \
 --offer-slug "custom-print" \
 --message "Print this test STL in black PETG, quantity 4." \
 --json
```

Create an intake from a Discord printable-file attachment:

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

This command accepts `.stl`, `.3mf`, `.step`, and `.stp` attachments. It creates a raw message, an intake request, and a stored artifact with Discord message and attachment metadata. It does not review, package, open Bambu Studio, reply to a customer, or send anything to a printer.

Scope a Discord job thread:

```bash
npm run cli -- record-discord-job-thread \
 --channel general \
 --thread-id "discord-thread-id" \
 --thread-name "print job customer bracket" \
 --source-message-id "123" \
 --json
```

Attach uploads to that job thread:

```bash
npm run cli -- intake-discord-attachment \
 --channel general \
 --author mynamejeef \
 --message-id "124" \
 --attachment-path "tests/fixtures/test_part.stl" \
 --attachment-filename "customer-part-v2.stl" \
 --job-thread-record-id 1 \
 --version-label v2 \
 --artifact-relationship revision \
 --json
```

Use one Discord job thread for one customer job/order. Revisions of the same part and multiple part files intended for one plate belong in the same thread as separate artifacts. Unrelated parts or orders should get a new thread. OpenClaw should create/reply to the actual Discord thread; MICBot stores the thread IDs and exposes them so later review cards and previews can be posted back into the right scoped conversation.

Store an artifact:

```bash
npm run cli -- store-artifact \
 --intake-request-id 1 \
 --path "tests/fixtures/test_part.stl" \
 --artifact-type stl \
 --json
```

Review the file:

```bash
npm run cli -- review-file --artifact-id 1 --json
```

Create a print package:

```bash
npm run cli -- create-print-package \
 --intake-request-id 1 \
 --artifact-id 1 \
 --material-profile "PETG" \
 --printer-profile "default-bambu" \
 --quantity 4 \
 --json
```

Probe Bambu tooling:

```bash
npm run cli -- probe-bambu --json
```

Open preview if possible:

```bash
npm run cli -- open-print-package-preview --print-package-id 1 --json
```

Request Bambu Studio Auto Arrange:

```bash
npm run cli -- request-bambu-auto-arrange --print-package-id 1 --attempt-ui --json
```

The `--attempt-ui` path activates Bambu Studio and sends the Auto Arrange keyboard shortcut. It does not approve or send a print. If the UI shortcut is unreliable in a given Bambu Studio state, the generated handoff still tells the human to press Auto Arrange manually.

Generate remote inspection assets for Discord:

```bash
npm run cli -- create-remote-inspection --print-package-id 1 --json
```

For STL packages this creates a Markdown review card plus Bambu Studio style raster PNG screenshots under the package preview directory. OpenClaw can post those images into Discord so Jeff can inspect the package away from the local machine. MICBot attempts Auto Arrange before generating the screenshots, records the attempt in JSON, and still does not approve or send prints.

If the package artifact is linked to a Discord job thread, the JSON output includes `discord_target_thread` so OpenClaw can post the review card and images with `thread-reply`.

The smoke path now generates these assets by default and includes them in `remote_inspection.preview_files` and `remote_inspection.raster_preview_files`:

```bash
npm run smoke:print-package -- --json
```

Use `--skip-remote-inspection` only when you need a package-only smoke run.

Show package state:

```bash
npm run cli -- show-print-package --id 1 --json
```

## Human Approval

The approval state is intentionally explicit. MICBot can prepare and open a preview, and may trigger the final Bambu Studio print/send action only after Jeff approves the exact package, material, quantity, and target printer in the current conversation.

For now, approval is represented by a `human_handoffs` row. The key handoff type for this slice is `approve_print_send`.

The intended print package lifecycle is:

```txt
ready_for_preview -> opened_for_preview -> awaiting_human_approval -> approved_to_send -> sent_to_printer
                                                         |-> rejected
                                                         |-> revise_requested
```

MICBot prevents unsupported status jumps in the CLI so approval remains auditable.

## Future Path

The likely next steps are routing OpenClaw Discord events into `intake-discord-attachment`, email or website intake, richer file review, quote/invoice preparation, and eventually a printer-send handoff. Any future printer-send automation should remain human-visible and approval-gated.
