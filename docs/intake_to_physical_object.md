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
- Copy an uploaded model or related file into managed runtime artifact storage.
- Compute SHA256 and file size.
- Infer a basic artifact type from the extension.
- Review stored files with basic deterministic checks.
- Create a print package directory with original, working, Bambu, and preview folders.
- Generate `checklist.md`, `notes.md`, and `package.json`.
- Probe for local Bambu Studio/Bambu Connect capabilities without login.
- Try to open a package preview in Bambu Studio when available.
- Create a human approval handoff when preview opening succeeds.

## Not Automated Yet

- Discord attachment ingestion.
- Website or email intake.
- Mesh repair, slicing analysis, or printability scoring.
- Bambu account login.
- Printer cloud/API control.
- Autonomous print sending.
- Customer messaging.
- Invoicing or QuickBooks integration.

MICBot must not send anything to a printer in this slice.

## Commands

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

Show package state:

```bash
npm run cli -- show-print-package --id 1 --json
```

## Human Approval

The approval state is intentionally explicit. MICBot can prepare and open a preview, but a human must review the package in Bambu Studio or Bambu Connect and approve, reject, or revise before any future printer-send workflow exists.

For now, approval is represented by a `human_handoffs` row. The key handoff type for this slice is `approve_print_send`.

## Future Path

The likely next steps are Discord attachment intake, email or website intake, richer file review, quote/invoice preparation, and eventually a printer-send handoff. Any future printer-send automation should remain human-visible and approval-gated.
