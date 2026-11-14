# EA-CSC Adopted Standard Operating Procedure (SOP)

**System:** EA-CSC Institutional Information and Document Governance System (IIDGS)  
**Unit:** Engineering and Architecture College Student Council (EA-CSC), Catanduanes State University  
**Governance Basis:** EA-CSC Constitution and By-Laws; Republic Act No. 10173 (Data Privacy Act of 2012)

## 1. Purpose

This SOP governs the end-to-end lifecycle of official council records—capture, verification, approval, publication, supersession, emergency withdrawal, bulletin compilation, and officer-term turnover—to ensure institutional continuity and single-source-of-truth public releases.

## 2. Roles and Segregation of Duties

- **Author / Assigned Officer:** Creates Draft records (`EACSC-YYYY-CAT-NNNN`), uploads validated source attachments (`.pdf`, `.docx`, `.png`, `.jpg`/`.jpeg`, max 10 MB), updates version notes, and submits versions for review.
- **Reviewer / Approver (Non-Author):** Completes the mandatory six-point verification checklist (`Confirmed`, `Correction Required`, or `Not Applicable`) on submitted `For Review` versions. Cannot approve a version they authored. Returns incomplete or inaccurate submissions with actionable review comments.
- **Custodian / Publisher:** Publishes `Approved` versions to `Published` (immediately or with a scheduled `effective_from` timestamp), activates scheduled releases once `effective_from` arrives, publishes superseding versions, and executes emergency withdrawals with a public withdrawal notice.
- **Bulletin Compiler:** Compiles cutoff-pinned Update Bulletins (Public or Internal) from eligible verified releases, generates the PDF artifact, and issues/archives versioned bulletins (`v1`, `v2`, ...).
- **Outgoing / Incoming Administration Officers:** Prepare the end-of-term turnover package, transfer access eligibility to incoming officers, deactivate outgoing accounts, and record incoming acknowledgment.

## 3. Lifecycle & Immutability Rules

1. **Draft -> For Review -> Approved -> Published -> Superseded / Withdrawn**
2. **Optimistic Concurrency (`PT409`):** Concurrent edits against a stale `revision_counter` are rejected; reload the record before retrying.
3. **Immutable History:** `audit_events`, `review_comments`, `record_verification_checklists`, and `mutation_receipts` are append-only; deletions and retroactive overwrites are blocked at the database layer.
4. **Timezone Standard:** All operational timestamps and bulletin cutoffs use `Asia/Manila` (`UTC+08:00`).

## 4. Incident & Emergency Withdrawal Procedure

1. When an erroneous or superseded public release poses immediate harm or confusion, an authorized Custodian executes **Withdraw Release** in the Release Panel with a clear rationale.
2. Public file download immediately returns `404` and a public withdrawal notice is posted on the record detail page.
3. A corrected version must pass full Draft -> For Review (6-point checklist) -> Approved -> Published workflow before replacing the withdrawn release.
