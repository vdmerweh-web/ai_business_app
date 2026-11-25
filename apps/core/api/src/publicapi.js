// Public endpoints used by the module tags on client sites (<pg-contact-form>, <pg-funnel>, <pg-booking>).
// No cookies, no sign-in. CORS is open because sites live on other addresses.
import rateLimit from 'express-rate-limit';
import {db} from './db.js';
import {copyRow} from './sites.js';
import {copyPool, migrateCopy} from './pgsites.js';
import {moduleOn, moduleById} from './modules.js';
import {tzParts, zonedToUtc} from './timeutil.js';
import {stubMail} from './mailstub.js';

const err = (m, s = 400) => Object.assign(new Error(m), {status: s});
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const clip = (v, n = 500) => String(v ?? '').trim().slice(0, n);
const isEmail = v => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(v);

async function ctx(req, moduleId) {
  const slug = String(req.params.slug || '').toLowerCase();
  const copy = req.params.copy === 'test' ? 'test' : req.params.copy === 'live' ? 'live' : null;
  if (!copy) throw err('Bad copy', 404);
  const site = db.prepare('select * from sites where slug=?').get(slug);
  if (!site) throw err('No such site', 404);
  if (!moduleOn(site.client_id, moduleId)) throw err(`${moduleById(moduleId)?.name || moduleId} is off for this site`, 403);
  const row = copyRow(site.id, copy);
  await migrateCopy(row);
  return {site, copy, pool: copyPool(row)};
}

async function upsertContact(pool, {name, email, phone, source, tag, custom}) {
  let c = email ? (await pool.query('select * from contacts where lower(email)=lower($1) order by id limit 1', [email])).rows[0] : null;
  if (c) {
    await pool.query(`update contacts set name=coalesce(nullif($2,''),name), phone=coalesce(nullif($3,''),phone), tags=(select array(select distinct unnest(tags || $4::text[]))), custom=custom || $5::jsonb where id=$1`, [c.id, name || '', phone || '', [tag], JSON.stringify(custom || {})]);
    return c.id;
  }
  c = (await pool.query('insert into contacts(name,email,phone,source,tags,custom) values($1,$2,$3,$4,$5,$6) returning id', [name || null, email || null, phone || null, source, [tag], JSON.stringify(custom || {})])).rows[0];
  return c.id;
}

export function publicRoutes(r, {W}) {
  const cors = (req, res, next) => {
    res.set({'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600', 'Cross-Origin-Resource-Policy': 'cross-origin'});
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  };
  const postLimit = rateLimit({windowMs: 10 * 60e3, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: {error: 'Too many tries. Please wait a few minutes.'}});
  r.use('/public', cors, rateLimit({windowMs: 60e3, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false}));
  r.get('/public/ping', (req, res) => res.json({ok: true}));
  const P = '/public/:slug/:copy';
  r.get(P + '/form/:id', W(async (req, res) => {
    const {pool} = await ctx(req, 'contact-form');
    const f = (await pool.query('select id,title,fields,success_text from forms where id=$1', [clip(req.params.id, 40)])).rows[0];
    if (!f) throw err('No such form', 404);
    const defs = (await pool.query('select key,label,type,options from field_defs order by id')).rows;
    res.json({...f, customFields: defs});
  }));
  r.post(P + '/form/:id', postLimit, W(async (req, res) => {
    const {site, copy, pool} = await ctx(req, 'contact-form');
    const b = req.body || {};
    if (b.website) return res.json({ok: true}); // honeypot: bots fill this hidden box
    const f = (await pool.query('select * from forms where id=$1', [clip(req.params.id, 40)])).rows[0];
    if (!f) throw err('No such form', 404);
    const data = {};
    for (const fld of f.fields) {
      const v = clip(b[fld.key], fld.type === 'textarea' ? 5000 : 300);
      if (fld.required && !v) throw err(`Please fill in "${fld.label}"`);
      if (fld.type === 'email' && v && !isEmail(v)) throw err('Please check your email address');
      data[fld.key] = v;
    }
    const defs = (await pool.query('select key from field_defs')).rows.map(x => x.key);
    const custom = {};
    for (const k of defs) if (b['custom_' + k] != null) custom[k] = clip(b['custom_' + k], 300);
    const contactId = await upsertContact(pool, {name: data.name, email: data.email, phone: data.phone, source: 'contact-form:' + f.id, tag: 'form:' + f.id, custom});
    await pool.query("insert into submissions(contact_id,module,form_id,data) values($1,'contact-form',$2,$3)", [contactId, f.id, JSON.stringify({...data, custom})]);
    stubMail({clientId: site.client_id, siteId: site.id, copy, subject: `New message on ${site.name}`, body: `${data.name || 'Someone'} sent the "${f.title}" form.`});
    res.json({ok: true, message: f.success_text || 'Thank you!'});
  }));
  r.get(P + '/funnel/:id', W(async (req, res) => {
    const {pool} = await ctx(req, 'funnel');
    const f = (await pool.query('select id,title,steps,success_text from funnels where id=$1', [clip(req.params.id, 40)])).rows[0];
    if (!f) throw err('No such funnel', 404);
    res.json(f);
  }));
  r.post(P + '/funnel/:id', postLimit, W(async (req, res) => {
    const {site, copy, pool} = await ctx(req, 'funnel');
    const b = req.body || {};
    if (b.website) return res.json({ok: true});
    const f = (await pool.query('select * from funnels where id=$1', [clip(req.params.id, 40)])).rows[0];
    if (!f) throw err('No such funnel', 404);
    const answers = {};
    for (const s of f.steps) {
      const v = clip(b[s.key], 1000);
      if (s.required && !v) throw err(`Please answer: ${s.question}`);
      if (s.type === 'email' && v && !isEmail(v)) throw err('Please check your email address');
      if (s.type === 'choice' && v && !(s.options || []).includes(v)) throw err('Please pick one of the choices');
      answers[s.key] = v;
    }
    const contactId = await upsertContact(pool, {name: answers.name, email: answers.email, phone: answers.phone, source: 'funnel:' + f.id, tag: 'funnel:' + f.id, custom: {}});
    await pool.query("insert into submissions(contact_id,module,form_id,data) values($1,'funnel',$2,$3)", [contactId, f.id, JSON.stringify(answers)]);
    stubMail({clientId: site.client_id, siteId: site.id, copy, subject: `New lead from "${f.title}" on ${site.name}`, body: `${answers.name || 'Someone'} finished the funnel.`});
    res.json({ok: true, message: f.success_text || 'Thank you!'});
  }));

  // Bookings: built-in calendar, or a Calendly link.
  const settings = async pool => (await pool.query('select mode,slot_minutes,hours,timezone,calendly_url from booking_settings where id=1')).rows[0] || {mode: 'builtin', slot_minutes: 30, hours: {}, timezone: 'Africa/Johannesburg'};
  async function slotsFor(pool, s, dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
    if (!m) throw err('Pick a date');
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    const wd = DAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
    const out = [];
    const step = Math.max(10, Math.min(240, +s.slot_minutes || 30)) * 60e3;
    for (const [from, to] of (s.hours?.[wd] || [])) {
      const [fh, fm] = from.split(':').map(Number), [th, tm] = to.split(':').map(Number);
      const start = zonedToUtc(y, mo, d, fh, fm, s.timezone), end = zonedToUtc(y, mo, d, th, tm, s.timezone);
      for (let t = start; t + step <= end; t += step) if (t > Date.now() + 30 * 60e3) out.push(t);
    }
    if (!out.length) return [];
    const taken = new Set((await pool.query("select starts_at from bookings where status='booked' and starts_at >= $1 and starts_at <= $2", [new Date(out[0]), new Date(out[out.length - 1])])).rows.map(r => +new Date(r.starts_at)));
    return out.filter(t => !taken.has(t)).map(t => {
      const p = tzParts(t, s.timezone);
      return {start: new Date(t).toISOString(), label: `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`};
    });
  }
  r.get(P + '/bookings', W(async (req, res) => {
    const {pool} = await ctx(req, 'bookings');
    const s = await settings(pool);
    res.json({mode: s.mode, calendlyUrl: s.mode === 'calendly' ? s.calendly_url : null, timezone: s.timezone, slotMinutes: s.slot_minutes});
  }));
  r.get(P + '/bookings/slots', W(async (req, res) => {
    const {pool} = await ctx(req, 'bookings');
    const s = await settings(pool);
    res.json({timezone: s.timezone, slots: await slotsFor(pool, s, clip(req.query.date, 10))});
  }));
  r.post(P + '/bookings', postLimit, W(async (req, res) => {
    const {site, copy, pool} = await ctx(req, 'bookings');
    const b = req.body || {};
    if (b.website) return res.json({ok: true});
    const s = await settings(pool);
    if (s.mode !== 'builtin') throw err('Please use the booking link');
    const name = clip(b.name, 120), email = clip(b.email, 200), phone = clip(b.phone, 40), note = clip(b.note, 1000);
    if (!name || !isEmail(email)) throw err('Please give your name and email');
    const start = new Date(String(b.start || ''));
    if (isNaN(start)) throw err('Pick a time');
    const day = new Intl.DateTimeFormat('en-CA', {timeZone: s.timezone}).format(start);
    const free = await slotsFor(pool, s, day);
    if (!free.some(x => x.start === start.toISOString())) throw err('Sorry, that time is no longer free. Please pick another.', 409);
    const contactId = await upsertContact(pool, {name, email, phone, source: 'booking', tag: 'booking', custom: {}});
    try {
      await pool.query('insert into bookings(contact_id,starts_at,ends_at,name,email,phone,note) values($1,$2,$3,$4,$5,$6,$7)', [contactId, start, new Date(+start + (+s.slot_minutes || 30) * 60e3), name, email, phone, note]);
    } catch (e) {
      if (e.code === '23505') throw err('Sorry, someone just took that time. Please pick another.', 409);
      throw e;
    }
    stubMail({clientId: site.client_id, siteId: site.id, copy, to: email, subject: `Your booking with ${site.name}`, body: `Booked for ${start.toISOString()}`});
    res.json({ok: true, message: 'You are booked. See you then!'});
  }));
}
