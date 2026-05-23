# Repository Data Policy

Git tracks code, docs, tests, schema, and non-sensitive operating knowledge.

Git does not track runtime SQLite databases.

Git does not track customer files, uploaded STLs, print packages, logs, secrets, or environment files.

Raw business ledger data lives in SQLite and is intentionally excluded from Git by default.

Generated wiki content may be tracked only while it remains non-sensitive operating knowledge. Future customer-sensitive wiki content may require revisiting this policy.

Before pushing to any remote, check for secrets and customer data.
