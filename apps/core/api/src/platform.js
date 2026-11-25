// Flags for Grid, test client accounts, and the admin Platform page.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {db} from './db.js';
import {scryptHash, upsertClient, setFeatures} from './clients.js';
import {CLIENT_DEFAULTS} from './features.js';
import {seedModules} from './modules.js';
import {queueMessage} from './hooks.js';
import {reservedList} from './hostnames.js';
import {storageFor} from './storage.js';

const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';

// Something needs Grid's eye: store it and send it to Grid's inbox.
export function flagToGrid(source, clientId, text) {
  const f = db.prepare('insert into flags(source,client_id,text) values(?,?,?) returning id').get(source, clientId || null, String(text).slice(0, 2000));
  try { queueMessage('app', 'grid', `[flag ${f.id}] ${text}`, {flagId: f.id, source, clientId}); db.prepare('update flags set sent_to_grid=1 where id=?').run(f.id); } catch {}
  console.log('flag for Grid:', source, String(text).slice(0, 160));
}

// Test client accounts for Hannes, Josh and Mark (client view, not admin).
// Their admin Google logins stay exactly as they are. Logins use a +test address
// because one email can only belong to one account. Passwords go to a 600 file in backups/.
const TEST_CLIENTS = [
  {slug: 'test-hannes', name: 'Hannes Test Business', email: 'hannes+test@codegreene.com', person: 'Hannes (client view)'},
  {slug: 'test-josh', name: 'Josh Test Business', email: 'josh+test@codegreene.com', person: 'Josh (client view)'},
  {slug: 'test-mark', name: 'Mark Test Business', email: 'mark+test@codegreene.com', person: 'Mark (client view)'},
];
export function seedTestClients() {
  const created = [];
  for (const t of TEST_CLIENTS) {
    let c = db.prepare('select * from clients where slug=?').get(t.slug);
    if (!c) {
      c = upsertClient({slug: t.slug, name: t.name, domain: null, site_url: null});
      setFeatures(c.id, CLIENT_DEFAULTS);
      db.prepare("update clients set is_test=1, plan_id='test' where id=?").run(c.id);
    }
    seedModules(c.id);
    const u = db.prepare('select * from users where email=?').get(t.email);
    if (!u) {
      const password = crypto.randomBytes(12).toString('base64url');
      db.prepare("insert into users(email,name,role,client_id,password_hash,welcome_seen) values(?,?,'client',?,?,0)").run(t.email, t.person, c.id, scryptHash(password));
      created.push({...t, password});
    }
  }
  const file = path.join(BACKUP_DIR, 'TEST_CLIENT_LOGINS.txt');
  // 660 (no "other" access) so the server's ACL users (grid_bot) can read it; the file mode alone would block them.
  try { if (fs.existsSync(file)) fs.chmodSync(file, 0o660); } catch {}
  if (created.length) {
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'Test client logins for https://app.codegreene.com (client view)\nSign in with "Email and password" on the login page, not Google.\nThis file is only on the server. Do not copy it into git or chat.\n\n';
    const add = created.map(x => `${x.person}\n  Client: ${x.name}\n  Email: ${x.email}\n  Password: ${x.password}\n`).join('\n');
    fs.writeFileSync(file, old + add + '\n', {mode: 0o660});
    console.log('test client logins written to', file, '(emails only:', created.map(x => x.email).join(', ') + ')');
  }
}

export function platformRoutes(r, {W}) {
  r.get('/platform/flags', W(async (req, res) => res.json(db.prepare('select f.*, c.name client_name from flags f left join clients c on c.id=f.client_id order by f.id desc limit 200').all())));
  r.post('/platform/flags/:id/resolve', W(async (req, res) => {
    db.prepare("update flags set resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') where id=?").run(+req.params.id);
    res.json({ok: true});
  }));
  r.get('/platform/reserved-names', W(async (req, res) => res.json(reservedList())));
  r.get('/platform/storage', W(async (req, res) => {
    const out = [];
    for (const c of db.prepare('select id,name,plan_id,is_test from clients order by name').all()) out.push({client: c, ...(await storageFor(c.id))});
    res.json(out);
  }));
}
