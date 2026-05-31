# MICBot Agent Notes

MICBot is the future AI operator for Made In Canada Industries, a small 3D print farm and light manufacturing business.

## Memory Boundaries

OpenClaw memory and MICBot memory are different systems:

- OpenClaw memory is for agent recall: how to work with Jeff, preferences, and assistant continuity.
- MICBot raw ledger is for durable business evidence: what was said, received, approved, uploaded, changed, or triggered.
- MICBot wiki is for human-readable operating knowledge projected from the business memory stored in SQLite.

Do not replace OpenClaw memory with MICBot memory.

## Current Scope

The current scope is the fastest path to business impact: intake -> artifact -> print package -> Bambu preview -> human approval -> approved print send.

The memory primitive is:

raw message/event -> SQLite ledger -> distilled business memory -> Markdown wiki projection

Raw messages are durable source material. Memory entries are distilled understanding. Markdown wiki files are generated projections from SQLite and are not the source of truth.

SQLite remains the source of truth. The canonical generated MICBot wiki path is `data/wiki/`.

The print workflow primitive is:

intake request -> managed artifact storage -> basic file review -> local print package -> human-visible Bambu preview -> explicit approval handoff -> approved send attempt

Printer send boundary: MICBot may trigger the final Bambu Studio print/send action only after Jeff explicitly approves the exact package, material, quantity, and target printer in the current conversation. Before sending, verify the visible Bambu Studio state or equivalent CLI/API target. Log the approval, target printer, material, package, and send result. Do not build black-box printer control and do not send without explicit approval.

The production 3D workflow primitive is:

physical-object request -> route as search_existing/cad_design/mesh_generation/direct_print_package -> preserve provenance and assumptions -> package -> Bambu preview -> approval -> approved send.

For common functional objects, search existing model sources first. For fit-critical mechanical parts, prefer STEP-first CAD. For organic/decorative/custom media references, use mesh generation. For supplied STL/3MF/STEP/STP files, go directly to reviewed print package creation.

## OpenClaw Capture Rules

1. Jeff should not manually run the CLI during normal operation.
2. OpenClaw should call the MICBot CLI internally.
3. OpenClaw is the conversational operator.
4. MICBot is the local business memory/tool substrate.
5. MICBot should be surface-neutral.
6. Discord, Slack, and Web UI are OpenClaw interface surfaces, not separate MICBot systems yet.
7. Keep channel-specific work as local CLI primitives until the core tool layer is stable.
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
22. Human approval handoffs now exist for print package review and approved print sends; keep them explicit and auditable.
23. Discord attachment intake is a local CLI primitive only; OpenClaw remains responsible for receiving the message and resolving the attachment file.

## Surface Model

Use `surface` for the OpenClaw interface surface, such as `openclaw_discord`, `openclaw_slack`, `openclaw_web`, `manual`, or `system`.

Use `channel` for the specific channel, session, or context, such as `general`, `micbot`, `webui`, `manual`, or `system`.

## Do Not Build Yet

Do not build browser automation, unapproved printer automation, a separate Discord bot, Slack bot integration, Web UI listeners, marketplace automation, website automation, slicer-level STL inspection, mesh repair, MCP servers, multi-agent runtimes, embeddings, vector search, RAG, or automatic memory summarization.

Prefer small, testable, durable changes. Do not overbuild.
