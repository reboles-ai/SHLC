'use strict';
const { fmtDate, fmtTime } = require('./excel');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const ACTIVITIES = ['Transport', 'Court', 'Appointment', 'Outreach', 'Group', 'Admin', 'Training'];
const CATEGORIES = ['SHLC Facility', 'Detention/Corrections', 'Hospital/ER', 'Court/Probation', 'Treatment/Recovery', 'DHHR Office', 'Pharmacy', 'Recovery/Community Meeting', 'Sober Living', 'Employer', 'Other'];
const STATUS_LABEL = { active: 'In progress', submitted: 'Awaiting approval', approved: 'Approved', returned: 'Returned - fix needed', denied: 'Denied' };

function layout(title, user, body, notice) {
  const nav = user ? `<nav>
    <a href="/">Trip</a><a href="/trips">My trips</a>
    ${user.role !== 'peer' ? '<a href="/review">Review</a><a href="/export">Excel</a>' : ''}
    ${user.role === 'admin' ? '<a href="/admin">Admin</a>' : ''}
  </nav>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f9f8f6"><link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/brand/icon-180.png"><link rel="icon" href="/brand/icon-192.png">
<title>${esc(title)} - SHLC Peer Trips</title><link rel="stylesheet" href="/style.css"></head><body>
<header><img class="emblem" src="/brand/emblem.png" alt="" width="480" height="254">
<img class="wordmark" src="/brand/wordmark.png" alt="Serenity Hills Life Center" width="720" height="219">
<p class="app">Peer Trips${user ? ` <span>&middot; ${esc(user.name)}</span>` : ''}</p></header>${nav}
<main>${notice ? `<p class="notice">${esc(notice)}</p>` : ''}${body}</main></body></html>`;
}

const message = (title, text) => layout(title, null, `<h1>${esc(title)}</h1><p>${esc(text)}</p>`);

function locOptions(locations, selected) {
  return locations.map((l) => `<option value="${l.id}"${l.id === selected ? ' selected' : ''}>${esc(l.name)}</option>`).join('');
}

function startForm(user, locations, error, v = {}) {
  const home = locations.find((l) => l.is_home);
  return layout('Start trip', user, `
<h1>Start a trip</h1>${error ? `<p class="error">${esc(error)}</p>` : ''}
<form method="post" action="/trips/start">
  <label>Activity<select name="activity" required>${ACTIVITIES.map((a) => `<option${a === v.activity ? ' selected' : ''}>${a}</option>`).join('')}</select></label>
  <label>Leaving from<select name="from_location_id" required>${locOptions(locations, Number(v.from_location_id) || home?.id)}</select></label>
  <label>Going to<select name="to_location_id" id="to" required>
    <option value="">Choose a destination</option>${locOptions(locations.filter((l) => !l.is_home), Number(v.to_location_id))}
    ${home ? `<option value="${home.id}"${Number(v.to_location_id) === home.id ? ' selected' : ''}>${esc(home.name)}</option>` : ''}
    <option value="other"${v.to_location_id === 'other' ? ' selected' : ''}>Other (not listed)</option></select></label>
  <label id="otherBox" hidden>Other destination: name and address<input name="to_other" maxlength="150" value="${esc(v.to_other)}"></label>
  <label>Resident ID or initials <small>Never a full name. Leave blank if no resident.</small>
    <input name="resident_ref" maxlength="12" pattern="[A-Za-z0-9\\-]{0,12}" autocomplete="off" value="${esc(v.resident_ref)}"></label>
  <label>Purpose <small>One short, factual sentence.</small><input name="purpose" maxlength="200" required value="${esc(v.purpose)}"></label>
  <fieldset><legend>Are you driving your own vehicle?</legend>
    <label class="radio"><input type="radio" name="drove" value="1" required${v.drove === '1' ? ' checked' : ''}> Yes, I am the driver</label>
    <label class="radio"><input type="radio" name="drove" value="0"${v.drove === '0' ? ' checked' : ''}> No</label></fieldset>
  <label id="odoBox">Odometer now<input name="odo_start" type="number" inputmode="decimal" min="0" step="0.1" value="${esc(v.odo_start)}"></label>
  <button class="go">Start trip</button>
</form>
<script>
const to=document.getElementById('to'),ob=document.getElementById('otherBox'),od=document.getElementById('odoBox');
function sync(){ob.hidden=to.value!=='other';ob.querySelector('input').required=to.value==='other';
const d=document.querySelector('input[name=drove]:checked');const on=d&&d.value==='1';od.hidden=!on;od.querySelector('input').required=on;}
document.addEventListener('change',sync);sync();
</script>`);
}

function activeTrip(user, t, error) {
  return layout('Trip in progress', user, `
<h1>Trip in progress</h1>${error ? `<p class="error">${esc(error)}</p>` : ''}
<div class="card"><div class="timer" id="timer" data-start="${esc(t.started_at)}">0:00:00</div>
<p><strong>${esc(t.from_name)}</strong> to <strong>${esc(t.to_name || `Other: ${t.to_other}`)}</strong></p>
<p>${esc(t.activity)}${t.resident_ref ? ` &middot; Resident ${esc(t.resident_ref)}` : ''}<br>${esc(t.purpose)}</p>
<p class="muted">Started ${esc(fmtTime(t.started_at))}${t.drove ? ` &middot; Odometer ${esc(t.odo_start)}` : ' &middot; Not driving'}</p></div>
<form method="post" action="/trips/${t.id}/stop">
  ${t.drove ? `<label>Odometer now<input name="odo_end" type="number" inputmode="decimal" min="${esc(t.odo_start)}" step="0.1" required></label>` : ''}
  <fieldset><legend>Did you return to where you started?</legend>
    <label class="radio"><input type="radio" name="round_trip" value="1" required> Yes, round trip</label>
    <label class="radio"><input type="radio" name="round_trip" value="0"> No, one way</label></fieldset>
  <label>Notes <small>Optional. No resident names.</small><input name="notes" maxlength="200"></label>
  <button class="stop">Stop trip and save</button>
</form>
<script>
const el=document.getElementById('timer'),s=new Date(el.dataset.start);
function tick(){const n=Math.max(0,Math.floor((Date.now()-s)/1000));
el.textContent=Math.floor(n/3600)+':'+String(Math.floor(n%3600/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
tick();setInterval(tick,1000);
</script>`);
}

function tripCard(t, extra = '') {
  return `<div class="card ${esc(t.status)}">
<div class="row"><strong>#${t.id} &middot; ${esc(fmtDate(t.started_at))}</strong><span class="pill">${esc(STATUS_LABEL[t.status])}</span></div>
${t.peer_name ? `<p><strong>${esc(t.peer_name)}</strong></p>` : ''}
<p>${esc(t.from_name)} to ${esc(t.to_name || `Other: ${t.to_other}`)}${t.round_trip ? ' (round trip)' : ''}</p>
<p>${esc(t.activity)}${t.resident_ref ? ` &middot; Resident ${esc(t.resident_ref)}` : ''}<br>${esc(t.purpose)}</p>
<p class="muted">${esc(fmtTime(t.started_at))} to ${esc(fmtTime(t.ended_at))} &middot; ${esc(t.hours)} hrs &middot; ${esc(t.miles)} mi (${esc(t.mileage_source)}) &middot; ${money(t.mileage_amount)}</p>
${t.drove ? `<p class="muted">Odometer ${esc(t.odo_start)} to ${esc(t.odo_end)}</p>` : ''}
${t.notes ? `<p class="muted">Notes: ${esc(t.notes)}</p>` : ''}
${t.flags ? `<p class="flag">${esc(t.flags)}</p>` : ''}
${t.approver_comment ? `<p class="muted">Supervisor: ${esc(t.approver_comment)}</p>` : ''}${extra}</div>`;
}

function myTrips(user, trips, notice) {
  const cards = trips.map((t) => tripCard(t, t.status === 'returned' ? `
<form method="post" action="/trips/${t.id}/resubmit" class="inline">
  ${t.drove ? `<label>Odometer start<input name="odo_start" type="number" step="0.1" min="0" value="${esc(t.odo_start)}" required></label>
  <label>Odometer end<input name="odo_end" type="number" step="0.1" min="0" value="${esc(t.odo_end)}" required></label>` : ''}
  <label>Purpose<input name="purpose" maxlength="200" value="${esc(t.purpose)}" required></label>
  <button>Fix and resubmit</button></form>` : '')).join('');
  return layout('My trips', user, `<h1>My trips</h1>${cards || '<p>No trips yet.</p>'}`, notice);
}

function review(user, trips, notice) {
  const cards = trips.map((t) => tripCard(t, `
<form method="post" action="/review/${t.id}" class="inline">
  <label>Comment <small>Required to return or deny.</small><input name="comment" maxlength="300"></label>
  <div class="row"><button name="decision" value="approved" class="go">Approve</button>
  <button name="decision" value="returned">Return</button>
  <button name="decision" value="denied" class="stop">Deny</button></div></form>`)).join('');
  return layout('Review', user, `<h1>Awaiting approval</h1>${cards || '<p>Nothing is waiting for you.</p>'}`, notice);
}

function exportPage(user, backupAt) {
  return layout('Excel', user, `<h1>Excel records</h1>
<p>A backup workbook is rewritten every time a trip is saved or approved.${backupAt ? ` Last updated ${esc(backupAt)}.` : ''}</p>
<p><a class="button" href="/export.xlsx">Download all trips</a></p>
<h2>Pay period download</h2>
<form method="get" action="/export.xlsx"><label>From<input type="date" name="from" required></label>
<label>To<input type="date" name="to" required></label><button>Download date range</button></form>`);
}

function admin(user, d, notice) {
  const staffRows = d.staff.map((s) => `<tr><td>${esc(s.name)}<br><small>${esc(s.email)}</small></td><td>${esc(s.role)}</td><td>${esc(s.supervisor_email || '')}</td>
<td><form method="post" action="/admin/staff/toggle"><input type="hidden" name="email" value="${esc(s.email)}"><button>${s.active ? 'Deactivate' : 'Activate'}</button></form></td></tr>`).join('');
  const locRows = d.locations.map((l) => `<form method="post" action="/admin/locations/${l.id}" class="card inline">
<strong>${esc(l.name)}</strong><small>${esc(l.category)} &middot; ${esc(l.address)}, ${esc(l.city)} ${esc(l.state)}</small>
${l.is_home ? '<small>Home facility</small>' : `<label>One-way miles from SHLC<input name="one_way_miles" type="number" step="0.1" min="0" value="${esc(l.one_way_miles)}"></label>
<label class="radio"><input type="checkbox" name="verified" value="1"${l.verified ? ' checked' : ''}> Mileage verified (used for pay)</label>`}
<label class="radio"><input type="checkbox" name="active" value="1"${l.active ? ' checked' : ''}> Active</label><button>Save</button></form>`).join('');
  return layout('Admin', user, `<h1>Admin</h1>
<h2>Settings</h2><form method="post" action="/admin/settings">
<label>Mileage rate ($ per mile)<input name="mileage_rate" type="number" step="0.001" min="0" value="${esc(d.settings.mileage_rate)}" required></label>
<label>Flag shifts longer than (hours)<input name="max_shift_hours" type="number" step="0.5" min="1" value="${esc(d.settings.max_shift_hours)}" required></label>
<label>Flag trips longer than (miles)<input name="max_trip_miles" type="number" step="1" min="1" value="${esc(d.settings.max_trip_miles)}" required></label>
<label>A pay period start date<input name="pay_period_start" type="date" value="${esc(d.settings.pay_period_start)}" required></label><button>Save settings</button></form>
<h2>Staff</h2><div class="scroll"><table><tr><th>Name</th><th>Role</th><th>Supervisor</th><th></th></tr>${staffRows}</table></div>
<form method="post" action="/admin/staff"><h3>Add or update a person</h3>
<label>SHLC Microsoft email<input name="email" type="email" required></label><label>Full name<input name="name" maxlength="80" required></label>
<label>Role<select name="role"><option value="peer">Peer</option><option value="supervisor">Supervisor</option><option value="admin">Admin</option></select></label>
<label>Supervisor's email <small>For peers.</small><input name="supervisor_email" type="email"></label><button>Save person</button></form>
<h2>Locations</h2>${locRows}
<form method="post" action="/admin/locations"><h3>Add a location</h3><label>Name<input name="name" maxlength="100" required></label>
<label>Category<select name="category">${CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select></label>
<label>Street address<input name="address" maxlength="120" required></label><label>City<input name="city" maxlength="60" required></label>
<label>State<select name="state"><option>WV</option><option>OH</option><option>PA</option></select></label><button>Add location</button></form>`, notice);
}

module.exports = { layout, message, startForm, activeTrip, myTrips, review, exportPage, admin, ACTIVITIES, CATEGORIES };
