# EA-CSC IIDGS — Detailed Change Log: Netlify Exit, Localhost Testing & Cloudflare Deployment

**Project:** CatSU EA-CSC Institutional Information & Document Governance System (IIDGS)  
**Period Covered:** November 16, 2026 – November 25, 2026 (Batches 14–19 & Production Host Migration)  
**Previous Host:** Netlify (`https://eacsc.netlify.app` — suspended due to credit exhaustion)  
**Current Live Production URL:** `https://iidgs.eacsc.workers.dev/` (Cloudflare Workers & Static Assets)  
**Backend / Database:** Supabase Project `ea-csc-website-dev` (`gkhhwrrvqlzpayphvsqp`)  

---

## 1. Context: Transition from Netlify to Localhost & Cloudflare

Following Batch 13 (`6962114`), the Netlify deployment account exhausted its hosting/build credits. Rather than halting development, the project shifted to a **zero-credit-waste localhost verification workflow** (`http://localhost:5173`) connected directly to the live Supabase database, followed by a clean GitHub-integrated migration to **Cloudflare Workers & Static Assets** (`https://iidgs.eacsc.workers.dev/`).

---

## 2. Phase A: Pre-Migration Localhost Feature Expansion (Batches 14–19)

Between November 16 and November 18, 2026, all remaining governance gaps were built, tested on `localhost:5173`, and verified against live Supabase RPCs:

### 2.1 Unified Officer Operations & 2-Stage Review (Batches 14–15)
- **Commits:** `fa2c5b9`, `8aa5d3d`
- **Migrations:** `20261117000100_unified_operations_and_turnover.sql`, `20261117000200_complete_workflow_and_turnover_alignment.sql`
- **Changes:**
  - Split Officer Workspace (`/officer`) and Review Queue (`/officer/reviews`) into clear two-stage governance: **Stage 1 (Reviewer Queue)** for Auditor/VP inspection and **Stage 2 (Executive 6-Point Approval)** for President substantive approval.
  - Added Realtime subscriptions across workspace, review queue, and account role requests.
  - Added Technical Administrator identity-confirmation checkbox on `/officer/admin/access` and incoming officer acknowledgment flow.
  - Updated `OfficerWorkspacePage.tsx` (`24633ca`) to sort records newest-first and increase `pageSize` to `50`.

### 2.2 Mobile Viewport & PDF Canvas Hardening
- **Commits:** `9f65064`, `15bf57b`
- **Changes:**
  - Fixed mobile top-bar overlap and responsive navigation drawer alignment.
  - Replaced native `<iframe src="blob:...">` PDF previews (which fail on Android/WebView) with `PdfCanvasViewer` rendering via `pdfjs-dist` (`pdf.worker.min.mjs`).
  - Rendered `PdfPreviewModal` via `ReactDOM.createPortal(..., document.body)` (`15bf57b`) for reliable viewport centering on mobile and scrolled pages.

### 2.3 Creator Controls, Restricted Picker & Segregation of Duties (Batch 16)
- **Commits:** `04afdf6`, `b638c32`, `e3d2e19`
- **Migration:** `20261118000100_creator_delete_restricted_picker_and_author_v2.sql`
- **Changes:**
  - Added **Creator-only Delete Document** (`eacsc_delete_unapproved_document`) for removing mistaken drafts before approval.
  - Added **Restricted Officer Picker** so authors of `restricted` documents can grant explicit viewer/reviewer access (`allow_restricted = true`).
  - Enforced **Creator-First Draft Mechanic**: only the document creator can upload Version 1 before other authors can collaborate on Version 2+.
  - Restricted Reviewer Return/Pass actions strictly to `/officer/reviews` (`b638c32`) and renamed the workspace submission card to **Submit for Review** (`e3d2e19`).

### 2.4 Executive Fast-Track, Google Drive Drafts & Internal Libraries (Batches 17–19)
- **Commits:** `ae4fb23`, `cf4e8c9`, `40b257a`, `acbee65`, `098ae94`, `6bfc46b`
- **Migrations:**
  - `20261118000200_batch17_exemptions_fasttrack_drive_bulletin.sql`
  - `20261118000300_batch18_fasttrack_internal_library_and_bulletins.sql`
  - `20261118000400_batch19_autolib_bulletins_and_workspace_filter.sql`
  - `20261118000500_next_bulletin_id.sql`
  - `20261118000600_fix_issue_bulletin_internal_match.sql`
  - `20261118000700_sync_candidates_effective_from.sql`
- **Changes:**
  - Implemented **Executive Fast-Track Self-Approval** (`President` and `Secretary`) inside `OfficerWorkspacePage.tsx` with mandatory urgency rationale logged to `audit_events`.
  - Added **Google Drive Link** draft attachment support alongside direct PDF/DOCX/PNG/JPEG uploads.
  - Built **Internal Council Library** (`/officer/library`) and **Internal Update Bulletins** (`/officer/internal-bulletins`) for officer-only access.
  - Implemented **Auto-Publish on Approval** (`auto_publish_internal_release`) so approved `internal` and `restricted` documents publish automatically into `/officer/library`, while `public` documents remain gated in `/officer/releases` for the PRO.
  - Implemented Custodian-only Bulletin Compiler access, auto-incrementing `EACSC-YYYY-BUL-NNNN` IDs across both public and internal bulletins, Custodian bulletin withdrawal, and future-date/current-time offset fixes (`e8661ac`).

---

## 3. Phase B: Localhost Pilot Testing & Turnover/UI Fixes (Nov 18–19, 2026)

During intensive manual and automated pilot testing on `http://localhost:5173`, several subtle bugs were caught and resolved before cloud deployment:

1. **Modal Viewport Positioning (`d5792c6`):**
   - *Symptom:* `+ New Folder` and `+ Create Document` modals were pushed to the bottom of long scrollable pages instead of staying centered in the viewport.
   - *Fix:* Removed `transform` from `@keyframes pageEnter` in `src/styles/global.css`, which had created a containing block breaking `position: fixed`.
2. **Turnover Non-Package Assignments & Creator Delete (`47b6d77`, `e219131`):**
   - *Migration:* `20261119000100_fix_turnover_transfer_and_delete.sql`
   - *Fix:* Deactivated remaining collaborator assignments held by the departing officer outside the position's inventory during transfer, added `eacsc_delete_turnover_package` for un-transferred packages, and enabled Technical Admin position inventory lookup on `/officer/turnover`.
3. **Turnover Acknowledgment Column Mismatch (`e30897b`):**
   - *Symptom:* Incoming officer clicking **Accept & Acknowledge Package** hit `column "confirmation_notes" of relation "turnover_acknowledgments" does not exist`.
   - *Migration:* `20261119000200_fix_complete_turnover_acknowledgment.sql` aligned the RPC with the live `turnover_acknowledgments` schema.
4. **Auto-Publish Execute Grant (`f8fbdc3`):**
   - *Migration:* `20261119000300_grant_auto_publish_execute.sql` granted `EXECUTE` on `eacsc_private.auto_publish_internal_release` to `authenticated` callers.
5. **Completed Turnover Package Archival (`f8fbdc3`):**
   - *Symptom:* Completed handover packages remained visibly active in the incoming receipt card.
   - *Fix:* Filtered `AccessPage.tsx` receipt list to `p.status === 'draft'` and moved acknowledged packages into a collapsible archive disclosure in `TurnoverPage.tsx`.
6. **Localhost 6-Document + Dual-Bulletin + Turnover Pilot (`472aeb2`, `e8661ac`):**
   - Executed clean database reset (`scripts/reset-clean-3-folders.mjs`) and full Playwright pilot (`scratch/capture_complete_6doc_pilot.py`) covering 6 documents (3 by Secretary, 3 by Outgoing BM), Auditor return + endorse, President 6-point approval, PRO public release, Treasurer Public & Internal bulletins, and full Turnover/Access Transfer.

---

## 4. Phase C: Cloudflare Migration & Live Production Hardening (Nov 19, 2026)

### 4.1 GitHub & Cloudflare Workers Setup
1. **Repository Remote:** Connected local repository to `https://github.com/eacscnetlify/ea-csc-website.git` (`origin/main`).
2. **Cloudflare Build Configuration:**
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Root directory: `/`
   - Build variables: `NODE_VERSION=22`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. **SPA Routing Loop Fix (`7e1c064`):**
   - *Error:* Cloudflare deployment failed at `npx wrangler deploy` with `Invalid _redirects configuration: Line 1: Infinite loop detected in this rule`.
   - *Fix:* Removed `public/_redirects` (`/* /index.html 200`, a Netlify-specific file) because Cloudflare Workers & Pages handles SPA fallback to `index.html` natively.
4. **Domain Configuration:**
   - Updated Cloudflare Worker name to `iidgs` and account subdomain to `eacsc`, establishing the live production URL: **`https://iidgs.eacsc.workers.dev/`**.
5. **Production Environment Variable Injection (`5ae1042`):**
   - *Error:* Initial Cloudflare build compiled before dashboard variables were saved, resulting in `"Set VITE_SUPABASE_URL in .env.local"` on `/login` and empty catalog fetches.
   - *Fix:* Added `.env.production` (containing public `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`) and unignored `!.env.production` in `.gitignore` so every Vite build deterministically embeds the production Supabase endpoint and publishable key.

### 4.2 Edge Function CORS & Live Production Bug Fixes
After `https://iidgs.eacsc.workers.dev/` went live, live browser testing uncovered three final production issues that were immediately resolved:

1. **Edge Function CORS (`403 ORIGIN_DENIED`):**
   - *Symptom:* Draft uploads (`ea-csc-stage-upload`), PDF previews/downloads (`ea-csc-public-download`, `ea-csc-download-file`, `ea-csc-bulletin-file`), releases (`ea-csc-publish-release`), and AI Assistant (`ea-csc-ai-assistant`) failed with `Failed to fetch` on `https://iidgs.eacsc.workers.dev/`.
   - *Fix:* Updated Supabase Edge Function secret `ALLOWED_ORIGINS` to `https://iidgs.eacsc.workers.dev,http://localhost:5173,http://127.0.0.1:5173`. Verified `OPTIONS` preflight returns `204 No Content` with `Access-Control-Allow-Origin: https://iidgs.eacsc.workers.dev`.
2. **Account Role Preset Checkbox Sync Bug (`37046ac`):**
   - *Symptom:* On `/account`, selecting a Council Position (e.g., *Auditor*, *PRO*, *Treasurer*) from `#role-preset` left `selectedRoles` stuck on `['author']` unless checkboxes were manually clicked; *Business Manager* was also missing from `POSITION_PRESETS`.
   - *Fix:* Updated `src/features/auth/AccountPage.tsx` to add *Business Manager* and automatically sync `selectedRoles` whenever `#role-preset` changes.
3. **Turnover Snapshot Null Assignments SQL Error (`37046ac`):**
   - *Symptom:* Technical Admin clicking **Transfer confirmed position access** hit `cannot extract elements from a scalar` when an older `Business Manager` record in `inventory_snapshot` had `"assignments": null`.
   - *Migration:* Applied `supabase/migrations/20261119000400_fix_turnover_null_assignments.sql`, wrapping `x->'assignments'` and `item->'assignments'` in `coalesce(nullif(..., 'null'::jsonb), '[]'::jsonb)` inside `eacsc_private.transfer_position_role_v2`.

### 4.3 Final Live Production Verification (`https://iidgs.eacsc.workers.dev/`)
- **Live End-to-End Pilot:** Registered **6 brand-new accounts** via `/signup` (`pilot.sec`, `pilot.bm`, `pilot.aud`, `pilot.pro`, `pilot.treas`, `pilot.bm.new`), approved all 6 via President on `/account`, created folder `Online Pilot Test Folder 2026`, created and processed 6 documents across all 3 access levels (`Public`, `Internal`, `Restricted`), tested Auditor return-to-draft + v2 resubmission, President 6-point approval + Fast-Track, Internal Library auto-publish & file download, PRO public publishing, Treasurer Public & Internal Bulletins, Technical Admin Turnover & Access Transfer, SHA-256 Checker, QR Code modal, PDF Canvas Preview, AI Assistant, and error scenarios—all passing with **0 console/page errors**.
- **Static Checks:** `npm run typecheck`, `npm run lint`, and `npm run build` passed with 0 errors.
- **Final Documentation:** Generated **Edition 2.0** of [EA-CSC_IIDGS_Officer_Operations_Manual.docx](../EA-CSC_IIDGS_Officer_Operations_Manual.docx) (`9.58 MB`, 45+ live production screenshots).
