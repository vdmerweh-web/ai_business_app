// Hostname routing: <name>.codegreene.com (and planet-grid.com) -> a site's LIVE copy.
// Names already used in DNS (or seen in certificate logs) are reserved so a client can never take them.
// Built from a read-only check on 25 Nov 2026 (dig + crt.sh); see reserved-names.json.
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {db} from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BASE_DOMAINS = String(process.env.SITE_BASE_DOMAINS || 'codegreene.com,planet-grid.com').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export function loadReserved() {
  const j = JSON.parse(fs.readFileSync(path.join(here, 'reserved-names.json'), 'utf8'));
  const ins = db.prepare('insert into reserved_names(name,source,points_to) values(?,?,?) on conflict(name) do update set source=excluded.source, points_to=excluded.points_to');
  db.transaction(() => {
    for (const [name, v] of Object.entries(j.names)) ins.run(name, (v.seen || []).join(', '), (v.points_to || []).join(', '));
  })();
  return Object.keys(j.names).length;
}
export function isReserved(name) {
  return !!db.prepare('select 1 from reserved_names where name=?').get(String(name).toLowerCase());
}
export function reservedList() {
  return db.prepare('select * from reserved_names order by name').all();
}
// Returns {slug} when a host should be served as a client site, else null.
export function siteSlugForHost(host) {
  host = String(host || '').toLowerCase().replace(/:\d+$/, '');
  const custom = db.prepare('select slug from sites where custom_domain=?').get(host);
  if (custom) return custom.slug;
  for (const d of BASE_DOMAINS) {
    if (!host.endsWith('.' + d)) continue;
    const label = host.slice(0, -(d.length + 1));
    if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(label) || isReserved(label)) return null;
    const s = db.prepare('select slug from sites where slug=?').get(label);
    return s ? s.slug : null;
  }
  return null;
}
