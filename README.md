# EA-CSC Records System

A responsive records-governance portal for the Engineering and Architecture
College Student Council.

## Current implementation

The Batch 2 development prototype includes:

- A public catalog with debounced search and six-category filtering.
- Record details with current release information and permitted public history.
- A quick-view modal with keyboard controls and focus restoration.
- An officer workspace preview showing six fictional records, eight versions,
  three current public releases, and one sample turnover package.
- Separate displays for the latest working version and current public release.
- Loading, empty, unavailable-record, and error states with retry controls.
- Shared navigation, an officer sign-in placeholder, and a Page Not Found screen.

All information is fictional. The workspace preview is publicly accessible.
Authentication, position-based permissions, document storage, editing,
approval, release actions, and turnover acknowledgment are not connected.

Colors and layout are provisional.

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
- `npm.cmd run dev` — start the development server
- `npm.cmd run lint` — run ESLint
- `npm.cmd run typecheck` — run TypeScript checks
- `npm.cmd run format` — format project files
- `npm.cmd run format:check` — check formatting
- `npm.cmd run build` — generate production files in dist
- `npm.cmd run preview` — serve the built files locally

Use the URL printed by the server. Press Ctrl+C to stop it.

## Source layout

- src/App.tsx — current development screen
- src/main.tsx — application entry point
- src/app — future application layout and routing
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
backend permission revocation, password recovery, and direct API
security tests remain pending. Batch 4 is not yet complete.

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
