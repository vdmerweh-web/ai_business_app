// Shared prompt log for every AI agent (Bobby, Scott, Grid, Admin, ...).
// Same column names on both apps. All AI calls must go through withPromptLog
// so a call cannot skip the log. The client credit meter reads cost_zar from here.
import os from 'os';
import {q} from './db.js';
import {isAppAdmin} from './staffcfg.js';
import {xaiBalanceSummary} from './xaiBalance.js';

export function monthKey(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit'}).formatToParts(d);
  return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
}

export async function promptLogInit() {
  await q(`
    create table if not exists ai_prompt_log (
      id bigserial primary key,
      created_at timestamptz not null default now(),
      finished_at timestamptz,
      duration_ms int,
      model_ms int,
      client_id int,
      user_id int,
      user_email text,
      ai_agent text not null,
      prompt_text text,
      response_length int,
      model text,
      input_tokens int,
      cached_input_tokens int,
      output_tokens int,
      cost_zar numeric(12,4) not null default 0,
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
    alter table ai_prompt_log add column if not exists trigger_type text not null default 'chat';
    alter table ai_prompt_log add column if not exists trigger_name text;
    alter table ai_prompt_log add column if not exists task_id text;
  `);
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

export async function creditsFromLog(clientId, month = monthKey()) {
  const {start, end} = monthStartEnd(month);
  const [row] = await q(`
    select coalesce(sum(cost_zar),0)::float used_zar,
           coalesce(sum(input_tokens),0)::int input_tokens,
           coalesce(sum(cached_input_tokens),0)::int cached_input_tokens,
           coalesce(sum(output_tokens),0)::int output_tokens,
           count(*)::int as calls
    from ai_prompt_log
    where client_id=$1
      and created_at >= $2::date
      and created_at < ($3::date)
  `, [clientId, start, end]);
  return row;
}

export async function withPromptLog({agent, user, client, prompt, conversationId, triggerType = 'chat', triggerName = null, taskId = null}, fn) {
  const t0 = Date.now();
  const createdAt = new Date();
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
    await insertLog({...base, ...meta, status: 'ok', model_ms: modelMs, duration_ms: Date.now() - t0, finished_at: new Date()});
    return result;
  } catch (e) {
    await insertLog({
      ...base, ...meta, status: 'error',
      error_message: String(e.message || e).slice(0, 500),
      model_ms: modelMs, duration_ms: Date.now() - t0, finished_at: new Date(),
    });
    throw e;
  }
}

async function insertLog(row) {
  await q(`
    insert into ai_prompt_log(
      created_at, finished_at, duration_ms, model_ms,
      client_id, user_id, user_email, ai_agent, prompt_text, response_length,
      model, input_tokens, cached_input_tokens, output_tokens, cost_zar,
      status, error_message, server_name, load_1, load_5, load_15, conversation_id,
      trigger_type, trigger_name, task_id
    ) values (
      $1,$2,$3,$4,
      $5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,
      $16,$17,$18,$19,$20,$21,$22,
      $23,$24,$25
    )
  `, [
    row.created_at, row.finished_at, row.duration_ms, row.model_ms,
    row.client_id, row.user_id, row.user_email, row.ai_agent, row.prompt_text, row.response_length || 0,
    row.model, row.input_tokens || 0, row.cached_input_tokens || 0, row.output_tokens || 0, row.cost_zar || 0,
    row.status, row.error_message || null, row.server_name, row.load_1, row.load_5, row.load_15, row.conversation_id,
    row.trigger_type || 'chat', row.trigger_name || null, row.task_id || null,
  ]);
}

// For webhook agents: open a row when the user sends, finish it when the bot replies.
export async function startPromptLog({agent, user, client, prompt, conversationId, triggerType = 'chat', triggerName = null, taskId = null}) {
  const load = readLoad();
  triggerType = ['chat', 'event', 'cron'].includes(triggerType) ? triggerType : 'chat';
  triggerName = triggerName ? String(triggerName).slice(0, 120) : null;
  taskId = taskId == null ? null : String(taskId).slice(0, 80);
  const [row] = await q(`
    insert into ai_prompt_log(
      created_at, client_id, user_id, user_email, ai_agent, prompt_text,
      status, server_name, load_1, load_5, load_15, conversation_id,
      trigger_type, trigger_name, task_id
    ) values (now(),$1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10,$11,$12,$13)
    returning id, created_at
  `, [
    client?.id || null, user?.id || null, user?.email || null, String(agent || 'unknown').slice(0, 40),
    String(prompt || '').slice(0, 20000), serverName(), load.load_1, load.load_5, load.load_15,
    conversationId == null ? null : String(conversationId),
    triggerType, triggerName, taskId,
  ]);
  return row;
}

export async function finishPromptLog(conversationId, agent, {status = 'ok', response_length = 0, error_message = null} = {}) {
  await q(`
    update ai_prompt_log set
      finished_at=now(),
      duration_ms=greatest(0, floor(extract(epoch from (now()-created_at))*1000))::int,
      response_length=$3,
      status=$4,
      error_message=$5
    where id=(
      select id from ai_prompt_log
      where conversation_id=$1 and ai_agent=$2 and status='pending'
      order by created_at desc limit 1
    )
  `, [String(conversationId), String(agent), response_length || 0, status, error_message]);
}

export function usageRoutes(r, {W}) {
  const admin = (req, res, next) => isAppAdmin(req.user) ? next() : res.status(403).json({error: 'This page is only for the site admin'});
  r.get('/usage/summary', admin, W(async (req, res) => {
    const from = String(req.query.from || '').slice(0, 10) || new Date(Date.now() - 30 * 864e5).toLocaleDateString('en-CA', {timeZone: 'Africa/Johannesburg'});
    const to = String(req.query.to || '').slice(0, 10) || new Date().toLocaleDateString('en-CA', {timeZone: 'Africa/Johannesburg'});
    const where = `created_at >= $1::date and created_at < ($2::date + interval '1 day')`;
    const p = [from, to];
    const agg = `count(*)::int as prompts,
      count(*) filter (where status='error')::int as errors,
      coalesce(sum(duration_ms),0)::bigint as total_ms,
      coalesce(avg(duration_ms) filter (where duration_ms is not null),0)::int as avg_ms,
      coalesce(avg(model_ms) filter (where model_ms is not null),0)::int as avg_model_ms,
      coalesce(sum(cost_zar),0)::float as credits,
      coalesce(avg(load_1) filter (where load_1 is not null),0)::float as avg_load`;
    const byClient = await q(`
      select l.client_id, coalesce(c.name,'(no company)') as name, c.ref, ${agg}
      from ai_prompt_log l left join clients c on c.id=l.client_id
      where ${where}
      group by l.client_id, c.name, c.ref
      order by credits desc, prompts desc
    `, p);
    const byUser = await q(`
      select user_id, coalesce(user_email,'(unknown)') as email, ${agg}
      from ai_prompt_log where ${where}
      group by user_id, user_email
      order by credits desc, prompts desc
    `, p);
    const byAgent = await q(`
      select ai_agent as agent, ${agg}
      from ai_prompt_log where ${where}
      group by ai_agent
      order by credits desc, prompts desc
    `, p);
    const byDay = await q(`
      select (created_at at time zone 'Africa/Johannesburg')::date::text as day, ${agg}
      from ai_prompt_log where ${where}
      group by 1
      order by 1
    `, p);
    const [totals] = await q(`select ${agg}, min(server_name) as server_name from ai_prompt_log where ${where}`, p);
    const xaiBalance = await xaiBalanceSummary();
    res.json({from, to, serverName: serverName(), totals, byClient, byUser, byAgent, byDay, xaiBalance});
  }));
  r.get('/usage/recent', admin, W(async (req, res) => {
    const limit = Math.min(200, Math.max(1, +req.query.limit || 50));
    const rows = await q(`
      select l.id, l.created_at, l.finished_at, l.duration_ms, l.model_ms,
             l.client_id, c.name as client_name, c.ref as client_ref,
             l.user_id, l.user_email, l.ai_agent, l.prompt_text, l.response_length,
             l.model, l.input_tokens, l.output_tokens, l.cost_zar, l.status,
             l.error_message, l.server_name, l.load_1, l.load_5, l.load_15, l.trigger_type, l.trigger_name, l.task_id
      from ai_prompt_log l
      left join clients c on c.id=l.client_id
      order by l.created_at desc
      limit $1
    `, [limit]);
    res.json(rows.map(r => ({
      ...r,
      created_at: r.created_at && new Date(r.created_at).toISOString(),
      finished_at: r.finished_at && new Date(r.finished_at).toISOString(),
      cost_zar: r.cost_zar == null ? 0 : +r.cost_zar,
    })));
  }));
}
