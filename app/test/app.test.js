'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { calcTrip } = require('../src/calc');
const { payPeriodOf } = require('../src/excel');
const { createApp } = require('../server');

const S = { mileage_rate: 0.76, max_shift_hours: 12, max_trip_miles: 100 };
const home = { is_home: 1 };
const court = { is_home: 0, verified: 1, one_way_miles: 9.4 };
const unverified = { is_home: 0, verified: 0, one_way_miles: 20 };
const T = (o) => ({ started_at: '2026-11-16T14:00:00Z', ended_at: '2026-11-16T16:30:00Z', drove: 1, round_trip: 1, odo_start: 1000, odo_end: 1019, ...o });

test('verified route pays standard miles, doubled for a round trip', () => {
  const c = calcTrip(T(), home, court, S);
  assert.deepEqual([c.hours, c.miles, c.mileage_amount, c.mileage_source, c.flags], [2.5, 18.8, 14.29, 'Standard route', '']);
});
test('passenger gets no mileage', () => assert.equal(calcTrip(T({ drove: 0 }), home, court, S).miles, 0));
test('unverified route falls back to odometer and is flagged', () => {
  const c = calcTrip(T(), home, unverified, S);
  assert.equal(c.miles, 19); assert.match(c.flags, /odometer used/);
});
test('odometer far from the standard route is flagged', () => assert.match(calcTrip(T({ odo_end: 1060 }), home, court, S).flags, /differs/));
test('long shift, other destination and overlap are flagged', () => {
  const c = calcTrip(T({ ended_at: '2026-11-17T04:00:00Z' }), home, null, S, [7]);
  assert.match(c.flags, /Long shift/); assert.match(c.flags, /not on the shared list/); assert.match(c.flags, /#7/);
});
test('pay period boundaries', () => {
  assert.equal(payPeriodOf('2026-11-15', '2026-11-02'), '2026-11-02');
  assert.equal(payPeriodOf('2026-11-16', '2026-11-02'), '2026-11-16');
  assert.equal(payPeriodOf('2026-10-30', '2026-11-02'), '2026-10-19');
});

let server, base, dir;
const as = (user) => async (url, body) => {
  const res = await fetch(base + url, {
    method: body ? 'POST' : 'GET', redirect: 'manual',
    headers: { 'x-dev-user': user, ...(body ? { 'content-type': 'application/x-www-form-urlencoded', origin: base } : {}) },
    body: body ? new URLSearchParams(body) : undefined,
  });
  return { status: res.status, text: await res.text(), res };
};
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shlc-'));
  const app = createApp({ AUTH_MODE: 'dev', ADMIN_EMAILS: 'admin@x.org', DATA_DIR: dir });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('full flow: start, stop, approve, lock, Excel backup', async () => {
  const admin = as('admin@x.org'), peer = as('jenna@x.org'), sup = as('sup@x.org'), other = as('erica@x.org');
  assert.equal((await peer('/')).status, 403, 'unknown accounts are refused');
  await admin('/admin/staff', { email: 'sup@x.org', name: 'Sup', role: 'supervisor' });
  await admin('/admin/staff', { email: 'jenna@x.org', name: 'Jenna Test', role: 'peer', supervisor_email: 'sup@x.org' });
  await admin('/admin/staff', { email: 'erica@x.org', name: 'Erica Test', role: 'peer', supervisor_email: 'someone-else@x.org' });
  assert.equal((await peer('/admin')).status, 403, 'peers cannot open admin');
  assert.equal((await peer('/export.xlsx')).status, 403, 'peers cannot export');

  const db = server._events.request.locals.db;
  const homeId = db.prepare('SELECT id FROM locations WHERE is_home = 1').get().id;
  const court = db.prepare("SELECT id FROM locations WHERE name LIKE 'Ohio County%'").get().id;
  assert.equal((await admin(`/admin/locations/${court}`, { one_way_miles: '', verified: '1', active: '1' })).res.headers.get('location').includes('Enter%20the%20measured'), true);
  await admin(`/admin/locations/${court}`, { one_way_miles: '9.4', verified: '1', active: '1' });

  const start = { activity: 'Court', from_location_id: homeId, to_location_id: court, purpose: 'Court hearing', drove: '1', odo_start: '1000' };
  assert.equal((await peer('/trips/start', { ...start, resident_ref: 'John Smith' })).status, 400, 'names are rejected');
  assert.equal((await peer('/trips/start', { ...start, resident_ref: 'R-12' })).status, 303);
  assert.match((await peer('/')).text, /Trip in progress/);
  const id = db.prepare("SELECT id FROM trips WHERE status = 'active'").get().id;
  assert.equal((await peer(`/trips/${id}/stop`, { odo_end: '990', round_trip: '1' })).status, 400, 'odometer cannot go backwards');
  assert.equal((await other(`/trips/${id}/stop`, { odo_end: '1019', round_trip: '1' })).status, 303);
  assert.equal(db.prepare('SELECT status FROM trips WHERE id = ?').get(id).status, 'active', 'another peer cannot stop my trip');
  await peer(`/trips/${id}/stop`, { odo_end: '1019', round_trip: '1' });
  const t = db.prepare('SELECT * FROM trips WHERE id = ?').get(id);
  assert.deepEqual([t.status, t.miles, t.mileage_amount], ['submitted', 18.8, 14.29]);

  assert.doesNotMatch((await other('/trips')).text, /Court hearing/, 'peers see only their own trips');
  await sup(`/review/${id}`, { decision: 'returned', comment: '' });
  assert.equal(db.prepare('SELECT status FROM trips WHERE id = ?').get(id).status, 'submitted', 'return needs a comment');
  await sup(`/review/${id}`, { decision: 'approved' });
  assert.equal(db.prepare('SELECT status FROM trips WHERE id = ?').get(id).status, 'approved');
  await peer(`/trips/${id}/resubmit`, { purpose: 'changed', odo_start: '1', odo_end: '999' });
  assert.equal(db.prepare('SELECT miles FROM trips WHERE id = ?').get(id).miles, 18.8, 'approved trips are locked');

  const cross = await fetch(`${base}/trips/start`, { method: 'POST', headers: { 'x-dev-user': 'jenna@x.org', origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
  assert.equal(cross.status, 403, 'cross-site posts are blocked');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(dir, 'backup', 'SHLC-Peer-Trips.xlsx'));
  const row = wb.getWorksheet('Trips').getRow(2);
  assert.equal(row.getCell(3).value, 'Jenna Test'); assert.equal(row.getCell(17).value, 18.8); assert.equal(row.getCell(22).value, 'approved');
  const sum = wb.getWorksheet('Payroll Summary').getRow(2);
  assert.equal(sum.getCell(5).value, 18.8); assert.equal(sum.getCell(6).value, 14.29);
  assert.equal((await sup('/export.xlsx')).status, 200);
});
