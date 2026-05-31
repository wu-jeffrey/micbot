# Production 3D Workflow

This is MICBot's production-grade version of the claw3d-style workflow.

The goal is not to clone claw3d command-for-command. The goal is to preserve its useful routing model while making MICBot reliable for a paid print-farm workflow.

## Architecture

```txt
OpenClaw / Discord / web operator
  -> MICBot CLI
  -> SQLite business ledger
  -> managed artifacts and print package folders
  -> model search / CAD / mesh generation tools
  -> Bambu Studio visible preview and slicing
  -> explicit approval
  -> approved printer send
```

OpenClaw stays the conversational operator. MICBot stays the durable local tool substrate.

## Primary Routing Gate

Every physical-object request is routed before tool execution:

- `search_existing`: common printable objects that likely exist in model libraries.
- `cad_design`: fit-critical or mechanical parts that should be STEP-first.
- `mesh_generation`: organic, artistic, exact-replication, or media-driven mesh work.
- `direct_print_package`: user supplied STL/3MF/STEP/STP and wants it prepared.
- `needs_clarification`: one focused missing decision blocks safe routing.
- `non_print_request`: no physical-object workflow applies.

This copies the strongest part of claw3d: common functional things should be searched first, while exact/custom/mechanical work should not be forced through generic AI mesh generation.

## End-to-End Flow

```txt
intake
  -> plan-production-workflow
  -> search existing OR CAD design OR mesh generation OR direct package
  -> candidate/model/CAD review
  -> print package
  -> Bambu Studio auto-arrange
  -> Bambu-style raster screenshots
  -> review details
  -> explicit package/material/quantity/printer approval
  -> final Bambu send
  -> logged result and status
```

## Route Details

### Search Existing

Use for common objects such as holders, hooks, cases, brackets, trays, organizers, and stands.

Expected workflow:

1. Search model sources.
2. Store source URL, author, license, and candidate files.
3. Present options.
4. User selects one.
5. Package selected model.
6. Auto-arrange and generate Bambu screenshots.
7. Wait for explicit print-send approval.

MICBot must add business checks claw3d does not enforce: provenance, license, revision history, package status, and approval logs.

### CAD Design

Use for mechanical, dimensional, or fit-critical work.

Expected workflow:

1. Create a natural-language CAD brief.
2. Ask only for fit-critical missing dimensions.
3. Generate STEP-first CAD source.
4. Validate geometry and snapshots.
5. Export STL/3MF sidecars.
6. Package and preview in Bambu Studio.
7. Wait for approval.

The text-to-cad/build123d style is the right inspiration here: STEP is primary; STL/3MF are derived print artifacts.

### Mesh Generation

Use for organic/decorative/custom media-driven shapes.

Expected workflow:

1. Extract the best frame/reference if the user sent video.
2. Generate a mesh model from image/sketch/video reference.
3. Ask for real-world size before slicing.
4. Package and preview.
5. Wait for approval.

Mesh generation should not be the default for brackets, cases, mounts, or anything fit-critical.

### Direct Print Package

Use when the user supplies STL/3MF/STEP/STP.

Expected workflow:

1. Store artifact.
2. Review file.
3. Create print package.
4. Auto-arrange.
5. Generate Bambu-style raster screenshots.
6. Wait for explicit approval.
7. Send only after approval.

## CLI Surface

Route a request without recording:

```bash
npm run cli -- plan-production-workflow \
 --message "I need a phone holder for my desk" \
 --source-kind text \
 --json
```

Route and persist the plan:

```bash
npm run cli -- plan-production-workflow \
 --message "Make a bracket with M4 holes that fits this shelf" \
 --source-kind image \
 --intake-request-id 1 \
 --record \
 --json
```

List recorded plans:

```bash
npm run cli -- list-production-workflow-plans --json
```

## Safety Boundary

The workflow planner never sends to printers. It only records the intended route and next steps.

Final printer sends remain gated by Jeff approving the exact package, material, quantity, and target printer in the current conversation. MICBot must verify visible Bambu Studio state or an equivalent target before triggering the send, then log the attempt and result.

