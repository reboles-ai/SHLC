'use strict';

/**
 * Sign-in is handled by Azure App Service Authentication ("Easy Auth") with Microsoft Entra ID.
 * Azure authenticates the user before the request reaches this app and passes the signed-in
 * account in the X-MS-CLIENT-PRINCIPAL-NAME header. Azure strips that header from inbound
 * requests, so it cannot be forged as long as authentication is set to "Require authentication".
 *
 * AUTH_MODE=dev is for local testing only and is refused when running on Azure.
 */
function makeAuth(db, env) {
  const onAzure = Boolean(env.WEBSITE_SITE_NAME);
  const mode = env.AUTH_MODE || 'azure';
  if (mode === 'dev' && onAzure) throw new Error('AUTH_MODE=dev is not allowed on Azure.');
  const admins = new Set((env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));

  return function auth(req, res, next) {
    let email = '';
    if (mode === 'dev') {
      email = (req.headers['x-dev-user'] || env.DEV_USER || '').toLowerCase();
    } else {
      email = String(req.headers['x-ms-client-principal-name'] || '').toLowerCase();
    }
    if (!email) return res.status(401).send(req.app.locals.views.message('Sign-in required', 'Please sign in with your SHLC Microsoft account.'));

    let staff = db.prepare('SELECT * FROM staff WHERE email = ? AND active = 1').get(email);
    if (admins.has(email)) staff = { email, name: staff?.name || email, role: 'admin', supervisor_email: staff?.supervisor_email || null };
    if (!staff) {
      return res.status(403).send(req.app.locals.views.message('Not set up yet',
        `The account ${email} has not been added to the tracker. Ask the Compliance Officer to add you.`));
    }
    req.user = staff;
    next();
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (roles.includes(req.user.role)) return next();
    res.status(403).send(req.app.locals.views.message('Not allowed', 'Your account does not have access to this page.'));
  };
}

/** Blocks cross-site form posts: the Origin of any state-changing request must match this site. */
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  let ok = false;
  if (site) {
    ok = site === 'same-origin';
  } else if (origin) {
    try { ok = new URL(origin).host === req.headers.host; } catch { ok = false; }
  }
  if (!ok) return res.status(403).send('Request blocked.');
  next();
}

module.exports = { makeAuth, requireRole, sameOrigin };
