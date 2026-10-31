# EA-CSC Records System

A responsive records-governance portal for the Engineering and Architecture
College Student Council.

## Current implementation

The development prototype currently includes:

- A public mock catalog with search, six-category filtering, record details,
  permitted history, and a keyboard-accessible quick-view modal.
- Officer email/password sign-in and shared session tracking.
- Workspace route entry requiring an active application profile and an
  assigned functional role.
- Current-session sign-out and password recovery/update pages.
- Fictional workspace records, document versions, and a sample turnover package.
- A Supabase schema with RLS, limited own-profile reads, and append-only audit
  protections.

The public catalog and workspace still use fictional mock records. Record-level
reads will be connected after the new assignment migration is verified.
Document storage, editing, approval, publication, and turnover acknowledgment
remain pending. Batch 4 is not yet complete.

Colors and layout are provisional. The progress sections below document earlier
checkpoints; this section describes the current implementation.

## Setup environment

Initial setup used:

- Windows with PowerShell inside Visual Studio Code
- Node.js 24.22.1
- npm 11.19.1
- Git 2.56.0.windows.4
- Vite 8.3.5
- TypeScript 6.0.3
- Tailwind CSS and its Vite plugin 4.3.3

The package lockfile records the resolved dependency versions.

## Commands

Run commands from the project folder.

- `npm.cmd ci` — install the locked dependencies after obtaining a project copy
- `npm.cmd run dev -- --host localhost --port 5173 --strictPort` — start the
  development server at the configured local authentication URL
- `npm.cmd run lint` — run ESLint
- `npm.cmd run typecheck` — run TypeScript checks
- `npm.cmd run format` — format project files
- `npm.cmd run format:check` — check formatting
- `npm.cmd run build` — generate production files in dist
- `npm.cmd run preview` — serve the built files locally

For local authentication, use http://localhost:5173. Press Ctrl+C to stop it.

## Source layout

- src/App.tsx — application router entry
- src/main.tsx — application entry point
- src/app — shared application layout and routing
- src/components/ui — reusable interface components
- src/features — feature-specific screens and logic
- src/lib — shared utilities and service clients
- src/styles/global.css — shared styles and Tailwind import
- src/types — shared TypeScript definitions

## Toolchain compatibility

The generated starter requested TypeScript 7, while its typescript-eslint
dependency required TypeScript below 6.1. The project uses ~6.0.0 to resolve
that conflict. Check compatibility before changing these versions.

## Configuration and records

Local environment files are excluded from Git. Any future .env.example must
contain placeholders only.

Do not store real restricted records, backup exports, or credentials in the
source repository.

Git checkpoints preserve source code. They do not back up operational records.

## Development mock testing

While running the development server, the browser Session Storage setting
`ea-csc:mock-mode` supports:

- `normal`: usual fictional data.
- `slow`: delayed responses for checking loading messages.
- `empty`: empty service results.
- `error`: simulated request failures.

Change the setting under the origin matching the current development URL.
Changes affect subsequent requests. Restore `normal` after testing.

The normal production build ignores this setting.

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
- Safe cleanup remains pending.
