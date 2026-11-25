// Sites module: a site has a live copy and a test copy. Each copy has its own
// Postgres database and its own login. Content (pages, client blocks) lives on disk.
import crypto from 'crypto';
import {db} from './db.js';
import {isAppAdmin} from './staffcfg.js';
import {getClient} from './clients.js';
import {pgConfigured, encrypt, namesFor, provisionCopy, migrateCopy, copyPool, resetTestFromLive, tryConnect} from './pgsites.js';
import * as F from './sitefiles.js';
import {isReserved} from './hostnames.js';

const err = (m, s = 400) => Object.assign(new Error(m), {status: s});
const BUILDER = process.env.BUILDER_URL || 'http://builder:3700';
const APP = process.env.APP_URL || 'https://app.codegreene.com';

export const siteRow = id => db.prepare('select * from sites where id=?').get(+id) || null;
export const copyRow = (siteId, copy) => db.prepare('select * from site_copies where site_id=? and copy=?').get(siteId, copy) || null;
export const sitesForClient = clientId => db.prepare('select * from sites where client_id=? order by id').all(clientId);

// Who may use a site: admins (any site), or users of the client that owns it.
export function siteFor(user, id) {
  const s = siteRow(id);
  if (!s) throw err('No such site', 404);
  if (isAppAdmin(user) || (user.client_id && s.client_id === user.client_id)) return s;
  throw err('No such site', 404);
}

export function validSlug(raw) {
  const slug = String(raw || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) throw err('Use 3 to 40 small letters, numbers or dashes, like "sunny-bakery".');
  if (/-test$/.test(slug) || /--/.test(slug)) throw err('That name is not allowed. Please pick another one.');
  if (isReserved(slug)) throw err(`"${slug}" is already used by us. Please pick another name.`);
  if (db.prepare('select 1 from sites where slug=?').get(slug)) throw err(`"${slug}" is taken. Please pick another name.`);
  return slug;
}

async function seedCopyData(row, siteName) {
  const p = copyPool(row);
  await p.query(`insert into forms(id,title,fields,success_text,fallback_text) values('main','Contact us',$1,'Thank you! We will get back to you soon.','Our form is resting. Please email or phone us.') on conflict(id) do nothing`, [JSON.stringify([
    {key: 'name', label: 'Your name', type: 'text', required: true},
    {key: 'email', label: 'Your email', type: 'email', required: true},
    {key: 'phone', label: 'Your phone number', type: 'tel', required: false},
    {key: 'message', label: 'How can we help?', type: 'textarea', required: true},
  ])]);
  await p.query(`insert into funnels(id,title,steps,success_text) values('quote','Get a quote',$1,'Thanks! We will send your quote soon.') on conflict(id) do nothing`, [JSON.stringify([
    {key: 'need', question: 'What do you need help with?', type: 'choice', options: ['A new website', 'More customers', 'Something else']},
    {key: 'when', question: 'When do you want to start?', type: 'choice', options: ['This month', 'Next month', 'Just looking']},
    {key: 'name', question: 'What is your name?', type: 'text', required: true},
    {key: 'email', question: 'What is your email?', type: 'email', required: true},
  ])]);
  const hours = {mon: [['09:00', '17:00']], tue: [['09:00', '17:00']], wed: [['09:00', '17:00']], thu: [['09:00', '17:00']], fri: [['09:00', '13:00']], sat: [], sun: []};
  await p.query('insert into booking_settings(id,hours) values(1,$1) on conflict(id) do nothing', [JSON.stringify(hours)]);
  await p.query("insert into meta(key,value) values('site_name',$1) on conflict(key) do nothing", [siteName]);
}

export async function createSite(user, clientId, {slug, name}) {
  if (!pgConfigured()) throw err('Site databases are not set up on this server yet.', 503);
  const client = getClient(clientId);
  if (!client) throw err('No such client', 404);
  const plan = db.prepare('select * from plans where id=?').get(client.plan_id || 'base') || {max_sites: 1};
  const count = db.prepare('select count(*) n from sites where client_id=?').get(clientId).n;
  if (count >= plan.max_sites && !isAppAdmin(user)) throw err(`Your plan allows ${plan.max_sites} site(s). Ask us if you need more.`);
  slug = validSlug(slug);
  name = String(name || '').trim().slice(0, 80) || slug;
  const site = db.prepare('insert into sites(client_id,slug,name,created_by) values(?,?,?,?) returning *').get(clientId, slug, name, user?.id || null);
  for (const copy of ['live', 'test']) {
    const names = namesFor(slug, copy);
    const password = crypto.randomBytes(24).toString('base64url');
    db.prepare("insert into site_copies(site_id,copy,db_name,db_user,db_pass_enc,status) values(?,?,?,?,?,'creating')").run(site.id, copy, names.db_name, names.db_user, encrypt(password));
    await provisionCopy(names, password);
    const row = copyRow(site.id, copy);
    await migrateCopy(row);
    await seedCopyData(row, name);
    db.prepare("update site_copies set status='ready', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') where id=?").run(row.id);
    F.writeSpec(slug, copy, F.defaultSpec(name));
  }
  build(site, 'test').catch(() => {});
  build(site, 'live').catch(() => {});
  return site;
}

// Ask the builder container to build one copy with Astro.
export async function build(site, copy) {
  const row = copyRow(site.id, copy);
  db.prepare("update site_copies set build_status='building', build_error=null where id=?").run(row.id);
  try {
    const r = await fetch(BUILDER + '/build', {
      method: 'POST', signal: AbortSignal.timeout(240e3),
      headers: {'Content-Type': 'application/json', 'X-Builder-Token': process.env.BUILDER_TOKEN || ''},
      body: JSON.stringify({slug: site.slug, copy, appUrl: APP}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Build failed (' + r.status + ')');
    db.prepare("update site_copies set build_status='ok', build_error=null, built_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') where id=?").run(row.id);
    return j;
  } catch (e) {
    db.prepare("update site_copies set build_status='failed', build_error=? where id=?").run(String(e.message).slice(0, 500), row.id);
    throw err('The site build did not work: ' + e.message, 502);
  }
}

export function publishPublic(p) {
  return {id: p.id, status: p.status, via: p.via, note: p.note, needsAdmin: !!p.needs_admin, clientOk: !!p.client_ok_by, adminOk: !!p.admin_ok_by, createdAt: p.created_at, doneAt: p.done_at, error: p.error};
}

export function sitePublic(s, user) {
  const copies = db.prepare('select copy,status,build_status,build_error,built_at,db_name from site_copies where site_id=?').all(s.id);
  const client = getClient(s.client_id);
  const pend = db.prepare("select * from publish_requests where site_id=? and status='pending' order by id desc").all(s.id);
  return {
    id: s.id, slug: s.slug, name: s.name, clientId: s.client_id, clientName: client?.name, createdAt: s.created_at,
    liveUrl: `${APP}/s/${s.slug}/`, testUrl: `${APP}/s/${s.slug}/test/`,
    futureUrl: `https://${s.slug}.codegreene.com/`,
    copies: Object.fromEntries(copies.map(c => [c.copy, {status: c.status, build: c.build_status, buildError: c.build_error, builtAt: c.built_at, database: isAppAdmin(user) ? c.db_name : undefined}])),
    pendingPublish: pend.map(publishPublic),
    blocksChanged: F.blocksHash(s.slug, 'test') !== F.blocksHash(s.slug, 'live'),
  };
}

// Bobby or a person asks to publish test -> live. A change with client blocks also needs an admin OK.
export function requestPublish(site, user, via = 'app', note = '') {
  const needsAdmin = F.blocksHash(site.slug, 'test') !== F.blocksHash(site.slug, 'live') ? 1 : 0;
  const open = db.prepare("select * from publish_requests where site_id=? and status='pending'").get(site.id);
  if (open) {
    if (needsAdmin && !open.needs_admin) db.prepare('update publish_requests set needs_admin=1 where id=?').run(open.id);
    return db.prepare('select * from publish_requests where id=?').get(open.id);
  }
  return db.prepare('insert into publish_requests(site_id,requested_by,via,note,needs_admin) values(?,?,?,?,?) returning *')
    .get(site.id, user?.id || null, via, String(note || '').slice(0, 500), needsAdmin);
}

export async function approvePublish(site, user, reqId) {
  const p = db.prepare("select * from publish_requests where id=? and site_id=? and status='pending'").get(+reqId, site.id);
  if (!p) throw err('No open publish request', 404);
  // Re-check: if blocks changed since the request, an admin OK is needed.
  if (F.blocksHash(site.slug, 'test') !== F.blocksHash(site.slug, 'live') && !p.needs_admin) db.prepare('update publish_requests set needs_admin=1 where id=?').run(p.id);
  if (isAppAdmin(user)) db.prepare('update publish_requests set admin_ok_by=?, client_ok_by=coalesce(client_ok_by,?) where id=?').run(user.id, user.id, p.id);
  else if (user.client_id === site.client_id) db.prepare('update publish_requests set client_ok_by=? where id=?').run(user.id, p.id);
  else throw err('Not allowed', 403);
  const q = db.prepare('select * from publish_requests where id=?').get(p.id);
  if (!q.client_ok_by || (q.needs_admin && !q.admin_ok_by)) {
    return {done: false, request: publishPublic(q), message: q.needs_admin && !q.admin_ok_by ? 'Thanks. This change has a client block, so Hannes or Grid must also OK it before it goes live.' : 'Waiting for the client to OK it.'};
  }
  try {
    F.copyContentTestToLive(site.slug);
    await build(site, 'live');
    db.prepare("update publish_requests set status='done', done_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') where id=?").run(p.id);
  } catch (e) {
    db.prepare("update publish_requests set status='failed', error=? where id=?").run(String(e.message).slice(0, 500), p.id);
    throw e;
  }
  return {done: true, request: publishPublic(db.prepare('select * from publish_requests where id=?').get(p.id)), message: 'Done. The live copy now matches the test copy.'};
}

export async function resetTest(site, {content = false} = {}) {
  const live = copyRow(site.id, 'live'), test = copyRow(site.id, 'test');
  const counts = await resetTestFromLive(live, test);
  if (content) { F.copyContentLiveToTest(site.slug); await build(site, 'test').catch(() => {}); }
  return counts;
}

// Proof that test cannot touch live: try to log in to the live DB with the test login.
export async function isolationCheck(site) {
  const live = copyRow(site.id, 'live'), test = copyRow(site.id, 'test');
  return {
    testLoginOpensTest: await tryConnect(test, test.db_name),
    testLoginOpensLive: await tryConnect(test, live.db_name),
    liveLoginOpensTest: await tryConnect(live, test.db_name),
  };
}

export const copyOf = v => v === 'live' ? 'live' : 'test';
export {F};
