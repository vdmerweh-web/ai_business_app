// Signed-in routes for Sites, Modules, CRM, forms, funnels and bookings.
import {db} from './db.js';
import {isAppAdmin} from './staffcfg.js';
import {getClient} from './clients.js';
import * as S from './sites.js';
import {copyPool, migrateCopy, pgConfigured} from './pgsites.js';
import {modulesFor, setModule, moduleOn, moduleById, major} from './modules.js';
import {validTz} from './timeutil.js';
import {storageFor} from './storage.js';
import {seoCheck} from './seo.js';

const err = (m, s = 400) => Object.assign(new Error(m), {status: s});
const clip = (v, n = 300) => String(v ?? '').trim().slice(0, n);
const F = S.F;

// Which client is this request about? Clients: always their own. Admins: ?clientId= or body.clientId, else their own.
export function clientIdFor(req) {
  if (isAppAdmin(req.user)) {
    const id = +(req.query.clientId || req.body?.clientId || 0);
    if (id) { if (!getClient(id)) throw err('No such client', 404); return id; }
  }
  if (!req.user.client_id) throw err('No client on this account', 403);
  return req.user.client_id;
}
async function poolFor(req, site, copy) {
  const row = S.copyRow(site.id, copy);
  if (!row) throw err('This copy is missing', 404);
  await migrateCopy(row);
  return copyPool(row);
}
const need = (site, mod) => { if (!moduleOn(site.client_id, mod)) throw err(`The ${moduleById(mod)?.name || mod} module is off. Switch it on under Modules.`, 403); };

export function sitesApiRoutes(r, {W}) {
  r.get('/sites', W(async (req, res) => {
    const admin = isAppAdmin(req.user);
    const rows = admin && !req.query.clientId ? db.prepare('select * from sites order by client_id, id').all() : S.sitesForClient(clientIdFor(req));
    const out = {sites: rows.map(s => S.sitePublic(s, req.user)), ready: pgConfigured(), isAdmin: admin};
    if (admin) out.clients = db.prepare('select id,name,slug,is_test,plan_id from clients order by is_test, name').all();
    res.json(out);
  }));
  r.post('/sites', W(async (req, res) => {
    const clientId = clientIdFor(req);
    const site = await S.createSite(req.user, clientId, {slug: req.body?.slug, name: req.body?.name});
    res.json(S.sitePublic(site, req.user));
  }));
  r.get('/sites/:id', W(async (req, res) => {
    const s = S.siteFor(req.user, req.params.id);
    res.json({
      ...S.sitePublic(s, req.user),
      spec: {test: F.readSpec(s.slug, 'test'), live: F.readSpec(s.slug, 'live')},
      blocks: {test: F.listBlocks(s.slug, 'test'), live: F.listBlocks(s.slug, 'live')},
      history: F.listHistory(s.slug, 'test').slice(0, 20),
      publishLog: db.prepare('select * from publish_requests where site_id=? order by id desc limit 20').all(s.id).map(S.publishPublic),
    });
  }));
  // Content edits only ever go to the TEST copy.
  r.put('/sites/:id/spec', W(async (req, res) => {
    const s = S.siteFor(req.user, req.params.id);
    F.writeSpec(s.slug, 'test', req.body?.spec);
    let built = true;
    await S.build(s, 'test').catch(() => { built = false; });
    res.json({ok: true, built});
  }));
  r.post('/sites/:id/build', W(async (req, res) => {
    const s = S.siteFor(req.user, req.params.id);
    const copy = S.copyOf(req.body?.copy);
    if (copy === 'live' && !isAppAdmin(req.user)) throw err('Only admins can rebuild live directly. Use Publish instead.', 403);
    res.json(await S.build(s, copy));
  }));
  r.post('/sites/:id/history/restore', W(async (req, res) => {
    const s = S.siteFor(req.user, req.params.id);
    F.restoreHistory(s.slug, 'test', clip(req.body?.file, 80));
    await S.build(s, 'test').catch(() => {});
    res.json({ok: true});
  }));
  r.post('/sites/:id/publish-requests', W(async (req, res) => {
    const s = S.siteFor(req.user, req.params.id);
    res.json(S.publishPublic(S.requestPublish(s, req.user, 'app', req.body?.note)));
  }));
  r.post('/sites/:id/publish-requests/:rid/approve', W(async (req, res) => {
    const s = S.siteFor(req.user, req.params.id);
    res.json(await S.approvePublish(s, req.user, req.params.rid));
  }));
  r.post('/sites/:id/publish-requests/:rid/cancel', W(async (req, res) => {
    const s = S.siteFor(req.user, req.params.id);
    db.prepare("update publish_requests set status='cancelled', done_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') where id=? and site_id=? and status='pending'").run(+req.params.rid, s.id);
    res.json({ok: true});
  }));
  r.post('/sites/:id/reset-test', W(async (req, res) => {
    const s = S.siteFor(req.user, req.params.id);
    res.json({ok: true, copied: await S.resetTest(s, {content: !!req.body?.content})});
  }));
  r.get('/sites/:id/isolation', W(async (req, res) => {
    if (!isAppAdmin(req.user)) throw err('Admins only', 403);
    res.json(await S.isolationCheck(S.siteFor(req.user, req.params.id)));
  }));
  r.get('/sites/:id/blocks/:name', W(async (req, res) => {
    const s = S.siteFor(req.user, req.params.id);
    res.json(F.readBlock(s.slug, S.copyOf(req.query.copy), req.params.name));
  }));
  r.put('/sites/:id/blocks/:name', W(async (req, res) => {
    const s = S.siteFor(req.user, req.params.id);
    const out = F.saveBlock(s.slug, req.params.name, req.body || {}, req.user.email);
    await S.build(s, 'test').catch(() => {});
    res.json(out);
  }));

  // Modules on/off per client
  r.get('/modules', W(async (req, res) => res.json(modulesFor(clientIdFor(req)))));
  r.put('/modules/:id', W(async (req, res) => {
    const cid = clientIdFor(req);
    setModule(cid, req.params.id, !!req.body?.enabled);
    res.json(modulesFor(cid));
  }));
  // A new major version: the client accepts it after trying it on test.
  r.post('/modules/:id/accept-update', W(async (req, res) => {
    const cid = clientIdFor(req);
    const m = moduleById(req.params.id);
    if (!m) throw err('No such module', 404);
    db.prepare('update client_modules set pinned_major=? where client_id=? and module_id=?').run(major(m.version), cid, m.id);
    res.json(modulesFor(cid));
  }));

  // CRM (per site copy)
  r.get('/sites/:id/crm', W(async (req, res) => {
    const s = S.siteFor(req.user, req.params.id); need(s, 'crm');
    const pool = await poolFor(req, s, S.copyOf(req.query.copy));
    const q = clip(req.query.q, 100);
    const contacts = (await pool.query(`select * from contacts where ($1 = '' or name ilike '%'||$1||'%' or email ilike '%'||$1||'%') order by id desc limit 200`, [q])).rows;
    const fields = (await pool.query('select * from field_defs order by id')).rows;
    const subs = (await pool.query('select id,contact_id,module,form_id,data,created_at from submissions order by id desc limit 50')).rows;
    res.json({contacts, fields, submissions: subs});
  }));
  r.post('/sites/:id/crm/contacts', W(async (req, res) => {
    const s = S.siteFor(req.user, req.params.id); need(s, 'crm');
    const pool = await poolFor(req, s, S.copyOf(req.body?.copy));
    const b = req.body || {};
    const row = (await pool.query("insert into contacts(name,email,phone,source,custom,notes) values($1,$2,$3,'added by hand',$4,$5) returning *", [clip(b.name, 120), clip(b.email, 200) || null, clip(b.phone, 40) || null, JSON.stringify(b.custom || {}), clip(b.notes, 2000) || null])).rows[0];
    res.json(row);
  }));
  r.put('/sites/:id/crm/contacts/:cid', W(async (req, res) => {
    const s = S.siteFor(req.user, req.params.id); need(s, 'crm');
    const pool = await poolFor(req, s, S.copyOf(req.body?.copy));
    const b = req.body || {};
    const custom = Object.fromEntries(Object.entries(b.custom || {}).slice(0, 50).map(([k, v]) => [clip(k, 40), clip(v, 500)]));
    const row = (await pool.query('update contacts set name=$2, email=$3, phone=$4, notes=$5, custom=$6 where id=$1 returning *', [+req.params.cid, clip(b.name, 120), clip(b.email, 200) || null, clip(b.phone, 40) || null, clip(b.notes, 2000) || null, JSON.stringify(custom)])).rows[0];
    if (!row) throw err('No such person', 404);
    res.json(row);
  }));
  // Client custom fields: they show up only for this client. The shared CRM never grows.
  r.post('/sites/:id/crm/fields', W(async (req, res) => {
    const s = S.siteFor(req.user, req.params.id); need(s, 'crm');
    const pool = await poolFor(req, s, S.copyOf(req.body?.copy));
    const label = clip(req.body?.label, 60);
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
    const type = ['text', 'number', 'date', 'choice', 'yesno'].includes(req.body?.type) ? req.body.type : 'text';
    if (!key) throw err('Give the field a name');
    const n = (await pool.query('select count(*)::int n from field_defs')).rows[0].n;
    if (n >= 30) throw err('You can have up to 30 extra fields');
    const options = type === 'choice' ? (Array.isArray(req.body?.options) ? req.body.options : String(req.body?.options || '').split(',')).map(o => clip(o, 60)).filter(Boolean).slice(0, 20) : [];
    const row = (await pool.query('insert into field_defs(key,label,type,options) values($1,$2,$3,$4) on conflict(key) do update set label=excluded.label, type=excluded.type, options=excluded.options returning *', [key, label, type, JSON.stringify(options)])).rows[0];
    res.json(row);
  }));
  // Forms and funnels settings (per copy; edit on test first)
  for (const kind of ['forms', 'funnels']) {
    const mod = kind === 'forms' ? 'contact-form' : 'funnel';
    r.get(`/sites/:id/${kind}`, W(async (req, res) => {
      const s = S.siteFor(req.user, req.params.id); need(s, mod);
      const pool = await poolFor(req, s, S.copyOf(req.query.copy));
      res.json((await pool.query(`select * from ${kind} order by id`)).rows);
    }));
    r.put(`/sites/:id/${kind}/:fid`, W(async (req, res) => {
      const s = S.siteFor(req.user, req.params.id); need(s, mod);
      const pool = await poolFor(req, s, S.copyOf(req.body?.copy));
      const fid = clip(req.params.fid, 40).toLowerCase();
      if (!/^[a-z0-9-]{1,40}$/.test(fid)) throw err('Bad name');
      const items = kind === 'forms' ? req.body?.fields : req.body?.steps;
      if (!Array.isArray(items) || !items.length || items.length > 20) throw err('Add 1 to 20 items');
      const clean = items.map(i => ({key: clip(i.key, 40).toLowerCase().replace(/[^a-z0-9_]/g, '_'), label: clip(i.label, 120), question: clip(i.question, 200), type: clip(i.type, 20) || 'text', required: !!i.required, options: Array.isArray(i.options) ? i.options.map(o => clip(o, 80)).slice(0, 12) : undefined}));
      const title = clip(req.body?.title, 120) || fid;
      const success = clip(req.body?.success_text, 300);
      if (kind === 'forms') await pool.query('insert into forms(id,title,fields,success_text,fallback_text) values($1,$2,$3,$4,$5) on conflict(id) do update set title=excluded.title, fields=excluded.fields, success_text=excluded.success_text, fallback_text=excluded.fallback_text, updated_at=now()', [fid, title, JSON.stringify(clean), success, clip(req.body?.fallback_text, 300)]);
      else await pool.query('insert into funnels(id,title,steps,success_text) values($1,$2,$3,$4) on conflict(id) do update set title=excluded.title, steps=excluded.steps, success_text=excluded.success_text, updated_at=now()', [fid, title, JSON.stringify(clean), success]);
      res.json({ok: true});
    }));
  }

  // Bookings settings
  r.get('/sites/:id/bookings', W(async (req, res) => {
    const s = S.siteFor(req.user, req.params.id); need(s, 'bookings');
    const pool = await poolFor(req, s, S.copyOf(req.query.copy));
    const st = (await pool.query('select mode,slot_minutes,hours,timezone,calendly_url,google_connected,outlook_connected from booking_settings where id=1')).rows[0] || null;
    const list = (await pool.query("select id,starts_at,ends_at,name,email,phone,note,status from bookings where starts_at > now() - interval '7 days' order by starts_at limit 100")).rows;
    res.json({settings: st, bookings: list});
  }));
  r.put('/sites/:id/bookings/settings', W(async (req, res) => {
    const s = S.siteFor(req.user, req.params.id); need(s, 'bookings');
    const pool = await poolFor(req, s, S.copyOf(req.body?.copy));
    const b = req.body || {};
    const mode = b.mode === 'calendly' ? 'calendly' : 'builtin';
    const url = clip(b.calendly_url, 200);
    if (mode === 'calendly' && !/^https:\/\/(www\.)?calendly\.com\/[A-Za-z0-9_\-/]+$/.test(url)) throw err('Please paste your Calendly link, like https://calendly.com/your-name/30min');
    const tz = validTz(b.timezone) ? b.timezone : 'Africa/Johannesburg';
    const slot = Math.max(10, Math.min(240, +b.slot_minutes || 30));
    const hours = {};
    for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
      hours[d] = (Array.isArray(b.hours?.[d]) ? b.hours[d] : []).slice(0, 3).filter(p => Array.isArray(p) && /^\d\d:\d\d$/.test(p[0]) && /^\d\d:\d\d$/.test(p[1]) && p[0] < p[1]).map(p => [p[0], p[1]]);
    }
    await pool.query(`insert into booking_settings(id,mode,slot_minutes,hours,timezone,calendly_url) values(1,$1,$2,$3,$4,$5)
      on conflict(id) do update set mode=excluded.mode, slot_minutes=excluded.slot_minutes, hours=excluded.hours, timezone=excluded.timezone, calendly_url=excluded.calendly_url, updated_at=now()`, [mode, slot, JSON.stringify(hours), tz, url || null]);
    res.json({ok: true});
  }));
  // Google / Outlook calendar links are stubbed: no OAuth apps exist yet.
  r.post('/sites/:id/bookings/connect/:provider', W(async (req, res) => {
    S.siteFor(req.user, req.params.id);
    const p = req.params.provider === 'outlook' ? 'Outlook' : 'Google Calendar';
    res.status(501).json({error: `Linking ${p} is not switched on yet. It needs a sign-in app set up first. Until then, use the built-in calendar or a Calendly link.`});
  }));

  // Change requests: Bobby and clients ask for shared modules to change. An admin decides.
  r.get('/change-requests', W(async (req, res) => {
    const all = isAppAdmin(req.user) && !req.query.clientId;
    const rows = all
      ? db.prepare('select cr.*, c.name client_name from change_requests cr join clients c on c.id=cr.client_id order by cr.id desc limit 200').all()
      : db.prepare('select * from change_requests where client_id=? order by id desc limit 100').all(clientIdFor(req));
    res.json(rows);
  }));
  r.post('/change-requests', W(async (req, res) => {
    const cid = clientIdFor(req);
    const text = clip(req.body?.text, 2000);
    if (text.length < 5) throw err('Please say what you would like changed');
    const mod = moduleById(req.body?.module) ? req.body.module : null;
    res.json(db.prepare("insert into change_requests(client_id,module_id,text,requested_by,via) values(?,?,?,?,'app') returning *").get(cid, mod, text, req.user.email));
  }));
  r.put('/change-requests/:id', W(async (req, res) => {
    if (!isAppAdmin(req.user)) throw err('Admins only', 403);
    const status = ['open', 'planned', 'done', 'declined'].includes(req.body?.status) ? req.body.status : 'open';
    db.prepare("update change_requests set status=?, note=?, decided_by=?, decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') where id=?").run(status, clip(req.body?.note, 1000), req.user.email, +req.params.id);
    res.json({ok: true});
  }));

  r.get('/sites/:id/seo', W(async (req, res) => {
    const s = S.siteFor(req.user, req.params.id);
    res.json(seoCheck(s.slug, S.copyOf(req.query.copy)));
  }));

  r.get('/storage', W(async (req, res) => res.json(await storageFor(clientIdFor(req)))));
  r.get('/mail-outbox', W(async (req, res) => {
    const all = isAppAdmin(req.user) && !req.query.clientId;
    const rows = all
      ? db.prepare('select * from mail_outbox order by id desc limit 100').all()
      : db.prepare('select * from mail_outbox where client_id=? order by id desc limit 100').all(clientIdFor(req));
    res.json(rows);
  }));
}
