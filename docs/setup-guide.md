# Setup Guide — Microsoft Lists + Power Automate

Estimated build time: **1–2 days** for one admin, plus 1 week of pilot.

## Prerequisites

| Item | Owner | Status |
|---|---|---|
| M365 licenses for all peers (Lists + Power Automate standard connectors included in Business Basic/Standard/E3) | IT / Admin | ☐ |
| SharePoint site: **SHLC Operations** | IT | ☐ |
| Service account for flows (`shlc-automation@…`) | IT | ☐ |
| SharePoint group **Tracker Approvers** (supervisors, compliance, admin) | IT | ☐ |
| SHLC mileage reimbursement rate | Finance | ☐ |
| Pay period anchor date | Payroll | ☐ |
| Top 15–25 peer destinations with addresses | Peer Lead | ☐ |

## Build steps

### Phase 1 — Lists (Day 1 morning)

1. Open **Microsoft Lists → + New list → From CSV**. Upload the files in `lists/` in this order:
   `Settings.csv` → `Staff.csv` → `Locations.csv` → `Routes.csv` → `TimeEntries.csv` → `LocationRequests.csv`
2. Choose **SHLC Operations** as the save location for every list.
3. After import, fix column types per `docs/list-schemas.md`. CSV import creates text columns, so convert:
   - Choice, Yes/No, Number, Currency, Date, Person columns
   - Create **Lookup** columns (Routes → Locations; Time Entries → Locations)
   - Add the **Hours** calculated column
4. Add list validation and advanced permissions to **Time Entries** (see schema doc).
5. Delete the sample rows from `Time Entries` and `Location Requests`.

### Phase 2 — Reference data (Day 1 afternoon)

6. **Settings:** enter real values.
7. **Staff:** one row per peer with supervisor.
8. **Locations:** replace placeholders with real destinations.
9. **Routes:** for each common pair, measure the shortest driving route once, enter **one-way miles**, VerifiedBy, VerifiedDate.

### Phase 3 — Form (Day 1 afternoon)

10. Time Entries → **Edit form → Edit columns**: hide CalculatedMiles, MileageSource, MileageAmount, Flags, Approver, ApprovalDate, ApproverComments, PayPeriod, Exported.
11. Optional: **Integrate → Power Apps → Customize forms** to default Peer = current user and show Odometer fields only when a location is Other.

### Phase 4 — Flows (Day 2)

12. Sign in to Power Automate as the service account.
13. Build Flows 1–4 per `docs/power-automate-flows.md`.
14. Run the testing checklist.

### Phase 5 — Pilot & rollout

15. Pilot with 2 peers + 1 supervisor for 1 pay period.
16. Fix issues, then train all peers (15 min) using the SOP.
17. Peers install the **Microsoft Lists** mobile app and pin **Time Entries**.
18. Go live on the first day of a pay period. Retire paper/legacy logs that day.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Peers forget to submit (leave as Draft) | Daily 5 PM reminder flow to anyone with a Draft older than 24 hours (optional Flow 5) |
| Routes list incomplete at launch | Odometer fallback + Location Request process |
| Resident names entered in notes | Training + monthly Compliance audit of the Flagged view and a sample of entries |
| Flow owner leaves | Service account owns all flows; Compliance is co-owner |
| Supervisor backlog delays payroll | 2-day approval timeout escalation |
