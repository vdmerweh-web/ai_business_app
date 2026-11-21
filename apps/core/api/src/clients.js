// Multi-tenant helpers. A user belongs to one client; queries must always filter by that client_id.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {db} from './db.js';
import {FEATURES, FEATURE_IDS, CLIENT_DEFAULTS, STAFF_DEFAULTS} from './features.js';
import {creditsFromLog, monthKey as logMonth} from './promptLog.js';
import {isAppAdmin} from './staffcfg.js';

const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';
const DEMO_EMAIL = 'amy@sunrisebakery.test';
const DEMO_SLUG = 'sunrise-bakery';

export function scryptHash(password, existing) {
  const parts = existing && existing.startsWith('scrypt$') ? existing.split('$') : null;
  const N = parts ? +parts[1] : 16384;
  const r = parts ? +parts[2] : 8;
  const p = parts ? +parts[3] : 1;
  const salt = parts ? Buffer.from(parts[4], 'base64url') : crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32, {N, r, p, maxmem: 64 * 1024 * 1024});
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function checkPassword(password, stored) {
  if (!stored || !password || !stored.startsWith('scrypt$')) return false;
  const next = scryptHash(password, stored);
  const a = Buffer.from(stored);
  const b = Buffer.from(next);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function monthKey(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit'}).formatToParts(d);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  return `${y}-${m}`;
}

export function getClient(id) {
  return db.prepare('select * from clients where id=?').get(id) || null;
}

export function featuresFor(clientId, user) {
  const rows = db.prepare('select feature_id, enabled from client_features where client_id=?').all(clientId);
  const map = new Map(rows.map(r => [r.feature_id, !!r.enabled]));
  const staff = user ? isAppAdmin(user) : false;
  return FEATURES.filter(f => map.get(f.id) && (!f.staffOnly || staff)).map(f => ({
    id: f.id,
    name: f.name,
    description: f.description,
    comingSoon: !!f.comingSoon,
    bot: f.bot || (f.id === 'bobby' ? null : undefined),
    staffOnly: !!f.staffOnly,
  }));
}

export function hasFeature(clientId, featureId, user) {
  const row = db.prepare('select enabled from client_features where client_id=? and feature_id=?').get(clientId, featureId);
  if (!(row && row.enabled)) return false;
  const f = FEATURES.find(x => x.id === featureId);
  if (f?.staffOnly && !isAppAdmin(user)) return false;
  return true;
}

export function requireFeature(featureId) {
  return (req, res, next) => {
    const f = FEATURES.find(x => x.id === featureId);
    if (f?.staffOnly && !isAppAdmin(req.user)) {
      return res.status(403).json({error: 'This part is only for the site admin'});
    }
    if (!req.user?.client_id || !hasFeature(req.user.client_id, featureId, req.user)) {
      return res.status(403).json({error: 'This part is not on for your account'});
    }
    next();
  };
}

export function setFeatures(clientId, ids) {
  const allowed = ids.filter(id => FEATURE_IDS.has(id));
  const tx = db.transaction(() => {
    db.prepare('delete from client_features where client_id=?').run(clientId);
    const ins = db.prepare('insert into client_features(client_id, feature_id, enabled) values(?,?,1)');
    for (const id of allowed) ins.run(clientId, id);
  });
  tx();
}

export function upsertClient({slug, name, domain, site_url, agent_name = 'Bobby', credit_allowance_zar = 100, zar_per_usd}) {
  const rate = zar_per_usd == null ? +(process.env.XAI_ZAR_PER_USD || 17.5) : +zar_per_usd;
  db.prepare(`
    insert into clients(slug, name, domain, site_url, agent_name, credit_allowance_zar, zar_per_usd)
    values(?,?,?,?,?,?,?)
    on conflict(slug) do update set
      name=excluded.name,
      domain=coalesce(excluded.domain, clients.domain),
      site_url=coalesce(excluded.site_url, clients.site_url),
      credit_allowance_zar=excluded.credit_allowance_zar,
      zar_per_usd=excluded.zar_per_usd
  `).run(slug, name, domain || null, site_url || null, agent_name, credit_allowance_zar, rate);
  return db.prepare('select * from clients where slug=?').get(slug);
}

export function creditsFor(client) {
  const month = monthKey();
  const row = creditsFromLog(client.id, month) || {};
  const allowance = +client.credit_allowance_zar || 100;
  const used = +row.used_zar || 0;
  return {
    month,
    usedZar: Math.round(used * 100) / 100,
    allowanceZar: allowance,
    remainingZar: Math.max(0, Math.round((allowance - used) * 100) / 100),
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    outputTokens: row.output_tokens,
    calls: row.calls,
    exhausted: used >= allowance - 0.001,
  };
}

export function clientPublic(client, user) {
  const features = featuresFor(client.id);
  const credits = creditsFor(client);
  return {
    id: client.id,
    slug: client.slug,
    name: client.name,
    domain: client.domain,
    siteUrl: client.site_url,
    agentName: client.agent_name || 'Bobby',
    features,
    credits,
    welcomeSeen: !!user.welcome_seen,
  };
}

function writeLoginFile(email, password, clientName) {
  const dir = BACKUP_DIR;
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
    const dest = path.join(dir, 'TEST_LOGIN.txt');
    const body = [
      'Test client login for https://app.codegreene.com',
      `Client: ${clientName}`,
      `Email: ${email}`,
      `Password: ${password}`,
      '',
      'This file is only on the server. Do not copy it into the web app or git.',
      '',
    ].join('\n');
    fs.writeFileSync(dest, body, {mode: 0o600});
    try { fs.chmodSync(dest, 0o600); } catch {}
    console.log('test login file written to', dest, '(email only:', email + ')');
  } catch (e) {
    console.error('could not write test login file:', e.message);
  }
}

export function seedTenants() {
  const staff = upsertClient({
    slug: 'codegreene',
    name: 'Codegreene',
    domain: 'codegreene.com',
    site_url: 'https://app.codegreene.com',
  });
  setFeatures(staff.id, STAFF_DEFAULTS);
  db.prepare("update users set client_id=?, role='admin' where client_id is null or email like '%@codegreene.com'").run(staff.id);

  const demo = upsertClient({
    slug: DEMO_SLUG,
    name: 'Sunrise Bakery',
    domain: 'sunrisebakery.test',
    site_url: 'https://app.codegreene.com/preview/sunrise-bakery.html',
    agent_name: 'Bobby',
    credit_allowance_zar: 100,
  });
  setFeatures(demo.id, CLIENT_DEFAULTS);

  const passFile = path.join(BACKUP_DIR, '.demo-pass');
  let provided = null;
  try {
    if (fs.existsSync(passFile)) {
      const raw = fs.readFileSync(passFile, 'utf8').trim();
      if (raw) provided = raw;
    }
  } catch (e) {
    console.error('could not read demo pass file:', e.message);
  }
  const existing = db.prepare('select id, password_hash from users where email=?').get(DEMO_EMAIL);
  if (provided) {
    const hash = scryptHash(provided);
    if (!existing) {
      db.prepare(`
        insert into users(email, name, role, client_id, password_hash, welcome_seen)
        values(?, 'Amy from Sunrise Bakery', 'client', ?, ?, 0)
      `).run(DEMO_EMAIL, demo.id, hash);
    } else {
      db.prepare("update users set password_hash=?, client_id=?, role='client' where id=?").run(hash, demo.id, existing.id);
    }
    console.log('demo client password synced from pass file (email only:', DEMO_EMAIL + ')');
  } else if (!existing) {
    const password = crypto.randomBytes(15).toString('base64url');
    const hash = scryptHash(password);
    db.prepare(`
      insert into users(email, name, role, client_id, password_hash, welcome_seen)
      values(?, 'Amy from Sunrise Bakery', 'client', ?, ?, 0)
    `).run(DEMO_EMAIL, demo.id, hash);
    writeLoginFile(DEMO_EMAIL, password, 'Sunrise Bakery');
  } else if (!existing.password_hash) {
    const password = crypto.randomBytes(15).toString('base64url');
    db.prepare('update users set password_hash=?, client_id=?, role=? where id=?').run(scryptHash(password), demo.id, 'client', existing.id);
    writeLoginFile(DEMO_EMAIL, password, 'Sunrise Bakery');
  } else {
    db.prepare("update users set client_id=?, role='client' where id=?").run(demo.id, existing.id);
  }
}

export const DEMO = {email: DEMO_EMAIL, slug: DEMO_SLUG};
