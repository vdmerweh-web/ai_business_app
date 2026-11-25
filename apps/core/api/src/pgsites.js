// Per-site databases in Postgres. Each site has a live copy and a test copy.
// Each copy gets its own database AND its own login (role). The test login can
// never connect to the live database. The admin login is only used to create
// databases and logins; everyday reads and writes use the copy's own login.
import crypto from 'crypto';
import pg from 'pg';

const {Pool} = pg;
const HOST = process.env.PG_HOST || 'db';
const PORT = +(process.env.PG_PORT || 5432);
const ADMIN_USER = process.env.PG_ADMIN_USER || 'cg_admin';
const ADMIN_PASS = process.env.PG_ADMIN_PASSWORD || '';
const KEY_HEX = process.env.SITE_SECRET_KEY || '';

export const pgConfigured = () => !!(ADMIN_PASS && KEY_HEX.length >= 64);
const err = (m, s = 400) => Object.assign(new Error(m), {status: s});

function key() {
  if (KEY_HEX.length < 64) throw err('Site databases are not set up on this server yet.', 503);
  return Buffer.from(KEY_HEX.slice(0, 64), 'hex');
}
// AES-256-GCM for per-copy DB passwords (and later calendar tokens).
export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}
export function decrypt(blob) {
  const [v, iv, tag, enc] = String(blob).split('.');
  if (v !== 'v1') throw new Error('bad secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
}

let adminPool = null;
function admin() {
  if (!pgConfigured()) throw err('Site databases are not set up on this server yet.', 503);
  if (!adminPool) {
    adminPool = new Pool({host: HOST, port: PORT, user: ADMIN_USER, password: ADMIN_PASS, database: 'postgres', max: 2, idleTimeoutMillis: 10e3});
    adminPool.on('error', e => console.error('pg admin pool', e.code || e.message));
  }
  return adminPool;
}

const pools = new Map();
// A pool for one copy, logged in as that copy's own role. Small and closed when idle.
export function copyPool(copyRow) {
  const k = copyRow.db_name;
  let p = pools.get(k);
  if (!p) {
    p = new Pool({host: HOST, port: PORT, user: copyRow.db_user, password: decrypt(copyRow.db_pass_enc), database: copyRow.db_name, max: 2, idleTimeoutMillis: 15e3});
    p.on('error', e => console.error('site pool error', k, e.code || e.message));
    pools.set(k, p);
  }
  return p;
}
// Try to log in to a database with a copy's role (used to prove test cannot reach live).
export async function tryConnect(copyRow, dbName) {
  const c = new pg.Client({host: HOST, port: PORT, user: copyRow.db_user, password: decrypt(copyRow.db_pass_enc), database: dbName, connectionTimeoutMillis: 5000});
  try { await c.connect(); await c.query('select 1'); return true; } catch { return false; } finally { c.end().catch(() => {}); }
}

export const ident = s => {
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(s)) throw err('Bad database name');
  return '"' + s + '"';
};
export function namesFor(slug, copy) {
  const base = 'site_' + slug.replace(/-/g, '_').slice(0, 40) + '_' + copy;
  return {db_name: base, db_user: base + '_user'};
}

// Create the database and its own login. Safe to run again.
export async function provisionCopy({db_name, db_user}, password) {
  const a = admin();
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(password)) throw err('bad generated password');
  const role = await a.query('select 1 from pg_roles where rolname=$1', [db_user]);
  if (!role.rowCount) await a.query(`create role ${ident(db_user)} login password '${password}' nosuperuser nocreatedb nocreaterole noinherit connection limit 5`);
  else await a.query(`alter role ${ident(db_user)} with login password '${password}'`);
  const dbx = await a.query('select 1 from pg_database where datname=$1', [db_name]);
  if (!dbx.rowCount) await a.query(`create database ${ident(db_name)} owner ${ident(db_user)}`);
  // Nobody but the owner (and the admin) may connect.
  await a.query(`revoke all on database ${ident(db_name)} from public`);
  await a.query(`grant connect on database ${ident(db_name)} to ${ident(db_user)}`);
}

export async function dbSizeBytes(db_name) {
  try {
    const r = await admin().query('select pg_database_size($1)::bigint as n', [db_name]);
    return +r.rows[0].n;
  } catch { return 0; }
}

// Site data schema. Only adds tables (never drops), so it is safe to run on every start.
export const SITE_SCHEMA = `
create table if not exists meta(key text primary key, value text);
create table if not exists contacts(id serial primary key, name text, email text, phone text, source text, tags text[] not null default '{}', custom jsonb not null default '{}', notes text, created_at timestamptz not null default now());
create index if not exists contacts_email on contacts(lower(email));
create table if not exists field_defs(id serial primary key, key text unique not null, label text not null, type text not null default 'text', options jsonb not null default '[]', created_at timestamptz not null default now());
create table if not exists submissions(id serial primary key, contact_id int references contacts on delete set null, module text not null, form_id text, data jsonb not null default '{}', created_at timestamptz not null default now());
create table if not exists forms(id text primary key, title text not null, fields jsonb not null, success_text text, fallback_text text, updated_at timestamptz not null default now());
create table if not exists funnels(id text primary key, title text not null, steps jsonb not null, success_text text, updated_at timestamptz not null default now());
create table if not exists booking_settings(id int primary key default 1 check (id = 1), mode text not null default 'builtin', slot_minutes int not null default 30, hours jsonb not null default '{}', timezone text not null default 'Africa/Johannesburg', calendly_url text, google_connected boolean not null default false, outlook_connected boolean not null default false, oauth_token_enc text, updated_at timestamptz not null default now());
create table if not exists bookings(id serial primary key, contact_id int references contacts on delete set null, starts_at timestamptz not null, ends_at timestamptz not null, name text, email text, phone text, note text, status text not null default 'booked', created_at timestamptz not null default now());
create unique index if not exists bookings_slot on bookings(starts_at) where status = 'booked';
create table if not exists block_data(id serial primary key, block text not null, data jsonb not null default '{}', created_at timestamptz not null default now());
insert into meta(key, value) values ('schema', '1') on conflict (key) do nothing;
`;
const migrated = new Set();
export async function migrateCopy(copyRow) {
  if (migrated.has(copyRow.db_name)) return;
  await copyPool(copyRow).query(SITE_SCHEMA);
  migrated.add(copyRow.db_name);
}

const COPY_TABLES = ['field_defs', 'forms', 'funnels', 'booking_settings', 'contacts', 'submissions', 'bookings', 'block_data'];
const SERIAL = new Set(['field_defs', 'contacts', 'submissions', 'bookings', 'block_data']);
const JSONCOL = new Set(['custom', 'options', 'data', 'fields', 'steps', 'hours']);
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Keys whose values are personal (names, addresses, free text that may hold personal details).
const PERSONAL = /name|address|street|city|postal|zip|message|note|comment|id_?number|birth/i;
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;
function scrubValue(v) {
  if (typeof v === 'string') return v.replace(EMAIL, 'someone@example.test').replace(PHONE, '000 000 0000');
  if (Array.isArray(v)) return v.map(scrubValue);
  if (v && typeof v === 'object' && !(v instanceof Date)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'string' && x && PERSONAL.test(k) ? '[cleaned]' : scrubValue(x)]));
  return v;
}
// Clean one row so no real person's details reach the test copy.
export function scrubRow(table, row) {
  const r = {...row};
  if (table === 'contacts') {
    r.name = 'Test person ' + r.id; r.email = r.email ? `person${r.id}@example.test` : null; r.phone = r.phone ? '000 000 0000' : null;
    r.notes = r.notes ? '[cleaned]' : null; r.custom = scrubValue(r.custom || {});
  } else if (table === 'bookings') {
    r.name = 'Test person'; r.email = r.email ? 'someone@example.test' : null; r.phone = r.phone ? '000 000 0000' : null; r.note = r.note ? '[cleaned]' : null;
  } else if (table === 'submissions' || table === 'block_data') {
    r.data = scrubValue(r.data || {});
  } else if (table === 'booking_settings') {
    r.oauth_token_enc = null; r.google_connected = false; r.outlook_connected = false;
  }
  return r;
}
// Copy cleaned data from live to test. Reads use the LIVE login, writes use the TEST login.
// Data only ever flows live -> test.
export async function resetTestFromLive(liveRow, testRow) {
  if (liveRow.copy !== 'live' || testRow.copy !== 'test' || liveRow.site_id !== testRow.site_id) throw err('Reset only copies live to test of the same site');
  await migrateCopy(liveRow); await migrateCopy(testRow);
  const live = copyPool(liveRow);
  const data = {};
  for (const t of COPY_TABLES) data[t] = (await live.query(`select * from ${t} order by 1`)).rows.map(r => scrubRow(t, r));
  const c = await copyPool(testRow).connect();
  const counts = {};
  try {
    await c.query('begin');
    await c.query(`truncate ${[...COPY_TABLES].reverse().join(', ')} restart identity cascade`);
    for (const t of COPY_TABLES) {
      counts[t] = data[t].length;
      for (const row of data[t]) {
        const cols = Object.keys(row);
        const vals = cols.map(k => JSONCOL.has(k) && row[k] != null ? JSON.stringify(row[k]) : row[k]);
        await c.query(`insert into ${t}(${cols.map(x => '"' + x + '"').join(',')}) values(${cols.map((_, i) => '$' + (i + 1)).join(',')})`, vals);
      }
      if (SERIAL.has(t)) await c.query(`select setval(pg_get_serial_sequence('${t}','id'), greatest(coalesce((select max(id) from ${t}), 0), 1))`);
    }
    await c.query("insert into meta(key,value) values('last_reset_from_live', now()::text) on conflict(key) do update set value=excluded.value");
    await c.query('commit');
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { c.release(); }
  return counts;
}
