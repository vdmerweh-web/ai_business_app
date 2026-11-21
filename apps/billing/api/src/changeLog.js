// Shared change log for undo. Scope: client records and agent settings only.
// Never logs or undoes invoices, payments, or ledger entries.
// Every allowed write must go through withLoggedWrite so the log is in the same transaction.
import {pool, q} from './db.js';
import {isAppAdmin} from './staffcfg.js';
import {currentPromptLogId} from './promptLog.js';

const ALLOWED = new Set(['clients']);
const BLOCKED = new Set(['invoices', 'invoice_lines', 'entries', 'payments', 'ledger']);
const CLIENT_FIELDS = [
  'id', 'ref', 'name', 'contact', 'email', 'cell', 'active', 'no_charge',
  'agent_name', 'credit_allowance_zar', 'zar_per_usd', 'site_url', 'domain', 'slug',
];

const err = (m, s = 400, payload) => Object.assign(new Error(m), {status: s, payload: payload || {}});

export async function changeLogInit() {
  await q(`
    create table if not exists change_log (
      id bigserial primary key,
      created_at timestamptz not null default now(),
      entity text not null,
      record_id text not null,
      client_id int,
      before_json jsonb,
      after_json jsonb,
      changed_by int,
      changed_by_email text,
      via text not null,
      prompt_log_id bigint,
      undone_by int,
      undone_by_email text,
      undone_at timestamptz,
      undo_of bigint
    );
    create index if not exists change_log_entity_record on change_log(entity, record_id, created_at desc);
    create index if not exists change_log_client on change_log(client_id, created_at desc);
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
    else if (typeof v === 'number' || (v != null && k.endsWith('_zar')) || k === 'zar_per_usd') {
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

async function withTx(fn) {
  const client = await pool.connect();
  const tq = (s, p) => client.query(s, p).then(r => r.rows);
  try {
    await client.query('BEGIN');
    const result = await fn({q: tq, client});
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

export async function withLoggedWrite({entity, recordId, clientId, user, via, promptLogId, apply}) {
  entity = assertEntity(entity);
  via = String(via || 'ui').slice(0, 80);
  const pid = promptLogId ?? currentPromptLogId();
  return withTx(async ({q}) => {
    let before = null;
    if (recordId != null) {
      const [row] = await q('select * from clients where id=$1', [recordId]);
      before = snapshot(row);
    }
    const afterRow = await apply({q, before});
    const after = snapshot(afterRow);
    const id = after?.id ?? recordId;
    if (id == null) throw err('The change did not return a record id.');
    if (sameSnap(before, after)) return afterRow;
    await q(`
      insert into change_log(
        entity, record_id, client_id, before_json, after_json,
        changed_by, changed_by_email, via, prompt_log_id
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [
      entity, String(id), clientId ?? after?.id ?? recordId ?? null,
      before, after, user?.id || null, user?.email || null, via,
      pid == null ? null : pid,
    ]);
    return afterRow;
  });
}

export async function undoChange(user, changeId) {
  if (!isAppAdmin(user)) throw err('Only a site admin can undo a change.', 403);
  return withTx(async ({q}) => {
    const [ch] = await q('select * from change_log where id=$1', [changeId]);
    if (!ch) throw err('That change was not found.', 404);
    assertEntity(ch.entity);
    if (ch.undone_at) throw err('This change was already undone.');
    if (!ch.before_json) {
      throw err('Adding a client cannot be undone from this list. You can mark the client inactive instead.');
    }
    const [current] = await q('select * from clients where id=$1', [ch.record_id]);
    if (!current) throw err('That record is no longer there, so this change cannot be undone.');
    const nowSnap = snapshot(current);
    const expected = ch.after_json;
    // Only compare keys that were stored on the change, so later extra columns do not false-conflict.
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
    const before = ch.before_json;
    const sets = [];
    const vals = [];
    for (const k of CLIENT_FIELDS) {
      if (k === 'id' || !(k in before)) continue;
      vals.push(before[k]);
      sets.push(`${k}=$${vals.length + 1}`);
    }
    if (!sets.length) throw err('There is nothing to restore on this change.');
    vals.unshift(ch.record_id);
    const [updated] = await q(`update clients set ${sets.join(', ')} where id=$1 returning *`, vals);
    await q(`
      update change_log set undone_by=$2, undone_by_email=$3, undone_at=now()
      where id=$1
    `, [ch.id, user.id, user.email || null]);
    await q(`
      insert into change_log(
        entity, record_id, client_id, before_json, after_json,
        changed_by, changed_by_email, via, prompt_log_id, undo_of
      ) values ($1,$2,$3,$4,$5,$6,$7,'undo',$8,$9)
    `, [
      ch.entity, ch.record_id, ch.client_id, snapshot(current), snapshot(updated),
      user.id, user.email || null, currentPromptLogId(), ch.id,
    ]);
    return {ok: true, record: snapshot(updated), undoneId: ch.id};
  });
}

function publicChange(row) {
  if (!row) return null;
  return {
    id: row.id,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    entity: row.entity,
    record_id: row.record_id,
    client_id: row.client_id,
    before: row.before_json,
    after: row.after_json,
    changed_by: row.changed_by,
    changed_by_email: row.changed_by_email,
    via: row.via,
    prompt_log_id: row.prompt_log_id,
    undone_by: row.undone_by,
    undone_by_email: row.undone_by_email,
    undone_at: row.undone_at instanceof Date ? row.undone_at.toISOString() : row.undone_at,
    undo_of: row.undo_of,
    canUndo: !row.undone_at && !!row.before_json,
  };
}

export async function listChanges({clientId, entity, limit} = {}) {
  const n = Math.min(100, Math.max(1, +limit || 30));
  const p = [];
  const where = [];
  if (clientId) { p.push(+clientId); where.push(`client_id=$${p.length}`); }
  if (entity) { p.push(assertEntity(entity)); where.push(`entity=$${p.length}`); }
  p.push(n);
  const rows = await q(`
    select * from change_log
    ${where.length ? 'where ' + where.join(' and ') : ''}
    order by created_at desc, id desc
    limit $${p.length}
  `, p);
  return rows.map(publicChange);
}

export function changeRoutes(r, {W}) {
  const admin = (req, res, next) => isAppAdmin(req.user) ? next() : res.status(403).json({error: 'This page is only for the site admin'});
  r.get('/changes', admin, W(async (req, res) => {
    res.json(await listChanges({clientId: req.query.client_id, entity: req.query.entity, limit: req.query.limit}));
  }));
  r.post('/changes/:id/undo', admin, W(async (req, res) => {
    try {
      res.json(await undoChange(req.user, req.params.id));
    } catch (e) {
      if (e.status === 409) return res.status(409).json({error: e.message, ...(e.payload || {})});
      throw e;
    }
  }));
}
