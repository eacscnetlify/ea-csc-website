# EA-CSC IIDGS — Batch 11 Master Blueprint & Upgrade Plan

*Status: Finalized Master Blueprint (Approved for Batch 11 Execution).*

---

## 1. Visual Identity & Color System (2026 Official Council Emblem)

### A. Official 2026 Logo Assets
- **Emblem Source:** CatSU 2026 College Student Council — Engineering and Architecture (`public/eacsc-logo-2026.jpg` and `public/eacsc-seal.png`).
- **Design Elements:**
  - Metallic chrome outer bevel with *"COLLEGE STUDENT COUNCIL 2026 · ENGINEERING AND ARCHITECTURE"*.
  - Futuristic stylized "EA" monogram.
  - Multi-discipline engineering symbols: Electric Cyan microchip (Computer/Electronics), Vivid Circuit Green traces (Electrical), Orange mechanical gear (Mechanical), Metallic Ionic pillar (Architecture), Silver angular bridge framework (Civil).
  - Deep space obsidian center background with radiant crimson outer glow.

### B. High-Tech Harmonized Color Palette
| Palette Element | Color Tone / Hex | Tailwind Equivalent | Application in Portal |
| :--- | :--- | :--- | :--- |
| **Obsidian Frame** | `#0A0A0E` / `#0F172A` | `bg-slate-950` / `bg-slate-900` | Left sidebar background, header navbars, and modal dark backdrops. |
| **Radiant Crimson** | `#8B1E28` / `#991B1B` / `#DC2626` | `rose-800` / `red-700` | Primary brand banners, hero accents, active nav indicators, and key badges. |
| **Metallic Silver / Chrome** | `#E2E8F0` / `#94A3B8` / `#CBD5E1` | `border-slate-300` / `text-slate-400` | Subtle card borders, dividers, metallic button borders, and secondary text. |
| **Circuit Emerald** | `#059669` / `#10B981` | `emerald-600` / `emerald-500` | "Verified" pills, 6-point check confirmations, active releases, and primary CTAs. |
| **Electric Cyan** | `#0284C7` / `#06B6D4` | `cyan-500` / `sky-600` | Technological highlights, SHA-256 verification inspector, and download buttons. |
| **Mechanical Amber** | `#D97706` / `#F59E0B` | `amber-600` / `amber-500` | Pending reviews, return-to-draft warnings, and priority attention counts. |
| **Clean Academic White** | `#FFFFFF` / `#F8FAFC` | `bg-white` / `bg-slate-50` | Card bodies, form inputs, modal dialogs, and reading surfaces. |

---

## 2. Observer vs. Officer Separation & Clean Public Experience

### A. Unauthenticated Visitors & Observers (`role = []`)
- **Strict Role Gate:** All officer tools (`/officer/*`, Document Workspace, Review Queue, Release Panel, Bulletin Compiler, Turnover, Access Transfer) are completely hidden from the sidebar.
- **Dedicated Public Pages Only:**
  1. **Home Lobby (Public Library)** (`/`)
  2. **Update Bulletins** (`/bulletins`)
  3. **Help & Operations Guide** (`/help`)
  4. **Create Account** (`/signup` — when logged out)
  5. **Sign In** (`/login` — when logged out)
  6. **My Account & Role Request** (`/account` — when logged in as an Observer)

### B. Authenticated Officers (`functional_roles.length > 0`)
- Dynamic sidebar unlocks **Officer Operations** and **Continuity & Access** sections matching the officer's granted roles.

---

## 3. Full 2026 Council Accounts & Position Roster

All accounts will be initialized with the official council password: **`eacsc_1999_CEA`**.

| # | Official Position | Representative Officer | Email | Functional Roles | Key Operational Responsibilities & Privileges |
| :- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Council President** | Rafael Santos | `president@eacsc.example` | `['approver', 'reviewer']` | Substantive approval (6-point check), role application approvals, executive fast-track self-approval for emergency council resolutions. |
| **2** | **Executive Secretary** | Roxan Mariz Icaro | `secretary@eacsc.example` | `['custodian', 'author']` | Primary records custodian, author of official minutes/proceedings, bulletin compiler, executive fast-track self-approval for official circulars. |
| **3** | **VP Internal** | Alyssa Tan | `vp.internal@eacsc.example` | `['reviewer']` | Peer review inspection, return-to-draft feedback on internal student affairs, policy compliance. |
| **4** | **VP External** | Mark Joseph Rivera | `vp.external@eacsc.example` | `['reviewer', 'author']` | Authors external partnerships & industry linkages, reviews public-facing student engagement policies. |
| **5** | **Committee Head (Academics)** | Marco Reyes | `author@eacsc.example` | `['author']` | Authors curriculum feedback, academic grievance resolutions, academic guideline drafts. |
| **6** | **Committee Head (Activities)** | Patricia Mae Gomez | `activities@eacsc.example` | `['author']` | Authors Engineering Week guidelines, sports fest rules, student organization event proposals. |
| **7** | **Treasurer & Auditor** | Kevin Dave Alcantara | `finance@eacsc.example` | `['custodian', 'author']` | Manages restricted financial liquidations, fee collection summaries, and budget workpapers. |
| **8** | **Public Information Officer** | Camille Cruz | `pio@eacsc.example` | `['publisher']` | Operates the Release Panel, schedules announcements, broadcasts releases to the Public Home Lobby. |
| **9** | **Lead Technical Admin** | Daniel Lim | `admin@eacsc.example` | `['technical_admin', 'custodian']` | Manages system health, access transfers, academic year turnover continuity, and user accounts. |
| **10** | **Student Observer (Applicant)** | Sunny Daniel Soneja | `observer@eacsc.example` | `[]` *(Unassigned)* | Explores Public Home Lobby, views bulletins, tests the *"Apply for Officer Role"* workflow. |

---

## 4. Database Purge & Fresh Seed Strategy

### A. Cleaning Old Fictional Drafts & Test Runs
- Create an automated migration script (`scripts/purge-and-seed-clean-db.mjs`) that safely cleans:
  - Previous test records (`EACSC-2099-BT-*`, `EACSC-2099-BR-*`).
  - Orphaned version drafts, attachments, and review comments from Batches 1–10.
  - Old test bulletin entries.
- Retains system audit schema integrity and continuity foundations.

### B. Fresh Seed Data
- Create a clean set of initial 2026 documents:
  1. **`EACSC-2026-GOV-0001`**: *EA-CSC 2026 Constitution & Operating By-Laws* (Public, Active Release v1).
  2. **`EACSC-2026-SEC-0001`**: *General Assembly Resolution 01: AY 2026–2027 Calendar of Activities* (Public, Active Release v1).
  3. **`EACSC-2026-ACT-0001`**: *College of Engineering & Architecture Week 2026 Guidelines* (Public, Draft v1 awaiting review).
  4. **`EACSC-2026-FIN-0001`**: *First Semester Council Operational Budget & Liquidation Plan* (Restricted, Draft v1).
- Default Folders:
  - *"AY 2026–2027 Governance & Charters"*
  - *"Engineering Week 2026"*
  - *"Executive Resolutions & Memos"*
  - *"Financial Records (Restricted)"*

---

## 5. Public Home Lobby & Student Account Onboarding

### A. Public Home Lobby (`/` — Image 3 Inspired)
- **High-Tech Hero Section:** Futuristic CatSU CEA 2026 banner featuring the new metallic emblem, glowing red/slate aesthetic, and organizational title.
- **Three Statutory Transparency Stat Cards:**
  1. *Verified Council Documents*
  2. *Official Update Bulletins*
  3. *100% Cryptographic Integrity (SHA-256)*
- **Search & Filter Bar:** Instant keyword search and category badges.
- **Recent Public Releases Grid:** Cards with release dates, download links, and one-click SHA-256 inspection modal.

### B. Account Onboarding & Role Application
- **Create Account Page (`/signup`):** Simple, student-friendly sign-up form with Name, Student ID (`2024-XXXXX`), Degree Program, Email, and Password.
- **Account Hub (`/account` — Image 4 Inspired):** Clean profile view showing Student ID, Program, **`Email Verified`** badge, and the **"Apply for Council Role"** form.
- **President Approval Console:** Rafael Santos reviews pending applications with 1-click **"Approve Role"** or **"Decline"**.
- **Forgot Password Verification:** Confirmed integration with Supabase Auth (`resetPasswordForEmail` -> `/auth/update-password`).

---

## 6. Officer Operations Suite

- **Document Workspace (`/officer`):** Two-column layout with folders, `+ New Folder`, `+ Create Document`, automatic creator assignment, version notes, and reviewer return feedback callouts.
- **Review Queue (`/officer/reviews`):** Streamlined 6-point verification checklist with **"Verify All Standard Checks"** fast-check button, and clear **"Return to Draft"** feedback.
- **Release Panel (`/officer/releases`):** Tabs for *Pending Releases* and *Active Documents*, auto-filled metadata, and immediate/scheduled release controls.
- **Update Bulletin Compiler (`/officer/bulletins`):** 1-click date presets, candidate releases checklist, side-by-side live PDF preview, and cryptographic issuance.
- **Council Activity & Audit (`/officer/history`):** Dedicated chronological timeline of all council operations.

---

## 7. Automated Test Suite (`scripts/batch11-revalidation.mjs`)

Comprehensive 12-stage automated revalidation:
1. **Logo & Favicon Check:** Verifies `/eacsc-logo-2026.jpg` and `/eacsc-seal.png` are properly loaded.
2. **Visitor Navigation Guard:** Public/Observer sees only public pages (no officer links).
3. **Student Registration (`/signup`):** Registers a new student account; validates default status is Observer.
4. **Observer Access Gate:** Confirms Observer is blocked from `/officer/*`.
5. **Role Application Flow:** Observer applies for role; record appears in President's pending list.
6. **President Role Approval:** President approves; applicant is granted active officer role.
7. **Document & Folder Creation:** Officer creates a folder and document; creator is auto-assigned.
8. **Draft Upload & Submission:** File uploaded and submitted for review without permission error.
9. **Review Queue & Return Cycle:** Reviewer returns with comment; author sees feedback; author resubmits.
10. **President 6-Point Approval:** President records substantive approval.
11. **PIO Public Release:** PIO publishes version; confirms it is live on the Public Home Lobby.
12. **Bulletin Compilation & PDF Preservation:** Secretary compiles releases into an official PDF bulletin.

---

## 8. Post-Deployment Deliverable: Step-by-Step Officer User Guide

Upon deployment, a dedicated, plain-English **Self-Guided Tour & Training Guide** will be delivered detailing:
- What changed across every page.
- How to test each account by switching between roles.
- Instructions on how to cleanly delete old test accounts in the Supabase Studio dashboard when you are ready.
