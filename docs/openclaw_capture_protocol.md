# OpenClaw Capture Protocol

MICBot is not a chat bot yet. MICBot is a local business memory and tool substrate that OpenClaw can call when Jeff says something worth preserving.

The CLI exists because OpenClaw needs a deterministic local tool surface. Jeff should talk normally through Discord, Slack, OpenClaw Web UI, or another future OpenClaw surface. OpenClaw decides whether the message matters, then calls the MICBot CLI internally.

## Architecture

Current flow:

```txt
Jeff message from any OpenClaw surface
-> OpenClaw agent
-> MICBot local CLI/tool layer
-> SQLite raw ledger
-> generated Markdown wiki in data/wiki/
```

SQLite is the source of truth. Raw messages are evidence. Distilled memory entries are business understanding linked back to raw source message IDs. Markdown files under `data/wiki/` are generated projections for humans and agents to read.

## Surface Neutrality

MICBot should not care whether Jeff used Discord, Slack, Web UI, or a later OpenClaw interface. The `surface` field identifies the OpenClaw interface surface. The `channel` field stores the specific channel, session, or context.

Recommended `surface` values:

- `openclaw_discord`
- `openclaw_slack`
- `openclaw_web`
- `manual`
- `system`

Example channels:

- Discord channel name or ID, such as `general`
- Slack channel name or ID, such as `micbot`
- Web UI session label, such as `webui`
- `manual`
- `system`

This is not a Discord, Slack, or Web UI integration. Do not build a separate MICBot Discord bot, Slack bot, Web UI listener, slash command, webhook, event collector, or background channel collector yet.

## Capture Modes

### Raw Capture

Use `add-raw-message` when Jeff says something business-relevant but does not clearly ask MICBot to convert it into durable policy memory.

Example:

```bash
npm run cli -- add-raw-message \
  --surface openclaw_discord \
  --channel general \
  --direction inbound \
  --actor Jeff \
  --content "Need to remember later that Kijiji listings should mention pickup in Toronto." \
  --json
```

This creates one `raw_messages` row only.

### Remember / Distill

Use `remember` when Jeff explicitly says things like:

- remember
- note that
- store this
- add to memory
- make this policy
- this is how MICBot should operate

Also use it when the message clearly creates durable operating policy for MICBot or Made In Canada Industries.

Example:

```bash
npm run cli -- remember \
  --surface openclaw_web \
  --channel webui \
  --direction inbound \
  --actor Jeff \
  --content "Make MICBot treat printer bed clearing as a human handoff step." \
  --category runbooks \
  --title "Bed clearing is a human handoff" \
  --body "Printer bed clearing is handled as a human handoff step until MICBot has a stable approval and safety model." \
  --status active \
  --json
```

This creates one raw message, creates one linked memory entry, rebuilds the wiki, and prints a concise result.

## Worth Capturing

Capture business-relevant instructions, facts, and decisions such as:

- material defaults
- printer operating preferences
- customer handling rules
- quote or pricing policy
- website wording decisions
- marketplace listing policy
- Made In Canada Industries operating model
- future automation constraints
- runbook or handoff rules

## Usually Not Worth Capturing

Do not capture casual chatter unless it affects the business or MICBot’s operating behavior.

Usually skip:

- greetings
- jokes with no business implication
- one-off status comments
- general conversation about unrelated topics
- transient implementation chatter that does not change future behavior

## JSON Output

OpenClaw should pass `--json` when it needs reliable machine-readable output. When `--json` is passed, supported commands emit valid JSON only and do not mix in human prose.

JSON output is supported for:

- `add-raw-message`
- `add-memory`
- `remember`
- `show-raw-message`
- `show-memory`
- `list-raw-messages`
- `list-memory`
- `list-settings`

## Future MCP Preparation

This protocol keeps the boundary clean for a future MCP tool. The CLI already defines stable local operations:

- capture raw evidence
- create linked memory
- read the ledger
- rebuild projections

When the local tool layer is stable, these commands can become MCP tool methods without changing the underlying source-of-truth model.
