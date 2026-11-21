// Bobby: the client's in-app helper. All reads are scoped to req.user.client_id.
import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {db, now} from './db.js';
import {getClient, featuresFor, creditsFor, monthKey, clientPublic} from './clients.js';

const DIR = process.env.UPLOAD_DIR || '/data/uploads';
const MB = 1024 * 1024;
const MAX = 5 * MB;
const MAX_ROUNDS = 4;
const XAI_URL = 'https://api.x.ai/v1/chat/completions';
const DEFAULT_MODEL = process.env.XAI_MODEL || 'grok-4.3';

// USD per 1 million tokens, short-context rates (prompt under 200k).
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

function kindOf(name, buf) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  const k = KINDS[ext];
  if (!k) throw err('File type not allowed. Use PNG, JPEG, GIF, WebP or PDF.');
  if (!buf?.length) throw err('Empty file');
  if (buf.length > MAX) throw err(`This file is ${(buf.length / MB).toFixed(1)} MB. The limit is 5 MB.`);
  if (!k[1](buf)) throw err(`That does not look like a real .${ext} file`);
  return k[0];
}

function saveClientFile(buf, name, clientId, conversationId, userId) {
  name = String(name || 'file').replace(/[\/\\\x00-\x1f"]/g, '_').slice(-120);
  const mime = kindOf(name, buf);
  const id = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(path.join(DIR, id), buf, {mode: 0o600});
  db.prepare('insert into client_files(id,client_id,conversation_id,user_id,name,mime,size) values(?,?,?,?,?,?,?)')
    .run(id, clientId, conversationId, userId, name, mime, buf.length);
  return db.prepare('select * from client_files where id=? and client_id=?').get(id, clientId);
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

function getConv(clientId, id) {
  const c = db.prepare('select * from bobby_conversations where id=? and client_id=?').get(+id, clientId);
  if (!c) throw err('No such conversation', 404);
  return c;
}

function publicMessages(rows) {
  return rows.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({
    id: m.id,
    role: m.role,
    sender: m.role === 'user' ? 'user' : 'assistant',
    text: m.content,
    created_at: m.created_at,
    costZar: m.cost_zar || undefined,
    files: [],
  }));
}


function welcomeText(client) {
  const name = client.agent_name || 'Bobby';
  const site = client.site_url
    ? ` Grid already built a first version of your site. You can look at it here: ${client.site_url}`
    : ' Grid already built a first version of your site.';
  return (
    `Hi, I'm ${name}. I'm your manager, worker, project helper and data helper in this app.` +
    site +
    ` A good next step is to look at the site, then send me your logo and pictures when you have them. You can also rename me if you would like a different name.` +
    ` I can read your information in this app. I will always ask you before I delete anything, spend money, or send an email.`
  );
}

function ensureWelcome(client, user) {
  const existing = db.prepare('select count(*) n from bobby_conversations where client_id=?').get(client.id).n;
  if (existing > 0) {
    if (!user.welcome_seen) db.prepare('update users set welcome_seen=1 where id=?').run(user.id);
    return;
  }
  const title = `Welcome from ${client.agent_name || 'Bobby'}`;
  const conv = db.prepare('insert into bobby_conversations(client_id,title,last_at,created_by) values(?,?,strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\'),?) returning *')
    .get(client.id, title, user.id);
  db.prepare("insert into bobby_messages(conversation_id,client_id,role,content) values(?,?,'assistant',?)")
    .run(conv.id, client.id, welcomeText(client));
  db.prepare('update users set welcome_seen=1 where id=?').run(user.id);
  return conv;
}

function systemPrompt(client, user) {
  const credits = creditsFor(client);
  const features = featuresFor(client.id).map(f => `${f.name} (${f.id}${f.comingSoon ? ', coming soon' : ', available now'})`).join('; ');
  return [
    `You are ${client.agent_name || 'Bobby'}, the in-app helper for one client. You are their manager, worker, project helper and data helper.`,
    `Talk in short, plain words (about a 4th-grade reading level). If you use a short form like CRM or AI, spell it out once in brackets.`,
    `You may only read this client's data, and only through your tools. Never invent or ask for another client's data. If a tool returns nothing, say so.`,
    `Client name: ${client.name}.`,
    client.domain ? `Their domain (the name of their website): ${client.domain}.` : '',
    client.site_url ? `A first draft of their website is already built at: ${client.site_url}. Offer the link when it helps.` : 'A first draft of their website has already been built.',
    `The person chatting is ${user.name || user.email}.`,
    `Features switched on for them: ${features}.`,
    `AI (Artificial Intelligence) credits this month (${credits.month}): R${credits.usedZar.toFixed(2)} of R${credits.allowanceZar.toFixed(2)} used, R${credits.remainingZar.toFixed(2)} left.`,
    `You will always ask the client before you delete anything, spend money, or send an email. You cannot do those things yet. If they ask, explain that and help them plan the words or steps.`,
    `If they want to rename you, you may use the rename_agent tool, but only when they clearly asked for a new name. Confirm the new name in your reply.`,
    `Useful next steps to offer: look at the site, send a logo and pictures (they can attach a file in this chat; a Resources page for uploads is also coming soon), and later set up the contact form (CRM, Customer Relationship Management) and Scott, the helper on the public site.`,
    `You work on the R100 of Grok credits included in their monthly plan. If credits run out, say so kindly and tell them to ask Planet Grid about a top-up. Do not promise free extra credits.`,
  ].filter(Boolean).join('\n');
}

const TOOLS = [
  {type: 'function', function: {name: 'get_account', description: "Get this client's name, domain, website draft link, and helper name.", parameters: {type: 'object', properties: {}, additionalProperties: false}}},
  {type: 'function', function: {name: 'list_features', description: 'List the app areas switched on for this client, and which ones are still coming soon.', parameters: {type: 'object', properties: {}, additionalProperties: false}}},
  {type: 'function', function: {name: 'get_credits', description: 'Get this month\'s AI (Artificial Intelligence) credit use and the R100 allowance.', parameters: {type: 'object', properties: {}, additionalProperties: false}}},
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

function runTool(client, name, args) {
  if (name === 'get_account') {
    return {name: client.name, domain: client.domain, siteUrl: client.site_url, agentName: client.agent_name, slug: client.slug};
  }
  if (name === 'list_features') {
    return featuresFor(client.id).map(f => ({id: f.id, name: f.name, description: f.description, comingSoon: f.comingSoon}));
  }
  if (name === 'get_credits') {
    return creditsFor(client);
  }
  if (name === 'list_people') {
    return db.prepare('select name, email, role from users where client_id=? order by id').all(client.id)
      .map(u => ({name: u.name, email: u.email, role: u.role}));
  }
  if (name === 'list_files') {
    return db.prepare('select id, name, mime, size, created_at from client_files where client_id=? order by created_at desc limit 50').all(client.id)
      .map(f => ({name: f.name, type: f.mime, sizeBytes: f.size, addedAt: f.created_at}));
  }
  if (name === 'rename_agent') {
    const nameNew = validAgentName(args?.new_name);
    if (!nameNew) return {error: 'That name is not allowed. Use 2 to 40 letters, numbers, spaces or hyphens.'};
    db.prepare('update clients set agent_name=? where id=?').run(nameNew, client.id);
    client.agent_name = nameNew;
    return {ok: true, agentName: nameNew};
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

function recordUsage(client, model, usage, conversationId, messageId) {
  const {input, cached, output, usd} = priceOf(model, usage);
  const zar = usd * (+client.zar_per_usd || +(process.env.XAI_ZAR_PER_USD || 17.5));
  db.prepare(`
    insert into credit_usage(client_id,month,model,input_tokens,cached_input_tokens,output_tokens,cost_usd,cost_zar,conversation_id,message_id)
    values(?,?,?,?,?,?,?,?,?,?)
  `).run(client.id, monthKey(), model, input, cached, output, usd, zar, conversationId, messageId);
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

function historyForModel(convId, clientId, limit = 30) {
  const rows = db.prepare('select * from bobby_messages where conversation_id=? and client_id=? order by id desc limit ?').all(convId, clientId, limit).reverse();
  const out = [];
  for (const m of rows) {
    if (m.role === 'tool') {
      out.push({role: 'tool', tool_call_id: m.tool_call_id, content: m.content || ''});
    } else if (m.role === 'assistant' && m.tool_calls) {
      let calls;
      try { calls = JSON.parse(m.tool_calls); } catch { calls = null; }
      out.push({role: 'assistant', content: m.content || '', tool_calls: calls || undefined});
    } else if (m.role === 'user' || m.role === 'assistant') {
      out.push({role: m.role, content: m.content || ''});
    }
  }
  return out;
}

async function replyTo(client, user, conv, userText) {
  const credits = creditsFor(client);
  if (credits.exhausted) {
    const text = `Our AI (Artificial Intelligence) credits for this month are used up. The plan includes R${credits.allowanceZar.toFixed(0)} a month. Please ask Planet Grid about a top-up if you need more.`;
    const row = db.prepare("insert into bobby_messages(conversation_id,client_id,role,content) values(?,?,'assistant',?) returning *")
      .get(conv.id, client.id, text);
    db.prepare("update bobby_conversations set last_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') where id=? and client_id=?").run(conv.id, client.id);
    return row;
  }
  if (!apiKeySet()) {
    const text = `I can show you around, but I am not connected to Grok yet. Planet Grid still needs to add an API (Application Programming Interface) key. Your site draft is at ${client.site_url || 'the link on this page'}, and you can already rename me with the Rename button.`;
    const row = db.prepare("insert into bobby_messages(conversation_id,client_id,role,content) values(?,?,'assistant',?) returning *")
      .get(conv.id, client.id, text);
    db.prepare("update bobby_conversations set last_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') where id=? and client_id=?").run(conv.id, client.id);
    return row;
  }

  const messages = [
    {role: 'system', content: systemPrompt(client, user)},
    ...historyForModel(conv.id, client.id),
  ];

  let lastZar = 0;
  let final = null;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const {model, data} = await callXai(messages, TOOLS);
    const choice = data.choices?.[0]?.message;
    if (!choice) throw err('Bobby got an empty reply. Please try again.', 502);
    const usage = data.usage || {};
    const toolCalls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];
    const content = String(choice.content || '');

    const saved = db.prepare("insert into bobby_messages(conversation_id,client_id,role,content,tool_calls,prompt_tokens,completion_tokens,cost_zar) values(?,?,'assistant',?,?,?,?,?) returning *")
      .get(conv.id, client.id, content, toolCalls.length ? JSON.stringify(toolCalls) : null, usage.prompt_tokens || 0, usage.completion_tokens || 0, 0);
    lastZar += recordUsage(client, model, usage, conv.id, saved.id);
    db.prepare('update bobby_messages set cost_zar=? where id=? and client_id=?').run(lastZar, saved.id, client.id);

    if (!toolCalls.length) {
      final = db.prepare('select * from bobby_messages where id=? and client_id=?').get(saved.id, client.id);
      break;
    }
    messages.push({role: 'assistant', content, tool_calls: toolCalls});
    for (const call of toolCalls) {
      let args = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch { args = {}; }
      const result = runTool(client, call.function?.name, args);
      const payload = JSON.stringify(result);
      db.prepare("insert into bobby_messages(conversation_id,client_id,role,content,tool_name,tool_call_id) values(?,?,'tool',?,?,?)")
        .run(conv.id, client.id, payload, call.function?.name || '', call.id);
      messages.push({role: 'tool', tool_call_id: call.id, content: payload});
    }
    // Refresh client in case rename_agent ran
    const fresh = getClient(client.id);
    if (fresh) Object.assign(client, fresh);
  }

  if (!final) {
    const text = 'I looked a few things up but did not finish a reply. Please ask me again in a short sentence.';
    final = db.prepare("insert into bobby_messages(conversation_id,client_id,role,content) values(?,?,'assistant',?) returning *")
      .get(conv.id, client.id, text);
  }
  db.prepare("update bobby_conversations set last_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), title=case when title like 'Welcome from %' or title='New chat' then substr(?,1,60) else title end where id=? and client_id=?")
    .run(userText.trim().split('\n')[0].slice(0, 60) || 'Chat', conv.id, client.id);
  return final;
}

const raw = express.raw({type: () => true, limit: MAX + 1024});
const ids = v => [...new Set((Array.isArray(v) ? v : []).map(String))].filter(x => /^[0-9a-f]{32}$/.test(x)).slice(0, 10);

function withFiles(clientId, convId, messages) {
  const files = db.prepare('select * from client_files where client_id=? and conversation_id=? order by created_at').all(clientId, convId);
  // Attach files to the next user message after the file's created_at, or to the latest user message.
  return messages.map(m => ({...m, files: []})).map((m, i, arr) => {
    if (m.role !== 'user') return m;
    const t = Date.parse(m.created_at) || 0;
    const prev = arr.slice(0, i).reverse().find(x => x.role === 'user');
    const prevT = prev ? (Date.parse(prev.created_at) || 0) : 0;
    m.files = files.filter(f => {
      const ft = Date.parse(f.created_at) || 0;
      return ft <= t + 2000 && ft > prevT;
    }).map(fileOut);
    return m;
  });
}

export function bobbyRoutes(r, {W}) {
  r.get('/bobby/status', W(async (req, res) => {
    const client = getClient(req.user.client_id);
    if (!client) throw err('No client account is linked to this sign-in', 403);
    ensureWelcome(client, req.user);
    res.json({
      client: clientPublic(getClient(client.id), req.user),
      grokConfigured: apiKeySet(),
      model: apiKeySet() ? DEFAULT_MODEL : null,
    });
  }));

  r.patch('/bobby/settings', W(async (req, res) => {
    const client = getClient(req.user.client_id);
    if (!client) throw err('No client account is linked to this sign-in', 403);
    const name = validAgentName(req.body?.agentName ?? req.body?.agent_name);
    if (!name) throw err('Please pick a name of 2 to 40 letters, numbers, spaces or hyphens.');
    db.prepare('update clients set agent_name=? where id=?').run(name, client.id);
    res.json({agentName: name, client: clientPublic(getClient(client.id), req.user)});
  }));

  r.get('/bobby/credits', W(async (req, res) => {
    const client = getClient(req.user.client_id);
    if (!client) throw err('No client account is linked to this sign-in', 403);
    res.json({...creditsFor(client), grokConfigured: apiKeySet()});
  }));

  r.get('/bobby/conversations', W(async (req, res) => {
    const client = getClient(req.user.client_id);
    if (!client) throw err('No client account is linked to this sign-in', 403);
    ensureWelcome(client, req.user);
    const list = db.prepare(`
      select c.id, c.title, c.created_at, c.last_at,
        (select content from bobby_messages where conversation_id=c.id and role in ('user','assistant') order by id desc limit 1) last_text,
        (select count(*) from bobby_messages m where m.conversation_id=c.id and m.role='assistant' and strftime('%s', m.created_at)*1000 > coalesce(c.user_read_at,0)) unread
      from bobby_conversations c
      where c.client_id=?
      order by coalesce(c.last_at, c.created_at) desc
    `).all(client.id);
    res.json(list);
  }));

  r.post('/bobby/conversations', W(async (req, res) => {
    const client = getClient(req.user.client_id);
    if (!client) throw err('No client account is linked to this sign-in', 403);
    const title = String(req.body?.title || '').trim().slice(0, 80) || 'New chat';
    const c = db.prepare("insert into bobby_conversations(client_id,title,last_at,created_by) values(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),?) returning id,title,created_at")
      .get(client.id, title, req.user.id);
    res.json(c);
  }));

  r.get('/bobby/conversations/:id', W(async (req, res) => {
    const client = getClient(req.user.client_id);
    if (!client) throw err('No client account is linked to this sign-in', 403);
    const c = getConv(client.id, req.params.id);
    const after = +req.query.after || 0;
    const rows = db.prepare('select * from bobby_messages where conversation_id=? and client_id=? and id>? order by id').all(c.id, client.id, after);
    db.prepare('update bobby_conversations set user_read_at=? where id=? and client_id=?').run(now(), c.id, client.id);
    const messages = withFiles(client.id, c.id, publicMessages(rows).map(m => {
      const raw = rows.find(r => r.id === m.id);
      return {...m, conversation_id: c.id, created_at: raw.created_at};
    }));
    res.json({id: c.id, title: c.title, agentName: client.agent_name, messages});
  }));

  r.post('/bobby/conversations/:id/messages', W(async (req, res) => {
    const client = getClient(req.user.client_id);
    if (!client) throw err('No client account is linked to this sign-in', 403);
    const c = getConv(client.id, req.params.id);
    const text = String(req.body?.text || '').slice(0, 8000);
    const fileIds = ids(req.body?.files);
    const files = fileIds.map(i => {
      const f = db.prepare('select * from client_files where id=? and client_id=?').get(i, client.id);
      if (!f) throw err('File not found');
      if (f.conversation_id && f.conversation_id !== c.id) throw err('File is not in this chat');
      if (!f.conversation_id) db.prepare('update client_files set conversation_id=? where id=? and client_id=?').run(c.id, f.id, client.id);
      return f;
    });
    if (!text.trim() && !files.length) throw err('Write a message or attach a file');
    const content = text.trim() || (files.length ? files.map(f => f.name).join(', ') : '');
    const userMsg = db.prepare("insert into bobby_messages(conversation_id,client_id,role,content) values(?,?,'user',?) returning *")
      .get(c.id, client.id, content);
    db.prepare("update bobby_conversations set last_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') where id=? and client_id=?").run(c.id, client.id);
    const assistant = await replyTo(getClient(client.id), req.user, c, content);
    res.json({
      user: {...publicMessages([userMsg])[0], files: files.map(fileOut)},
      assistant: publicMessages([assistant])[0],
      credits: creditsFor(getClient(client.id)),
      agentName: getClient(client.id).agent_name,
    });
  }));

  r.post('/bobby/conversations/:id/upload', raw, W(async (req, res) => {
    const client = getClient(req.user.client_id);
    if (!client) throw err('No client account is linked to this sign-in', 403);
    const c = getConv(client.id, req.params.id);
    res.json(fileOut(saveClientFile(req.body, req.query.name, client.id, c.id, req.user.id)));
  }));

  r.get('/bobby/files/:id', W(async (req, res) => {
    const client = getClient(req.user.client_id);
    if (!client) throw err('No client account is linked to this sign-in', 403);
    const f = /^[0-9a-f]{32}$/.test(req.params.id)
      ? db.prepare('select * from client_files where id=? and client_id=?').get(req.params.id, client.id)
      : null;
    if (!f) throw err('Not found', 404);
    sendFile(res, f, req.query.dl === '1');
  }));
}

