# CatSU EA-CSC IIDGS — Master Project Documentation

**Institution:** Catanduanes State University (CatSU) — College of Engineering and Architecture  
**Organization:** Engineering and Architecture College Student Council (EA-CSC)  
**System Title:** Institutional Information and Document Governance System (IIDGS)  
**Live Production URL:** `https://iidgs.eacsc.workers.dev/`  
**GitHub Repository:** `https://github.com/eacscnetlify/ea-csc-website.git`  
**Supabase Project:** `ea-csc-website-dev` (`gkhhwrrvqlzpayphvsqp`)  
**Documentation Updated:** November 25, 2026 (Asia/Manila, UTC+8)  

---

## 1. Executive Summary & Project Vision

The **EA-CSC Institutional Information and Document Governance System (IIDGS)** is a full-stack web application engineered to replace informal, fragmented student council document sharing (chat attachments, mutable shared drives, and unverified PDFs) with a **cryptographically verifiable, role-enforced, two-stage governance platform**.

Every official resolution, memorandum, charter, financial ledger, and update bulletin created in the system passes through strict **Segregation of Duties**, **6-Point Substantive Verification**, **SHA-256 file integrity hashing**, and **immutable audit logging**, culminating in automated **Officer Turnover & Access Transfer** at the end of each academic term.

---

## 2. System Architecture & Technology Stack

### 2.1 Frontend Application (`src/`)
- **Core Framework:** React `19.3.1` + TypeScript `6.0` + Vite `8.3.5` (Rolldown bundler).
- **Routing:** React Router (`react-router`) with client-side route guards (`RequireAuth`) and native Cloudflare SPA fallback.
- **Styling & UI:** Tailwind CSS v4 (`@tailwindcss/vite`), responsive sidebar/drawer layout (`AppLayout.tsx`), section-specific translucent backgrounds, custom circular favicon/seal, and viewport-centered modals.
- **Client-Side Cryptography & PDF Tooling:**
  - Web Crypto API (`crypto.subtle.digest('SHA-256', ...)`) for zero-upload local file verification (`FileVerifierWidget.tsx`).
  - `pdfjs-dist` (`PdfCanvasViewer.tsx`) for cross-browser and Android/WebView-safe canvas PDF previews.
  - `jspdf` + `html2canvas` (`bulletinPdf.ts`) for generating multi-page official Update Bulletin PDFs.
  - `qrcode` (`ShareQrModal.tsx`) for scannable verification QR codes and downloadable PNGs.

### 2.2 Backend, Database & Storage (`supabase/`)
- **Database:** Supabase PostgreSQL with strict **Row-Level Security (RLS)** on all tables (`app_users`, `master_records`, `record_folders`, `record_versions`, `record_releases`, `update_bulletins`, `turnover_packages`, `turnover_acknowledgments`, `audit_events`, `role_requests`, `mutation_receipts`).
- **Concurrency & Idempotency:**
  - Optimistic Concurrency Control (`revision_counter`) returning `PT409` conflict errors on stale edits.
  - Idempotent `mutation_receipts` keyed by `p_request_id` (`uuid`) preventing duplicate submissions on network retries.
  - Append-only `audit_events` recording every state transition in `Asia/Manila` (`UTC+8`).
- **Private Storage Buckets:** `ea-csc-records` and `verified-council-releases` — completely private; zero public bucket URLs. All uploads and downloads are brokered by authenticated/CORS-validated Edge Functions.

### 2.3 Serverless Edge Functions (`supabase/functions/`)
| Edge Function | Method | Purpose & Security Controls |
| :--- | :---: | :--- |
| `ea-csc-stage-upload` | `POST` | Validates MIME/extension/size (up to 10 MB), computes server SHA-256, stores private draft attachment, and records acceptance. |
| `ea-csc-download-file` | `GET` | Streams private draft/internal/restricted attachments to authorized officers after verifying active role & `allow_restricted` flags. |
| `ea-csc-publish-release` | `POST` | Verifies approved version checksum and publishes active public release metadata. |
| `ea-csc-public-download` | `GET` | Streams verified public release PDFs to students and visitors with `X-Content-SHA256` headers. |
| `ea-csc-bulletin-file` | `GET` | Streams issued Public or Internal Update Bulletin PDFs (enforcing officer auth for `internal` audience). |
| `ea-csc-ai-assistant` | `POST` | Hybrid Google Gemini Flash (`gemini-2.5-flash` + automatic model discovery fallback) + local portal NLP/dictionary fallback. |

*All 6 Edge Functions enforce strict `ALLOWED_ORIGINS` CORS validation (`https://iidgs.eacsc.workers.dev`, `http://localhost:5173`, `http://127.0.0.1:5173`).*

### 2.4 Hosting & Deployment Evolution
1. **Initial Production Host (Batches 1–13):** Netlify (`https://eacsc.netlify.app`).
2. **Localhost Hardening Phase (Batches 14–19):** After Netlify credits were exhausted, development and end-to-end verification moved to `http://localhost:5173` paired with live Supabase.
3. **Final Production Host (Current):** Migrated via GitHub (`eacscnetlify/ea-csc-website`) to **Cloudflare Workers & Static Assets** at **`https://iidgs.eacsc.workers.dev/`**, with `.env.production` supplying public Supabase build variables and native Cloudflare SPA routing (without `_redirects`).

---

## 3. Application Sitemap & Module Inventory

### 3.1 Public Portal & Guest Routes
| Route | Component | Purpose |
| :--- | :--- | :--- |
| `/` | `PublicLibraryPage.tsx` | Verified Public Document Catalog, live search/category filters, Details modal, Pinned Documents strip, and In-Browser SHA-256 File Verifier. |
| `/records/:recordId` | `RecordDetailPage.tsx` | Full citation view for a public release with Official Download, PDF Canvas Preview, Share/QR Code, Pin Document, and Printable Verification Slip. |
| `/bulletins` | `PublicBulletinsPage.tsx` | Archive of official Public Update Bulletins with PDF Preview, Download, and QR Code. |
| `/help` | `HelpPage.tsx` | Grouped accordion Operations Guide, FY 2026–2027 Role Matrix, and Governance Scenarios A–F. |
| `/login` | `LoginPage.tsx` | Officer & Observer authentication with automatic role-based redirect (`/officer` vs. `/account`). |
| `/signup` | `SignUpPage.tsx` | Student Observer registration with server-side duplicate Full Name / Student ID checks (`eacsc_check_signup_availability`). |
| `/account` | `AccountPage.tsx` | Profile overview, Password Reset link, Officer Role Application form (with position-preset role syncing), and President's Role Approval Console. |
| `/auth/reset-password` | `ResetPasswordPage.tsx` | Sends Supabase password recovery email redirecting to `/auth/update-password`. |
| `/auth/update-password` | `UpdatePasswordPage.tsx` | Authenticated password update screen for recovery sessions. |
| `*` | `NotFoundPage.tsx` | Graceful 404 page with navigation back to Home. |

### 3.2 Protected Officer & Continuity Routes (`RequireAuth`)
| Route | Component | Required Roles / Access | Purpose |
| :--- | :--- | :--- | :--- |
| `/officer` | `OfficerWorkspacePage.tsx` | Any active officer | Folder directory (`+ New Folder`), Document creation (`+ Create Document`), Draft v1/v2+ uploads, Google Drive link drafts, Creator-only Delete, Submit for Review, and Executive Fast-Track Self-Approval. |
| `/officer/reviews` | `ReviewQueuePage.tsx` | `reviewer` / `approver` | **Stage 1: Reviewer Queue** (Return with suggestions to Draft / Pass to President) and **Stage 2: Executive 6-Point Approval** (6-Point Checklist + Substantive Approval). |
| `/officer/releases` | `ReleasePanel.tsx` | `publisher` (PRO) | Final PIO verification and publication of approved `public` documents to `/`, plus emergency withdrawal (`eacsc_withdraw_release`). |
| `/officer/library` | `InternalLibraryPage.tsx` | Active officers | Auto-published repository of approved `internal` and `restricted` documents (restricted items visible only to explicitly authorized officers). |
| `/officer/bulletins` | `BulletinBuilderPage.tsx` | `custodian` | Query eligible releases by date window & audience (`public` / `internal`), generate multi-page PDF previews, issue official bulletins, and manage/withdraw posted bulletins. |
| `/officer/internal-bulletins` | `InternalBulletinsPage.tsx` | Active officers | Officer-only archive of issued Internal Update Bulletins. |
| `/officer/history` | `CouncilHistoryPage.tsx` | Active officers | Chronological, immutable audit event log across all council operations (`UTC+8`). |
| `/officer/turnover` | `TurnoverPage.tsx` | `custodian` / `author` / `technical_admin` | Continuity Memorandum drafting, inventory snapshot freezing, outgoing confirmation, un-transferred package deletion, and Technical Admin position lookup. |
| `/officer/admin/access` | `AccessPage.tsx` | `technical_admin` / incoming officers | Technical Admin executes confirmed access transfers; Incoming Officer completes one-click `Accept & Acknowledge Package`. |

---

## 4. Complete Database Migration History (44 Migrations)

| Phase / Batch | Migration Files | Key Capabilities Implemented |
| :--- | :--- | :--- |
| **Batches 1–3: Foundations** | `20261029000100` – `20261030000300` (8 files) | Connection check, `app_users` (6 functional roles), `master_records`, `record_versions`, `audit_events`, `update_bulletins`, auth profile & RLS read access. |
| **Batch 4: Drafts & Catalog** | `20261030000400` – `20261031000100` (3 files) | `eacsc_update_draft_notes` with OCC (`PT409`), `mutation_receipts`, and `eacsc_public_catalog` isolation. |
| **Batch 5: Private Storage** | `20261031000200` – `20261031000800` (7 files) | Private storage buckets, staged upload preparation, upload request access, acceptance context, and version file access. |
| **Batches 6–7: Review & Release** | `20261101000100`, `20261113000100` – `20261113000300` (4 files) | Review transitions, 6-point verification & `eacsc_approve_version`, publication, supersession, emergency withdrawal, and audit history reads. |
| **Batch 8: Bulletins** | `20261114000100`, `20261114000200` (2 files) | Eligible release candidate querying and `eacsc_issue_bulletin` with SHA-256 PDF archival. |
| **Batch 9: Turnover & DR** | `20261114000300`, `20261114000400` (2 files) | Turnover packages, continuity memorandums, outgoing confirmation, role transfer, and incoming acknowledgment. |
| **Batch 10: Revalidation** | `20261114000500` (1 file) | Bulletin staging RLS repairs, release protection, and revalidation fixes. |
| **Batch 11: Roster & Republish** | `20261115000100` – `20261115000400` (5 files) | Role requests, signup duplicate checks, folder grants, and `fix_republish_after_withdrawal`. |
| **Batches 14–19: Unified Ops & Auto-Publish** | `20261117000100` – `20261118000700` (9 files) | Two-stage review alignment, creator-only delete, restricted picker, creator-first v2+, Fast-Track self-approval, Google Drive links, auto-publish internal/restricted, next bulletin ID, and effective-date sync. |
| **Cloudflare Pilot Hardening** | `20261119000100` – `20261119000400` (4 files) | Transfer non-package assignment deactivation, creator package delete, `turnover_acknowledgments` schema alignment, `auto_publish_internal_release` execute grant, and null-assignment scalar guard in `transfer_position_role_v2`. |

---

## 5. Governance & Security Model Summary

1. **Three Access Classes:**
   - **Public:** 2-stage review → President 6-point approval → PRO Release Panel gate → Live on `/` and eligible for Public Bulletins.
   - **Internal:** 2-stage review → President 6-point approval → **Auto-published** to `/officer/library` and eligible for Internal Bulletins.
   - **Restricted:** 2-stage review (requiring explicit `allow_restricted` assignment) → President 6-point approval → **Auto-published** to `/officer/library` strictly for named authorized officers; excluded from bulletins.
2. **Creator-First Draft Lock:** The original document creator must upload/attach Version 1 before collaborating authors can upload Version 2+.
3. **Segregation of Duties:** Standard authors cannot endorse or approve their own drafts; only President and Secretary may invoke **Executive Fast-Track Self-Approval** with a recorded urgency rationale.
4. **Three-Party Turnover Handover:** Outgoing Officer confirms memorandum & inventory → separate Technical Administrator executes transfer → Incoming Officer accepts & acknowledges → Outgoing Officer is cleanly deactivated (`Account inactive`) while preserving all historical audit records.

---

## 6. Operations, Testing & Backup Tooling

- **Operational Runbooks (`docs/operations/`):** `01_EA_CSC_ADOPTED_SOP.md` through `06_PILOT_EVALUATION_PACK_AND_RECEIPT.md`.
- **Human Pilot Kit (`docs/pilot/`):** `01_CEAFEST_PILOT_FACILITATOR_SCRIPT.md` through `05_WEBSITE_USER_AND_OFFICER_MANUAL.md`.
- **Official Word Manual:** [EA-CSC_IIDGS_Officer_Operations_Manual.docx](../EA-CSC_IIDGS_Officer_Operations_Manual.docx) (Edition 2.0, `9.58 MB`, 45+ live production screenshots).
- **Backup & Disaster Recovery (`scripts/`):** `backup.mjs`, `verify-backup.mjs`, `restore-backup.mjs`, `setup-official-fictional-roster.mjs`, `reset-clean-3-folders.mjs`, `diagnose-workspace.mjs`.
- **Automated Verification Suites:** `npm run typecheck`, `npm run lint`, `npm run build`, HTTP batch suites (`batch4`–`batch6`, `batch10`–`batch11`), `simulate-full-lifecycle.mjs`, and live Playwright E2E pilot verification on `https://iidgs.eacsc.workers.dev/`.

---

## 7. Production Environment Reference

| Configuration Item | Production Value / Location |
| :--- | :--- |
| **Live Web URL** | `https://iidgs.eacsc.workers.dev/` |
| **Frontend Env File** | `.env.production` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) |
| **Supabase Auth Site URL** | `https://iidgs.eacsc.workers.dev` (Redirect URLs: `https://iidgs.eacsc.workers.dev/**`) |
| **Edge Function `ALLOWED_ORIGINS`** | `https://iidgs.eacsc.workers.dev,http://localhost:5173,http://127.0.0.1:5173` |
| **Edge Function `GEMINI_API_KEY`** | Stored in Supabase Edge Function Secrets |
| **Cloudflare Build Settings** | Build: `npm run build` · Deploy: `npx wrangler deploy` · Root: `/` |
