# EA-CSC Deployment & Recovery Report

**Prepared:** 2026-11-14T21:29+08:00  
**Operational Supabase Project Ref:** `gkhhwrrvqlzpayphvsqp`

## 1. Multi-Origin CORS Configuration (Edge Functions)

All 5 Supabase Edge Functions (`ea-csc-stage-upload`, `ea-csc-download-file`, `ea-csc-public-download`, `ea-csc-publish-release`, `ea-csc-bulletin-file`) now resolve origins via `ALLOWED_ORIGINS` (comma-separated) in addition to `http://localhost:5173`, explicitly rejecting wildcard `*` and unknown origins with HTTP `403 ORIGIN_DENIED`.

### Required Edge Function Secret

Set `ALLOWED_ORIGINS` on the Supabase project before deploying:

```bash
supabase secrets set ALLOWED_ORIGINS="https://<your-production-domain>" --project-ref gkhhwrrvqlzpayphvsqp
```

Then deploy all 5 Edge Functions:

```bash
supabase functions deploy ea-csc-stage-upload ea-csc-download-file ea-csc-public-download ea-csc-publish-release ea-csc-bulletin-file --project-ref gkhhwrrvqlzpayphvsqp
```

## 2. Frontend SPA Hosting & Routing

- `public/_redirects` (`/* /index.html 200`) is included in the Vite build output (`dist/_redirects`) for static hosts supporting `_redirects` (e.g., Netlify, Cloudflare Pages).
- Required frontend build environment variables:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY` (or `VITE_SUPABASE_ANON_KEY`)

## 3. Verified Backup & Recovery Readiness

- **Latest Verified Offline Backup:** `D:\EA_CSC_Backups\EA_CSC_2026-11-14T13-19-12-284Z_l4p7CE`
- **Restore Dry-Run:** `scripts/restore-backup.mjs --dry-run` verified all 4 dumps (`application.dump`, `managed-schema.dump`, `auth-data.dump`, `storage-data.dump`) and Storage manifest (`80` objects) with operational ref guard (`gkhhwrrvqlzpayphvsqp` refused).
- **External Remaining Step:** Provision an isolated non-production target Supabase project / PostgreSQL 17 DSN and run `scripts/restore-backup.mjs --target-dsn="<ISOLATED_DSN>" <BACKUP_DIR>` per `docs/operations/05_DISASTER_RECOVERY_RUNBOOK.md`.
