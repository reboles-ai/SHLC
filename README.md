# SHLC Peer Time & Mileage Tracker

Peer work-hours and mileage tracking for Serenity Hills Life Center. This repo holds three versions:

| Version | Where | Status |
|---|---|---|
| **Phone app** (start/stop trips, supervisor approval, Excel backup) | `app/`, hosting steps in `docs/app-deployment.md` | Built and tested locally; not yet hosted |
| Excel workbook (interim) | `excel/` | Ready to use |
| Microsoft Lists + Power Automate design | `docs/`, `lists/` | Design only |

Run the app locally: `cd app && npm ci && npm run dev`, then open http://localhost:3000. Run tests: `npm test`.

The rest of this page describes the Microsoft Lists design.

## What's in this repo

| Path | Purpose |
|---|---|
| `docs/setup-guide.md` | Step-by-step build in Microsoft 365, in order |
| `docs/list-schemas.md` | Every list, column, type, and validation rule |
| `docs/power-automate-flows.md` | The 4 flows: calculate & flag, approval, payroll export, new location review |
| `docs/SOP-peer-time-mileage.md` | Staff-facing SOP for peers, supervisors, and payroll |
| `lists/*.csv` | Import templates — create each list "From CSV" in Microsoft Lists |

## System at a glance

```
Peer (Lists mobile app)
   │  submits Time Entry (locations picked from shared list)
   ▼
Flow 1 – Calculate & Flag ──► hours, standard miles, $ owed, review flags
   ▼
Flow 2 – Supervisor Approval ──► Approved (locked) / Returned
   ▼
Flow 3 – Payroll Export (biweekly) ──► CSV to SharePoint + email to payroll

"Other" destination ──► Location Request ──► Flow 4 – Admin review ──► added to shared Locations
```

## Key design decisions

- **Shared Locations + Routes lists** set one approved mileage per route. No map API, no GPS tracking on personal phones.
- **Only the driver** claims mileage.
- **No resident names** — resident ID or initials only (HIPAA minimum necessary).
- **Mileage rate lives in the Settings list**, not in flows, so finance can change it without editing automation.

## Owners

| Role | Responsibility |
|---|---|
| Compliance Officer | System owner, audits, policy |
| Tracker Admin | Locations, Routes, Staff, Settings lists |
| Supervisors | Approve/return entries within 2 business days |
| Payroll | Receives biweekly export |
