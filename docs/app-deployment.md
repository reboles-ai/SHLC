# SHLC Peer Trips App — Hosting Setup

The app in `app/` is a phone-friendly web app. Peers open it in their phone browser and add it to the home screen, where it behaves like an installed app.

**Status:** built and tested in a development environment. It has **not** yet been run on Azure. Treat the first deployment as a pilot.

## What you need

| Item | Notes |
|---|---|
| Azure subscription under SHLC's Microsoft tenant | Sign SHLC's HIPAA agreement coverage for Azure with Microsoft before storing real data |
| Someone with rights to create an App Service and an app registration | Usually the Microsoft 365 global admin |
| About 30 minutes | One time |

## Steps

### 1. Create the web app
1. Go to **portal.azure.com** → **Create a resource** → **Web App**.
2. Name: `shlc-peer-trips`. Publish: **Code**. Runtime: **Node 22 LTS**. Operating system: **Linux**. Region: **East US**.
3. Plan: **Basic B1** (always on, custom storage). Create.

### 2. Turn on Microsoft sign-in
1. Open the web app → **Authentication** → **Add identity provider** → **Microsoft**.
2. Tenant type: **Workforce**. Supported accounts: **Current tenant - single tenant**.
3. Restrict access: **Require authentication**. Unauthenticated requests: **HTTP 302 redirect**.
4. Save.

This is the app's only login. Do not skip it and do not choose "Allow unauthenticated access".

### 3. Settings
Web app → **Environment variables** → add:

| Name | Value |
|---|---|
| `ADMIN_EMAILS` | `compliance@serenityhillslifecenter.org` |
| `DATA_DIR` | `/home/data` |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `true` |
| `TZ` | `America/New_York` |

Web app → **Configuration** → **General settings**: HTTPS Only **On**, Minimum TLS **1.2**, Always On **On**, Startup command `npm start`.

### 4. Deploy the code
Web app → **Deployment Center** → Source **GitHub** → repository `reboles-ai/SHLC`, branch as directed. The app lives in the `app/` folder, so the generated workflow needs its working directory set to `app`. Ask Claude to adjust the workflow file once Azure has created it.

### 5. First sign-in
1. Open `https://shlc-peer-trips.azurewebsites.net` and sign in as the compliance account.
2. **Admin** → add the supervisor, then each peer with their SHLC email and supervisor's email.
3. **Admin** → Locations: enter measured one-way miles and tick **Mileage verified** for each destination.
4. Each peer opens the address on their phone, signs in, and uses **Add to Home Screen**.

### 6. Backups
- Web app → **Backups**: enable daily backups (covers `/home/data`, which holds the database and the Excel backup file).
- The Excel workbook is rewritten at `/home/data/backup/SHLC-Peer-Trips.xlsx` after every saved or approved trip, and can be downloaded from the **Excel** tab.

### 7. Optional: automatic copy of the Excel file to SharePoint
Not tested yet. Requires an app registration with the Microsoft Graph application permission `Sites.Selected` (or `Files.ReadWrite.All`) and admin consent, then these settings:

| Name | Value |
|---|---|
| `GRAPH_TENANT_ID` | Directory (tenant) ID |
| `GRAPH_CLIENT_ID` | Application (client) ID |
| `GRAPH_CLIENT_SECRET` | Client secret (store as a Key Vault reference) |
| `GRAPH_DRIVE_ID` | ID of the SharePoint document library |
| `GRAPH_FOLDER_PATH` | e.g. `Peer Trip Tracker Backup` |

## Pilot checklist

| # | Check | Pass |
|---|---|---|
| 1 | Signed-out visitor is sent to Microsoft sign-in | ☐ |
| 2 | An SHLC account not added in Admin sees "Not set up yet" | ☐ |
| 3 | Peer can start and stop a trip on a phone | ☐ |
| 4 | Peer cannot open Admin, Review or Excel | ☐ |
| 5 | Supervisor sees only their own peers' trips | ☐ |
| 6 | Approved trip cannot be changed by the peer | ☐ |
| 7 | Excel download matches the trips entered | ☐ |
| 8 | Data survives a web app restart | ☐ |

## Known limits

- Needs a phone signal to start and stop a trip. There is no offline mode.
- The timer is the time between Start and Stop. A peer who forgets to stop will be flagged as a long shift for the supervisor to correct by returning the trip.
- Mileage comes from verified standard routes or odometer readings. The app does not track GPS location.
- The database is a single file on the web app's storage, suitable for a small team. Keep the app at one instance.
