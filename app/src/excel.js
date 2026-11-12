'use strict';
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const TZ = 'America/New_York';
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: TZ }) : '');
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }) : '');
const localDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD

/** Start date (YYYY-MM-DD) of the 14-day pay period containing the given day. */
function payPeriodOf(day, anchor) {
  const d = Date.UTC(...day.split('-').map((n, i) => (i === 1 ? n - 1 : +n)));
  const a = Date.UTC(...anchor.split('-').map((n, i) => (i === 1 ? n - 1 : +n)));
  const idx = Math.floor((d - a) / (14 * 86400000));
  return new Date(a + idx * 14 * 86400000).toISOString().slice(0, 10);
}

function tripRows(db, from, to) {
  const rows = db.prepare(`
    SELECT t.*, s.name AS peer_name, lf.name AS from_name, lt.name AS to_name
    FROM trips t
    LEFT JOIN staff s ON s.email = t.peer_email
    LEFT JOIN locations lf ON lf.id = t.from_location_id
    LEFT JOIN locations lt ON lt.id = t.to_location_id
    WHERE t.status <> 'active'
    ORDER BY t.started_at`).all();
  return rows.filter((r) => {
    const day = localDay(r.started_at);
    return (!from || day >= from) && (!to || day <= to);
  });
}

async function buildWorkbook(db, settings, { from, to } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SHLC Peer Trip Tracker';
  wb.created = new Date();
  const rows = tripRows(db, from, to);

  const ws = wb.addWorksheet('Trips', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Trip #', key: 'id', width: 8 },
    { header: 'Pay Period Start', key: 'period', width: 14 },
    { header: 'Peer', key: 'peer', width: 22 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Start', key: 'start', width: 10 },
    { header: 'End', key: 'end', width: 10 },
    { header: 'Hours', key: 'hours', width: 8 },
    { header: 'Activity', key: 'activity', width: 14 },
    { header: 'From', key: 'from', width: 30 },
    { header: 'To', key: 'to', width: 34 },
    { header: 'Round Trip', key: 'rt', width: 10 },
    { header: 'Drove Own Vehicle', key: 'drove', width: 12 },
    { header: 'Odometer Start', key: 'o1', width: 12 },
    { header: 'Odometer End', key: 'o2', width: 12 },
    { header: 'Resident ID', key: 'res', width: 12 },
    { header: 'Purpose', key: 'purpose', width: 40 },
    { header: 'Miles', key: 'miles', width: 8 },
    { header: 'Mileage Source', key: 'src', width: 16 },
    { header: 'Rate', key: 'rate', width: 8 },
    { header: 'Mileage $', key: 'amt', width: 11 },
    { header: 'Flags', key: 'flags', width: 44 },
    { header: 'Status', key: 'status', width: 11 },
    { header: 'Approved By', key: 'approver', width: 26 },
    { header: 'Approved On', key: 'approved', width: 12 },
    { header: 'Supervisor Comment', key: 'comment', width: 30 },
    { header: 'Peer Notes', key: 'notes', width: 30 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  ws.getRow(1).alignment = { wrapText: true, vertical: 'middle' };

  const summary = new Map();
  for (const r of rows) {
    const period = payPeriodOf(localDay(r.started_at), settings.pay_period_start);
    const peer = r.peer_name || r.peer_email;
    ws.addRow({
      id: r.id, period, peer, date: fmtDate(r.started_at), start: fmtTime(r.started_at), end: fmtTime(r.ended_at),
      hours: r.hours, activity: r.activity, from: r.from_name, to: r.to_name || `Other: ${r.to_other || ''}`,
      rt: r.round_trip ? 'Yes' : 'No', drove: r.drove ? 'Yes' : 'No', o1: r.odo_start, o2: r.odo_end,
      res: r.resident_ref, purpose: r.purpose, miles: r.miles, src: r.mileage_source, rate: r.rate, amt: r.mileage_amount,
      flags: r.flags, status: r.status, approver: r.approver_email, approved: fmtDate(r.approved_at),
      comment: r.approver_comment, notes: r.notes,
    });
    const key = `${period}|${peer}`;
    const s = summary.get(key) || { period, peer, hours: 0, miles: 0, amt: 0, pending: 0, trips: 0 };
    if (r.status === 'approved') { s.hours += r.hours || 0; s.miles += r.miles || 0; s.amt += r.mileage_amount || 0; s.trips += 1; }
    if (r.status === 'submitted' || r.status === 'returned') s.pending += 1;
    summary.set(key, s);
  }
  ws.getColumn('amt').numFmt = '"$"#,##0.00';
  ws.getColumn('rate').numFmt = '"$"0.00';

  const ps = wb.addWorksheet('Payroll Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  ps.columns = [
    { header: 'Pay Period Start', key: 'period', width: 16 },
    { header: 'Peer', key: 'peer', width: 24 },
    { header: 'Approved Trips', key: 'trips', width: 14 },
    { header: 'Approved Hours', key: 'hours', width: 14 },
    { header: 'Approved Miles', key: 'miles', width: 14 },
    { header: 'Mileage $', key: 'amt', width: 12 },
    { header: 'Awaiting Approval', key: 'pending', width: 16 },
  ];
  ps.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ps.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  [...summary.values()].sort((a, b) => (a.period + a.peer).localeCompare(b.period + b.peer)).forEach((s) => {
    ps.addRow({ ...s, hours: Math.round(s.hours * 100) / 100, miles: Math.round(s.miles * 10) / 10, amt: Math.round(s.amt * 100) / 100 });
  });
  ps.getColumn('amt').numFmt = '"$"#,##0.00';
  ps.addRow([]);
  ps.addRow([`Only approved trips are counted. Generated ${new Date().toLocaleString('en-US', { timeZone: TZ })} Eastern.`]);
  return wb;
}

/**
 * Rewrites the backup workbook on the server and, when SharePoint settings are present,
 * uploads the same file to the configured SharePoint/OneDrive folder.
 * Never throws: a backup failure must not block a peer from saving a trip.
 */
async function writeBackup(db, settings, dataDir, env = process.env, log = console) {
  try {
    const wb = await buildWorkbook(db, settings);
    const dir = path.join(dataDir, 'backup');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'SHLC-Peer-Trips.xlsx');
    const tmp = `${file}.tmp`;
    await wb.xlsx.writeFile(tmp);
    fs.renameSync(tmp, file);
    if (env.GRAPH_TENANT_ID && env.GRAPH_CLIENT_ID && env.GRAPH_CLIENT_SECRET && env.GRAPH_DRIVE_ID) {
      await uploadToSharePoint(fs.readFileSync(file), env);
    }
    return file;
  } catch (err) {
    log.error('Backup failed:', err.message);
    return null;
  }
}

async function uploadToSharePoint(buffer, env) {
  const tokenRes = await fetch(`https://login.microsoftonline.com/${env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GRAPH_CLIENT_ID,
      client_secret: env.GRAPH_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!tokenRes.ok) throw new Error(`SharePoint sign-in failed (${tokenRes.status})`);
  const { access_token: token } = await tokenRes.json();
  const folder = (env.GRAPH_FOLDER_PATH || 'Peer Trip Tracker Backup').split('/').map(encodeURIComponent).join('/');
  const url = `https://graph.microsoft.com/v1.0/drives/${env.GRAPH_DRIVE_ID}/root:/${folder}/SHLC-Peer-Trips.xlsx:/content`;
  const up = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    body: buffer,
  });
  if (!up.ok) throw new Error(`SharePoint upload failed (${up.status})`);
}

module.exports = { buildWorkbook, writeBackup, payPeriodOf, localDay, fmtDate, fmtTime, TZ };
