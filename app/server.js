'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const { open, getSettings, audit } = require('./src/db');
const { makeAuth, requireRole, sameOrigin } = require('./src/auth');
const { calcTrip } = require('./src/calc');
const { buildWorkbook, writeBackup, TZ } = require('./src/excel');
const views = require('./src/views');

const TRIP_SQL = `SELECT t.*, s.name AS peer_name, lf.name AS from_name, lt.name AS to_name
  FROM trips t LEFT JOIN staff s ON s.email = t.peer_email
  LEFT JOIN locations lf ON lf.id = t.from_location_id
  LEFT JOIN locations lt ON lt.id = t.to_location_id`;
const RESIDENT_RE = /^[A-Za-z0-9-]{0,12}$/;

function createApp(env = process.env) {
  const dataDir = env.DATA_DIR || path.join(__dirname, 'data');
  const db = open(dataDir);
  const app = express();
  app.locals.views = views;
  app.locals.db = db;
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Cache-Control': 'no-store',
      'Strict-Transport-Security': 'max-age=31536000',
    });
    next();
  });
  app.get('/healthz', (req, res) => res.send('ok'));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use(sameOrigin);
  app.use(makeAuth(db, env));

  const backup = () => writeBackup(db, getSettings(db), dataDir, env);
  const flash = (req) => (typeof req.query.m === 'string' ? req.query.m.slice(0, 120) : '');
  const done = (res, to, m) => res.redirect(303, `${to}?m=${encodeURIComponent(m)}`);
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const activeLocations = () => db.prepare('SELECT * FROM locations WHERE active = 1 ORDER BY is_home DESC, name').all();
  const activeTripOf = (email) => db.prepare(`${TRIP_SQL} WHERE t.peer_email = ? AND t.status = 'active'`).get(email);

  function recalc(tripId) {
    const t = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
    const loc = db.prepare('SELECT * FROM locations WHERE id = ?');
    const overlaps = db.prepare(`SELECT id FROM trips WHERE peer_email = ? AND id <> ? AND status NOT IN ('active','denied')
      AND started_at < ? AND ended_at > ?`).all(t.peer_email, t.id, t.ended_at, t.started_at).map((r) => r.id);
    const c = calcTrip(t, loc.get(t.from_location_id), t.to_location_id ? loc.get(t.to_location_id) : null, getSettings(db), overlaps);
    db.prepare(`UPDATE trips SET hours=@hours, miles=@miles, mileage_source=@mileage_source, rate=@rate,
      mileage_amount=@mileage_amount, flags=@flags WHERE id=@id`).run({ ...c, id: t.id });
  }

  // ---- Peer: start / stop / history -------------------------------------------------
  app.get('/', (req, res) => {
    const t = activeTripOf(req.user.email);
    res.send(t ? views.activeTrip(req.user, t) : views.startForm(req.user, activeLocations()));
  });

  app.post('/trips/start', (req, res) => {
    const b = req.body;
    const fail = (msg) => res.status(400).send(views.startForm(req.user, activeLocations(), msg, b));
    if (activeTripOf(req.user.email)) return res.redirect(303, '/');
    if (!views.ACTIVITIES.includes(b.activity)) return fail('Choose an activity.');
    const from = db.prepare('SELECT * FROM locations WHERE id = ? AND active = 1').get(Number(b.from_location_id));
    if (!from) return fail('Choose where you are leaving from.');
    let toId = null;
    let toOther = null;
    if (b.to_location_id === 'other') {
      toOther = String(b.to_other || '').trim().slice(0, 150);
      if (!toOther) return fail('Enter the name and address of the destination.');
    } else {
      const to = db.prepare('SELECT * FROM locations WHERE id = ? AND active = 1').get(Number(b.to_location_id));
      if (!to) return fail('Choose a destination.');
      if (to.id === from.id) return fail('Leaving from and going to cannot be the same place.');
      toId = to.id;
    }
    const resident = String(b.resident_ref || '').trim();
    if (!RESIDENT_RE.test(resident)) return fail('Resident ID or initials only: letters, numbers and dashes, no spaces, no names.');
    const purpose = String(b.purpose || '').trim().slice(0, 200);
    if (!purpose) return fail('Enter the purpose of the trip.');
    if (b.drove !== '1' && b.drove !== '0') return fail('Say whether you are driving your own vehicle.');
    const drove = b.drove === '1' ? 1 : 0;
    const odo = num(b.odo_start);
    if (drove && !(Number.isFinite(odo) && odo >= 0)) return fail('Enter your odometer reading.');

    const info = db.prepare(`INSERT INTO trips (peer_email, activity, from_location_id, to_location_id, to_other, resident_ref,
      purpose, drove, odo_start, started_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`)
      .run(req.user.email, b.activity, from.id, toId, toOther, resident || null, purpose, drove, drove ? odo : null, new Date().toISOString());
    audit(db, req.user.email, 'trip.start', info.lastInsertRowid);
    res.redirect(303, '/');
  });

  app.post('/trips/:id/stop', async (req, res) => {
    const t = activeTripOf(req.user.email);
    if (!t || t.id !== Number(req.params.id)) return res.redirect(303, '/');
    const fail = (msg) => res.status(400).send(views.activeTrip(req.user, t, msg));
    if (req.body.round_trip !== '1' && req.body.round_trip !== '0') return fail('Say whether this was a round trip.');
    const odoEnd = num(req.body.odo_end);
    if (t.drove && !(Number.isFinite(odoEnd) && odoEnd >= t.odo_start)) return fail('Odometer now must be the same as or higher than your starting odometer.');
    db.prepare(`UPDATE trips SET ended_at = ?, odo_end = ?, round_trip = ?, notes = ?, status = 'submitted' WHERE id = ?`)
      .run(new Date().toISOString(), t.drove ? odoEnd : null, req.body.round_trip === '1' ? 1 : 0, String(req.body.notes || '').trim().slice(0, 200) || null, t.id);
    recalc(t.id);
    audit(db, req.user.email, 'trip.stop', t.id);
    await backup();
    done(res, '/trips', 'Trip saved and sent to your supervisor.');
  });

  app.get('/trips', (req, res) => {
    const trips = db.prepare(`${TRIP_SQL} WHERE t.peer_email = ? AND t.status <> 'active' ORDER BY t.started_at DESC LIMIT 100`).all(req.user.email);
    res.send(views.myTrips(req.user, trips.map((t) => ({ ...t, peer_name: null })), flash(req)));
  });

  app.post('/trips/:id/resubmit', async (req, res) => {
    const t = db.prepare("SELECT * FROM trips WHERE id = ? AND peer_email = ? AND status = 'returned'").get(Number(req.params.id), req.user.email);
    if (!t) return done(res, '/trips', 'That trip cannot be changed.');
    const purpose = String(req.body.purpose || '').trim().slice(0, 200);
    const o1 = t.drove ? num(req.body.odo_start) : null;
    const o2 = t.drove ? num(req.body.odo_end) : null;
    if (!purpose || (t.drove && !(Number.isFinite(o1) && Number.isFinite(o2) && o1 >= 0 && o2 >= o1))) {
      return done(res, '/trips', 'Not saved: check the odometer readings and purpose.');
    }
    db.prepare("UPDATE trips SET purpose = ?, odo_start = ?, odo_end = ?, status = 'submitted' WHERE id = ?").run(purpose, o1, o2, t.id);
    recalc(t.id);
    audit(db, req.user.email, 'trip.resubmit', t.id, `odometer ${t.odo_start}-${t.odo_end} changed to ${o1}-${o2}`);
    await backup();
    done(res, '/trips', 'Trip resubmitted.');
  });

  // ---- Supervisor: review ------------------------------------------------------------
  const canReview = requireRole('supervisor', 'admin');
  const reviewable = (user) => (user.role === 'admin'
    ? db.prepare(`${TRIP_SQL} WHERE t.status = 'submitted' AND t.peer_email <> ? ORDER BY t.started_at`).all(user.email)
    : db.prepare(`${TRIP_SQL} WHERE t.status = 'submitted' AND s.supervisor_email = ? AND t.peer_email <> ? ORDER BY t.started_at`).all(user.email, user.email));

  app.get('/review', canReview, (req, res) => res.send(views.review(req.user, reviewable(req.user), flash(req))));

  app.post('/review/:id', canReview, async (req, res) => {
    const id = Number(req.params.id);
    const { decision } = req.body;
    const comment = String(req.body.comment || '').trim().slice(0, 300);
    if (!['approved', 'returned', 'denied'].includes(decision)) return done(res, '/review', 'Choose a decision.');
    if (!reviewable(req.user).some((t) => t.id === id)) return done(res, '/review', 'That trip is not waiting for your approval.');
    if (decision !== 'approved' && !comment) return done(res, '/review', 'A comment is required to return or deny a trip.');
    db.prepare('UPDATE trips SET status = ?, approver_email = ?, approved_at = ?, approver_comment = ? WHERE id = ?')
      .run(decision, req.user.email, new Date().toISOString(), comment || null, id);
    audit(db, req.user.email, `trip.${decision}`, id, comment);
    await backup();
    done(res, '/review', `Trip #${id} ${decision}.`);
  });

  // ---- Excel -------------------------------------------------------------------------
  app.get('/export', canReview, (req, res) => {
    const file = path.join(dataDir, 'backup', 'SHLC-Peer-Trips.xlsx');
    const at = fs.existsSync(file) ? fs.statSync(file).mtime.toLocaleString('en-US', { timeZone: TZ }) : '';
    res.send(views.exportPage(req.user, at));
  });

  app.get('/export.xlsx', canReview, async (req, res) => {
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const from = day.test(req.query.from) ? req.query.from : undefined;
    const to = day.test(req.query.to) ? req.query.to : undefined;
    const wb = await buildWorkbook(db, getSettings(db), { from, to });
    audit(db, req.user.email, 'export', null, `${from || 'all'} to ${to || 'all'}`);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="SHLC-Peer-Trips${from ? `-${from}-to-${to || 'now'}` : ''}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  });

  // ---- Admin -------------------------------------------------------------------------
  const isAdmin = requireRole('admin');
  app.get('/admin', isAdmin, (req, res) => res.send(views.admin(req.user, {
    settings: getSettings(db),
    staff: db.prepare('SELECT * FROM staff ORDER BY active DESC, name').all(),
    locations: db.prepare('SELECT * FROM locations ORDER BY is_home DESC, name').all(),
  }, flash(req))));

  app.post('/admin/settings', isAdmin, (req, res) => {
    const b = req.body;
    const vals = { mileage_rate: num(b.mileage_rate), max_shift_hours: num(b.max_shift_hours), max_trip_miles: num(b.max_trip_miles) };
    if (Object.values(vals).some((v) => !(Number.isFinite(v) && v >= 0)) || !/^\d{4}-\d{2}-\d{2}$/.test(b.pay_period_start)) {
      return done(res, '/admin', 'Settings not saved: check the values.');
    }
    const set = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
    for (const [k, v] of Object.entries({ ...vals, pay_period_start: b.pay_period_start })) set.run(String(v), k);
    audit(db, req.user.email, 'settings.update', null, JSON.stringify({ ...vals, pay_period_start: b.pay_period_start }));
    done(res, '/admin', 'Settings saved. New rates apply to trips saved from now on.');
  });

  app.post('/admin/staff', isAdmin, (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim().slice(0, 80);
    const role = req.body.role;
    const sup = String(req.body.supervisor_email || '').trim().toLowerCase() || null;
    if (!/^\S+@\S+\.\S+$/.test(email) || !name || !['peer', 'supervisor', 'admin'].includes(role)) return done(res, '/admin', 'Person not saved: check the email, name and role.');
    db.prepare(`INSERT INTO staff (email, name, role, supervisor_email, active) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(email) DO UPDATE SET name = excluded.name, role = excluded.role, supervisor_email = excluded.supervisor_email, active = 1`)
      .run(email, name, role, sup);
    audit(db, req.user.email, 'staff.save', null, `${email} ${role}`);
    done(res, '/admin', `${name} saved.`);
  });

  app.post('/admin/staff/toggle', isAdmin, (req, res) => {
    const email = String(req.body.email || '').toLowerCase();
    db.prepare('UPDATE staff SET active = 1 - active WHERE email = ?').run(email);
    audit(db, req.user.email, 'staff.toggle', null, email);
    done(res, '/admin', 'Staff updated.');
  });

  app.post('/admin/locations', isAdmin, (req, res) => {
    const b = req.body;
    const name = String(b.name || '').trim().slice(0, 100);
    if (!name || !views.CATEGORIES.includes(b.category) || !['WV', 'OH', 'PA'].includes(b.state)) return done(res, '/admin', 'Location not saved: check the fields.');
    if (db.prepare('SELECT 1 FROM locations WHERE name = ?').get(name)) return done(res, '/admin', 'A location with that name already exists.');
    db.prepare('INSERT INTO locations (name, category, address, city, state) VALUES (?, ?, ?, ?, ?)')
      .run(name, b.category, String(b.address || '').trim().slice(0, 120), String(b.city || '').trim().slice(0, 60), b.state);
    audit(db, req.user.email, 'location.add', null, name);
    done(res, '/admin', `${name} added. Enter its verified miles to use it for pay.`);
  });

  app.post('/admin/locations/:id', isAdmin, (req, res) => {
    const l = db.prepare('SELECT * FROM locations WHERE id = ?').get(Number(req.params.id));
    if (!l) return done(res, '/admin', 'Location not found.');
    const miles = l.is_home ? null : num(req.body.one_way_miles);
    const verified = !l.is_home && req.body.verified === '1' ? 1 : 0;
    if (miles != null && !(Number.isFinite(miles) && miles >= 0)) return done(res, '/admin', 'Miles must be a number.');
    if (verified && !(miles > 0)) return done(res, '/admin', 'Enter the measured miles before marking a location verified.');
    db.prepare('UPDATE locations SET one_way_miles = ?, verified = ?, active = ? WHERE id = ?').run(miles, verified, req.body.active === '1' || l.is_home ? 1 : 0, l.id);
    audit(db, req.user.email, 'location.update', null, `${l.name}: ${miles} mi, verified=${verified}`);
    done(res, '/admin', `${l.name} saved.`);
  });

  app.use((req, res) => res.status(404).send(views.message('Not found', 'That page does not exist.')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send(views.message('Something went wrong', 'Your entry may not have been saved. Go back and try again.'));
  });
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`SHLC Peer Trips listening on ${port}`));
}

module.exports = { createApp };
