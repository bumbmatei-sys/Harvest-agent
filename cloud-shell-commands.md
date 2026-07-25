# Cloud Shell Commands

Phone reference for running Harvest's operational scripts from Firebase Cloud Shell.

Cloud Shell already has Node and Application Default Credentials for
`harvest-agent-233a1`, so **no service-account key is needed and none should ever
be created** — Firestore holds donor names, emails, giving amounts and prayer
requests.

```bash
git clone https://github.com/bumbmatei-sys/Harvest-agent && cd Harvest-agent
npm install --omit=dev   # firebase-admin is all the scripts need
```

## Query Firestore (read-only) — `scripts/q.mjs`

One reusable, **read-only** query tool. It has no `--commit`, no write path, and
nothing it can be asked to do will change data — safe to run blind, mid-incident,
without re-reading it first.

```bash
node scripts/q.mjs contacts --where email=miriambumb@yahoo.com
node scripts/q.mjs contactActivities --where contactId=BKzF9ezNrItiLn9wjEEc
node scripts/q.mjs affiliate_commissions --where status=pending --where type=initial
node scripts/q.mjs tenants/bumb
```

- `<collection>` → query it. `<collection>/<docId>` → print that one document
  (any depth: `tenants/bumb/usage/2026-07`).
- `--where field=value` — repeatable. **Only the first reaches Firestore**; the
  rest are applied in memory and the output says so. This repo avoids composite
  indexes on purpose, and a multi-field `where()` would demand a new one.
- `--limit N` — default 20, so a stray query never floods the terminal.
- `--group` — query a subcollection anywhere in the tree, e.g.
  `node scripts/q.mjs invoices --group --where tenantId=bumb`.
- Values are coerced: `1785` is a number, `true`/`false`/`null` likewise.
  Force a type with `--where zip:string=90210`.
- Timestamps print as ISO; giant fields (a `rag_chunks` embedding `vector` is
  3072 floats) print as `[3072 items] …truncated`.
- A missing index prints the Firebase console URL that creates it — that URL is
  the fix.

## Clean up orphaned AI-Knowledge chunks — `scripts/cleanup-orphaned-rag-chunks.mjs`

Chunks whose `rag_sources` doc is gone but that still feed blog generation.
**Dry run first, always**, and scope to one tenant the first time.

```bash
node scripts/cleanup-orphaned-rag-chunks.mjs --tenant=bumb
node scripts/cleanup-orphaned-rag-chunks.mjs --tenant=bumb --commit
```

## Purge test-mode Stripe IDs — `scripts/purge-test-stripe-ids.mjs`

Pre-go-live only — it classifies Stripe ids by shape, not by test-vs-live, so it
must never run after the first live write. Dry run is safe anytime.

```bash
node scripts/purge-test-stripe-ids.mjs --collection=affiliate_commissions
node scripts/purge-test-stripe-ids.mjs --collection=tenants,users --commit --i-am-pre-go-live
```
