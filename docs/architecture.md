# MICBot Architecture

MICBot starts as a local, deterministic TypeScript CLI backed by SQLite.

The initial architecture is intentionally small:

1. OpenClaw receives a normal message from Jeff.
2. OpenClaw decides whether the message is business-relevant.
3. OpenClaw calls the MICBot CLI.
4. MICBot writes raw evidence to SQLite.
5. MICBot stores distilled memory entries in SQLite.
6. MICBot projects selected memory into Markdown wiki files.

SQLite is the source of truth. Markdown is generated output.
