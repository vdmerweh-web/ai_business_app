// Admin <-> Grid webhooks, signed with HMAC-SHA256 (Hash-based Message Authentication Code).
// Each direction has its own secret in .env (never in git, never logged):
//   HOOK_SECRET_ADMIN_IN   Admin signs what it sends to the app
//   HOOK_SECRET_GRID_IN    Grid signs what it sends to the app
//   HOOK_SECRET_ADMIN_OUT  the app signs what it sends to Admin (ADMIN_HOOK_URL, else CG_WEBHOOK_URL)
//   HOOK_SECRET_GRID_OUT   the app signs what it sends to Grid (GRID_WEBHOOK_URL; if empty Grid polls its inbox)
// Signature: X-CG-Timestamp (unix seconds), X-CG-Nonce, X-CG-Signature: sha256=<hex HMAC of "ts.nonce.METHOD.path.body">.
// Requests older than 5 minutes, or with a nonce we have seen, are refused.
import crypto from 'crypto';
import {db} from './db.js';

const BOTS = ['admin', 'grid'];
const secret = (bot, dir) => (process.env[`HOOK_SECRET_${bot.toUpperCase()}_${dir}`] || '').trim();
export const hooksConfigured = () => BOTS.every(b => secret(b, 'IN').length >= 32);
const outUrl = bot => bot === 'admin' ? (process.env.ADMIN_HOOK_URL || process.env.CG_WEBHOOK_URL || '').trim() : (process.env.GRID_WEBHOOK_URL || '').trim();
const err = (m, s = 400) => Object.assign(new Error(m), {status: s});

export function sign(sec, ts, nonce, method, path, body) {
  return 'sha256=' + crypto.createHmac('sha256', sec).update(`${ts}.${nonce}.${method.toUpperCase()}.${path}.${body || ''}`).digest('hex');
}
function log(direction, peer, path, status, sigOk, summary) {
  db.prepare('insert into webhook_log(direction,peer,path,status,sig_ok,summary) values(?,?,?,?,?,?)').run(direction, peer, path, status, sigOk == null ? null : sigOk ? 1 : 0, String(summary || '').slice(0, 300));
}
let flagger = () => {};
export function onHookFlag(fn) { flagger = fn; }

// Express middleware: check the signature for a given sender bot.
function verify(bot) {
  return (req, res, next) => {
    const sec = secret(bot, 'IN');
    const path = req.originalUrl.split('?')[0];
    const fail = (m, code = 401) => { log('in', bot, path, code, false, m); if (code === 401) flagger('webhook', null, `Refused a ${bot} webhook: ${m}`); res.status(code).json({error: m}); };
    if (sec.length < 32) return fail('This webhook is not set up yet', 503);
    const ts = +req.get('x-cg-timestamp'), nonce = String(req.get('x-cg-nonce') || ''), sig = String(req.get('x-cg-signature') || '');
    if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) return fail('Old or missing timestamp');
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(nonce)) return fail('Missing nonce');
    const want = sign(sec, ts, nonce, req.method, path, req.rawBody ? req.rawBody.toString('utf8') : '');
    const a = Buffer.from(sig), b = Buffer.from(want);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail('Bad signature');
    db.prepare('delete from hook_nonces where seen_at < ?').run(Date.now() - 900e3);
    try { db.prepare('insert into hook_nonces(nonce,seen_at) values(?,?)').run(nonce, Date.now()); } catch { return fail('Nonce already used'); }
    req.hookBot = bot;
    next();
  };
}

export function queueMessage(from, to, text, meta = {}) {
  const row = db.prepare('insert into hook_messages(from_bot,to_bot,text,meta) values(?,?,?,?) returning *').get(from, to, String(text).slice(0, 8000), JSON.stringify(meta).slice(0, 4000));
  deliverOut(row.id).catch(() => {});
  return row;
}
const whAuth = () => { const a = String(process.env.CG_WEBHOOK_AUTH || '').trim().replace(/^authorization\s*:\s*/i, ''); return a ? {Authorization: /^[A-Za-z][\w-]*\s+\S/.test(a) ? a : 'Bearer ' + a} : {}; };

// Push a message to the bot's own webhook (if it has one). Grid without a URL polls its inbox.
async function deliverOut(id) {
  const m = db.prepare('select * from hook_messages where id=? and delivered=0').get(id);
  if (!m) return;
  const url = outUrl(m.to_bot), sec = secret(m.to_bot, 'OUT');
  if (!url || sec.length < 32) return;
  const body = JSON.stringify({
    app: 'codegreene', section: 'bot-link', conversationTitle: `${m.from_bot} -> ${m.to_bot}`, userName: m.from_bot === 'grid' ? 'Grid' : m.from_bot === 'admin' ? 'Admin' : 'Codegreene app',
    userEmail: null, userRole: 'bot', from: m.from_bot, to: m.to_bot, text: m.text, meta: JSON.parse(m.meta || '{}'), messageId: 'hook-' + m.id, attempt: m.attempts + 1,
  });
  const ts = Math.floor(Date.now() / 1000), nonce = crypto.randomBytes(16).toString('base64url');
  let path = '/';
  try { path = new URL(url).pathname; } catch {}
  let st = 0;
  try {
    const r = await fetch(url, {method: 'POST', signal: AbortSignal.timeout(10e3), headers: {
      'Content-Type': 'application/json', 'X-CG-Timestamp': String(ts), 'X-CG-Nonce': nonce, 'X-CG-Signature': sign(sec, ts, nonce, 'POST', path, body),
      ...(m.to_bot === 'admin' ? {'X-CG-Webhook-Secret': process.env.CG_WEBHOOK_SECRET || '', ...whAuth()} : {}),
    }, body});
    st = r.status;
  } catch { st = 0; }
  db.prepare('update hook_messages set attempts=attempts+1, last_status=?, delivered=? where id=?').run(st, st >= 200 && st < 300 ? 1 : 0, m.id);
  log('out', m.to_bot, path, st, null, `message ${m.id} from ${m.from_bot}`);
  if ((st < 200 || st >= 300) && m.attempts + 1 >= 5 && m.to_bot !== 'grid') flagger('webhook', null, `Could not deliver message ${m.id} to ${m.to_bot} after 5 tries (last status ${st}).`);
}
export function startHookWorker() {
  setInterval(() => {
    for (const m of db.prepare("select id from hook_messages where delivered=0 and attempts < 5 and created_at > datetime('now','-1 day') order by id limit 10").all()) deliverOut(m.id).catch(() => {});
  }, 60e3).unref();
}

export function hookRoutes(r, {W}) {
  r.get('/hooks/status', (req, res) => res.json({configured: hooksConfigured()}));
  for (const bot of BOTS) {
    const other = bot === 'admin' ? 'grid' : 'admin';
    // A bot sends a message to the other bot (or "people", which shows in the app's Platform page).
    r.post(`/hooks/${bot}/message`, verify(bot), W(async (req, res) => {
      const to = ['admin', 'grid', 'people'].includes(req.body?.to) ? req.body.to : other;
      const text = String(req.body?.text || '').trim();
      if (!text) throw err('Empty message');
      if (to === bot) throw err('A bot cannot message itself');
      const row = queueMessage(bot, to, text, {conversationId: req.body?.conversationId || null, replyTo: req.body?.replyTo || null});
      log('in', bot, req.path, 200, true, `message ${row.id} to ${to}`);
      res.json({ok: true, id: row.id});
    }));
    // A bot reads messages sent to it (for bots without a webhook URL, like Grid).
    r.get(`/hooks/${bot}/inbox`, verify(bot), W(async (req, res) => {
      const after = +(req.query.after || 0);
      const rows = db.prepare('select id,from_bot,to_bot,text,meta,created_at from hook_messages where to_bot=? and id>? order by id limit 100').all(bot, after);
      db.prepare("update hook_messages set read_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), delivered=1 where to_bot=? and id>? and id<=?").run(bot, after, rows.length ? rows[rows.length - 1].id : after);
      log('in', bot, req.path, 200, true, `inbox read, ${rows.length} messages`);
      res.json(rows.map(x => ({...x, meta: JSON.parse(x.meta || '{}')})));
    }));
  }
}

// Admin-only views for the Platform page.
export function hookAdminRoutes(r, {W}) {
  r.get('/platform/hooks', W(async (req, res) => res.json({
    configured: hooksConfigured(),
    adminOut: !!outUrl('admin'), gridOut: !!outUrl('grid'),
    messages: db.prepare('select * from hook_messages order by id desc limit 100').all(),
    log: db.prepare('select * from webhook_log order by id desc limit 100').all(),
  })));
  r.post('/platform/hooks/send', W(async (req, res) => {
    const to = req.body?.to === 'grid' ? 'grid' : 'admin';
    const text = String(req.body?.text || '').trim();
    if (!text) throw err('Empty message');
    res.json(queueMessage('people', to, `${req.user.name || req.user.email}: ${text}`, {userEmail: req.user.email}));
  }));
}
