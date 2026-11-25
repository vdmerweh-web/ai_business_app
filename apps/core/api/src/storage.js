// Storage limits per plan. We measure each client's database space (all site copies)
// and file space (site files + uploads), and warn at 80% and 100%.
// Video is never hosted here: embed it from YouTube or Vimeo.
import path from 'path';
import {db} from './db.js';
import {getClient} from './clients.js';
import {dbSizeBytes, pgConfigured} from './pgsites.js';
import {SITES_DIR, dirBytes} from './sitefiles.js';

const MB = 1024 * 1024;
const level = pct => pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';

export async function storageFor(clientId) {
  const client = getClient(clientId);
  const plan = db.prepare('select * from plans where id=?').get(client?.plan_id || 'base') || {id: 'base', name: 'Base plan', db_mb: 250, files_mb: 1024};
  const copies = db.prepare('select sc.db_name, s.slug from site_copies sc join sites s on s.id=sc.site_id where s.client_id=?').all(clientId);
  let dbBytes = 0;
  if (pgConfigured()) for (const c of copies) dbBytes += await dbSizeBytes(c.db_name);
  let filesBytes = db.prepare('select coalesce(sum(size),0) n from client_files where client_id=?').get(clientId).n;
  for (const slug of [...new Set(copies.map(c => c.slug))]) filesBytes += dirBytes(path.join(SITES_DIR, slug));
  const dbPct = Math.round(dbBytes / (plan.db_mb * MB) * 100), filesPct = Math.round(filesBytes / (plan.files_mb * MB) * 100);
  const lvl = level(Math.max(dbPct, filesPct));
  return {
    plan: {id: plan.id, name: plan.name, dbMb: plan.db_mb, filesMb: plan.files_mb},
    db: {bytes: dbBytes, pct: dbPct, level: level(dbPct)},
    files: {bytes: filesBytes, pct: filesPct, level: level(filesPct)},
    level: lvl,
    message: lvl === 'over' ? 'You are over your plan space. Please ask us about more space.' : lvl === 'warn' ? 'You have used most of your plan space.' : 'You have plenty of space left.',
  };
}

// Measure every client now and then; flag to Grid when someone crosses 80% or 100%.
export async function measureAll(flag) {
  for (const c of db.prepare('select id, name from clients').all()) {
    try {
      const u = await storageFor(c.id);
      const prev = db.prepare('select level from storage_usage where client_id=? order by id desc limit 1').get(c.id);
      db.prepare('insert into storage_usage(client_id,db_bytes,files_bytes,level) values(?,?,?,?)').run(c.id, u.db.bytes, u.files.bytes, u.level);
      if (u.level !== 'ok' && prev?.level !== u.level && flag) flag('storage', c.id, `${c.name} storage is at ${u.level === 'over' ? 'over 100%' : '80% or more'} (database ${u.db.pct}%, files ${u.files.pct}%).`);
    } catch (e) { console.error('storage measure', c.id, e.message); }
  }
}
// Upload guard: refuse new files when a client is over the limit.
export async function assertSpace(clientId, extraBytes = 0) {
  const u = await storageFor(clientId);
  if (u.files.bytes + extraBytes > u.plan.filesMb * MB) throw Object.assign(new Error('Your plan space is full. Please ask us about more space.'), {status: 413});
}
