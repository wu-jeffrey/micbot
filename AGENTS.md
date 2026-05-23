# MICBot Agent Notes

MICBot is the future AI operator for Made In Canada Industries, a small 3D print farm and light manufacturing business.

## Memory Boundaries

OpenClaw memory and MICBot memory are different systems:

- OpenClaw memory is for agent recall: how to work with Jeff, preferences, and assistant continuity.
- MICBot raw ledger is for durable business evidence: what was said, received, approved, uploaded, changed, or triggered.
- MICBot wiki is for human-readable operating knowledge projected from the business memory stored in SQLite.

Do not replace OpenClaw memory with MICBot memory.

## Current Scope

The current scope is Chunk 1C: hardened OpenClaw-to-MICBot capture protocol over the local CLI.

The primitive is:

raw message/event -> SQLite ledger -> distilled business memory -> Markdown wiki projection

Raw messages are durable source material. Memory entries are distilled understanding. Markdown wiki files are generated projections from SQLite and are not the source of truth.

SQLite remains the source of truth. The canonical generated MICBot wiki path is `data/wiki/`.

## OpenClaw Capture Rules

1. Jeff should not manually run the CLI during normal operation.
2. OpenClaw should call the MICBot CLI internally.
3. OpenClaw is the conversational operator.
4. MICBot is the local business memory/tool substrate.
5. MICBot should be surface-neutral.
6. Discord, Slack, and Web UI are OpenClaw interface surfaces, not separate MICBot systems yet.
7. Do not build channel-specific integrations until the core local tool layer is stable.
8. Do not build a separate MICBot Discord bot yet.
9. Do not build a separate MICBot Slack bot yet.
10. Capture business-relevant user instructions as raw messages.
11. Only create distilled memory when Jeff explicitly asks to remember/store/note something, or when the message clearly creates a durable operating policy.
12. Use `add-raw-message` for business-relevant raw capture.
13. Use `remember` for explicit durable memory.
14. Use `update-memory` for corrections or refinements.
15. Use `deprecate-memory` instead of deleting outdated memory.
16. Never modify raw messages.
17. Do not capture casual chatter unless it affects MICBot, MIC operations, print farm operations, customer handling, pricing, policies, website, marketplace, printers, materials, or future automation.
18. Raw messages are evidence.
19. Wiki entries are distilled understanding.
20. SQLite remains the source of truth.
21. `data/wiki/` is the canonical generated wiki path.
22. Do not build jobs/approvals/tasks yet.

## Surface Model

Use `surface` for the OpenClaw interface surface, such as `openclaw_discord`, `openclaw_slack`, `openclaw_web`, `manual`, or `system`.

Use `channel` for the specific channel, session, or context, such as `general`, `micbot`, `webui`, `manual`, or `system`.

## Do Not Build Yet

Do not build jobs, approvals, task systems, browser automation, printer automation, Discord bot integration, Slack bot integration, Web UI listeners, marketplace automation, website automation, STL inspection, MCP servers, multi-agent runtimes, embeddings, vector search, RAG, or automatic memory summarization.

Prefer small, testable, durable changes. Do not overbuild.
