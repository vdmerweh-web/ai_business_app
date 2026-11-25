// Scheduler module: one shared job queue with a capped number of workers.
// - Jobs set for the same time (like midnight) are spread over a window (jitter).
// - Each client has caps: jobs per day, active jobs, and AI credits per day.
// - A failed job is retried, then flagged to Grid.
// - Every run is written to the central run log (sched_runs).
import {db} from './db.js';
import {tzParts, zonedToUtc, validTz} from './timeutil.js';

const err = (m, s = 400) => Object.assign(new Error(m), {status: s});
export const WORKERS = Math.max(1, Math.min(10, +(process.env.SCHED_WORKERS || 3)));
const WINDOW_TOP_OF_HOUR = +(process.env.SCHED_JITTER_SEC || 7200); // 00:00 jobs spread over 00:00-02:00
const WINDOW_OTHER = 600;
const BACKOFF = [60e3, 5 * 60e3, 15 * 60e3, 60 * 60e3];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const KINDS = {
  bobby_task: 'Ask Bobby to do a task (uses AI credits)',
  build_site: 'Rebuild the test copy of a site',
  reset_test: 'Reset a test copy from live (cleaned data)',
  seo_check: 'Run the SEO (Search Engine Optimization) check on the test copy',
  ping: 'A tiny test job that does nothing',
};
const runners = {};
export function registerRunner(kind, fn) { runners[kind] = fn; }
let flagFn = () => {};
export function onFlag(fn) { flagFn = fn; }

// Schedules: "once 2026-12-01T09:00", "daily 00:00", "weekly mon 08:30", "hourly", "every 30 min"
export function parseSchedule(s) {
  s = String(s || '').trim().toLowerCase();
  let m;
  if ((m = /^once (\d{4})-(\d{2})-(\d{2})[t ](\d{2}):(\d{2})$/.exec(s))) return {type: 'once', y: +m[1], mo: +m[2], d: +m[3], h: +m[4], min: +m[5]};
  if (s === 'now') return {type: 'now'};
  if ((m = /^daily (\d{2}):(\d{2})$/.exec(s))) return {type: 'daily', h: +m[1], min: +m[2]};
  if ((m = /^weekly (sun|mon|tue|wed|thu|fri|sat) (\d{2}):(\d{2})$/.exec(s))) return {type: 'weekly', wd: m[1], h: +m[2], min: +m[3]};
  if (s === 'hourly') return {type: 'every', min: 60};
  if ((m = /^every (\d{1,4}) min$/.exec(s)) && +m[1] >= 15) return {type: 'every', min: +m[1]};
  throw err('Use a schedule like "daily 00:00", "weekly mon 08:30", "once 2026-12-01 09:00", "hourly" or "every 30 min" (15 minutes or more).');
}
export function nextRun(schedule, tz, from = Date.now()) {
  const p = parseSchedule(schedule);
  if (p.type === 'now') return from;
  if (p.type === 'once') return zonedToUtc(p.y, p.mo, p.d, p.h, p.min, tz);
  if (p.type === 'every') return from + p.min * 60e3;
  for (let i = 0; i < 9; i++) {
    const day = tzParts(from + i * 864e5, tz);
    if (p.type === 'weekly' && day.wd !== p.wd) continue;
    const t = zonedToUtc(day.y, day.m, day.d, p.h, p.min, tz);
    if (t > from) return t;
  }
  return null;
}
export function pickJitter(schedule) {
  const p = parseSchedule(schedule);
  if (p.type === 'now' || p.type === 'every') return 0;
  const win = p.min === 0 ? WINDOW_TOP_OF_HOUR : WINDOW_OTHER;
  return Math.floor(Math.random() * win);
}

export function capsFor(clientId) {
  db.prepare('insert or ignore into client_caps(client_id) values(?)').run(clientId);
  return db.prepare('select * from client_caps where client_id=?').get(clientId);
}
const dayStart = () => new Date(Date.now() - 864e5).toISOString();
export function usageToday(clientId) {
  return db.prepare("select count(*) runs, coalesce(sum(cost_zar),0) zar from sched_runs where client_id=? and started_at > ? and status != 'skipped'").get(clientId, dayStart());
}

export function createJob({clientId, siteId = null, kind, title = '', payload = {}, schedule, tz, createdBy, jitter}) {
  if (!KINDS[kind]) throw err('Unknown job type. Use one of: ' + Object.keys(KINDS).join(', '));
  tz = validTz(tz) ? tz : (db.prepare('select timezone from clients where id=?').get(clientId)?.timezone || 'Africa/Johannesburg');
  parseSchedule(schedule);
  const caps = capsFor(clientId);
  const active = db.prepare("select count(*) n from sched_jobs where client_id=? and status in ('active','running')").get(clientId).n;
  if (active >= caps.max_active_jobs) throw err(`You already have ${active} jobs. The limit is ${caps.max_active_jobs}.`);
  if (siteId && !db.prepare('select 1 from sites where id=? and client_id=?').get(siteId, clientId)) throw err('No such site', 404);
  if (kind === 'bobby_task' && String(payload?.prompt || '').trim().length < 3) throw err('Say what Bobby should do');
  const j = jitter == null ? pickJitter(schedule) : Math.max(0, Math.min(7200, +jitter));
  const base = nextRun(schedule, tz);
  if (base == null) throw err('That time could not be worked out');
  if (parseSchedule(schedule).type === 'once' && base < Date.now() - 60e3) throw err('That time is in the past');
  return db.prepare('insert into sched_jobs(client_id,site_id,kind,title,payload,schedule,tz,next_run_at,jitter_sec,created_by) values(?,?,?,?,?,?,?,?,?,?) returning *')
    .get(clientId, siteId, kind, String(title).slice(0, 120) || KINDS[kind], JSON.stringify(payload || {}).slice(0, 4000), schedule.trim().toLowerCase(), tz, base + j * 1000, j, String(createdBy || '').slice(0, 120));
}

export function jobPublic(j) {
  return {id: j.id, clientId: j.client_id, siteId: j.site_id, kind: j.kind, title: j.title, schedule: j.schedule, tz: j.tz, status: j.status,
    nextRunAt: j.next_run_at ? new Date(j.next_run_at).toISOString() : null, jitterMinutes: Math.round(j.jitter_sec / 60), attempts: j.attempts, maxAttempts: j.max_attempts,
    lastRunAt: j.last_run_at ? new Date(j.last_run_at).toISOString() : null, lastError: j.last_error, createdBy: j.created_by, payload: (() => { try { return JSON.parse(j.payload); } catch { return {}; } })()};
}

const running = new Set();
export const runningCount = () => running.size;

async function runOne(job) {
  const attempt = job.attempts + 1;
  const caps = capsFor(job.client_id), used = usageToday(job.client_id);
  const run = db.prepare("insert into sched_runs(job_id,client_id,kind,attempt,status) values(?,?,?,?,'running') returning id").get(job.id, job.client_id, job.kind, attempt);
  const finish = (status, message, cost = 0) => db.prepare("update sched_runs set status=?, message=?, cost_zar=?, finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') where id=?").run(status, String(message || '').slice(0, 1000), cost, run.id);
  const reschedule = () => {
    const p = parseSchedule(job.schedule);
    if (p.type === 'once' || p.type === 'now') return db.prepare("update sched_jobs set status='done', locked_at=null, attempts=0, last_run_at=? where id=?").run(Date.now(), job.id);
    const n = nextRun(job.schedule, job.tz, Math.max(Date.now(), job.next_run_at - job.jitter_sec * 1000));
    db.prepare("update sched_jobs set status='active', locked_at=null, attempts=0, last_run_at=?, next_run_at=? where id=?").run(Date.now(), n + job.jitter_sec * 1000, job.id);
  };
  if (used.runs >= caps.max_jobs_per_day) { finish('skipped', `Daily job limit reached (${caps.max_jobs_per_day}).`); return reschedule(); }
  if (job.kind === 'bobby_task' && used.zar >= caps.max_ai_zar_per_day) { finish('skipped', `Daily AI credit limit for jobs reached (R${caps.max_ai_zar_per_day}).`); return reschedule(); }
  try {
    const fn = runners[job.kind];
    if (!fn) throw new Error('No runner for ' + job.kind);
    const out = await fn(job, JSON.parse(job.payload || '{}'), {aiBudgetZar: Math.max(0, caps.max_ai_zar_per_day - used.zar)}) || {};
    finish('ok', out.message || 'Done', +out.costZar || 0);
    db.prepare('update sched_jobs set last_error=null where id=?').run(job.id);
    reschedule();
  } catch (e) {
    const msg = String(e.message || e).slice(0, 500);
    finish('failed', msg);
    if (attempt >= job.max_attempts) {
      db.prepare("update sched_jobs set status='flagged', locked_at=null, attempts=?, last_error=?, last_run_at=? where id=?").run(attempt, msg, Date.now(), job.id);
      flagFn('scheduler', job.client_id, `Job #${job.id} "${job.title}" (${job.kind}) failed ${attempt} times. Last error: ${msg}`);
    } else {
      db.prepare("update sched_jobs set status='active', locked_at=null, attempts=?, last_error=?, next_run_at=? where id=?").run(attempt, msg, Date.now() + BACKOFF[Math.min(attempt - 1, BACKOFF.length - 1)], job.id);
    }
  }
}

function tick() {
  while (running.size < WORKERS) {
    const job = db.prepare("select * from sched_jobs where status='active' and next_run_at <= ? and locked_at is null order by next_run_at limit 1").get(Date.now());
    if (!job) return;
    const got = db.prepare("update sched_jobs set status='running', locked_at=? where id=? and status='active' and locked_at is null").run(Date.now(), job.id);
    if (!got.changes) continue;
    running.add(job.id);
    runOne(job).catch(e => console.error('scheduler', e.message)).finally(() => running.delete(job.id));
  }
}
export function startScheduler() {
  // Jobs left "running" by a restart go back in the queue.
  db.prepare("update sched_jobs set status='active', locked_at=null where status='running'").run();
  db.prepare("update sched_runs set status='failed', message='Stopped by a restart', finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') where status='running'").run();
  setInterval(tick, 5000).unref();
  console.log(`scheduler on: ${WORKERS} workers`);
}

export function schedulerRoutes(r, {W, clientIdFor, isAdmin}) {
  r.get('/scheduler/jobs', W(async (req, res) => {
    const all = isAdmin(req.user) && !req.query.clientId;
    const jobs = all ? db.prepare('select j.*, c.name client_name from sched_jobs j join clients c on c.id=j.client_id order by j.id desc limit 300').all()
      : db.prepare('select * from sched_jobs where client_id=? order by id desc limit 200').all(clientIdFor(req));
    const runs = all ? db.prepare('select r.*, c.name client_name from sched_runs r left join clients c on c.id=r.client_id order by r.id desc limit 200').all()
      : db.prepare('select * from sched_runs where client_id=? order by id desc limit 100').all(clientIdFor(req));
    const cid = all ? null : clientIdFor(req);
    res.json({jobs: jobs.map(j => ({...jobPublic(j), clientName: j.client_name})), runs, kinds: KINDS, workers: WORKERS, running: running.size,
      caps: cid ? capsFor(cid) : null, usedToday: cid ? usageToday(cid) : null});
  }));
  r.post('/scheduler/jobs', W(async (req, res) => {
    const b = req.body || {};
    const job = createJob({clientId: clientIdFor(req), siteId: b.siteId ? +b.siteId : null, kind: b.kind, title: b.title, payload: b.payload, schedule: b.schedule, tz: b.tz, createdBy: req.user.email, jitter: isAdmin(req.user) ? b.jitter : undefined});
    res.json(jobPublic(job));
  }));
  r.post('/scheduler/jobs/:id/:action', W(async (req, res) => {
    const job = db.prepare('select * from sched_jobs where id=?').get(+req.params.id);
    if (!job || (!isAdmin(req.user) && job.client_id !== req.user.client_id)) throw err('No such job', 404);
    const a = req.params.action;
    if (a === 'pause') db.prepare("update sched_jobs set status='paused' where id=? and status in ('active','flagged')").run(job.id);
    else if (a === 'resume') db.prepare("update sched_jobs set status='active', attempts=0, next_run_at=max(coalesce(next_run_at,0), ?) where id=? and status in ('paused','flagged')").run(Date.now(), job.id);
    else if (a === 'run-now') db.prepare("update sched_jobs set status='active', next_run_at=? where id=? and status in ('active','paused','flagged','done')").run(Date.now(), job.id);
    else if (a === 'cancel') db.prepare("update sched_jobs set status='cancelled' where id=? and status != 'running'").run(job.id);
    else throw err('Unknown action');
    res.json(jobPublic(db.prepare('select * from sched_jobs where id=?').get(job.id)));
  }));
  r.put('/scheduler/caps/:clientId', W(async (req, res) => {
    if (!isAdmin(req.user)) throw err('Admins only', 403);
    const cid = +req.params.clientId; capsFor(cid);
    const b = req.body || {};
    db.prepare('update client_caps set max_jobs_per_day=?, max_active_jobs=?, max_ai_zar_per_day=? where client_id=?').run(Math.max(0, +b.max_jobs_per_day || 50), Math.max(0, +b.max_active_jobs || 20), Math.max(0, +b.max_ai_zar_per_day || 10), cid);
    res.json(capsFor(cid));
  }));
}
