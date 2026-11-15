# EA-CSC IIDGS Portal — Master Development & Operations Log

**Project:** Catanduanes State University (CatSU) — College of Engineering and Architecture Student Council (EA-CSC)  
**System:** Institutional Information and Document Governance System (IIDGS)  
**Production URL:** `https://eacsc.netlify.app`  
**Supabase Project:** `ea-csc-website-dev` (`gkhhwrrvqlzpayphvsqp`)  
**Log Finalized:** November 15, 2026 (Asia/Manila)

---

## 1. System Architecture & Tech Stack

- **Frontend:** React 19 (`^19.3.1`), TypeScript (`~6.0.0`), Vite 8 (`^8.3.5`), React Router 8 (`^8.5.1`), Tailwind CSS v4 (`@tailwindcss/vite ^4.3.3`), `jspdf` (`^4.2.1`) for client-side bulletin PDF compilation.
- **Backend & Database:** Supabase PostgreSQL (`@supabase/supabase-js 2.118.0`), Row-Level Security (RLS), `security definer` RPCs in `eacsc_private` / `public`, optimistic concurrency control (`revision_counter`), idempotent `mutation_receipts`, and immutable `audit_events`.
- **Storage Buckets:** Private storage buckets (`ea-csc-records` / `verified-council-releases`) accessed only through authorized Edge Functions with SHA-256 verification.
- **Serverless Edge Functions (`supabase/functions/`):**
  - `ea-csc-stage-upload` — Staged private file upload + SHA-256 verification.
  - `ea-csc-download-file` — Authorized private file retrieval for officers.
  - `ea-csc-publish-release` — Verified public/internal release publication with checksum validation.
  - `ea-csc-public-download` — Public document download endpoint for active releases.
  - `ea-csc-bulletin-file` — Authorized bulletin PDF download endpoint.
  - `ea-csc-ai-assistant` — Hybrid Gemini AI + portal-aware assistant endpoint.
- **Hosting & CDN:** Netlify (`https://eacsc.netlify.app`).

---

## 2. External Connections & User-Performed Setup

### 2.1 Supabase Connection & Secrets
- **Linked Project:** `ea-csc-website-dev` (`gkhhwrrvqlzpayphvsqp`) at `https://gkhhwrrvqlzpayphvsqp.supabase.co`.
- **Local Environment Files:** Configured `.env.local` (frontend `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) and `.env.backup.local` (database `DATABASE_URL` / `PG*` + service role key for backup, restore, and verification scripts).
- **Edge Function Secrets (User-executed via Supabase CLI):**
  - Set `ALLOWED_ORIGINS` to permit `http://localhost:5173` and `https://eacsc.netlify.app`.
  - Set `GEMINI_API_KEY` via `npx supabase secrets set GEMINI_API_KEY=...` and deployed `ea-csc-ai-assistant` with `--no-verify-jwt`.
- **User Capacity Note:** Supabase Auth and PostgreSQL accommodate thousands of student/observer accounts cleanly without artificial user-count blocks in the application layer.

### 2.2 Netlify Deployment Connection
- Connected and deployed production builds from `dist/` (`npm run build`) to `https://eacsc.netlify.app` using `npx netlify deploy --prod --dir=dist`.
- Configured client-side SPA routing and verified live production origins against Supabase `ALLOWED_ORIGINS`.

### 2.3 Gemini AI Integration
- Connected Google Gemini API (`GEMINI_API_KEY` stored securely in Supabase Edge Function secrets, never exposed to the browser).
- Implemented automatic Gemini Flash model resolution (`gemini-2.5-flash` priority + fallback model discovery on `503`/unavailability) with a 30-second client timeout and automatic fallback to the local portal NLP/dictionary/summarizer engine so the assistant never fails silently.

---

## 3. Chronological Build Log (Batches 1–11)

### Foundations & Batches 1–3: Core Schema, Auth, & Read Access
- **Migrations:**
  - `20261029000100_connection_check.sql` — Connection & health check baseline.
  - `20261029000200_app_users.sql` — Officer/user profiles, 6 functional roles (`author`, `custodian`, `reviewer`, `approver`, `publisher`, `technical_admin`), `is_active`, `revision_counter`.
  - `20261029000300_master_records.sql` — Master document registry, categories, document types, access classes (`public`, `internal`, `restricted`).
  - `20261029000400_record_versions.sql` — Version lifecycle (`Draft`, `For Review`, `Approved`, `Superseded`), checksums, approval metadata.
  - `20261029000500_audit_events.sql` — Append-only audit log.
  - `20261030000100_update_bulletins.sql` — Update bulletin schema foundations.
  - `20261030000200_auth_profile_access.sql` — Authenticated profile & role checks.
  - `20261030000300_record_read_access.sql` — Assigned record reads & RLS isolation.
- **Frontend & Commits:**
  - `948e6dc` — Audit history and bulletin schema foundations.
  - `97c4642`, `fded619` — Core schema integrity rollback tests & replay verification.
  - `727ad3d`, `1bdb8a7` — Officer sign-in, profile-based access (`RequireAuth`), password recovery (`ResetPasswordPage`, `UpdatePasswordPage`).
  - `fb55f69` — Assigned record reads and authorization checks.

### Batch 4: Controlled Draft Editing & Public Catalog Isolation
- **Migrations:**
  - `20261030000400_draft_notes_command.sql` — `eacsc_update_draft_notes` with OCC & `mutation_receipts`.
  - `20261030000500_draft_conflict_http409.sql` — HTTP 409 conflict signaling (`PT409`).
  - `20261031000100_public_catalog.sql` — Public library catalog & release isolation.
- **Commits:** `3b637e1`, `7d98c9a`, `6455119`, `e7e997f`, `101f4d4` (verified via `scripts/batch4-http.mjs` & `scripts/run-batch4-http.ps1`).

### Batch 5: Private Storage Staging, Acceptance & Authorized Downloads
- **Migrations:**
  - `20261031000200_private_storage_buckets.sql`
  - `20261031000300_prepare_version_upload.sql`
  - `20261031000400_upload_request_access.sql`
  - `20261031000500_accept_version_upload.sql`
  - `20261031000600_upload_acceptance_context.sql`
  - `20261031000700_version_file_access.sql`
  - `20261031000800_upload_cleanup_plan.sql`
- **Edge Functions:** `ea-csc-stage-upload`, `ea-csc-download-file`.
- **Commits:** `5f1f6ab`, `28328ef`, `a42a1ef`, `ca175ea`, `55f9376`, `7314642`, `73eb34c`, `8bb658f`, `cfb43ad` (verified via `batch5-stage-http.mjs`, `batch5-accept-http.mjs`, `batch5-download-http.mjs`).

### Batch 6 & Batch 7: Review Workflow, 6-Point Verification, Publication, Withdrawal & Conflict Reconciliation
- **Migrations:**
  - `20261101000100_review_transitions.sql` — Submit for review & return for correction.
  - `20261113000100_verification_and_approval.sql` — 6-point verification checklist & approval (`eacsc_approve_version`).
  - `20261113000200_publication_and_withdrawal.sql` — Publication, supersession, & emergency withdrawal (`eacsc_withdraw_release`).
  - `20261113000300_audit_history_read.sql` — Council audit history viewer.
- **Edge Functions:** `ea-csc-publish-release`, `ea-csc-public-download`.
- **Commits:** `3763fdd`, `700a26e`, `bfa803e`, `94d2541` (verified via `batch6-review-http.mjs`).

### Batch 8: Update Bulletin Compiler, Issuance & Public Digest
- **Migrations:**
  - `20261114000100_bulletin_candidates.sql` — Eligible release candidate selection.
  - `20261114000200_bulletin_issuance.sql` — `eacsc_issue_bulletin` with source snapshots, SHA-256 PDF archival, and v1 → v2 supersession.
- **Edge Function:** `ea-csc-bulletin-file`.
- **Commit:** `5b0a4eb`.

### Batch 9: Continuity Turnover & Offline Disaster Recovery
- **Migrations:**
  - `20261114000300_turnover_system.sql`, `20261114000400_turnover_controls.sql` — Turnover memo drafting, outgoing inventory freeze (`eacsc_confirm_turnover_outgoing`), Technical Admin role/assignment transfer (`eacsc_transfer_position_role_v2`), and incoming officer acknowledgment (`eacsc_sign_turnover_acknowledgment_v2`).
- **Backup & Restore Tooling:** `scripts/backup-preflight.mjs`, `scripts/backup-database.mjs`, `scripts/backup-storage.mjs`, `scripts/backup.mjs`, `scripts/verify-backup.mjs`, `scripts/restore-backup.mjs`.
- **Commit:** `c64d1da`.

### Batch 10: Revalidation, Operations Pack & Initial Sidebar Shell
- **Migration:** `20261114000500_batch10_revalidation_repairs.sql` — Fixed bulletin staging RLS, `protect_record_release`, publication activation, and revalidation repairs.
- **Documentation Pack:** `docs/batch10/*` (`ACCEPTANCE_REGISTER.md`, `DEPLOYMENT_AND_RECOVERY_REPORT.md`, `PROPOSAL_TRACEABILITY.md`, `batch10-revalidation-results.json`, etc.) and `docs/operations/*` (`01` through `06` SOPs, checklists, templates, and runbooks).
- **Commits:** `123290f`, `a3320e8` — Added sidebar navigation shell, Help Center, AI Assistant drawer, and role-based demo accounts.

### Batch 11: Public Portal Upgrades, Visual Polish, Hybrid Gemini AI, & Full Lifecycle Simulation
1. **Part 1 — Governance & Account Upgrades (`e042725`, `c43bc53`):**
   - Migrations `20261115000100_batch11_features.sql`, `20261115000200_fix_app_users_grants.sql`, `20261115000300_signup_duplicate_checks.sql`, `20261115000400_fix_master_records_folder_grant.sql`.
   - Observer sign-up (`SignUpPage`), 28-position council roster (`setup-official-fictional-roster.mjs`), role application & President fast-track approval (`AccountPage`), document folders (`OfficerWorkspacePage`), and clean database seeding (`purge-and-seed-clean-db.mjs`).
2. **Part 2 — Visual Identity, Backgrounds, Transitions & Accordion Help (`e8674d0`, `892c834`, `1a6c0b7`):**
   - Circular favicon/logo styling, section-specific translucent backgrounds (Public, Auth, Officer Operations, Continuity & Access) with balanced opacity and fixed `left-72` alignment, smooth page/UI transitions, and grouped accordion layout in `HelpPage.tsx`.
3. **Part 3 — Hybrid Gemini AI Assistant & Custom Icon (`d5bda90`, `93dd4df`, `7f76def`, `62110e2`, `d66d343`, `d53c1cf`):**
   - Upgraded `ea-csc-ai-assistant` Edge Function and `AssistantDrawer.tsx` with Gemini Flash integration (`gemini-2.5-flash` + fallback model discovery), 30s timeout, local NLP/dictionary/summarizer fallback, uncropped circular custom chatbot icon, animated hover/click trigger button, smooth slide-in drawer, and single-line status badge (`Gemini AI` / `Smart Local`).
   - Resolved all ESLint (`react-hooks`, regex escape) and TypeScript issues (`d53c1cf`).
4. **Part 4 — Top-Bar Consolidation, Governance Guard Card, Republish Fix & Full Lifecycle Simulation (`cae8ef4`):**
   - Moved `Refresh`, `Home`, `Help`, `Sign out`/`Sign in`, and `AI Assistant` to uniform `h-9` (`36px`) animated top-bar buttons in `AppLayout.tsx`; removed redundant strip buttons from `RequireAuth.tsx`; replaced the bottom-left sidebar officer card with the **Governance Guard** (`SHA-256`, `Guide`, `Bulletins`) card.
   - Added **Role Capabilities & Security Reference** to `AccountPage.tsx` and Scenarios **E** & **F** to `HelpPage.tsx`.
   - **Bug Discovered & Fixed:** `20261115000100_fix_republish_after_withdrawal.sql` fixed a production SQL bug in `eacsc_private.publish_version` where republishing `v2` after an emergency withdrawal of `v1` threw `55000: A withdrawn release cannot be changed.` because it tried to update `effective_until` on the already-withdrawn `prior_release`.

### Batch 12: Zero-Backend UX Enhancements, Markdown AI & Human Pilot Pack
- **AI Assistant Markdown Rendering (`94200ab`):** Added XSS-safe React Markdown renderer (`src/features/assistant/MarkdownMessage.tsx`) wired into `AssistantDrawer.tsx` so Gemini AI headings, bold text, lists, code blocks, and links render cleanly.
- **Human Pilot & User Manual Pack (`aa29e15`, `5b3d313`):** Created `docs/pilot/01_CEAFEST_PILOT_FACILITATOR_SCRIPT.md` through `05_WEBSITE_USER_AND_OFFICER_MANUAL.md` covering the two-part CEAFest simulation + live turnover handover, Google Forms survey (30+ student observers & CEA officers), observation sheet, and beginner-friendly officer manual.
- **Six Zero-Backend Interactive Features:**
  1. **In-Browser SHA-256 File Verifier** (`src/features/records/FileVerifierWidget.tsx`) — Drag-and-drop file checker on `/` comparing local file bytes against live official releases or pasted SHA-256 hashes.
  2. **Shareable QR Code Generator** (`src/features/records/ShareQrModal.tsx`) — Generates scannable QR codes + copyable links + downloadable PNGs on `/`, `/records/:recordId`, and `/bulletins`.
  3. **In-Browser PDF/Image Quick Preview** (`src/features/records/PdfPreviewModal.tsx`) — Modal viewer with live SHA-256 display on `/`, `/records/:recordId`, and `/bulletins`.
  4. **Role-Guided Quick Actions Banner** (`src/features/auth/RoleActionBanner.tsx`) — Collapsible role-specific action cards with 1-click jump links on `/account` and `/officer/workspace`.
  5. **Student Bookmarks / Pinned Documents** (`src/features/records/useBookmarks.ts`) — `localStorage`-persisted pinning on `/` and `/records/:recordId` with a "Pinned by You" strip.
  6. **Printable Verification Slip** (`src/features/records/VerificationSlipPrint.ts`) — Hidden-iframe print receipt on `/records/:recordId` for hard-copy submissions.
- **Help Center Updates:** Updated `src/features/help/HelpPage.tsx` with instructions for all 6 new tools.

---

## 4. Verification, Testing & Live Production Checks

| Check / Suite | Scope | Result | Notes / Evidence |
| :--- | :--- | :--- | :--- |
| Static Checks | `npm run typecheck`, `npm run lint`, `npm run build` | **PASS** | 0 TypeScript errors, 0 ESLint errors, clean Vite production bundle (`dist/`). |
| Batch 4–6 HTTP Suites | `batch4-http.mjs`, `batch5-*-http.mjs`, `batch6-review-http.mjs` | **PASS** | Verified Draft OCC (`409`), staged uploads, checksums, downloads, and review transitions. |
| Batch 10 & 11 Revalidation | `scripts/batch10-revalidation.mjs`, `scripts/batch11-revalidation.mjs` | **PASS** | Verified RLS, public catalog isolation, bulletin issuance, and turnover controls. |
| Full Lifecycle Simulation | `scripts/simulate-full-lifecycle.mjs` | **PASS (8/8)** | Executed against live Supabase: Sign-up -> Role Approval -> Folder & Doc -> v1 Stage -> Submit -> Return -> Resubmit -> 6-Point Approve -> Publish v1 -> Withdraw -> Stage v2 -> Approve -> Republish v2 (`EACSC-2026-ACT-0027`) -> 2nd Public Doc (`EACSC-2026-ACT-0028`) -> Bulletin v1 & v2 -> Outgoing Freeze -> Tech Admin Transfer -> Incoming Acknowledgment. |
| Live Browser E2E Verification | `https://eacsc.netlify.app` | **PASS** | Verified unauthenticated & authenticated (`president@eacsc.example`) top-bar buttons (`36px`), Governance Guard sidebar, live public documents, v2 bulletin, `/account` role reference, `/help` Scenarios E & F, and live `Gemini AI` assistant responses. |

---

## 5. Official Fictional Roster & Operational Reference

- **Roster Seed Script:** `scripts/setup-official-fictional-roster.mjs` (default test password: `eacsc_1999_CEA`).
- **Key Simulated Executive Accounts:**
  - `president@eacsc.example` — `approver`, `reviewer`, `author`, `custodian`
  - `executive.secretary@eacsc.example` — `custodian`, `author`, `approver`, `reviewer`
  - `executive.auditor@eacsc.example` — `reviewer`
  - `pro@eacsc.example` — `publisher`, `author`
  - `admin@eacsc.example` — `technical_admin`, `custodian`
- **Operations & Disaster Recovery Runbooks:** Located in `docs/operations/01_EA_CSC_ADOPTED_SOP.md` through `06_PILOT_EVALUATION_PACK_AND_RECEIPT.md`.

---

## 6. Official FY 2026–2027 Officer Roster Alignment (Batch 13)

- **Source Document:** `CEA_ROSTER-OF-OFFICERS_(EA-CSC)2026-2027`
- **Changes Applied:**
  - `src/features/auth/AccountPage.tsx`: Replaced the earlier placeholder position list with the official FY 2026–2027 EA-CSC officer roster grouped into **Executive Officers** (`President`, `Vice President`, `Secretary`, `Assistant Secretary`, `Treasurer`, `Budget Secretary`, `Auditor`, `Public Information Officer`, `Property Custodian`), **Legislative & Representatives** (`Legislator`, `Senator`, `Representative`), **Committees** (`Secretariat Committee`, `Finance, Budget and Appropriation Committee`, `Ways and Means Committee`, `Student Grievance and Concerns Committee`, `Revisions and Constitutional Amendment Committee`, `Publication Committee`, `Esports and Gaming Committee`, `Event Organization and Participation Committee`, `Web Development Committee`), and **Advisory & System Administration** (`Faculty Adviser`, `Technical Administrator`).
  - `src/features/help/HelpPage.tsx`: Updated `ROLE_MATRIX`, `OFFICIAL_TEST_SAMPLE`, role descriptions, workspace steps, and operational Scenarios A–F to reflect the official FY 2026–2027 position titles.
  - `src/features/assistant/assistantEngine.ts` & `supabase/functions/ea-csc-ai-assistant/index.ts`: Updated AI Assistant role/position terminology and system prompt (`SYSTEM_INSTRUCTION`) to reference the official FY 2026–2027 roster and redeployed the `ea-csc-ai-assistant` Edge Function.
- **Verification:** `npm run typecheck`, `npm run lint`, and `npm run build` passed with 0 errors; redeployed to Supabase Edge Functions and Netlify (`https://eacsc.netlify.app`).
