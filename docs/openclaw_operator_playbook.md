# OpenClaw Operator Playbook

OpenClaw is the conversational operator. MICBot is the local business memory/tool substrate. Jeff should not manually run MICBot commands during normal operation.

Use `--json` for commands OpenClaw needs to parse. SQLite is the source of truth. `data/wiki/` is a generated Markdown projection.

## Raw Capture Only

Jeff says:

> Later we should make Kijiji posts mention Toronto pickup.

OpenClaw should capture only the raw evidence:

```bash
npm run cli -- add-raw-message --surface openclaw_discord --channel general --direction inbound --actor Jeff --content "Later we should make Kijiji posts mention Toronto pickup." --json
```

This creates one `raw_messages` row and does not create distilled memory.

## Remember / Distill

Jeff says:

> Remember black PETG is default for outdoor brackets.

OpenClaw should create raw evidence, distilled memory, and a regenerated wiki projection:

```bash
npm run cli -- remember --surface openclaw_discord --channel general --direction inbound --actor Jeff --content "Remember black PETG is default for outdoor brackets." --category materials --title "Default outdoor bracket material" --body "Black PETG is the default material for outdoor brackets." --status active --json
```

`remember` writes the raw message and memory entry in a SQLite transaction, then rebuilds `data/wiki/`.

## Correction

Jeff says:

> Actually, outdoor brackets can be black PETG or ASA depending on UV exposure.

OpenClaw should:

1. Capture the correction as raw evidence.
2. Update or deprecate the previous memory.
3. Create or update the better memory entry.
4. Rebuild the wiki.

Example:

```bash
npm run cli -- add-raw-message --surface openclaw_discord --channel general --direction inbound --actor Jeff --content "Actually, outdoor brackets can be black PETG or ASA depending on UV exposure." --json
npm run cli -- update-memory --id 1 --category materials --title "Default outdoor bracket materials" --body "Outdoor brackets should default to black PETG unless UV exposure or customer requirements make ASA a better fit." --source-raw-message-ids "1,2" --status active --json
```

When a prior memory should remain historically visible but no longer guide operations:

```bash
npm run cli -- deprecate-memory --id 1 --reason "Replaced by a more specific outdoor bracket materials policy." --json
```

Deprecation stores the reason in the memory body because the current schema does not include a separate metadata field.

## Not Worth Capturing

Jeff says:

> cool thanks

OpenClaw should not capture this. Casual acknowledgement is not business evidence unless it changes MICBot, MIC operations, print farm operations, customer handling, pricing, policies, website, marketplace, printers, materials, or future automation.

## Boundaries

Do not build channel-specific integrations yet. Discord, Slack, and Web UI are OpenClaw surfaces, not separate MICBot systems. Do not build a Discord bot, Slack bot, Web UI listener, jobs, approvals, tasks, printer automation, browser automation, marketplace automation, website automation, STL inspection, MCP server, embeddings, vector search, or automatic background capture.
