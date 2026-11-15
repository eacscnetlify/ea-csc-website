# EA-CSC IIDGS — Human Pilot Testing Facilitator Script (CEAFest Scenario & Live Turnover)

**Portal URL:** `https://eacsc.netlify.app`  
**Duration:** ~90 minutes total (Part 1: ~55 mins | Part 2: ~35 mins)  
**Methodology Alignment:** ES 7 Engineering Management — Project Proposal (NA1 Revised V2), Objective 9 (Institutional Adoption, Pilot Evaluation & Handover)

---

## 1. Pilot Design Overview

This human pilot uses a **two-part realistic simulation** centered on **CEAFest** (CatSU College of Engineering & Architecture annual college-wide event):

- **Part 1 — CEAFest Operational Simulation (Acting Officers + Real President & Secretary):**  
  Your project team acts as the working committee officers (`Author`, `Custodian`, `Auditor/Reviewer`, `PRO/Publisher`), collaborating live with the **real EA-CSC President** (`Approver`) and **real EA-CSC Secretary** (`Custodian / Bulletin Compiler`) to plan, verify, publish, correct, and compile official CEAFest documents.
- **Part 2 — Real Governance Turnover & Handover (Outgoing Team → Incoming Real EA-CSC Officers):**  
  Your project team acts as the **Outgoing Officers** and the **real EA-CSC Officers** act as the **Incoming Officers**. Using `/officer/turnover` and `/officer/access`, the team executes an actual end-of-term turnover—transferring custody and active portal access into the hands of the real EA-CSC officers.

---

## 2. Pre-Session Setup Checklist (15 Minutes Before Start)

1. **Cast & Account Readiness:**
   - **Acting Team (Part 1 Working Officers / Part 2 Outgoing):**
     - Acting Author / Committee Chair (e.g., Events/Activities Chair) — `author`, `custodian`
     - Acting Executive Auditor — `reviewer`
     - Acting PRO (Publisher) — `publisher`, `author`
     - Technical Admin (Facilitator / Lead) — `technical_admin`, `custodian`
   - **Real EA-CSC Officers:**
     - **EA-CSC President** — `approver`, `reviewer`, `author`, `custodian`
     - **EA-CSC Executive Secretary** — `custodian`, `author`, `approver`, `reviewer`
     - **Incoming EA-CSC Officers (Part 2):** Must sign up via `/signup`, complete their profile, and have at least one active base role (e.g., `author` via President approval on `/account`) *before* Part 2 begins so they can be designated as Incoming Officers in Turnover packages.
2. **Devices:** Have at least one **Desktop (`1440px`)** and one **Mobile (`375px`)** device ready for responsive checks.
3. **Facilitator Rule:** Do **not** verbally tell participants which button to click unless they are completely blocked after trying `/help` or the **AI Assistant**; record any hesitation or assistance needed on the Observation Sheet (`02_OBSERVATION_AND_TIME_ON_TASK_SHEET.md`).

---

## 3. Part 1 Script — CEAFest Governance Simulation (~55 Minutes)

### Facilitator Opening (3 mins)
> *"Welcome to the EA-CSC IIDGS Pilot Test. Today we are simulating the full document lifecycle for **CEAFest**—covering seminars, booth installations, the 4-hour Amazing Race and academic contests (Quiz Bee, Robothon, Calculator Warrior), the closing ceremony/night party, and the event budget. Our goal is to test whether officers can process documents systematically without developer help. If you get stuck, use the **Help** button or the **AI Assistant** in the top bar first."*

### Scene 1: Document Folder & Multi-Class Creation (10 mins)
- **Acting Author / Committee Chair:**
  1. Log in and open **Document Workspace** (`/officer/workspace`).
  2. Create a folder: **`CEAFest 2026 Official Operations`**.
  3. Create the 5 core CEAFest records inside the folder:
     - **Doc A (`public`):** *CEAFest 2026 General Event & Night Party Plan* (Category: `Activities and CBO records`)
     - **Doc B (`public`):** *CEAFest 2026 Seminar & Ceremony Schedule* (Category: `Activities and CBO records`)
     - **Doc C (`public`):** *CEAFest 2026 Amazing Race & Academic Contests Guidelines* (Category: `Activities and CBO records`) — covering the 4-hour house banner race, 5-bottom-house flag-burning rule, sub-org station facilitators, and faculty-advised Quiz Bee, Robothon, and Calculator Warrior.
     - **Doc D (`public`):** *CEAFest 2026 Booth & Stall Installation Plan* (Category: `Forms and official information`)
     - **Doc E (`restricted`):** *CEAFest 2026 Master Budget & Financial Plan* (Category: `Financial archives`)
  4. Stage a valid `.pdf` (Version 1) for **Doc B (Seminar Schedule)**—*intentionally include a deliberate error* (e.g., wrong venue room or missing UTC+8 start time) to test the review gate.
  5. Stage a valid `.pdf` (Version 1) for **Doc C (Contests Guidelines)** and **Doc E (Budget Plan)**.
  6. Submit **Doc B (v1)** and **Doc C (v1)** for review.

### Scene 2: Review, Error-Catching & 6-Point Verification (12 mins)
- **Acting Auditor (`reviewer`) & Real EA-CSC President (`approver`):**
  1. Open **Review Queue** (`/officer/reviews`).
  2. Inspect **Doc B (Seminar Schedule v1)**, spot the intentional venue/time error, and click **Return for Correction** with a clear comment.
  3. **Acting Author:** Open Doc B in **Document Workspace**, update the draft notes / stage corrected file, and **Resubmit for Review**.
  4. **Real EA-CSC President:** Open **Doc B** and **Doc C** in **Review Queue**, complete all **6 Verification Checklist** items (`Identity & Version`, `Dates & Deadlines`, `Location / Link`, `Audience & Requirements`, `Authority Disclosure`, `Contact & Reference`), and **Approve** both.
  5. **Access Isolation Check (Quick Verification):** Confirm on a separate incognito/student browser that **Doc E (`restricted` Budget)** is **not** visible on the Public Library (`/`).

### Scene 3: Publication, Emergency Withdrawal & Republishing (10 mins)
- **Acting PRO (`publisher`):**
  1. Open **Release Panel** (`/officer/releases`).
  2. Publish **Doc B (Seminar Schedule v1)** and **Doc C (Contests Guidelines v1)** to the Public Library.
  3. **Simulated Schedule Change (Emergency Withdrawal):**
     > *"Facilitator Cue: A keynote speaker changed their seminar slot! Withdraw Doc B v1 immediately."*
     - PRO clicks **Withdraw Release** on Doc B v1 with a clear withdrawal reason.
     - Acting Author uploads **Doc B v2** with the updated speaker schedule → submits → President completes 6-point approval → PRO **Republishes Doc B v2** (verifying v1 is marked `Superseded`).

### Scene 4: Compiling & Updating the CEAFest Bulletin (10 mins)
- **Real EA-CSC Executive Secretary (`custodian`):**
  1. Open **Bulletin Compiler** (`/officer/bulletins`).
  2. Select the active public CEAFest releases (**Doc B v2** and **Doc C v1**) and compile **CEAFest Update Bulletin v1** (PDF generated with SHA-256).
  3. Verify the bulletin appears on **Update Bulletins** (`/bulletins`) and test downloading the PDF.
  4. *(Optional if time permits)* Issue a **v2 correction** of the bulletin to verify versioned bulletin supersession.

### Scene 5: Public Portal & Mobile Check (10 mins)
- **All Participants (on Mobile `375px` & Desktop `1440px`):**
  1. Open `/` (Public Library), search for `"CEAFest"`, open a record detail page (`/records/:recordId`), and test the download.
  2. Open **Help & Guide** (`/help`) and test the **AI Assistant** by asking a question about CEAFest document classifications or the 6-point checklist.
  3. Check **Activity & History** (`/officer/history`) to inspect the immutable audit trail of all CEAFest actions.

---

## 4. Part 2 Script — Live Turnover & Access Handover (~35 Minutes)

### Facilitator Transition Cue (2 mins)
> *"Part 1 is complete. Now we move to **Part 2: End-of-Term Turnover**. Your project team will act as the **Outgoing Officers** handing over CEAFest operations and portal custody to the **real EA-CSC Officers (Incoming)**."*

### Step 1: Outgoing Preparation & Inventory Freeze (10 mins)
- **Outgoing Officers (Acting Team):**
  1. Open **Turnover & Continuity** (`/officer/turnover`).
  2. Select the assigned council position and designate the **Incoming EA-CSC Officer**.
  3. Complete the Continuity Memo fields using the CEAFest simulation context:
     - *Ongoing Projects:* CEAFest 2026 seminar, contest, and booth preparations.
     - *Critical Deadlines:* Post-event liquidation, house point tallying, and night party clearance.
     - *Official Contacts & Operational Lessons:* Sub-org station facilitators & faculty contest advisers.
  4. Save the draft, then click **Confirm & Freeze Outgoing Inventory** (locks the record inventory snapshot).
  5. *(Optional)* Export the JSON / Print-to-PDF turnover memorandum for physical/archival filing.

### Step 2: Technical Admin Access Transfer (10 mins)
- **Technical Admin (`technical_admin`):**
  1. Open **Access Transfer** (`/officer/access`).
  2. Locate the confirmed/frozen turnover package.
  3. Execute **Transfer Position Role** — transferring the council position, functional roles, and active record assignments from the Outgoing Officer to the Incoming EA-CSC Officer (and deactivating the Outgoing Officer).

### Step 3: Incoming Officer Acknowledgment & Verification (10 mins)
- **Incoming Real EA-CSC Officers:**
  1. Log in (or click **Refresh** in the top bar) and open **My Account & Role** (`/account`) to confirm the new position and functional roles are active.
  2. Open **Document Workspace** (`/officer/workspace`) to verify they can now see and manage the transferred CEAFest records.
  3. Open **Turnover & Continuity** (`/officer/turnover`) and sign the **Incoming Officer Acknowledgment** (noting any exceptions if applicable).
  4. **Outgoing Acting Officer:** Verify they can no longer access `/officer/*` operations after deactivation.

### Step 4: Post-Pilot Survey & Debrief (5 mins)
- Distribute `03_PILOT_SURVEY_QUESTIONNAIRE.md` (or Google Form equivalent) to all participants immediately while impressions are fresh.
- Collect signatures on the **Pilot Completion & Handover Receipt** (`04_FINAL_EVALUATION_SUMMARY_TEMPLATE.md`).
