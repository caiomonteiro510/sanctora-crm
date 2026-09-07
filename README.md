# Sanctora CRM — Offline-First Collaborative Sync

A single-file CRM (`index.html` — HTML/CSS/JS, no build step, no framework) with a Google Apps Script backend, built for a two-person sales team that needed to share one pipeline without paying for a SaaS CRM or standing up a server.

> This repo documents the architecture and ships the parts that are pure engineering (the sync backend and the client-side merge logic). The full front-end — pricing tables, message templates, sales-process copy — is Sanctora's internal sales material and isn't included here; this is a case study of *how it works*, not the product itself.

## The problem

Two co-founders, one pipeline, zero budget for a CRM subscription. Requirements: works with no setup (open a file, start using it), works offline (spotty connectivity is normal on mobile), and lets both people edit leads concurrently without silently losing each other's notes.

## Architecture

```
index.html (client)                Google Apps Script (backend)
──────────────────────             ─────────────────────────────
localStorage  <──── read/write     Google Sheet ("leads" tab)
     │                                       │
     │  local-first: every action            │  1 sheet row per lead
     │  writes to localStorage                │  "json" column = source of truth,
     │  immediately, UI never blocks           │  other columns = human-readable mirror
     │                                       │
     └── debounced sync (2.5s) ──POST──► doPost(e)
         + periodic sync (60s)              │
                                    token check → LockService (mutex)
                                             → merge → write → respond
```

Client and server share the same conflict-resolution rule, implemented twice (once in the browser, once in Apps Script) because both sides can be the one merging incoming changes:

- **Notes and history are append-only and unioned.** Never overwritten, never lost, deduplicated by id. This is the one field class where "merge both sides" beats "pick a winner" — you never want an edit to erase your co-founder's note.
- **Scalar fields (deal value, stage, phone number) use last-write-wins**, compared by an `atualizadoEm` (updated-at) timestamp — simple, predictable, and correct as long as the team agrees who's editing what.
- **Deletes are soft** (`excluido` flag) and propagate through the same merge path, so nothing disappears from the shared sheet without a trace.

A `LockService` mutex on the Apps Script side serializes concurrent requests from both users against the same spreadsheet — Sheets isn't a database, and without it two near-simultaneous writes can race.

## What's in this repo

- [`apps-script/Codigo.gs`](apps-script/Codigo.gs) — the full backend, unedited. Token-gated, mutex-protected, does the server-side half of the merge described above.
- [`docs/sync-engine.js`](docs/sync-engine.js) — the client-side counterpart, extracted and genericized (business-specific fields renamed to generic placeholders): local-first persistence, debounced/periodic sync, and the `mesclarRemoto` merge function that mirrors the backend's logic.
- This README.

The full `index.html` (pipeline UI, SLA tracking, message templates, pricing catalog) stays private — it's the actual product this architecture supports.

## Why this design

- **No server to run or pay for.** Apps Script deploys as a free "Web App" tied to a Google account the team already has.
- **The spreadsheet doubles as a human-readable mirror and a free audit log** (Sheets' own version history) while the `json` column stays the actual source of truth.
- **Local-first means the UI never waits on the network.** Every action commits to `localStorage` synchronously; sync happens in the background and reconciles.

## License

MIT — see [LICENSE](LICENSE).
