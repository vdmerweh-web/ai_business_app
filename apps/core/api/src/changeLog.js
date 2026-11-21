// Shared change log for undo. Scope: client records and agent settings only.
// Never logs or undoes invoices, payments, or ledger entries.
// Every allowed write must go through withLoggedWrite so the log is in the same transaction.
import {db} from './db.js';
import {isAppAdmin} from './staffcfg.js';
import {currentPromptLogId} from './promptLog.js';

const ALLOWED = new Set(['clients']);
const BLOCKED = new Set(['invoices', 'invoice_lines', 'entries', 'payments', 'ledger']);
const CLIENT_FIELDS = [
  'id', 'ref', 'name', 'contact', 'email', 'cell', 'active', 'no_charge',
  'agent_name', 'credit_allowance_zar', 'zar_per_usd', 'site_url', 'domain', 'slug',
];

const err = (m, s = 400, payload) => Object.assign(new Error(m), {status: s, payload: payload || {}});
const iso = (d = new Date()) => d.toISOString();

export function changeLogInit() {
  db.exec(`
    create table if not exists change_log (
      id integer primary key,
      created_at text not null,
      entity text not null,
      record_id text not null,
      client_id integer,
      before_json text,
      after_json text,
      changed_by integer,
      changed_by_email text,
      via text not null,
      prompt_log_id integer,
      undone_by integer,
      undone_by_email text,
      undone_at text,
      undo_of integer
    );
    create index if not exists change_log_entity_record on change_log(entity, record_id, created_at);
    create index if not exists change_log_client on change_log(client_id, created_at);
  `);
}

function assertEntity(entity) {
  const name = String(entity || '').toLowerCase();
  if (BLOCKED.has(name) || /invoice|payment|entr(y|ies)|ledger|statement/.test(name)) {
    throw err('Undo and skill writes are not allowed on invoices, payments or ledger entries.', 403);
  }
  if (!ALLOWED.has(name)) throw err('This kind of record is not in the change log yet.', 400);
  return name;
}

function snapshot(row) {
  if (!row) return null;
  const out = {};
  for (const k of CLIENT_FIELDS) {
    if (row[k] === undefined) continue;
    let v = row[k];
    if (k === 'active' || k === 'no_charge') v = v === true || v === 't' || v === 1 || v === '1';
    else if (k === 'email' && v) v = String(v).trim().toLowerCase();
    else if (typeof v === 'number' || (v != null && (k.endsWith('_zar') || k === 'zar_per_usd'))) {
      const n = v == null ? null : Number(v);
      v = n == null || Number.isNaN(n) ? null : n;
    } else if (v != null) v = typeof v === 'string' ? v : String(v);
    out[k] = v === undefined ? null : v;
  }
  return out;
}

function sameSnap(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function parseJson(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

export function withLoggedWrite({entity, recordId, clientId, user, via, promptLogId, apply}) {
  entity = assertEntity(entity);
  via = String(via || 'ui').slice(0, 80);
  const pid = promptLogId ?? currentPromptLogId();
  const run = db.transaction(() => {
    let before = null;
    if (recordId != null) {
      const row = db.prepare('select * from clients where id=?').get(recordId);
      before = snapshot(row);
    }
    const afterRow = apply({before});
    const after = snapshot(afterRow);
    const id = after?.id ?? recordId;
    if (id == null) throw err('The change did not return a record id.');
    if (sameSnap(before, after)) return afterRow;
    db.prepare(`
      insert into change_log(
        created_at, entity, record_id, client_id, before_json, after_json,
        changed_by, changed_by_email, via, prompt_log_id
      ) values (?,?,?,?,?,?,?,?,?,?)
    `).run(
      iso(), entity, String(id), clientId ?? after?.id ?? recordId ?? null,
      before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null,
      user?.id || null, user?.email || null, via, pid == null ? null : pid,
    );
    return afterRow;
  });
  return run();
}

export function undoChange(user, changeId) {
  if (!isAppAdmin(user)) throw err('Only a site admin can undo a change.', 403);
  const run = db.transaction(() => {
    const ch = db.prepare('select * from change_log where id=?').get(changeId);
    if (!ch) throw err('That change was not found.', 404);
    assertEntity(ch.entity);
    if (ch.undone_at) throw err('This change was already undone.');
    const before = parseJson(ch.before_json);
    const expected = parseJson(ch.after_json);
    if (!before) {
      throw err('Adding a client cannot be undone from this list. You can mark the client inactive instead.');
    }
    const current = db.prepare('select * from clients where id=?').get(ch.record_id);
    if (!current) throw err('That record is no longer there, so this change cannot be undone.');
    const nowSnap = snapshot(current);
    const expectedKeys = expected && typeof expected === 'object' ? Object.keys(expected) : [];
    const nowCmp = {}, expCmp = {};
    for (const k of expectedKeys) {
      if (!CLIENT_FIELDS.includes(k)) continue;
      nowCmp[k] = nowSnap[k];
      expCmp[k] = expected[k];
    }
    if (!sameSnap(nowCmp, expCmp)) {
      throw err(
        'This record has changed again, so undo was not applied. Please check the current details first.',
        409,
        {conflict: true, current: nowSnap, expected}
      );
    }
    const sets = [];
    const vals = [];
    for (const k of CLIENT_FIELDS) {
      if (k === 'id' || !(k in before)) continue;
      sets.push(`${k}=?`);
      vals.push(before[k]);
    }
    if (!sets.length) throw err('There is nothing to restore on this change.');
    vals.push(ch.record_id);
    db.prepare(`update clients set ${sets.join(', ')} where id=?`).run(...vals);
    const updated = db.prepare('select * from clients where id=?').get(ch.record_id);
    db.prepare(`
      update change_log set undone_by=?, undone_by_email=?, undone_at=? where id=?
    `).run(user.id, user.email || null, iso(), ch.id);
    db.prepare(`
      insert into change_log(
        created_at, entity, record_id, client_id, before_json, after_json,
        changed_by, changed_by_email, via, prompt_log_id, undo_of
      ) values (?,?,?,?,?,?,?,?,'undo',?,?)
    `).run(
      iso(), ch.entity, ch.record_id, ch.client_id,
      JSON.stringify(snapshot(current)), JSON.stringify(snapshot(updated)),
      user.id, user.email || null, currentPromptLogId(), ch.id,
    );
    return {ok: true, record: snapshot(updated), undoneId: ch.id};
  });
  return run();
}

function publicChange(row) {
  if (!row) return null;
  return {
    id: row.id,
    created_at: row.created_at,
    entity: row.entity,
    record_id: row.record_id,
    client_id: row.client_id,
    before: parseJson(row.before_json),
    after: parseJson(row.after_json),
    changed_by: row.changed_by,
    changed_by_email: row.changed_by_email,
    via: row.via,
    prompt_log_id: row.prompt_log_id,
    undone_by: row.undone_by,
    undone_by_email: row.undone_by_email,
    undone_at: row.undone_at,
    undo_of: row.undo_of,
    canUndo: !row.undone_at && !!parseJson(row.before_json),
  };
}

export function listChanges({clientId, entity, limit} = {}) {
  const n = Math.min(100, Math.max(1, +limit || 30));
  const where = [], p = [];
  if (clientId) { where.push('client_id=?'); p.push(+clientId); }
  if (entity) { where.push('entity=?'); p.push(assertEntity(entity)); }
  p.push(n);
  const rows = db.prepare(`
    select * from change_log
    ${where.length ? 'where ' + where.join(' and ') : ''}
    order by created_at desc, id desc
    limit ?
  `).all(...p);
  return rows.map(publicChange);
}

export function changeRoutes(r, {W}) {
  const admin = (req, res, next) => isAppAdmin(req.user) ? next() : res.status(403).json({error: 'This page is only for the site admin'});
  r.get('/changes', admin, W(async (req, res) => {
    res.json(listChanges({clientId: req.query.client_id, entity: req.query.entity, limit: req.query.limit}));
  }));
  r.post('/changes/:id/undo', admin, W(async (req, res) => {
    try {
      res.json(undoChange(req.user, req.params.id));
    } catch (e) {
      if (e.status === 409) return res.status(409).json({error: e.message, ...(e.payload || {})});
      throw e;
    }
  }));
}
