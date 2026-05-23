# MICBot Memory Architecture

## OpenClaw Memory

OpenClaw memory is for agent recall: preferences, operating style, and assistant continuity.

## MICBot Raw Ledger

The raw ledger is durable business evidence. It stores exact messages and events, including surface, channel, direction, actor, content, and optional raw JSON.

## MICBot Wiki

The wiki is human-readable operating knowledge generated from distilled memory entries in SQLite.

Memory entries link back to raw source message IDs. This keeps the raw ledger as evidence and the wiki as readable projection.

## Current Rule

Do not treat Markdown as source of truth yet. Edit business memory through SQLite-backed tools, then rebuild the wiki.
