// Google sign-in for staff (OIDC code flow + PKCE + state + nonce).
// Email + password for client users. Session: random token in an httpOnly Secure SameSite=Lax cookie (cg_sid); only its SHA-256 hash is stored.
import crypto from 'crypto';
import {createRemoteJWKSet, jwtVerify} from 'jose';
import {db, now} from './db.js';
import {checkPassword, getClient, clientPublic} from './clients.js';

const H = t => crypto.createHash('sha256').update(t).digest('hex');
const b64u = b => b.toString('base64url');
const APP = process.env.APP_URL || 'https://app.codegreene.com';
const RED = process.env.GOOGLE_REDIRECT_URI || APP + '/auth/google/callback';
const GID = process.env.GOOGLE_CLIENT_ID || '', GSEC = process.env.GOOGLE_CLIENT_SECRET || '';
export const ALLOWED = new Set(String(process.env.ALLOWED_EMAILS || 'hannes@codegreene.com,josh@codegreene.com,mark@codegreene.com').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
// Dev-only mock login: refused unless APP_URL is localhost, so it can never switch on in production.
export const MOCK = process.env.DEV_MOCK_LOGIN === '1' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(APP);
if (process.env.DEV_MOCK_LOGIN === '1' && !MOCK) console.error('DEV_MOCK_LOGIN ignored: APP_URL is not localhost');
const COOKIE = 'cg_sid', DAYS = 7;
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export function newSession(res, uid) {
  const t = crypto.randomBytes(32).toString('hex');
  db.prepare('insert into sessions(token_hash,user_id,expires_at) values(?,?,?)').run(H(t), uid, now() + DAYS * 864e5);
  db.prepare(`update users set last_login_at=datetime('now') where id=?`).run(uid);
  res.cookie(COOKIE, t, {httpOnly: true, secure: !MOCK, sameSite: 'lax', maxAge: DAYS * 864e5, path: '/'});
}

function isStaffEmail(email) {
  return ALLOWED.has(String(email || '').toLowerCase());
}

export function sessionUser(req) {
  const t = req.cookies?.[COOKIE];
  if (!t || !/^[0-9a-f]{64}$/.test(t)) return null;
  const u = db.prepare('select u.*,s.token_hash from sessions s join users u on u.id=s.user_id where s.token_hash=? and s.expires_at>?').get(H(t), now());
  if (!u) return null;
  // Staff must stay on the allowlist. Client users sign in with a password hash instead.
  if (u.role === 'admin' || isStaffEmail(u.email)) {
    if (!isStaffEmail(u.email)) return null;
  } else if (!u.password_hash || !u.client_id) {
    return null;
  }
  return u;
}

export const gate = (req, res, next) => {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({error: 'Please sign in'});
  req.user = u;
  next();
};

const upsert = (email, p = {}) => {
  db.prepare(`insert into users(email,name,picture,google_sub) values(?,?,?,?) on conflict(email) do update set name=coalesce(excluded.name,name),picture=coalesce(excluded.picture,picture),google_sub=coalesce(excluded.google_sub,google_sub)`).run(email, p.name || null, p.picture || null, p.sub || null);
  const row = db.prepare('select id, client_id from users where email=?').get(email);
  if (!row.client_id) {
    const staff = db.prepare("select id from clients where slug='codegreene'").get();
    if (staff) db.prepare("update users set client_id=?, role='admin' where id=?").run(staff.id, row.id);
  }
  return row.id;
};

function meOut(u) {
  const client = u.client_id ? getClient(u.client_id) : null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    picture: u.picture,
    role: u.role,
    client: client ? clientPublic(client, u) : null,
  };
}

export function authRoutes(r, {loginLimit}) {
  r.get('/auth/config', (req, res) => res.json({google: !!(GID && GSEC), mock: MOCK, password: true}));
  const start = (req, res) => {
    if (!GID || !GSEC) return res.status(404).json({error: 'Google sign-in is not set up'});
    const state = b64u(crypto.randomBytes(24)), verifier = b64u(crypto.randomBytes(48)), nonce = b64u(crypto.randomBytes(16));
    db.prepare('delete from oauth_states where expires_at<?').run(now());
    db.prepare('insert into oauth_states values(?,?,?,?)').run(state, verifier, nonce, now() + 600e3);
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    Object.entries({
      client_id: GID, redirect_uri: RED, response_type: 'code', scope: 'openid email profile', state, nonce, prompt: 'select_account',
      code_challenge: b64u(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
    }).forEach(([k, v]) => u.searchParams.set(k, v));
    res.redirect(u.toString());
  };
  r.get('/auth/google/start', loginLimit, start);
  const callback = async (req, res) => {
    const fail = m => res.redirect(APP + '/login?error=' + encodeURIComponent(m));
    try {
      const {code, state} = req.query;
      if (!code || !state) return fail('Google sign-in was cancelled');
      const st = db.prepare('delete from oauth_states where state=? and expires_at>? returning *').get(String(state), now());
      if (!st) return fail('Sign-in expired, please try again');
      const tr = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', signal: AbortSignal.timeout(10e3),
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({code: String(code), client_id: GID, client_secret: GSEC, redirect_uri: RED, grant_type: 'authorization_code', code_verifier: st.verifier}),
      });
      const tok = await tr.json().catch(() => ({}));
      if (!tr.ok || !tok.id_token) return fail('Google sign-in failed');
      const {payload: p} = await jwtVerify(tok.id_token, JWKS, {issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: GID});
      if (p.nonce !== st.nonce) return fail('Sign-in check failed');
      if (p.email_verified !== true) return fail('Your Google email is not verified');
      const email = String(p.email || '').toLowerCase();
      if (!ALLOWED.has(email)) return fail(`${email} does not have access to this app`);
      newSession(res, upsert(email, p));
      res.redirect(APP + '/');
    } catch (e) {
      console.error('google callback', e.code || e.name);
      fail('Google sign-in failed');
    }
  };
  // Google may return to /auth/google/callback (default) or /api/auth/google/callback; nginx forwards both here.
  r.get('/auth/google/callback', loginLimit, callback);

  r.post('/auth/login', loginLimit, (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({error: 'Please enter your email and password'});
    if (password.length > 200) return res.status(400).json({error: 'Please enter your email and password'});
    const u = db.prepare('select * from users where email=?').get(email);
    // Same message whether the user exists or not, so we do not reveal accounts.
    if (!u || !u.password_hash || !u.client_id || !checkPassword(password, u.password_hash)) {
      return res.status(401).json({error: 'Email or password is not right'});
    }
    newSession(res, u.id);
    res.json({ok: 1});
  });

  if (MOCK) r.post('/auth/dev-login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const u = db.prepare('select * from users where email=?').get(email);
    if (ALLOWED.has(email)) {
      newSession(res, upsert(email, {name: email.split('@')[0]}));
      return res.json({ok: 1});
    }
    if (u && u.password_hash && u.client_id) {
      newSession(res, u.id);
      return res.json({ok: 1});
    }
    return res.status(403).json({error: 'Not on the allowlist'});
  });

  r.post('/auth/logout', (req, res) => {
    const t = req.cookies?.[COOKIE];
    if (t) db.prepare('delete from sessions where token_hash=?').run(H(String(t)));
    res.clearCookie(COOKIE, {path: '/'});
    res.json({ok: 1});
  });

  r.get('/me', (req, res) => {
    const u = sessionUser(req);
    if (!u) return res.status(401).json({error: 'Please sign in'});
    res.json(meOut(u));
  });
}
setInterval(() => {
  db.prepare('delete from sessions where expires_at<?').run(now());
  db.prepare('delete from oauth_states where expires_at<?').run(now());
}, 3600e3).unref();
