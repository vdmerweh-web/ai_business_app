// Shared prompt log for every AI agent (Bobby, Scott, Grid, Admin, ...).
// Same column names on both apps. All AI calls must go through withPromptLog
// so a call cannot skip the log. The client credit meter reads cost_zar from here.
import os from 'os';
import {db} from './db.js';
import {isAppAdmin} from './staffcfg.js';
import {xaiBalanceSummary} from './xaiBalance.js';

export function monthKey(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit'}).formatToParts(d);
  return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
}

export function promptLogInit() {
  db.exec(`
    create table if not exists ai_prompt_log (
      id integer primary key,
      created_at text not null,
      finished_at text,
      duration_ms integer,
      model_ms integer,
      client_id integer,
      user_id integer,
      user_email text,
      ai_agent text not null,
      prompt_text text,
      response_length integer,
      model text,
      input_tokens integer,
      cached_input_tokens integer,
      output_tokens integer,
      cost_zar real not null default 0,
      status text not null,
      error_message text,
      server_name text,
      load_1 real,
      load_5 real,
      load_15 real,
      conversation_id text,
      trigger_type text not null default 'chat',
      trigger_name text,
      task_id text
    );
    create index if not exists ai_prompt_log_client_time on ai_prompt_log(client_id, created_at);
    create index if not exists ai_prompt_log_agent_time on ai_prompt_log(ai_agent, created_at);
    create index if not exists ai_prompt_log_user_time on ai_prompt_log(user_id, created_at);
  `);
  const cols = db.prepare('pragma table_info(ai_prompt_log)').all().map(c => c.name);
  if (!cols.includes('trigger_type')) db.exec("alter table ai_prompt_log add column trigger_type text not null default 'chat'");
  if (!cols.includes('trigger_name')) db.exec('alter table ai_prompt_log add column trigger_name text');
  if (!cols.includes('task_id')) db.exec('alter table ai_prompt_log add column task_id text');
}

export function readLoad() {
  try {
    const [a, b, c] = os.loadavg();
    return {load_1: a, load_5: b, load_15: c};
  } catch {
    return {load_1: null, load_5: null, load_15: null};
  }
}

export function serverName() {
  if (process.env.SERVER_NAME) return String(process.env.SERVER_NAME).slice(0, 80);
  try { return os.hostname().slice(0, 80); } catch { return ''; }
}

function monthStartEnd(key) {
  const [y, m] = key.split('-').map(Number);
  const start = `${key}-01`;
  const endM = m === 12 ? 1 : m + 1;
  const endY = m === 12 ? y + 1 : y;
  const end = `${endY}-${String(endM).padStart(2, '0')}-01`;
  return {start, end};
}

function iso(d = new Date()) { return d.toISOString(); }

export function creditsFromLog(clientId, month = monthKey()) {
  const {start, end} = monthStartEnd(month);
  return db.prepare(`
    select coalesce(sum(cost_zar),0) used_zar,
           coalesce(sum(input_tokens),0) input_tokens,
           coalesce(sum(cached_input_tokens),0) cached_input_tokens,
           coalesce(sum(output_tokens),0) output_tokens,
           count(*) as calls
    from ai_prompt_log
    where client_id=?
      and created_at >= ?
      and created_at < ?
  `).get(clientId, start + 'T00:00:00.000+02:00', end + 'T00:00:00.000+02:00');
}

export async function withPromptLog({agent, user, client, prompt, conversationId, triggerType = 'chat', triggerName = null, taskId = null}, fn) {
  const t0 = Date.now();
  const createdAt = iso();
  const load = readLoad();
  let modelMs = 0;
  const markModel = async p => {
    const s = Date.now();
    try { return await p; } finally { modelMs += Date.now() - s; }
  };
  const meta = {model: null, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, cost_zar: 0, response_length: 0};
  const setMeta = m => Object.assign(meta, m);
  const base = {
    created_at: createdAt,
    client_id: client?.id || null,
    user_id: user?.id || null,
    user_email: user?.email || null,
    ai_agent: String(agent || 'unknown').slice(0, 40),
    prompt_text: String(prompt || '').slice(0, 20000),
    server_name: serverName(),
    conversation_id: conversationId == null ? null : String(conversationId),
    trigger_type: ['chat', 'event', 'cron'].includes(triggerType) ? triggerType : 'chat',
    trigger_name: triggerName ? String(triggerName).slice(0, 120) : null,
    task_id: taskId == null ? null : String(taskId).slice(0, 80),
    ...load,
  };
  try {
    const result = await fn({markModel, setMeta});
    insertLog({...base, ...meta, status: 'ok', model_ms: modelMs, duration_ms: Date.now() - t0, finished_at: iso()});
    return result;
  } catch (e) {
    insertLog({
      ...base, ...meta, status: 'error',
      error_message: String(e.message || e).slice(0, 500),
      model_ms: modelMs, duration_ms: Date.now() - t0, finished_at: iso(),
    });
    throw e;
  }
}

function insertLog(row) {
  db.prepare(`
    insert into ai_prompt_log(
      created_at, finished_at, duration_ms, model_ms,
      client_id, user_id, user_email, ai_agent, prompt_text, response_length,
      model, input_tokens, cached_input_tokens, output_tokens, cost_zar,
      status, error_message, server_name, load_1, load_5, load_15, conversation_id,
      trigger_type, trigger_name, task_id
    ) values (?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?)
  `).run(
    row.created_at, row.finished_at, row.duration_ms, row.model_ms,
    row.client_id, row.user_id, row.user_email, row.ai_agent, row.prompt_text, row.response_length || 0,
    row.model, row.input_tokens || 0, row.cached_input_tokens || 0, row.output_tokens || 0, row.cost_zar || 0,
    row.status, row.error_message || null, row.server_name, row.load_1, row.load_5, row.load_15, row.conversation_id,
    row.trigger_type || 'chat', row.trigger_name || null, row.task_id || null,
  );
}

export function startPromptLog({agent, user, client, prompt, conversationId, triggerType = 'chat', triggerName = null, taskId = null}) {
  const load = readLoad();
  triggerType = ['chat', 'event', 'cron'].includes(triggerType) ? triggerType : 'chat';
  triggerName = triggerName ? String(triggerName).slice(0, 120) : null;
  taskId = taskId == null ? null : String(taskId).slice(0, 80);
  const info = db.prepare(`
    insert into ai_prompt_log(
      created_at, client_id, user_id, user_email, ai_agent, prompt_text,
      status, server_name, load_1, load_5, load_15, conversation_id
    ) values (?,?,?,?,?,?, 'pending',?,?,?,?,?)
  `).run(
    iso(), client?.id || null, user?.id || null, user?.email || null, String(agent || 'unknown').slice(0, 40),
    String(prompt || '').slice(0, 20000), serverName(), load.load_1, load.load_5, load.load_15,
    conversationId == null ? null : String(conversationId),
  );
  return {id: info.lastInsertRowid};
}

export function finishPromptLog(conversationId, agent, {status = 'ok', response_length = 0, error_message = null} = {}) {
  const row = db.prepare(`
    select id, created_at from ai_prompt_log
    where conversation_id=? and ai_agent=? and status='pending'
    order by created_at desc, id desc limit 1
  `).get(String(conversationId), String(agent));
  if (!row) return;
  const duration = Math.max(0, Date.now() - Date.parse(row.created_at));
  db.prepare(`
    update ai_prompt_log set finished_at=?, duration_ms=?, response_length=?, status=?, error_message=?
    where id=?
  `).run(iso(), duration, response_length || 0, status, error_message, row.id);
}

export function usageRoutes(r, {W}) {
  const admin = (req, res, next) => isAppAdmin(req.user) ? next() : res.status(403).json({error: 'This page is only for the site admin'});
  r.get('/usage/summary', admin, W(async (req, res) => {
    const from = String(req.query.from || '').slice(0, 10) || new Date(Date.now() - 30 * 864e5).toLocaleDateString('en-CA', {timeZone: 'Africa/Johannesburg'});
    const to = String(req.query.to || '').slice(0, 10) || new Date().toLocaleDateString('en-CA', {timeZone: 'Africa/Johannesburg'});
    const start = from + 'T00:00:00.000+02:00';
    const endEx = (() => { const d = new Date(to + 'T00:00:00+02:00'); d.setDate(d.getDate() + 1); return d.toISOString(); })();
    const agg = `count(*) as prompts,
      sum(case when status='error' then 1 else 0 end) as errors,
      coalesce(sum(duration_ms),0) as total_ms,
      coalesce(avg(case when duration_ms is not null then duration_ms end),0) as avg_ms,
      coalesce(avg(case when model_ms is not null then model_ms end),0) as avg_model_ms,
      coalesce(sum(cost_zar),0) as credits,
      coalesce(avg(case when load_1 is not null then load_1 end),0) as avg_load`;
    const byClient = db.prepare(`
      select l.client_id, coalesce(c.name,'(no company)') as name, c.slug as ref, ${agg}
      from ai_prompt_log l left join clients c on c.id=l.client_id
      where l.created_at >= ? and l.created_at < ?
      group by l.client_id
      order by credits desc, prompts desc
    `).all(start, endEx);
    const byUser = db.prepare(`
      select user_id, coalesce(user_email,'(unknown)') as email, ${agg}
      from ai_prompt_log where created_at >= ? and created_at < ?
      group by user_id, user_email
      order by credits desc, prompts desc
    `).all(start, endEx);
    const byAgent = db.prepare(`
      select ai_agent as agent, ${agg}
      from ai_prompt_log where created_at >= ? and created_at < ?
      group by ai_agent
      order by credits desc, prompts desc
    `).all(start, endEx);
    const byDay = db.prepare(`
      select substr(created_at, 1, 10) as day, ${agg}
      from ai_prompt_log where created_at >= ? and created_at < ?
      group by 1
      order by 1
    `).all(start, endEx);
    const totals = db.prepare(`select ${agg} from ai_prompt_log where created_at >= ? and created_at < ?`).get(start, endEx);
    const xaiBalance = xaiBalanceSummary();
    res.json({from, to, serverName: serverName(), totals, byClient, byUser, byAgent, byDay, xaiBalance});
  }));
  r.get('/usage/recent', admin, W(async (req, res) => {
    const limit = Math.min(200, Math.max(1, +req.query.limit || 50));
    const rows = db.prepare(`
      select l.id, l.created_at, l.finished_at, l.duration_ms, l.model_ms,
             l.client_id, c.name as client_name, c.slug as client_ref,
             l.user_id, l.user_email, l.ai_agent, l.prompt_text, l.response_length,
             l.model, l.input_tokens, l.output_tokens, l.cost_zar, l.status,
             l.error_message, l.server_name, l.load_1, l.load_5, l.load_15, l.trigger_type, l.trigger_name, l.task_id
      from ai_prompt_log l
      left join clients c on c.id=l.client_id
      order by l.created_at desc
      limit ?
    `).all(limit);
    res.json(rows);
  }));
}
