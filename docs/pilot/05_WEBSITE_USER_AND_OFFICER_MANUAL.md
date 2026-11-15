# EA-CSC IIDGS Portal — Beginner-Friendly User & Officer Manual

**Website Address:** `https://eacsc.netlify.app`  
**Who This Manual Is For:**  
- **CEA Students & Visitors** looking for official announcements, guidelines, and bulletins.  
- **New EA-CSC Officers** (even if you have never used a document governance website before).

---

## 1. Getting Around the Website (The Screen Layout)

When you open `https://eacsc.netlify.app`, the screen has three main areas:

1. **Left Sidebar (Main Menu):**
   - **PUBLIC PORTAL** (Visible to everyone):
     - **Home** (`/`) — Search and download official published documents.
     - **Update Bulletins** (`/bulletins`) — View and download official compiled PDF gazettes/digests.
     - **Help & Guide** (`/help`) — Expandable accordion guide, rules, and real-world scenarios.
   - **OFFICER OPERATIONS** (Visible after you sign in):
     - **Document Workspace** (`/officer/workspace`) — Create folders, create documents, upload files, and submit them for review.
     - **Review Queue** (`/officer/reviews`) — Check submitted drafts, return drafts for correction, or complete 6-point approval.
     - **Release Panel** (`/officer/releases`) — Publish approved documents to the public or withdraw/republish them.
     - **Bulletin Compiler** (`/officer/bulletins`) — Bundle published documents into an official PDF Update Bulletin.
     - **Activity & History** (`/officer/history`) — Read-only timeline of every action ever taken on council records.
   - **CONTINUITY & ACCESS** (Visible after you sign in):
     - **Turnover & Continuity** (`/officer/turnover`) — Prepare end-of-term handover memos and sign acknowledgments.
     - **Access Transfer** (`/officer/access`) — Used by the Technical Admin to transfer positions and permissions to incoming officers.
     - **My Account & Role** (`/account`) — View your profile, apply for an officer role, or (for President) approve role requests.

2. **Top Header Bar (Top-Right Buttons):**
   - **Refresh** *(shown only when signed in)* — Reloads your permissions immediately after your role is approved or transferred.
   - **Home** — Jumps straight back to the Public Library (`/`).
   - **Help** — Opens the Help & Guide page (`/help`).
   - **Sign in / Sign out** — Logs you into your account or safely logs you out.
   - **AI Assistant** — Opens a side chat panel where you can ask questions about how the website works, define difficult words, or paste announcement text to summarize it.

3. **Main Content Area (Center):** Shows the page you selected.

---

## 2. Plain-English Guide to Roles, Statuses & Privacy Levels

### A. What the Roles Mean
Think of the website like an assembly line with **checks and balances** so no single person can accidentally publish a wrong document:
- **Student / Observer** — Default role after signing up. Can browse public documents and apply for an officer role.
- **Author** — Creates folders/documents, uploads PDF/DOCX/image drafts, and submits them for review.
- **Custodian** — Responsible for maintaining a record or compiling **Update Bulletins** (usually the Executive Secretary).
- **Reviewer (Auditor)** — Checks submitted drafts for accuracy and either **Returns for Correction** with a comment or passes them on.
- **Approver (President)** — Performs the **6-Point Verification Checklist** and grants official **Approval**. Also approves new officer role applications on `/account`.
- **Publisher (PRO)** — Takes **Approved** documents and publishes them to the Public Library (or withdraws them if an emergency error is found).
- **Technical Admin** — Executes end-of-term **Access Transfers** on `/officer/access`.

### B. What the 4 Document Statuses Mean
1. **`Draft`** — Work in progress. Only assigned officers can see it. You can still edit notes or upload a new file.
2. **`For Review`** — Locked for editing and waiting in the **Review Queue** for the Auditor/President.
3. **`Approved`** — Passed the **6-Point Verification Checklist**. Ready for the PRO to publish.
4. **`Superseded`** — An older version that has been replaced by a newer approved & published version (kept in history for transparency).

### C. What the 3 Privacy Levels Mean
- **`public`** (Green) — Safe for all students and visitors on the Home page once published.
- **`internal`** (Amber) — For EA-CSC officers only; never shown on the Public Library.
- **`restricted`** (Red) — Sensitive records (e.g., **Budget & Financial Plans**). Only officers explicitly granted restricted access can view them.

---

## 3. Part A — Guide for Students & New Sign-Ups

### How to Find and Download Official Documents (No Login Needed)
1. Go to `https://eacsc.netlify.app`.
2. Use the **Search** box or **Category** dropdown on the **Home** page to find a document (for example, type `"CEAFest"`).
3. Click the document title to open its details, verify its version and **SHA-256** integrity badge, and click **Download**.
4. To view bundled announcements, click **Update Bulletins** in the left menu.

### How to Create an Account & Request an Officer Role
1. Click **Sign in** at the top right, then click **Create an account** (`/signup`).
2. Fill in your **Full Name**, **Student ID**, **Degree Program**, **Email**, and **Password** (minimum 8 characters), then submit.
3. Log in at `/login`. You will start as a **Student Observer**.
4. If you are an EA-CSC officer, click **My Account & Role** (`/account`) in the left sidebar.
5. Under **Apply for Officer Role**, choose your **Council Position** and submit.
6. Wait for the **EA-CSC President** to approve your request. Once approved, click **Refresh** in the top-right bar to unlock your officer pages!

---

## 4. Part B — Step-by-Step Officer Playbooks (By Role)

### Playbook 1: Author / Committee Officer ("I need to upload and submit a document")
1. Click **Document Workspace** (`/officer/workspace`) in the left menu.
2. *(Optional)* Click **New Folder** to organize your event or committee files (e.g., `CEAFest 2026 Official Operations`).
3. Click **Create Document**, enter the **Title**, **Category**, **Document Type**, **Access Class** (`public`, `internal`, or `restricted`), and **Summary**, then click **Save**.
4. Open your new document and go to **Upload New Version**.
   - Choose your `.pdf`, `.docx`, `.jpg`, or `.png` file.
   - Enter clear **Version Notes** (e.g., *"v1: Initial CEAFest Seminar Schedule"*).
   - Choose Classification (`Initial capture` for v1; `Legitimate change` or `Preventable correction` for v2+).
   - Click **Upload Draft Version**.
5. Double-check your uploaded file, then click **Submit for Review**.
6. **If your document is returned for correction:** Open the document in **Document Workspace**, read the Reviewer's comment, update your **Draft Notes** (or upload a fixed file), and click **Submit for Review** again.

### Playbook 2: Auditor / Reviewer ("I need to check a submitted draft")
1. Click **Review Queue** (`/officer/reviews`) in the left menu.
2. Select the document marked **`For Review`**.
3. Click **Download / View File** and read it carefully (check dates, venue, time zone `UTC+8`, rules, and grammar).
4. **If something is missing or wrong:** Type a clear explanation in the comment box and click **Return for Correction**. It goes straight back to the Author as a `Draft`.

### Playbook 3: President / Approver ("I need to approve documents and officer accounts")
- **To approve a new officer's role application:**
  1. Click **My Account & Role** (`/account`).
  2. Scroll to **Pending Role Applications**, review the applicant's name and requested council position, and click **Approve** (or **Reject**).
- **To approve a document (`For Review`):**
  1. Click **Review Queue** (`/officer/reviews`).
  2. Open the submitted document and download the file to inspect it.
  3. Complete all **6-Point Verification Checklist** boxes:
     - *Identity & Version* (correct title and version number)
     - *Dates & Deadlines* (accurate dates and `UTC+8` times)
     - *Location / Link* (exact room, venue, or working URL)
     - *Audience & Requirements* (who it is for and what they need)
     - *Authority Disclosure* (clear approving council body)
     - *Contact & Reference* (valid email/office and reference number)
  4. Enter your Approval Basis/Reference and click **Approve Version**. Its status becomes **`Approved`**.

### Playbook 4: PRO / Publisher ("I need to publish, withdraw, or republish")
- **To publish an Approved document:**
  1. Click **Release Panel** (`/officer/releases`).
  2. Find the **`Approved`** version, enter the Public Title and Authorization Reference, and click **Publish Release**. It is now live on the Home page!
- **If an urgent error is discovered after publishing (Emergency Withdrawal):**
  1. In **Release Panel**, find the active release and click **Withdraw Release**.
  2. Enter the **Withdrawal Reason** and confirm. The file is immediately removed from public downloads, and a public withdrawal notice is recorded.
  3. Have the Author upload a corrected **v2**, get it **Approved** in Review Queue, and then click **Publish Release** on **v2**. Version 1 automatically becomes **`Superseded`**.

### Playbook 5: Executive Secretary / Custodian ("I need to compile an Update Bulletin")
1. Click **Bulletin Compiler** (`/officer/bulletins`).
2. Set the **Bulletin ID** (e.g., `EACSC-2026-BUL-0001`), **Title**, and **Coverage Dates**.
3. Check the boxes next to the **published releases** you want to bundle into this bulletin.
4. Click **Compile & Issue Bulletin**. The website automatically generates a tamper-evident PDF with a SHA-256 checksum and posts it to **Update Bulletins** (`/bulletins`).
5. If you need to correct a bulletin later, select **Issue Correction (v2)** referencing the prior bulletin issue.

### Playbook 6: End-of-Term Turnover & Access Transfer (Outgoing → Tech Admin → Incoming)
> **Before you start:** Make sure the **Incoming Officer** has already signed up and has at least one active role (e.g., `author` approved by the President on `/account`), and that the **Outgoing Officer** has assigned records under their `council_position`.

1. **Step 1 — Outgoing Officer (`/officer/turnover`):**
   - Fill out the **Turnover Package** (Term Covered, Incoming Officer, Ongoing Projects, Critical Deadlines, Official Contacts, Operational Lessons).
   - Click **Save Draft**, then click **Confirm & Freeze Outgoing Inventory**.
   - *(Optional)* Click **Export JSON** or **Print / Save PDF** for your physical turnover binder.
2. **Step 2 — Technical Admin (`/officer/access`):**
   - Open **Access Transfer**, select the frozen turnover package, and click **Transfer Position Role**.
   - This safely moves the position, functional roles, and record assignments to the Incoming Officer and deactivates the Outgoing Officer.
3. **Step 3 — Incoming Officer (`/officer/turnover`):**
   - Click **Refresh** in the top-right bar (or log back in).
   - Verify your new roles on **My Account & Role** (`/account`) and your records on **Document Workspace** (`/officer/workspace`).
   - Open **Turnover & Continuity** (`/officer/turnover`) and click **Sign Incoming Acknowledgment** to complete the handover.

---

## 5. Quick Troubleshooting ("What If Something Happens?")

- **"My roles changed, but I still don't see the new buttons."**  
  Click **Refresh** in the top-right header bar (or sign out and sign back in).
- **"I see a 'Conflict / Record changed' (409) message when saving."**  
  Another officer updated that same record while you had it open. Click **Reload** on the prompt to fetch the latest version before saving again—the system does this to prevent accidentally overwriting a teammate's work.
- **"My file upload was rejected."**  
  Only valid `.pdf`, `.docx`, `.jpg`, and `.png` files are accepted. Make sure the file is not corrupted or renamed from another format (for example, renaming a `.txt` file to `.pdf` will be blocked by the server's file check).
- **"I forgot my password."**  
  On the **Sign in** page (`/login`), click **Forgot password?** to receive a reset link.
- **"I'm still not sure what a button or term means."**  
  Click **AI Assistant** in the top-right corner and type your question in plain English (for example: *"What do I do if a draft is returned?"* or *"Define superseded"*), or open **Help & Guide** (`/help`).
