# List Schemas

All lists live on one SharePoint site (recommended: **SHLC Operations**). Create them in this order — later lists look up earlier ones.

1. Settings
2. Staff
3. Locations
4. Routes
5. Time Entries
6. Location Requests

Column names below are the **internal names to use when creating**. Create without spaces first, then rename the display name if desired — flows reference internal names.

---

## 1. Settings

One row per setting. Flows read values from here.

| Column | Type | Notes |
|---|---|---|
| Title | Single line (default) | Setting key, e.g. `MileageRate` |
| Value | Single line | e.g. `0.00` |
| Notes | Multiple lines | What it controls |

**Required rows**

| Title | Example Value | Used by |
|---|---|---|
| MileageRate | 0.76 | Flow 1 |
| MaxShiftHours | 12 | Flow 1 flag |
| MaxTripMiles | 100 | Flow 1 flag |
| PayPeriodStart | 2026-11-02 | Flow 3 (anchor date for biweekly cycle) |
| PayrollEmail | *payroll mailbox* | Flow 3 |
| TrackerAdminEmail | *admin mailbox* | Flow 4 |

---

## 2. Staff

| Column | Type | Required | Notes |
|---|---|---|---|
| Title | Single line | Yes | Full name |
| Person | Person | Yes | M365 account |
| Supervisor | Person | Yes | Approver for Flow 2 |
| EmployeeID | Single line | Yes | Payroll ID |
| Role | Choice | Yes | Peer Recovery Specialist, Peer Lead, Other |
| Active | Yes/No | Yes | Default Yes |

---

## 3. Locations (shared destinations)

| Column | Type | Required | Notes |
|---|---|---|---|
| Title | Single line | Yes | Display name, e.g. `SHLC – Main Facility` |
| LocationID | Single line | Yes | Short code, e.g. `LOC-001`. Enforce unique values. |
| Category | Choice | Yes | SHLC Facility, Hospital/ER, Court/Probation, DHHR Office, Pharmacy, Recovery/Community Meeting, Sober Living, Employer, Other |
| Address | Multiple lines (plain) | Yes | Full street address |
| City | Single line | Yes | |
| State | Choice | Yes | WV, OH, PA |
| Active | Yes/No | Yes | Default Yes. Never delete — deactivate. |

---

## 4. Routes (approved standard mileage)

One row per location pair. Flow 1 checks both directions, so enter each pair **once**.

| Column | Type | Required | Notes |
|---|---|---|---|
| Title | Single line | Yes | Auto-label, e.g. `LOC-001 ↔ LOC-004` |
| FromLocation | Lookup → Locations (Title) | Yes | |
| ToLocation | Lookup → Locations (Title) | Yes | |
| OneWayMiles | Number (1 decimal) | Yes | Measured once by admin using a map's shortest driving route |
| VerifiedBy | Person | Yes | |
| VerifiedDate | Date | Yes | Re-verify annually |

---

## 5. Time Entries (main list)

| Column | Type | Required | Notes |
|---|---|---|---|
| Title | Single line | Auto | Flow sets to `Peer – Date` |
| Peer | Person | Yes | Default = current user (set in form) |
| WorkDate | Date only | Yes | |
| ClockIn | Date & time | Yes | |
| ClockOut | Date & time | Yes | |
| Hours | Calculated (Number, 2 dec) | — | `=ROUND(([ClockOut]-[ClockIn])*24,2)` |
| ActivityType | Choice | Yes | Transport, Court, Appointment, Outreach, Group, Admin, Training |
| StartLocation | Lookup → Locations (Title) | Yes | Filter to Active in form |
| EndLocation | Lookup → Locations (Title) | Yes | |
| RoundTrip | Yes/No | Yes | Default Yes |
| DrovePersonalVehicle | Yes/No | Yes | Only "Yes" earns mileage |
| OdometerStart | Number | No | Required only when a location is "Other" |
| OdometerEnd | Number | No | |
| ResidentRef | Single line | No | **ID or initials only. No names.** |
| Purpose | Multiple lines (plain) | Yes | Short, factual |
| CalculatedMiles | Number (1 dec) | — | Set by Flow 1. Hide from edit form. |
| MileageSource | Choice | — | Standard Route, Odometer, None. Set by Flow 1. |
| MileageAmount | Currency | — | Set by Flow 1 |
| Flags | Multiple lines (plain) | — | Set by Flow 1 |
| Status | Choice | Yes | Draft, Submitted, Pending Approval, Approved, Returned, Denied. Default Draft. |
| Approver | Person | — | Set by Flow 2 |
| ApprovalDate | Date & time | — | Set by Flow 2 |
| ApproverComments | Multiple lines | — | Set by Flow 2 |
| PayPeriod | Single line | — | Set by Flow 3, e.g. `2026-11-02` |
| Exported | Yes/No | — | Default No. Set by Flow 3. |

**List validation** (List settings → Validation settings):

```
=AND([ClockOut]>[ClockIn],([ClockOut]-[ClockIn])*24<=16,OR(ISBLANK([OdometerEnd]),[OdometerEnd]>=[OdometerStart]))
```

User message: `Clock Out must be after Clock In, shifts cannot exceed 16 hours, and ending odometer must be greater than starting odometer.`

**Permissions** (List settings → Advanced settings):
- Read access: **Read items that were created by the user**
- Create and Edit access: **Create items and edit items that were created by the user**
- Supervisors, Tracker Admin, Compliance get a SharePoint group with **Edit** on the list (they see all items).

**Views**

| View | Filter | Audience |
|---|---|---|
| My Entries | Peer = [Me] | Peers (default) |
| Pending My Approval | Status = Pending Approval | Supervisors |
| Flagged | Flags is not blank | Compliance |
| Current Pay Period | Status = Approved AND Exported = No | Payroll |

---

## 6. Location Requests

| Column | Type | Required | Notes |
|---|---|---|---|
| Title | Single line | Yes | Proposed location name |
| Address | Multiple lines | Yes | |
| City | Single line | Yes | |
| State | Choice | Yes | WV, OH, PA |
| Category | Choice | Yes | Same choices as Locations |
| Reason | Multiple lines | Yes | Why peers go here |
| RequestedBy | Person | Auto | Created By works |
| Decision | Choice | — | Pending, Approved, Denied. Default Pending. |
