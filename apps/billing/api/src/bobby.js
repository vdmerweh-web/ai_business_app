// Bobby: the client's in-app helper. All reads are scoped to one client_id.
// Postgres port of the core app helper. Does not touch invoices, entries or mail.
import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {q} from './db.js';
import {withLoggedWrite} from './changeLog.js';
import {isAppAdmin} from './staffcfg.js';
import {
  searchClients, getClientBilling, proposeBillingEmailChange,
  applyBillingEmailChange, cancelBillingEmailChange, pendingForUser, publicAction,
} from './billingEmail.js';
import {withPromptLog, creditsFromLog} from './promptLog.js';

const DIR = process.env.UPLOAD_DIR || '/data/uploads';
const MB = 1024 * 1024;
const MAX = 5 * MB;
const MAX_ROUNDS = 4;
const XAI_URL = 'https://api.x.ai/v1/chat/completions';
const DEFAULT_MODEL = process.env.XAI_MODEL || 'grok-4.3';

const PRICES = {
  'grok-4.7': {in: 2.00, cached: 0.50, out: 6.00},
  'grok-4.6': {in: 2.00, cached: 0.50, out: 6.00},
  'grok-4.5': {in: 2.00, cached: 0.30, out: 6.00},
  'grok-4.3': {in: 1.25, cached: 0.20, out: 2.50},
};

const err = (m, s = 400) => Object.assign(new Error(m), {status: s});
const hasMagic = (b, s, o = 0) => b.slice(o, o + s.length).equals(Buffer.from(s, 'latin1'));
const KINDS = {
  png: ['image/png', b => hasMagic(b, '\x89PNG')],
  jpg: ['image/jpeg', b => b[0] === 0xff && b[1] === 0xd8],
  jpeg: ['image/jpeg', b => b[0] === 0xff && b[1] === 0xd8],
  gif: ['image/gif', b => hasMagic(b, 'GIF8')],
  webp: ['image/webp', b => hasMagic(b, 'RIFF') && hasMagic(b, 'WEBP', 8)],
  pdf: ['application/pdf', b => hasMagic(b, '%PDF')],
};
const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
fs.mkdirSync(DIR, {recursive: true});

export function apiKeySet() {
  return !!(process.env.XAI_API_KEY || '').trim();
}

const iso = v => !v ? null : (v instanceof Date ? v.toISOString() : String(v));

export async function bobbyInit() {
  await q(`
    alter table clients add column if not exists agent_name text not null default 'Bobby';
    alter table clients add column if not exists credit_allowance_zar numeric(12,2) not null default 100;
    alter table clients add column if not exists zar_per_usd numeric(12,4) not null default 17.50;
    alter table clients add column if not exists site_url text;
    alter table users add column if not exists welcome_seen boolean not null default false;

    create table if not exists credit_usage (
      id serial primary key,
      client_id int not null references clients on delete cascade,
      month text not null,
      model text,
      input_tokens int not null default 0,
      cached_input_tokens int not null default 0,
      output_tokens int not null default 0,
      cost_usd numeric(12,6) not null default 0,
      cost_zar numeric(12,4) not null default 0,
      conversation_id int,
      message_id int,
      created_at timestamptz default now()
    );
    create index if not exists credit_usage_client_month on credit_usage(client_id, month);

    create table if not exists bobby_conversations (
      id serial primary key,
      client_id int not null references clients on delete cascade,
      title text not null default 'New chat',
      created_at timestamptz default now(),
      last_at timestamptz,
      created_by int references users on delete set null,
      user_read_at timestamptz default now()
    );
    create index if not exists bobby_conversations_client on bobby_conversations(client_id, last_at);

    create table if not exists bobby_messages (
      id serial primary key,
      conversation_id int not null references bobby_conversations on delete cascade,
      client_id int not null references clients on delete cascade,
      role text not null check(role in ('user','assistant','system','tool')),
      content text not null default '',
      tool_name text,
      tool_call_id text,
      tool_calls jsonb,
      prompt_tokens int,
      completion_tokens int,
      cost_zar numeric(12,4),
      created_at timestamptz default now()
    );
    create index if not exists bobby_messages_conv on bobby_messages(conversation_id, id);

    create table if not exists bobby_files (
      id text primary key,
      client_id int not null references clients on delete cascade,
      conversation_id int references bobby_conversations on delete set null,
      user_id int references users on delete set null,
      name text not null,
      mime text not null,
      size int not null,
      created_at timestamptz default now()
    );
    create index if not exists bobby_files_client on bobby_files(client_id, created_at);

    create table if not exists bobby_action_requests (
      id text primary key,
      kind text not null,
      client_id int not null references clients on delete cascade,
      requested_by int references users on delete set null,
      payload jsonb not null,
      status text not null default 'pending',
      created_at timestamptz default now(),
      expires_at timestamptz not null,
      applied_at timestamptz
    );
    create index if not exists bobby_action_requests_pending on bobby_action_requests(requested_by, status, expires_at);
  `);
}

export function monthKey(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit'}).formatToParts(d);
  return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
}

export async function getClient(id) {
  if (!id) return null;
  const [c] = await q(`
    select c.*, d.domain
    from clients c
    left join lateral (
      select domain from domains
      where client_id = c.id and coalesce(status, 'active') <> 'inactive'
      order by id limit 1
    ) d on true
    where c.id = $1
  `, [id]);
  return c || null;
}

export async function creditsFor(client) {
  const month = monthKey();
  const row = (await creditsFromLog(client.id, month)) || {};
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

function clientFeatures() {
  return [
    {id: 'bobby', name: 'Bobby', comingSoon: false},
    {id: 'web', name: 'Web', comingSoon: true},
    {id: 'crm', name: 'CRM', comingSoon: false},
    {id: 'scott', name: 'Scott', comingSoon: true},
  ];
}

export async function clientPublic(client, user) {
  const credits = await creditsFor(client);
  const siteUrl = client.site_url || (client.domain ? `https://${client.domain}` : null);
  return {
    id: client.id,
    ref: client.ref,
    name: client.name,
    domain: client.domain || null,
    siteUrl,
    agentName: client.agent_name || 'Bobby',
    features: clientFeatures(),
    credits,
    welcomeSeen: !!(user && user.welcome_seen),
  };
}

async function resolveClient(req) {
  // Portal or "view as" already has a client_id on the session.
  if (req.user.client_id) {
    const c = await getClient(req.user.client_id);
    if (!c) throw err('No client account is linked to this sign-in', 403);
    return c;
  }
  if (!isAppAdmin(req.user)) throw err('No client account is linked to this sign-in', 403);
  const raw = req.query.client_id ?? req.body?.client_id ?? req.get('x-bobby-client');
  if (raw) {
    const c = await getClient(+raw);
    if (!c) throw err('No such company', 404);
    return c;
  }
  const pref = (process.env.MAIN_CLIENT_REF || '').trim();
  if (pref) {
    const [c] = await q('select id from clients where lower(ref)=lower($1) or lower(name)=lower($1) limit 1', [pref]);
    if (c) return getClient(c.id);
  }
  throw err('Pick a company first to talk to this helper.', 400);
}

function kindOf(name, buf) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  const k = KINDS[ext];
  if (!k) throw err('File type not allowed. Use PNG, JPEG, GIF, WebP or PDF.');
  if (!buf?.length) throw err('Empty file');
  if (buf.length > MAX) throw err(`This file is ${(buf.length / MB).toFixed(1)} MB. The limit is 5 MB.`);
  if (!k[1](buf)) throw err(`That does not look like a real .${ext} file`);
  return k[0];
}

async function saveClientFile(buf, name, clientId, conversationId, userId) {
  name = String(name || 'file').replace(/[\/\\\x00-\x1f"]/g, '_').slice(-120);
  const mime = kindOf(name, buf);
  const id = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(path.join(DIR, id), buf, {mode: 0o600});
  await q('insert into bobby_files(id,client_id,conversation_id,user_id,name,mime,size) values($1,$2,$3,$4,$5,$6,$7)',
    [id, clientId, conversationId, userId, name, mime, buf.length]);
  const [f] = await q('select * from bobby_files where id=$1 and client_id=$2', [id, clientId]);
  return f;
}

const fileOut = f => f && {id: f.id, name: f.name, mime: f.mime, size: f.size, image: INLINE.has(f.mime), url: '/api/bobby/files/' + f.id};

function sendFile(res, f, dl) {
  res.set({
    'Content-Type': f.mime,
    'Cache-Control': 'private, max-age=86400',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'Content-Disposition': `${INLINE.has(f.mime) && !dl ? 'inline' : 'attachment'}; filename="${f.name.replace(/[^\x20-\x7e]/g, '_')}"`,
  }).send(fs.readFileSync(path.join(DIR, f.id)));
}

async function getConv(clientId, id) {
  const [c] = await q('select * from bobby_conversations where id=$1 and client_id=$2', [+id, clientId]);
  if (!c) throw err('No such conversation', 404);
  return c;
}

function publicMessages(rows) {
  return rows.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({
    id: m.id,
    role: m.role,
    sender: m.role === 'user' ? 'user' : 'assistant',
    text: m.content,
    created_at: iso(m.created_at),
    costZar: m.cost_zar ? +m.cost_zar : undefined,
    files: [],
  }));
}

function welcomeText(client) {
  const name = client.agent_name || 'Bobby';
  const siteUrl = client.site_url || (client.domain ? `https://${client.domain}` : null);
  const site = siteUrl
    ? ` Grid already built a first version of your site. You can look at it here: ${siteUrl}`
    : ' Grid already built a first version of your site.';
  return (
    `Hi, I'm ${name}. I'm your manager, worker, project helper and data helper in this app.` +
    site +
    ` A good next step is to look at the site, then send me your logo and pictures when you have them. You can also rename me if you would like a different name.` +
    ` I can read your information in this app. I will always ask you before I delete anything, spend money, or send an email.`
  );
}

async function ensureWelcome(client, user) {
  const [{n}] = await q('select count(*)::int n from bobby_conversations where client_id=$1', [client.id]);
  if (n > 0) {
    if (!user.welcome_seen) await q('update users set welcome_seen=true where id=$1', [user.id]);
    return;
  }
  const title = `Welcome from ${client.agent_name || 'Bobby'}`;
  const [conv] = await q('insert into bobby_conversations(client_id,title,last_at,created_by) values($1,$2,now(),$3) returning *',
    [client.id, title, user.id]);
  await q("insert into bobby_messages(conversation_id,client_id,role,content) values($1,$2,'assistant',$3)",
    [conv.id, client.id, welcomeText(client)]);
  await q('update users set welcome_seen=true where id=$1', [user.id]);
  return conv;
}

function systemPrompt(client, user, credits) {
  const features = clientFeatures().map(f => `${f.name} (${f.id}${f.comingSoon ? ', coming soon' : ', available now'})`).join('; ');
  const siteUrl = client.site_url || (client.domain ? `https://${client.domain}` : null);
  return [
    `You are ${client.agent_name || 'Bobby'}, the in-app helper for one client. You are their manager, worker, project helper and data helper.`,
    `Talk in short, plain words (about a 4th-grade reading level). If you use a short form like CRM or AI, spell it out once in brackets.`,
    `You may only read this client's data, and only through your tools. Never invent or ask for another client's data. If a tool returns nothing, say so.`,
    `Client name: ${client.name}.`,
    client.domain ? `Their domain (the name of their website): ${client.domain}.` : '',
    siteUrl ? `A first draft of their website is already built at: ${siteUrl}. Offer the link when it helps.` : 'A first draft of their website has already been built.',
    `The person chatting is ${user.name || user.email}.`,
    `Features switched on for them: ${features}.`,
    `AI (Artificial Intelligence) credits this month (${credits.month}): R${credits.usedZar.toFixed(2)} of R${credits.allowanceZar.toFixed(2)} used, R${credits.remainingZar.toFixed(2)} left.`,
    `You will always ask the client before you delete anything, spend money, or send an email. You cannot do those things yet. If they ask, explain that and help them plan the words or steps.`,
    `If they want to rename you, you may use the rename_agent tool, but only when they clearly asked for a new name. Confirm the new name in your reply.`,
    `Useful next steps to offer: look at the site, send a logo and pictures (they can attach a file in this chat), and later set up the contact form (CRM, Customer Relationship Management) and Scott, the helper on the public site.`,
    `You work on the R100 of Grok credits included in their monthly plan. If credits run out, say so kindly and tell them to ask Planet Grid about a top-up. Do not promise free extra credits.`,
    isAppAdmin(user) ? `The person chatting is a site admin. They may look up any of this server's clients (name, domain, billing email and contacts) and may ask you to change a client's billing email.` : '',
    isAppAdmin(user) ? `To change a billing email: first find the client, then use propose_billing_email_change. Show the old and new email clearly and ask them to confirm. Only use apply_billing_email_change after they clearly say yes or click Yes. Never change invoices, payments or balances. Never send an email. Never update the email yourself except through those tools.` : `You cannot change billing data. If they ask to change a billing email, tell them to ask the site admin (Planet Grid).`,
  ].filter(Boolean).join('\n');
}

const ADMIN_TOOLS = [
  {type: 'function', function: {name: 'search_clients', description: "Find this server's clients by name, domain, reference or billing email. Returns name, domain, billing email and contacts only. Never returns invoices, payments or balances.", parameters: {type: 'object', properties: {query: {type: 'string', description: 'Two or more letters to search for.'}}, required: ['query'], additionalProperties: false}}},
  {type: 'function', function: {name: 'get_client_billing', description: "Get one client's name, domain, billing email and contacts. Never returns invoices, payments or balances.", parameters: {type: 'object', properties: {client_id: {type: 'integer', description: 'The client id from search_clients.'}}, required: ['client_id'], additionalProperties: false}}},
  {type: 'function', function: {name: 'propose_billing_email_change', description: 'Prepare a billing-email change for one client. This does not save yet. Show the old and new email and ask the admin to confirm.', parameters: {type: 'object', properties: {client_id: {type: 'integer'}, new_email: {type: 'string', description: 'The new billing email.'}}, required: ['client_id', 'new_email'], additionalProperties: false}}},
  {type: 'function', function: {name: 'apply_billing_email_change', description: 'Save a proposed billing-email change. Only use after the admin clearly said yes or clicked Yes.', parameters: {type: 'object', properties: {action_id: {type: 'string'}, confirmed: {type: 'boolean'}}, required: ['action_id', 'confirmed'], additionalProperties: false}}},
];

const TOOLS = [
  {type: 'function', function: {name: 'get_account', description: "Get this client's name, domain, website draft link, and helper name.", parameters: {type: 'object', properties: {}, additionalProperties: false}}},
  {type: 'function', function: {name: 'list_features', description: 'List the app areas switched on for this client, and which ones are still coming soon.', parameters: {type: 'object', properties: {}, additionalProperties: false}}},
  {type: 'function', function: {name: 'get_credits', description: "Get this month's AI (Artificial Intelligence) credit use and the R100 allowance.", parameters: {type: 'object', properties: {}, additionalProperties: false}}},
  {type: 'function', function: {name: 'list_people', description: 'List the people (names and emails) who can sign in to this client account. Never list any other client.', parameters: {type: 'object', properties: {}, additionalProperties: false}}},
  {type: 'function', function: {name: 'list_files', description: 'List files this client has already sent (logos, pictures, PDFs).', parameters: {type: 'object', properties: {}, additionalProperties: false}}},
  {type: 'function', function: {name: 'rename_agent', description: 'Rename the in-app helper for this client. Only use when the client clearly asked to change the name.', parameters: {type: 'object', properties: {new_name: {type: 'string', description: 'The new name, 2 to 40 letters, numbers, spaces or hyphens.'}}, required: ['new_name'], additionalProperties: false}}},
];

function validAgentName(raw) {
  const name = String(raw || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 40) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .\-']*$/u.test(name)) return null;
  return name;
}

async function runTool(client, user, name, args) {
  if (name === 'get_account') {
    const siteUrl = client.site_url || (client.domain ? `https://${client.domain}` : null);
    return {name: client.name, domain: client.domain, siteUrl, agentName: client.agent_name, ref: client.ref};
  }
  if (name === 'list_features') {
    return clientFeatures();
  }
  if (name === 'get_credits') {
    return creditsFor(client);
  }
  if (name === 'list_people') {
    const rows = await q('select name, email, role from users where client_id=$1 order by id', [client.id]);
    return rows.map(u => ({name: u.name, email: u.email, role: u.role}));
  }
  if (name === 'list_files') {
    const rows = await q('select id, name, mime, size, created_at from bobby_files where client_id=$1 order by created_at desc limit 50', [client.id]);
    return rows.map(f => ({name: f.name, type: f.mime, sizeBytes: f.size, addedAt: iso(f.created_at)}));
  }
  if (name === 'rename_agent') {
    const nameNew = validAgentName(args?.new_name);
    if (!nameNew) return {error: 'That name is not allowed. Use 2 to 40 letters, numbers, spaces or hyphens.'};
    const updated = await withLoggedWrite({
      entity: 'clients', recordId: client.id, clientId: client.id, user, via: 'rename_agent',
      apply: async ({q}) => {
        const [row] = await q('update clients set agent_name=$1 where id=$2 returning *', [nameNew, client.id]);
        return row;
      },
    });
    client.agent_name = updated.agent_name;
    return {ok: true, agentName: updated.agent_name};
  }
  if (name === 'search_clients') {
    if (!isAppAdmin(user)) return {error: 'Only a site admin can look up other clients.'};
    return searchClients(args?.query);
  }
  if (name === 'get_client_billing') {
    if (!isAppAdmin(user)) return {error: 'Only a site admin can look up other clients.'};
    return getClientBilling(+args?.client_id);
  }
  if (name === 'propose_billing_email_change') {
    return proposeBillingEmailChange(user, {client_id: args?.client_id, new_email: args?.new_email});
  }
  if (name === 'apply_billing_email_change') {
    if (!args?.confirmed) return {error: 'Not saved. The admin did not confirm.'};
    try {
      return await applyBillingEmailChange(user, String(args?.action_id || ''), {confirmed: true});
    } catch (e) {
      return {error: e.message};
    }
  }
  return {error: 'Unknown tool'};
}

function priceOf(model, usage) {
  const p = PRICES[model] || PRICES['grok-4.7'];
  const input = +(usage?.prompt_tokens || 0);
  const cached = +(usage?.prompt_tokens_details?.cached_tokens || usage?.cached_tokens || 0);
  const fresh = Math.max(0, input - cached);
  const output = +(usage?.completion_tokens || 0);
  const usd = (fresh * p.in + cached * p.cached + output * p.out) / 1e6;
  return {input, cached, output, usd};
}

async function recordUsage(client, model, usage, conversationId, messageId) {
  const {input, cached, output, usd} = priceOf(model, usage);
  const zar = usd * (+client.zar_per_usd || +(process.env.XAI_ZAR_PER_USD || 17.5));
  await q(`
    insert into credit_usage(client_id,month,model,input_tokens,cached_input_tokens,output_tokens,cost_usd,cost_zar,conversation_id,message_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  `, [client.id, monthKey(), model, input, cached, output, usd, zar, conversationId, messageId]);
  return zar;
}

async function callXai(messages, tools) {
  const key = (process.env.XAI_API_KEY || '').trim();
  if (!key) throw err('Bobby is not connected to Grok yet. An API (Application Programming Interface) key needs to be set.', 503);
  const model = DEFAULT_MODEL;
  const body = {model, messages, tools, tool_choice: 'auto', temperature: 0.6};
  const r = await fetch(XAI_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(45_000),
    headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key},
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || data?.error || `The Grok service returned ${r.status}`;
    console.error('xai error', r.status, typeof msg === 'string' ? msg.slice(0, 200) : 'err');
    throw err(r.status === 401 || r.status === 403
      ? 'The Grok key was rejected. Please check it with Planet Grid.'
      : 'Bobby could not reach Grok just now. Please try again in a moment.', 502);
  }
  return {model, data};
}

async function historyForModel(convId, clientId, limit = 30) {
  const rows = (await q('select * from bobby_messages where conversation_id=$1 and client_id=$2 order by id desc limit $3', [convId, clientId, limit])).reverse();
  const out = [];
  for (const m of rows) {
    if (m.role === 'tool') {
      out.push({role: 'tool', tool_call_id: m.tool_call_id, content: m.content || ''});
    } else if (m.role === 'assistant' && m.tool_calls) {
      const calls = typeof m.tool_calls === 'string' ? JSON.parse(m.tool_calls) : m.tool_calls;
      out.push({role: 'assistant', content: m.content || '', tool_calls: calls || undefined});
    } else if (m.role === 'user' || m.role === 'assistant') {
      out.push({role: m.role, content: m.content || ''});
    }
  }
  return out;
}

async function insertAssistant(convId, clientId, text, extra = {}) {
  const [row] = await q(
    `insert into bobby_messages(conversation_id,client_id,role,content,tool_calls,prompt_tokens,completion_tokens,cost_zar)
     values($1,$2,'assistant',$3,$4,$5,$6,$7) returning *`,
    [convId, clientId, text, extra.tool_calls ? JSON.stringify(extra.tool_calls) : null, extra.prompt_tokens || null, extra.completion_tokens || null, extra.cost_zar || 0]
  );
  return row;
}

async function replyTo(client, user, conv, userText) {
  return withPromptLog({agent: 'bobby', user, client, prompt: userText, conversationId: conv.id}, async ({markModel, setMeta}) => {
  const credits = await creditsFor(client);
  if (credits.exhausted) {
    const text = `Our AI (Artificial Intelligence) credits for this month are used up. The plan includes R${credits.allowanceZar.toFixed(0)} a month. Please ask Planet Grid about a top-up if you need more.`;
    const row = await insertAssistant(conv.id, client.id, text);
    await q('update bobby_conversations set last_at=now() where id=$1 and client_id=$2', [conv.id, client.id]);
    setMeta({response_length: text.length, cost_zar: 0});
    return row;
  }
  if (!apiKeySet()) {
    const siteUrl = client.site_url || (client.domain ? `https://${client.domain}` : 'the link on this page');
    const text = `I can show you around, but I am not connected to Grok yet. Planet Grid still needs to add an API (Application Programming Interface) key. Your site draft is at ${siteUrl}, and you can already rename me with the Rename button.`;
    const row = await insertAssistant(conv.id, client.id, text);
    await q('update bobby_conversations set last_at=now() where id=$1 and client_id=$2', [conv.id, client.id]);
    setMeta({response_length: text.length, cost_zar: 0});
    return row;
  }

  const messages = [
    {role: 'system', content: systemPrompt(client, user, credits)},
    ...await historyForModel(conv.id, client.id),
  ];

  let lastZar = 0;
  let inTok = 0, cachedTok = 0, outTok = 0, lastModel = null;
  let final = null;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const tools = isAppAdmin(user) ? [...TOOLS, ...ADMIN_TOOLS] : TOOLS;
    const {model, data} = await markModel(callXai(messages, tools));
    const choice = data.choices?.[0]?.message;
    if (!choice) throw err('Bobby got an empty reply. Please try again.', 502);
    const usage = data.usage || {};
    const toolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];
    const content = String(choice.content || '');

    const saved = await insertAssistant(conv.id, client.id, content, {
      tool_calls: toolCalls.length ? toolCalls : null,
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      cost_zar: 0,
    });
    const priced = priceOf(model, usage);
    inTok += priced.input; cachedTok += priced.cached; outTok += priced.output; lastModel = model;
    lastZar += await recordUsage(client, model, usage, conv.id, saved.id);
    await q('update bobby_messages set cost_zar=$1 where id=$2 and client_id=$3', [lastZar, saved.id, client.id]);

    if (!toolCalls.length) {
      const [row] = await q('select * from bobby_messages where id=$1 and client_id=$2', [saved.id, client.id]);
      final = row;
      break;
    }
    messages.push({role: 'assistant', content, tool_calls: toolCalls});
    for (const call of toolCalls) {
      let args = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch { args = {}; }
      const result = await runTool(client, user, call.function?.name, args);
      const payload = JSON.stringify(result);
      await q("insert into bobby_messages(conversation_id,client_id,role,content,tool_name,tool_call_id) values($1,$2,'tool',$3,$4,$5)",
        [conv.id, client.id, payload, call.function?.name || '', call.id]);
      messages.push({role: 'tool', tool_call_id: call.id, content: payload});
    }
    const fresh = await getClient(client.id);
    if (fresh) Object.assign(client, fresh);
  }

  if (!final) {
    final = await insertAssistant(conv.id, client.id, 'I looked a few things up but did not finish a reply. Please ask me again in a short sentence.');
  }
  const title = (userText.trim().split('\n')[0] || 'Chat').slice(0, 60);
  await q(`update bobby_conversations set last_at=now(),
    title=case when title like 'Welcome from %' or title='New chat' then $1 else title end
    where id=$2 and client_id=$3`, [title, conv.id, client.id]);
  setMeta({
    model: lastModel,
    input_tokens: inTok,
    cached_input_tokens: cachedTok,
    output_tokens: outTok,
    cost_zar: lastZar,
    response_length: (final?.content || '').length,
  });
  return final;
  });
}

const raw = express.raw({type: () => true, limit: MAX + 1024});
const ids = v => [...new Set((Array.isArray(v) ? v : []).map(String))].filter(x => /^[0-9a-f]{32}$/.test(x)).slice(0, 10);

async function withFiles(clientId, convId, messages) {
  const files = await q('select * from bobby_files where client_id=$1 and conversation_id=$2 order by created_at', [clientId, convId]);
  return messages.map(m => ({...m, files: []})).map((m, i, arr) => {
    if (m.role !== 'user') return m;
    const t = Date.parse(m.created_at) || 0;
    const prev = arr.slice(0, i).reverse().find(x => x.role === 'user');
    const prevT = prev ? (Date.parse(prev.created_at) || 0) : 0;
    m.files = files.filter(f => {
      const ft = Date.parse(iso(f.created_at)) || 0;
      return ft <= t + 2000 && ft > prevT;
    }).map(fileOut);
    return m;
  });
}

export function bobbyRoutes(r, {W}) {
  r.get('/bobby/clients', W(async (req, res) => {
    if (!isAppAdmin(req.user)) throw err('This list is only for the site admin', 403);
    const rows = await q('select id, ref, name from clients where active is not false order by name');
    res.json(rows);
  }));

  r.get('/bobby/status', W(async (req, res) => {
    const client = await resolveClient(req);
    await ensureWelcome(client, req.user);
    res.json({
      client: await clientPublic(await getClient(client.id), req.user),
      grokConfigured: apiKeySet(),
      model: apiKeySet() ? DEFAULT_MODEL : null,
    });
  }));

  r.patch('/bobby/settings', W(async (req, res) => {
    const client = await resolveClient(req);
    const name = validAgentName(req.body?.agentName ?? req.body?.agent_name);
    if (!name) throw err('Please pick a name of 2 to 40 letters, numbers, spaces or hyphens.');
    await withLoggedWrite({
      entity: 'clients', recordId: client.id, clientId: client.id, user: req.user, via: 'ui',
      apply: async ({q}) => {
        const [row] = await q('update clients set agent_name=$1 where id=$2 returning *', [name, client.id]);
        return row;
      },
    });
    res.json({agentName: name, client: await clientPublic(await getClient(client.id), req.user)});
  }));

  r.get('/bobby/credits', W(async (req, res) => {
    const client = await resolveClient(req);
    res.json({...await creditsFor(client), grokConfigured: apiKeySet()});
  }));

  r.get('/bobby/conversations', W(async (req, res) => {
    const client = await resolveClient(req);
    await ensureWelcome(client, req.user);
    const list = await q(`
      select c.id, c.title, c.created_at, c.last_at,
        (select content from bobby_messages where conversation_id=c.id and role in ('user','assistant') order by id desc limit 1) last_text,
        (select count(*)::int from bobby_messages m where m.conversation_id=c.id and m.role='assistant' and m.created_at > coalesce(c.user_read_at, to_timestamp(0))) unread
      from bobby_conversations c
      where c.client_id=$1
      order by coalesce(c.last_at, c.created_at) desc
    `, [client.id]);
    res.json(list.map(c => ({...c, created_at: iso(c.created_at), last_at: iso(c.last_at)})));
  }));

  r.post('/bobby/conversations', W(async (req, res) => {
    const client = await resolveClient(req);
    const title = String(req.body?.title || '').trim().slice(0, 80) || 'New chat';
    const [c] = await q('insert into bobby_conversations(client_id,title,last_at,created_by) values($1,$2,now(),$3) returning id,title,created_at',
      [client.id, title, req.user.id]);
    res.json({...c, created_at: iso(c.created_at)});
  }));

  r.get('/bobby/conversations/:id', W(async (req, res) => {
    const client = await resolveClient(req);
    const c = await getConv(client.id, req.params.id);
    const after = +req.query.after || 0;
    const rows = await q('select * from bobby_messages where conversation_id=$1 and client_id=$2 and id>$3 order by id', [c.id, client.id, after]);
    await q('update bobby_conversations set user_read_at=now() where id=$1 and client_id=$2', [c.id, client.id]);
    const messages = await withFiles(client.id, c.id, publicMessages(rows).map(m => {
      const rawRow = rows.find(r => r.id === m.id);
      return {...m, conversation_id: c.id, created_at: iso(rawRow.created_at)};
    }));
    const pending = isAppAdmin(req.user) ? publicAction(await pendingForUser(req.user, client.id)) : null;
    res.json({id: c.id, title: c.title, agentName: client.agent_name, messages, pendingAction: pending});
  }));

  r.post('/bobby/conversations/:id/messages', W(async (req, res) => {
    const client = await resolveClient(req);
    const c = await getConv(client.id, req.params.id);
    const text = String(req.body?.text || '').slice(0, 8000);
    const fileIds = ids(req.body?.files);
    const files = [];
    for (const i of fileIds) {
      const [f] = await q('select * from bobby_files where id=$1 and client_id=$2', [i, client.id]);
      if (!f) throw err('File not found');
      if (f.conversation_id && f.conversation_id !== c.id) throw err('File is not in this chat');
      if (!f.conversation_id) await q('update bobby_files set conversation_id=$1 where id=$2 and client_id=$3', [c.id, f.id, client.id]);
      files.push(f);
    }
    if (!text.trim() && !files.length) throw err('Write a message or attach a file');
    const content = text.trim() || (files.length ? files.map(f => f.name).join(', ') : '');
    const [userMsg] = await q("insert into bobby_messages(conversation_id,client_id,role,content) values($1,$2,'user',$3) returning *",
      [c.id, client.id, content]);
    await q('update bobby_conversations set last_at=now() where id=$1 and client_id=$2', [c.id, client.id]);
    const assistant = await replyTo(await getClient(client.id), req.user, c, content);
    const fresh = await getClient(client.id);
    const pending = isAppAdmin(req.user) ? publicAction(await pendingForUser(req.user, client.id)) : null;
    res.json({
      user: {...publicMessages([userMsg])[0], files: files.map(fileOut)},
      assistant: publicMessages([assistant])[0],
      credits: await creditsFor(fresh),
      agentName: fresh.agent_name,
      pendingAction: pending,
    });
  }));

  r.post('/bobby/conversations/:id/upload', raw, W(async (req, res) => {
    const client = await resolveClient(req);
    const c = await getConv(client.id, req.params.id);
    res.json(fileOut(await saveClientFile(req.body, req.query.name, client.id, c.id, req.user.id)));
  }));

  r.get('/bobby/files/:id', W(async (req, res) => {
    const client = await resolveClient(req);
    const [f] = /^[0-9a-f]{32}$/.test(req.params.id)
      ? await q('select * from bobby_files where id=$1 and client_id=$2', [req.params.id, client.id])
      : [null];
    if (!f) throw err('Not found', 404);
    sendFile(res, f, req.query.dl === '1');
  }));

  r.get('/bobby/actions/pending', W(async (req, res) => {
    if (!isAppAdmin(req.user)) throw err('Only a site admin can see this.', 403);
    const client = req.user.client_id ? await resolveClient(req) : null;
    res.json({action: publicAction(await pendingForUser(req.user, client && client.id))});
  }));

  r.post('/bobby/actions/:id/confirm', W(async (req, res) => {
    if (!isAppAdmin(req.user)) throw err('Only a site admin can confirm this.', 403);
    const ok = !!req.body?.confirm;
    if (!ok) {
      res.json(await cancelBillingEmailChange(req.user, req.params.id));
      return;
    }
    const result = await applyBillingEmailChange(req.user, req.params.id, {confirmed: true});
    res.json(result);
  }));
}
