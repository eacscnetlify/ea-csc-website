# EA-CSC Records Governance System

The Engineering and Architecture College Student Council's Institutional
Information and Document Governance System (IIDGS), aligned with Needs Analysis 1,
Project Proposal Revised V2, and Batch Plan V4.

## Current status — 14 November 2026

Batch 9 turnover and offline backup implementation has passed development
verification. Git Checkpoint 9 remains pending final source review and commit.

Batch 10 deployment, consolidated acceptance, isolated recovery testing,
pilot measurement, and formal handover remain pending.

Earlier batch notes are retained below as historical evidence. Their statements
about mock data or unfinished features describe their original checkpoints.

## Implemented capabilities

- Officer authentication, active-profile checks, functional roles, and per-record
  assignments, including explicit restricted-record permission.
- Controlled private-file ingestion and authorized downloads.
- Draft, review, approval, replacement, publication, and withdrawal workflows.
- Six-point verification checks, retained review comments, and scoped audit history.
- Optimistic concurrency checks using revision counters and PT409 / HTTP 409.
- Public release catalog and update bulletin preparation, issue, and retrieval.
- Position inventories, continuity memoranda, frozen outgoing confirmation,
  administrative access transfer, and incoming acknowledgment.
- Saved turnover-package JSON export and browser Print / Save PDF.
- Offline database archives, actual Storage files, structured metadata JSON,
  SHA-256 manifests, and independent backup verification.

Implementation is not equivalent to final production acceptance. Batch 10 must
exercise the complete workflows with recorded evidence.

## Architecture and development baseline

- Frontend: React 19, TypeScript 6, Vite 8.3.5, Tailwind CSS 4, React Router.
- Backend: Supabase PostgreSQL, Auth, private Storage, and trusted Edge Functions.
- Development project: `ea-csc-website-dev`.
- Development project reference: `gkhhwrrvqlzpayphvsqp`.
- Local frontend: `http://localhost:5173`.
- Development tools: Node.js 24 and Windows PowerShell.
- Verified PostgreSQL clients: 17.12; hosted PostgreSQL: 17.11.
- Displayed operational timestamps: `Asia/Manila` (UTC+8).
- Resolved dependency versions are recorded in the package lockfile.

## Local setup and commands

Install locked dependencies using `npm.cmd ci`. Create the ignored `.env.local`
from `.env.example`, supplying the environment's public Supabase URL and
publishable key. The backend must be provisioned for operational pages to work.

```powershell
npm.cmd run dev -- --host localhost --port 5173 --strictPort
```

Development checks:

```powershell
npm.cmd run format:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

`npm.cmd run preview` serves the built files locally.

For static hosting, the build command is `npm run build` and the publish
directory is `dist`.

## Configuration boundaries

Frontend configuration uses only:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Privileged backup configuration belongs in the ignored `.env.backup.local`:

- `SUPABASE_URL`
- `SUPABASE_BACKUP_KEY`
- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`
- `PG_BIN_DIR`, `PGSSLROOTCERT`, `BACKUP_ROOT`

The downloaded root certificate supports verified TLS database connections.

Keep credentials, local environment files, protected records, and backup exports
outside Git. Privileged keys must never be exposed through frontend variables.

Migrations are versioned in `supabase/migrations/`. Changing migration or Edge
Function source files does not automatically deploy those changes to Supabase.

## Batch 9 verified results

- Saved and reopened the continuity memorandum.
- Confirmed an inventory containing fictional records 9701 and 9702.
- Froze the outgoing inventory and transferred existing position assignments.
- Verified outgoing profile deactivation and zero active outgoing assignments.
- Retrieved both version 2 attachments as the incoming officer.
- Recorded one acknowledgment; final package status `acknowledged`, revision 4.
- Confirmed four audited operations and four matching retry receipts.
- Exported the saved turnover package as JSON and PDF.
- Passed TypeScript, lint, and build checks during turnover implementation.
- Passed repository formatting and lint after backup implementation.
- Finalized a backup containing 72 metadata tables and 18 Storage files.
- Verified manifests, metadata row counts, file sizes, and SHA-256 checksums.
- Recorded one expected fixture exception, zero unexpected source issues,
  and zero archive warnings.

The 72-table count includes captured Auth, Storage, and private-schema tables.
It is not a count of application record types.

## Backup operation

Run complete backups at least weekly and before major changes or handover.
The verified Windows backup root was `D:/EA_CSC_Backups`.

Create a new complete capture:

```powershell
node --env-file=.env.backup.local scripts/backup.mjs
```

Verify an existing capture, replacing the folder placeholder:

```powershell
node --env-file=.env.backup.local scripts/verify-backup.mjs "D:\EA_CSC_Backups\<backup-folder>"
```

`backup.mjs --finalize <backup-folder>` completes an existing capture. It does
not create a fresh snapshot of changes made after that capture.

Backup contents include database archives, Storage catalog and original file
bytes, structured metadata JSON, review evidence, and consolidated manifests.

Metadata JSON represents SQL NULL as JSON null and other values as strings.
The native archives remain the recovery source for PostgreSQL types, schema,
functions, policies, and sequence state.

The manifest provides SHA-256 integrity checks. It is not digitally signed.

### Documented development fixture exception

`EACSC-2099-HTTP-9604` version 1 intentionally references
`batch4-http-fixtures/no-object-review.pdf` without an uploaded file.

Its seed is `supabase/tests/setup_batch4_http_fixtures.sql`. The verifier
recognizes only the exact documented fixture metadata and retains the exception.
Other missing references still require review.

The verified snapshot contains 16 record versions, zero release rows, and zero
bulletin rows. It does not establish recovery of issued release or bulletin
artifacts. The Batch 10 drill must include representative issued artifacts.

### Recovery preparation

A verified capture is not a successful restoration.

The Batch 10 recovery procedure must:

1. Verify the selected backup and record the recovery start time.
2. Provision an empty, isolated target with the required Supabase baseline,
   roles, extensions, Auth, and private Storage services.
3. Review archive dependencies and restore lists. Managed-schema archives are
   recovery references, not instructions to overwrite provider-owned schemas.
4. Restore application data and controls, including reviewed Auth identity/profile
   bindings and application permissions.
5. Restore bucket configuration and actual file bytes to their original paths
   through Storage APIs. Storage metadata alone restores no files.
6. Deploy matching trusted functions and configure isolated Auth URLs and origins.
7. Compare restored records, relationships, histories, files, and permissions
   against the manifest; test authorized retrieval and prohibited access.
8. Include an issued bulletin and its source relationships, record recovery time,
   and retain defects and retest results.

Keep the operational project untouched throughout the drill.

Pilot objectives are recovery within one working day and no more than seven
days of lost updates when the weekly backup schedule is followed. These are
project objectives, not provider guarantees.

## Batch 10 deployment and handover

Batch Plan V4 currently specifies Cloudflare Pages for frontend hosting.
Netlify is a compatible alternative under consideration. A host change must be
recorded as a plan amendment. Supabase remains the backend in either arrangement.

Before live use:

- Designate the production backend and separate preview/development configuration.
- Inspect the applied migration and deployed function state.
- Configure SPA routing, build-time public variables, Auth/recovery URLs,
  permitted function origins, HTTPS, and rollback.
- Verify complete publication and bulletin workflows using controlled test records.

Source-review findings to verify against the current working tree and backend:

- Five file/publication Edge Functions currently hardcode
  `http://localhost:5173` as their permitted origin.
- The bulletin master-record INSERT in
  `20261114000200_bulletin_issuance.sql` lists nine target columns but eight
  values. If still present, resolve it through a new corrective migration.

Completion requires:

- Documented D01–D18 and supplementary P01–P04 results.
- A successful isolated recovery drill.
- The planned pilot group of 12 participants.
- Approximately 30 agreed records and at least 30 realistic retrieval tasks.
- Independent retrieval success of at least 90%, with failures and assistance
  reported separately and median successful-task time assessed against 30 seconds.
- The adopted SOP, populated index, verification tools, User Guide, Technical
  Guide, ownership/recovery/support register, evaluation report, turnover
  demonstrations, and signed handover receipt.

Git Checkpoint 10 follows completion of the required evidence and handover.

## Historical development log

The following sections preserve earlier implementation and verification results.
Their unfinished-work statements apply to their original checkpoints.

## Batch 2 verification

Manual testing covered:

- Search, category filtering, and empty search results.
- Record details, permitted history, and unavailable record addresses.
- The request form remaining at public version 1 while working version 2
  is approved but unreleased.
- Modal mouse and keyboard controls, Escape, and focus restoration.
- Workspace totals and turnover package expansion.
- Loading, empty, error, and successful retry behavior.
- Navigation, refresh, and layouts at 375 and 1440 CSS pixels wide.

Formatting, TypeScript checking, ESLint, and the production build passed.

## Batch 3 backend progress

A Supabase development project has been provisioned in Singapore.

The local frontend uses VITE_SUPABASE_URL and
VITE_SUPABASE_PUBLISHABLE_KEY from the ignored .env.local file.
The tracked .env.example contains placeholders.

The shared client is defined in src/lib/supabase.ts.
The development-only /dev/connection route checks the database through
the eacsc_connection_check function.

The connection-check migration is saved in:
supabase/migrations/20261029000100_connection_check.sql

Database migrations are currently applied manually through the Supabase
SQL Editor. Automatic GitHub database deployment is disabled.

The public catalog and workspace still use fictional records.
Officer authentication and operational permissions remain future work.

The app_users table has been created using:
supabase/migrations/20261029000200_app_users.sql

It stores named officer profiles linked to Supabase Auth identities.
Profiles default to inactive, with no assigned functional roles.

Verification confirmed that Row Level Security is enabled, no access
policies exist yet, and anon/authenticated have no direct SELECT,
INSERT, UPDATE, or DELETE privileges on this table.

The primary key, Auth foreign key, and validation constraints were
confirmed through database metadata queries. Officer login and
controlled profile operations will be implemented in later steps.

The master_records and record_versions tables have been created using:

- supabase/migrations/20261029000300_master_records.sql
- supabase/migrations/20261029000400_record_versions.sql

master_records stores permanent document identities, classification,
custody, and retention metadata. Its primary key and two text-search
indexes were confirmed.

record_versions stores individual document versions, predecessor links,
file metadata, lifecycle states, and approval evidence references.

Database metadata checks confirmed RLS is enabled on both tables,
with zero access policies and no direct SELECT, INSERT, UPDATE,
or DELETE privileges for anon or authenticated.

The expected eight master_records constraints and nineteen
record_versions constraints were confirmed. Data rejection tests
and migration replay remain part of the Batch 3 integrity checks.

The audit_events and update_bulletins tables have been created using:

- supabase/migrations/20261029000500_audit_events.sql
- supabase/migrations/20261030000100_update_bulletins.sql

audit_events stores operational history with named actor references,
record/version links, selected before-and-after snapshots, and timestamps.
Its server-time and change-blocking triggers were confirmed present
and enabled. All ten expected constraints were confirmed.

update_bulletins stores bulletin identities and issue versions,
coverage and cutoff details, audience, source snapshots, PDF and
archive references, preparer/publisher references, and correction
or withdrawal metadata. Its 27 expected constraints were confirmed.

Both tables have RLS enabled, zero access policies, and no direct
SELECT, INSERT, UPDATE, DELETE, or TRUNCATE privileges for anon,
authenticated, or service_role.

All five core tables now exist. Data-integrity tests and migration
replay remain pending. Automatic audit integration, bulletin generation,
source validation, and protection against editing issued bulletins
will be implemented before their operational use.

## Batch 3 database verification — 2026-10-30

The core database schema was verified in two Supabase projects:

- Development: ea-csc-website-dev
- Isolated migration replay: ea-csc-schema-replay

The replay project was checked before migration execution. None of
the five application tables or the connection-check function existed.

All six saved migration files were then executed successfully in
chronological order through the Supabase SQL Editor.

The following manual SQL integrity tests passed in both projects:

- supabase/tests/001_records_versions_integrity.sql: 9 checks.
- supabase/tests/002_profiles_audit_integrity.sql: 14 checks.
- supabase/tests/003_bulletins_integrity.sql: 20 checks.

Total: 43 distinct checks passed in each project.

Verification covered selected valid relationships, rejection of
invalid data, profile defaults, authoritative audit timestamps,
audit UPDATE/DELETE/TRUNCATE protection, and bulletin metadata rules.

Both projects have Row Level Security enabled on all five application
tables. No application access policies have been added yet.

The anon and authenticated roles have none of the table privileges
checked by the final verification query.

All fictional application fixture rows were rolled back. Final checks
confirmed that all five application tables were empty in both projects.

The temporary Auth identity batch3-integrity@example.invalid was
deleted from both projects, and its absence was verified.

The connection-check function returned status "ok" in the replay project.
The website configuration remains pointed at the development project.

These tests were run manually through the administrative SQL Editor.
They do not verify application authorization, actual stored files,
publication workflows, or issued-bulletin immutability.

To rerun tests 002 and 003, first recreate the confirmed fictional Auth
identity required by those scripts, then remove it after testing.

## Batch 4 progress

Officer sign-in and profile-based workspace entry are implemented.

Completed work:

- Configured email authentication with public signup and anonymous
  sign-ins disabled.
- Configured the local Site URL and password-recovery redirect URL.
- Added shared session tracking through AuthProvider and useAuth.
- Added the officer email/password sign-in form and handled errors.
- Added a profile SELECT policy restricted to the signed-in permanent
  user's own row and seven explicitly permitted columns.
- Kept profile inserts and updates unavailable to application users.
- Added profile response validation, request cancellation, timeout,
  retry, window-focus refresh, and current-session sign-out.
- Protected the officer route with session and active-profile checks.

Four confirmed fictional Auth identities were created. Three have
application profiles: active author, active custodian, and inactive
author. The fourth intentionally has no application profile.

Manual checks passed for signed-out redirection, incorrect credentials,
active account entry, session persistence after refresh, sign-out,
inactive-account denial, missing-profile denial, public-library access,
keyboard navigation, and narrow layouts.

Formatting, TypeScript, ESLint, and the production build passed.
The build still reports a JavaScript chunk-size warning.

The workspace continues to display fictional mock records.
Operational record scopes, controlled database mutations, immediate
backend permission revocation, and direct API security tests remain pending.
Password recovery is documented in the next section. Batch 4 is not yet complete.

The fictional Auth accounts and profiles remain temporarily for
continued Batch 4 testing.

### Batch 4 — Password recovery

- Added password recovery request and password update routes.
- Added the Forgot your password link to officer sign-in.
- Verified recovery email delivery using an organization member's
  project Auth test account.
- Verified the recovery link opens the password update form.
- Verified mismatched passwords are rejected.
- Verified successful password update and current-session sign-out.
- Verified the test account remains blocked from the workspace
  because it has no application profile.
- Formatting, TypeScript, ESLint, and production build checks passed.
- The production build still reports a bundle-size warning.
- Record-level permissions and direct API authorization tests remain
  pending before Batch 4 is complete.

### Batch 4 — Assigned record reads

- Applied 20261030000300_record_read_access.sql in the development project.
- Added explicit per-record functional assignments.
- Protected reads require an active profile, an active matching assignment,
  and additional permission for restricted records.
- Author-only version reads are currently limited to Draft versions.
- Application roles cannot directly modify records or assignments.
- The revised single-block authorization test completed successfully
  in the Supabase SQL Editor with 61 checks.
- Cleanup checks confirmed fixture removal and profile restoration.
- Metadata checks confirmed RLS, selected-column grants, denied anonymous
  reads, denied authenticated writes, and zero stored fixture rows.
- The website still displays fictional mock records.
- Controlled mutations, direct HTTP tests, and database integration remain
  pending. Batch 4 is not yet complete.

### Batch 4 — Controlled Draft notes command

- Applied migration `20261030000400_draft_notes_command.sql` to the development project.
- Passed all 70 checks in `005_draft_notes_command.sql`.
- Passed all 15 checks in `verify_batch4_draft_command.sql`.
- Verified assignment-based authorization, revision conflicts, retry receipts,
  and atomic version/audit/receipt changes through SQL tests.
- Verified cleanup of temporary fixtures and fault-injection constraints.
- Direct application-table writes remain denied.
- Actual HTTP authorization, retry, and concurrency tests remain pending.
- The workspace still uses mock record data. Batch 4 remains in progress.

### Batch 4 — HTTP authorization and controlled-edit verification

- Applied `20261030000500_draft_conflict_http409.sql`.
- Application revision conflicts now return PT409 / HTTP 409.
- Passed all 100 hosted HTTP checks.
- Passed the updated 61 read checks and 70 Draft command checks.
- Passed all six conflict-repair checks and 12 retained-history checks.
- Verified identical-request receipts, competing edits, and current-profile
  deactivation using the original access token.
- Restored the fictional Author to active status.
- Retained fictional HTTP fixtures and their audit/receipt history.
- Workspace record data remains mocked; frontend integration is pending.
- Batch 4 remains in progress.

### Batch 4 — Connected officer workspace

- Connected the workspace to assigned database records and accessible versions.
- Connected authorized Draft-notes editing to the controlled backend command.
- Verified Author and Custodian visibility and successful notes saves.
- Verified two-tab revision conflicts without overwriting the winning edit.
- Confirmed the expected manual workspace checks.
- Passed formatting, typecheck, lint and production build.
- Passed all 12 retained-history checks after UI edits.
- Public library pages still use prototype data.
- File access, approvals, publication and turnover remain pending.
- Batch 4 remains in progress.

### Batch 4 — public catalog access checks

- Added a public metadata RPC with seven explicitly selected safe fields.
- Public results require an explicitly selected, applicable public release.
- Approved but unreleased versions do not replace the selected released version.
- Restricted, internal, expired, future and withdrawn releases remain hidden.
- Release facts and authorization evidence have no direct application access.
- Development verification passed: six metadata checks, unauthenticated HTTP 200 with an empty catalog, and 44 SQL isolation checks.
- Temporary catalog fixtures rolled back; existing records and audit/receipt history remained unchanged.
- Publication commands and public-library integration remain for Batch 6.

### Batch 4 — completion checkpoint

- Authentication, assigned-record access, controlled Draft-note editing and the safe public metadata boundary are implemented and verified.
- Development verification passed: 100 HTTP checks, workspace save/conflict checks and audit/receipt history verification.
- The five Batch 4 migrations were applied in order to ea-csc-schema-replay after its verified Batch 3 baseline.
- Replay verification passed: 61 read-access checks, 70 Draft-command checks, 44 public-catalog checks and both six-check metadata queries.
- Final replay contents: three application profiles; no records, versions, assignments, releases, audit events, mutation receipts or bulletins.
- Development HTTP fixtures and their audit/receipt history are retained.
- The frontend remains configured for ea-csc-website-dev.
- Private file handling follows in Batch 5. Publication commands and public-library integration remain for Batch 6.

### Batch 5 progress — private upload staging

- Created two private Storage buckets with a 10,000,000-byte file limit
  and the four approved MIME types.
- Added controlled upload preparation with current authorization,
  record revision checks, immutable preparation facts, audit events,
  and retry receipts.
- Deployed `ea-csc-stage-upload` to the development project.
- Configured function-scoped Deno dependency resolution; local Deno
  type checking and linting passed.
- Verified signed-out rejection and nine authenticated HTTP checks:
  preparation, identical retries, size/checksum rejection, valid
  private staging, and public URL denial.
- Confirmed nine database checks: one request, matching audit and
  receipt, one staged object, unchanged master revision, and no
  official version or final-destination object.
- Document-format verification, controlled acceptance, orphan cleanup,
  authorized downloads, and upload UI integration remain pending.

### Batch 5 — verified upload acceptance checkpoint

- Added PDF, JPEG/PNG, and DOCX verification helpers; all 85 local
  verification tests passed.
- Deployed the staging and acceptance handler with its helper modules.
- Hosted PDF acceptance verification passed all 17 HTTP checks.
- Database verification passed all 17 checks, confirming matching version,
  file metadata, predecessor, master revision, audit, receipt, and acceptance
  decision.
- Plain text labeled as PDF was rejected without creating an official version.
- Acceptance retries returned the same version and audit.
- Storage remains private; acceptance creates a Draft without approval
  or publication.
- Preserved fictional fixtures and upload history for subsequent verification.
- Authorized officer file retrieval passed all 16 hosted HTTP checks,
  including byte integrity, access denials, attachment headers and unchanged
  master revision.
- Safe cleanup passed all 13 database checks. Three reviewed staging objects
  were removed while preserving the accepted final file and immutable history.
- All 16 authorized-download HTTP checks passed again after cleanup.

### Batch 5 — file ingestion and retrieval complete

Verified in development on 1 November 2026:

- PDF, DOCX, JPEG and PNG browser uploads and downloads passed.
- Versions 2–6 retain accepted attachments, matching preparation facts,
  acceptance decisions, audit events and immutable receipts.
- All 13 final database verification checks passed.
- Both managed buckets remain private, with no direct Storage policies.
- Previously cleaned staging objects remain absent, and abandoned uploads
  remain blocked from acceptance.
- Accepted versions remain Drafts without approval or public release.
- Workspace access rechecks preserve layout and entered form values.
- Formatting, TypeScript, lint, production build and whitespace checks passed.

Verification SQL files describe specific checkpoints. Later workflow changes
may legitimately change the fixture state those historical checks expect.

### Batch 6 progress — review transitions and retained comments

Applied `supabase/migrations/20261101000100_review_transitions.sql` in `ea-csc-website-dev`:

- Added `eacsc_submit_version_for_review` (`Draft` → `For Review` by assigned Author) and `eacsc_return_version_for_correction` (`For Review` → `Draft` with required nonblank comments up to 2,000 characters by assigned Reviewer).
- Added immutable `public.review_comments` bound to the reviewed and returned revisions, audit events, and retry receipts.
- Added fictional Reviewer account `batch6-reviewer@example.invalid` assigned to `EACSC-2099-HTTP-9601` (`allow_restricted = false`).
- Passed all 5 setup checks (`verify_batch6_review_setup.sql`), all 23 hosted HTTP checks (`batch6-review-http.mjs`), and browser submit/return verification.
- Review queue/inspection, six-point verification checklist, substantive approval, and controlled publication remain in progress.

### Batch 6 & Batch 7 completion — lifecycle controls, OCC modal, and audit viewer

- Added the assignment-filtered For Review queue and inspection panel (`/officer/reviews`).
- Added the six-point Appendix B verification checklist, provisional-notice rules, substantive approval, and custodian acceptance (`20261113000100_verification_and_approval.sql`).
- Added the PIO publication/withdrawal panel (`/officer/releases`), `ea-csc-publish-release` and `ea-csc-public-download` Edge Functions (`20261113000200_publication_and_withdrawal.sql`), and connected the public library (`/`).
- Added the HTTP 409 conflict reconciliation modal (`ConflictModal.tsx`), `Asia/Manila` date formatting (`dates.ts`), and the scoped immutable audit timeline (`HistoryPanel.tsx` + `20261113000300_audit_history_read.sql`).

### Batch 8 completion — update bulletin compiler and PDF generation

- Added audience-isolated release candidate querying (`20261114000100_bulletin_candidates.sql`).
- Added atomic bulletin issuance and archive registration (`20261114000200_bulletin_issuance.sql`).
- Added trusted streaming download Edge Function `ea-csc-bulletin-file`.
- Integrated `jspdf` template compiler with live in-browser preview, frozen JSON source snapshot, and publication checks (`/officer/bulletins`).
- Added public portal Update Bulletins tab (`/bulletins`) with direct immutable PDF retrieval.
