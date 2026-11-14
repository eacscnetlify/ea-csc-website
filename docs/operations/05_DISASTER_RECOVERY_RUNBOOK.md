# EA-CSC Disaster Recovery & Backup Runbook

**Operational Project Ref:** `gkhhwrrvqlzpayphvsqp`  
**Backup Location Standard:** Local encrypted/offline archive directory (e.g., `D:\EA_CSC_Backups\EA_CSC_<TIMESTAMP>_<ID>`)

## 1. Preflight Check

Before running a backup or restore test, verify PostgreSQL 17 client tools (`pg_dump`, `pg_restore`, `psql`) and Storage access:

```powershell
node --env-file=.env.backup.local scripts/backup-preflight.mjs
```

## 2. Capturing a Verified Offline Backup

```powershell
node --env-file=.env.backup.local scripts/backup.mjs
```

Confirm the run reports `0` unexpected source issues and `0` archive warnings (the retained missing-object negative test fixture `EACSC-2099-HTTP-9604` v1 is the sole expected exception).

## 3. Restore Dry-Run Verification

Validate manifest SHA-256 hashes and `pg_restore --list` TOC integrity without modifying any database:

```powershell
node --env-file=.env.backup.local scripts/restore-backup.mjs --dry-run <BACKUP_DIR>
```

Latest verified snapshot: `D:\EA_CSC_Backups\EA_CSC_2026-11-14T13-19-12-284Z_l4p7CE`.

## 4. Isolated Target Restore Procedure (Non-Production Only)

`scripts/restore-backup.mjs` explicitly **refuses** any target DSN containing the operational project ref `gkhhwrrvqlzpayphvsqp`.

1. Provision a blank isolated target Supabase project or PostgreSQL 17 instance + S3/Storage buckets (`internal-council-records`, `verified-council-releases`).
2. Set the isolated target credentials in `.env.restore.local` (never `.env.local` or `.env.backup.local`).
3. Run:
   ```powershell
   node --env-file=.env.restore.local scripts/restore-backup.mjs --target-dsn="<ISOLATED_DSN>" <BACKUP_DIR>
   ```
4. Verify restored row counts against `manifest.json` and run `supabase/tests/verify_slice9a_backend.sql` against the isolated target.
