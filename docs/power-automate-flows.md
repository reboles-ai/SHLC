# Power Automate Flows

Build all flows under a **service account** (e.g. `shlc-automation@…`) with Edit rights on the site, not a personal account. If the builder leaves, the flows keep running.

| # | Flow | Trigger | Outcome |
|---|---|---|---|
| 1 | Time Entry – Calculate & Flag | Item created/modified, Status = Submitted | Miles, $, flags; Status → Pending Approval |
| 2 | Time Entry – Supervisor Approval | Item modified, Status = Pending Approval | Approved / Returned / Denied; item locked |
| 3 | Payroll Export | Recurrence, biweekly | CSV in SharePoint + email to payroll |
| 4 | Location Request Review | Location Requests item created | Approved → new Locations row |

---

## Flow 1 — Time Entry: Calculate & Flag

**Trigger:** SharePoint – *When an item is created or modified* (Time Entries)

**Trigger condition** (Settings → Trigger conditions) — prevents loops:
```
@equals(triggerOutputs()?['body/Status/Value'], 'Submitted')
```

**Steps**

1. **Get items – Settings** → Initialize variables `varRate`, `varMaxHours`, `varMaxMiles` from rows `MileageRate`, `MaxShiftHours`, `MaxTripMiles`.
2. **Initialize** `varMiles` (Float, 0), `varSource` (String, `None`), `varFlags` (String, empty).
3. **Get items – Routes**, Filter Query (both directions, verified routes only):
   ```
   Verified eq 1 and ((FromLocation/Id eq @{StartLocation Id} and ToLocation/Id eq @{EndLocation Id}) or (FromLocation/Id eq @{EndLocation Id} and ToLocation/Id eq @{StartLocation Id}))
   ```
4. **Condition – Route found** `length(body('Get_items_Routes')?['value']) > 0`
   - **Yes:** `varMiles = OneWayMiles × if(RoundTrip, 2, 1)`; `varSource = Standard Route`
   - **No:** if OdometerStart and OdometerEnd are both filled → `varMiles = OdometerEnd − OdometerStart`; `varSource = Odometer`; append flag `No standard route – odometer used.` Otherwise append flag `No standard route and no odometer – miles set to 0.`
5. **Condition – Not driver** `DrovePersonalVehicle = No` → `varMiles = 0`, `varSource = None`.
6. **Flags**
   - Hours > `varMaxHours` → `Shift over limit.`
   - `varMiles` > `varMaxMiles` → `Trip over mileage limit.`
   - StartLocation or EndLocation Category = Other → `Non-standard location.`
   - **Overlap check:** Get items – Time Entries, filter:
     ```
     Peer/EMail eq '@{Peer Email}' and ID ne @{ID} and ClockIn lt '@{ClockOut}' and ClockOut gt '@{ClockIn}' and Status ne 'Denied'
     ```
     If any returned → `Overlaps another entry (ID x).`
7. **Update item** (Time Entries):
   - Title = `@{Peer DisplayName} – @{formatDateTime(WorkDate,'yyyy-MM-dd')}`
   - CalculatedMiles = `varMiles`
   - MileageSource = `varSource`
   - MileageAmount = `mul(varMiles, varRate)`
   - Flags = `varFlags`
   - Status = **Pending Approval**

---

## Flow 2 — Supervisor Approval

**Trigger:** *When an item is created or modified* (Time Entries)
**Trigger condition:**
```
@equals(triggerOutputs()?['body/Status/Value'], 'Pending Approval')
```

**Steps**

1. **Get items – Staff**, filter `Person/EMail eq '@{Peer Email}'` → supervisor email.
2. **Start and wait for an approval** — type *Approve/Reject – First to respond*, custom responses: **Approve**, **Return for correction**, **Deny**.
   - Title: `Time entry: @{Title}`
   - Details: Hours, Activity, Start → End, Miles, $ amount, **Flags (bold if not blank)**, Purpose.
   - Item link: entry URL.
3. **Switch on outcome**
   - **Approve** → Update item: Status = Approved, Approver, ApprovalDate = `utcNow()`, ApproverComments. Then **Stop sharing an item** + **Grant access** (Peer = Read) to lock the record.
   - **Return for correction** → Status = Returned, comments. Email peer with the comments and link. Peer fixes and sets Status = Submitted (re-runs Flow 1).
   - **Deny** → Status = Denied, comments. Email peer and cc Compliance.
4. **Escalation:** set the approval action *timeout* to `P2D`. On timeout, email supervisor + Compliance: `Time entry pending more than 2 business days.`

---

## Flow 3 — Payroll Export (biweekly)

**Trigger:** Recurrence — every **2 weeks**, Monday 6:00 AM, start date = first Monday after a pay period ends. Time zone: Eastern.

**Steps**

1. Get `PayPeriodStart` and `PayrollEmail` from Settings. Compute `periodStart` and `periodEnd` (14 days).
2. **Get items – Time Entries**, filter:
   ```
   Status eq 'Approved' and Exported eq 0 and WorkDate ge '@{periodStart}' and WorkDate le '@{periodEnd}'
   ```
   Top count 5000, pagination on.
3. **Select** columns: EmployeeID (lookup from Staff), Peer, WorkDate, ClockIn, ClockOut, Hours, ActivityType, CalculatedMiles, MileageAmount, Approver, ApprovalDate.
4. **Create CSV table** → **Create file** in `Shared Documents/Payroll Exports/` named `SHLC-Peer-Time-@{periodStart}.csv`.
5. **Send email** to PayrollEmail with the file attached and totals (hours, miles, $) in the body.
6. **Apply to each** item → Update item: Exported = Yes, PayPeriod = `periodStart`.
7. Update Settings `PayPeriodStart` = next period start.
8. Any approved entries for the period still **Pending Approval** → email supervisors: `Missed payroll cutoff – will roll to next period.`

---

## Flow 4 — Location Request Review

**Trigger:** *When an item is created* (Location Requests)

**Steps**

1. **Start and wait for an approval** → TrackerAdminEmail. Details: name, address, category, reason, requester.
2. **Approved** → Get the highest existing LocationID and increment it. **Create item** in Locations (Active = Yes). Update request Decision = Approved. Email requester. Remind admin: **add the Routes row with verified miles**.
3. **Denied** → Decision = Denied, email requester with comments.

---

## Testing checklist (before go-live)

| # | Test | Expected |
|---|---|---|
| 1 | Entry with standard route, driver, round trip | Miles = 2 × one-way, $ correct, no flags |
| 2 | Same route, passenger | Miles 0, source None |
| 3 | "Other" location with odometer | Source Odometer, flag Non-standard location |
| 4 | 13-hour shift | Flag Shift over limit |
| 5 | Two overlapping entries | Second entry flagged with first ID |
| 6 | Supervisor returns entry | Peer emailed, resubmit re-runs Flow 1 |
| 7 | Approved entry | Peer can no longer edit |
| 8 | Run Flow 3 manually | CSV correct, items marked Exported |
| 9 | Submit location request, approve | New Locations row, admin reminded to add route |
