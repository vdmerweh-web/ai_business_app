// Admin-only helpers for a client billing-email change.
// Bobby may propose a change, but this module is the only place that writes clients.email,
// and only after an admin confirms in chat. It never touches invoices, payments, balances, or mail.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {spawn} from 'child_process';
import {q} from './db.js';
import {isAppAdmin} from './staffcfg.js';
import {withLoggedWrite} from './changeLog.js';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const err = (m, s = 400) => Object.assign(new Error(m), {status: s});
const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';

export function validEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  return EMAIL.test(email) ? email : null;
}

export async function searchClients(query) {
  const t = String(query || '').trim().slice(0, 80);
  if (t.length < 2) return {error: 'Type at least 2 letters of the name, domain or reference.'};
  const like = '%' + t.replace(/[\\%_]/g, m => '\\' + m) + '%';
  const rows = await q(`
    select c.id, c.ref, c.name, c.contact, c.email, c.cell,
           (select string_agg(d.domain, ', ' order by d.domain)
              from domains d where d.client_id=c.id and coalesce(d.status,'active')<>'inactive') as domains
    from clients c
    where c.name ilike $1 or c.ref ilike $1 or coalesce(c.email,'') ilike $1 or coalesce(c.contact,'') ilike $1
       or exists (select 1 from domains d where d.client_id=c.id and d.domain ilike $1)
    order by c.name
    limit 20
  `, [like]);
  return {matches: rows.map(r => ({
    id: r.id, ref: r.ref, name: r.name, contact: r.contact,
    billingEmail: r.email, cell: r.cell, domains: r.domains || '',
  }))};
}

export async function getClientBilling(clientId) {
  const [c] = await q(`
    select c.id, c.ref, c.name, c.contact, c.email, c.cell,
           (select string_agg(d.domain, ', ' order by d.domain)
              from domains d where d.client_id=c.id and coalesce(d.status,'active')<>'inactive') as domains
    from clients c where c.id=$1
  `, [clientId]);
  if (!c) return {error: 'No such client'};
  return {id: c.id, ref: c.ref, name: c.name, contact: c.contact, billingEmail: c.email, cell: c.cell, domains: c.domains || ''};
}

async function writeSqlSnapshot() {
  fs.mkdirSync(BACKUP_DIR, {recursive: true});
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `pre-billing-email-change-${stamp}.sql`);
  const rows = await q(`select id, legacy_id, ref, name, contact, email, cell, active, no_charge from clients order by id`);
  const esc = v => v == null ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'";
  const lines = [
    '-- Snapshot of billing clients (id, name, contact, email) taken before a billing-email change.',
    `-- ${new Date().toISOString()}`,
    'BEGIN;',
    ...rows.map(r => `-- ${r.ref} ${r.name}\n-- UPDATE clients SET email=${esc(r.email)} WHERE id=${r.id};`),
    'COMMIT;',
    '',
  ];
  fs.writeFileSync(dest, lines.join('\n'), {mode: 0o600});
  return dest;
}

function tryPgDump() {
  const url = process.env.DATABASE_URL;
  if (!url) return Promise.resolve(null);
  fs.mkdirSync(BACKUP_DIR, {recursive: true});
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `pre-billing-email-change-${stamp}-pg.dump`);
  return new Promise(resolve => {
    const child = spawn('pg_dump', [url, '-Fc', '-f', dest], {stdio: ['ignore', 'pipe', 'pipe']});
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('error', () => resolve(null));
    child.on('close', code => {
      if (code === 0 && fs.existsSync(dest)) resolve(dest);
      else {
        try { fs.unlinkSync(dest); } catch {}
        if (err) console.error('pg_dump (email change) skipped:', err.slice(0, 200));
        resolve(null);
      }
    });
  });
}

export async function backupBeforeEmailWrite() {
  const dumped = await tryPgDump();
  const snapshot = await writeSqlSnapshot();
  return {pgDump: dumped, snapshot};
}

export async function proposeBillingEmailChange(user, {client_id, new_email}) {
  if (!isAppAdmin(user)) return {error: 'Only a site admin can change a billing email.'};
  const cid = +client_id;
  if (!cid) return {error: 'Pick which client this is for.'};
  const email = validEmail(new_email);
  if (!email) return {error: 'That new email does not look right. Use a normal email, like name@business.co.za.'};
  const info = await getClientBilling(cid);
  if (info.error) return info;
  const old = String(info.billingEmail || '').trim().toLowerCase() || null;
  if (old === email) return {error: `The billing email for ${info.name} is already ${email}. No change is needed.`};
  const id = cryptoId();
  await q(`
    insert into bobby_action_requests(id, kind, client_id, requested_by, payload, status, expires_at)
    values($1,'billing_email',$2,$3,$4,'pending', now() + interval '30 minutes')
  `, [id, cid, user.id, {oldEmail: old, newEmail: email, clientName: info.name, ref: info.ref}]);
  return {
    pending: true,
    actionId: id,
    kind: 'billing_email',
    clientId: cid,
    clientName: info.name,
    ref: info.ref,
    oldEmail: old,
    newEmail: email,
    message: `Please confirm: change the billing email for ${info.name} (${info.ref}) from ${old || '(none)'} to ${email}. I will only save this after you click Yes or say yes. I will not change invoices, payments or balances, and I will not send any email.`,
  };
}

function cryptoId() {
  return crypto.randomBytes(16).toString('hex');
}

export async function getPendingAction(id, user) {
  const [row] = await q('select * from bobby_action_requests where id=$1', [id]);
  if (!row) return null;
  if (!isAppAdmin(user)) return null;
  return row;
}

export async function pendingForUser(user, clientId) {
  const [row] = await q(`
    select * from bobby_action_requests
    where requested_by=$1 and status='pending' and expires_at>now()
      and ($2::int is null or client_id=$2)
    order by created_at desc limit 1
  `, [user.id, clientId || null]);
  return row || null;
}

export function publicAction(row) {
  if (!row) return null;
  const p = row.payload || {};
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    clientId: row.client_id,
    clientName: p.clientName,
    ref: p.ref,
    oldEmail: p.oldEmail,
    newEmail: p.newEmail,
    expiresAt: row.expires_at,
  };
}

export async function applyBillingEmailChange(user, actionId, {confirmed}) {
  if (!isAppAdmin(user)) throw err('Only a site admin can change a billing email.', 403);
  if (!confirmed) throw err('This change was not confirmed.');
  const [row] = await q(`
    select * from bobby_action_requests
    where id=$1 and kind='billing_email' and status='pending' and expires_at>now()
  `, [actionId]);
  if (!row) throw err('That confirmation has expired or was already used. Please ask me again.', 400);
  const p = row.payload || {};
  const newEmail = validEmail(p.newEmail);
  if (!newEmail) throw err('The new email on this request is not valid.');
  const backup = await backupBeforeEmailWrite();
  let updated;
  try {
    updated = await withLoggedWrite({
      entity: 'clients',
      recordId: row.client_id,
      clientId: row.client_id,
      user,
      via: 'apply_billing_email_change',
      apply: async ({q}) => {
        const [next] = await q(`
          update clients set email=$2
          where id=$1 and lower(coalesce(email,'')) is not distinct from lower(coalesce($3,''))
          returning *
        `, [row.client_id, newEmail, p.oldEmail || '']);
        if (!next) {
          const e = err('The billing email was changed already, or the client was not found. Nothing was saved. Please check and ask me again.');
          e.code = 'stale';
          throw e;
        }
        await q(`update bobby_action_requests set status='applied', applied_at=now() where id=$1`, [actionId]);
        await q(`insert into audit_log(user_id, action, detail) values($1,$2,$3)`, [
          user.id,
          'billing_email_change',
          {
            client_id: next.id,
            ref: next.ref,
            name: next.name,
            old_email: p.oldEmail || null,
            new_email: newEmail,
            action_id: actionId,
            backup,
          },
        ]);
        return next;
      },
    });
  } catch (e) {
    if (e.code === 'stale') {
      await q(`update bobby_action_requests set status='cancelled' where id=$1 and status='pending'`, [actionId]);
    }
    throw e;
  }
  return {
    ok: true,
    clientName: updated.name,
    ref: updated.ref,
    oldEmail: p.oldEmail || null,
    newEmail: updated.email,
    backup: backup.pgDump || backup.snapshot,
  };
}

export async function cancelBillingEmailChange(user, actionId) {
  if (!isAppAdmin(user)) throw err('Only a site admin can cancel this.', 403);
  const [row] = await q(`
    update bobby_action_requests set status='cancelled'
    where id=$1 and status='pending' and requested_by=$2
    returning id
  `, [actionId, user.id]);
  if (!row) throw err('That request was not found, or was already used.', 400);
  return {ok: true, cancelled: true};
}
