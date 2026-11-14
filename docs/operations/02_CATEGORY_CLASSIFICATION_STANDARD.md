# EA-CSC Category & Classification Standard

**System:** EA-CSC IIDGS  
**Effective:** Academic Year Turnover & Operational Pilot

## 1. Official Record Categories & ID Prefixes

Every master record receives a canonical identifier in the format `EACSC-YYYY-CODE-NNNN`:

| Category        | Code  | Typical Records                                                            | Default Sensitivity                                    |
| :-------------- | :---- | :------------------------------------------------------------------------- | :----------------------------------------------------- |
| **Governance**  | `GOV` | Constitutions, resolutions, council directives, organizational policies    | Public (unless marked Restricted)                      |
| **Secretariat** | `SEC` | General assembly minutes, executive board minutes, official correspondence | Internal / Restricted by default                       |
| **Activities**  | `ACT` | Event guidelines, memoranda, competition mechanics, schedules              | Public                                                 |
| **Financial**   | `FIN` | Audited financial statements, liquidation reports, budget allocations      | Restricted during review; Public summary upon approval |
| **Forms**       | `FRM` | Official student council templates, accreditation forms, request slips     | Public                                                 |
| **Turnover**    | `TRN` | End-of-term handover inventories, asset ledgers, transition briefs         | Restricted / Internal                                  |

## 2. Audience & Access Classifications

- **Public:** Visible in the Public Library (`/`) and Record Detail (`/records/:recordId`) once `Published` and `activated_at` is set (`effective_from <= now`). Downloadable via `ea-csc-public-download`.
- **Internal / Restricted:** Accessible only to active authenticated officers holding an active assignment on the record (`record_assignments`). Denied to anonymous users, inactive accounts, and unassigned officers.
- **Update Bulletins:**
  - **Public Bulletins:** Listed on `/bulletins` and downloadable publicly.
  - **Internal Bulletins:** Accessible only to active authenticated officers via `ea-csc-bulletin-file` (`401` for anonymous requests).
