// Module catalogue. A module is a feature built once in the shared code and
// switched on or off per client. Each module has a version number:
// - patch/minor changes (1.0 -> 1.1) roll out to every site at once;
// - a new major version (1.x -> 2.0) goes to a client's test copy first, and moves
//   to live once checked (the client's pinned major is raised).
// Bobby can never change this file or module code. He logs change requests instead.
import {db} from './db.js';

export const MODULES = [
  {id: 'sites', name: 'Sites', version: '1.0.0', description: 'Add sites. Each site has a test copy and a live copy.', always: true},
  {id: 'seo', name: 'SEO', version: '1.0.0', description: 'SEO (Search Engine Optimization) helps people find your site on Google: titles, descriptions, sitemap, share tags and a page check.', always: true},
  {id: 'contact-form', name: 'Contact form', version: '1.0.0', tag: 'pg-contact-form', description: 'A form on your site. Messages land in your CRM (Customer Relationship Management) list.'},
  {id: 'funnel', name: 'Funnels', version: '1.0.0', tag: 'pg-funnel', description: 'A few short questions, one at a time, that turn a visitor into a lead in your CRM.'},
  {id: 'crm', name: 'CRM', version: '1.0.0', description: 'CRM (Customer Relationship Management): your list of people who contacted you, with your own extra fields.'},
  {id: 'bookings', name: 'Bookings', version: '1.0.0', tag: 'pg-booking', description: 'Let visitors book a time. Use the built-in calendar or your Calendly link.'},
  {id: 'scheduler', name: 'Scheduler', version: '1.0.0', description: 'Set jobs for Bobby to do at a set time, like posting a blog every Monday.'},
  {id: 'blog', name: 'Blog', version: '0.1.0', description: 'Blog posts on your site.', comingSoon: true},
  {id: 'projects', name: 'Projects', version: '0.1.0', description: 'Track work with your team.', comingSoon: true},
  {id: 'shop', name: 'Shop', version: '0.1.0', description: 'Sell products on your site.', comingSoon: true},
  {id: 'subscriptions', name: 'Subscriptions', version: '0.1.0', description: 'Monthly payments from your customers.', comingSoon: true},
  {id: 'messages', name: 'Messages', version: '0.1.0', description: 'Direct messages with your customers.', comingSoon: true},
];
export const MODULE_IDS = new Set(MODULES.map(m => m.id));
export const DEFAULT_MODULES = ['sites', 'seo', 'contact-form', 'crm', 'bookings', 'scheduler'];
export const major = v => +String(v).split('.')[0];
export const moduleById = id => MODULES.find(m => m.id === id) || null;

export function seedModules(clientId, ids = DEFAULT_MODULES) {
  const have = db.prepare('select count(*) n from client_modules where client_id=?').get(clientId).n;
  if (have) return;
  const ins = db.prepare('insert or ignore into client_modules(client_id,module_id,enabled,pinned_major) values(?,?,1,?)');
  for (const id of ids) { const m = moduleById(id); if (m) ins.run(clientId, id, major(m.version)); }
}

export function modulesFor(clientId) {
  const rows = new Map(db.prepare('select * from client_modules where client_id=?').all(clientId).map(r => [r.module_id, r]));
  return MODULES.map(m => {
    const r = rows.get(m.id);
    const pinned = r?.pinned_major ?? major(m.version);
    return {
      id: m.id, name: m.name, description: m.description, tag: m.tag || null, comingSoon: !!m.comingSoon,
      version: m.version, enabled: !!m.always || !!r?.enabled,
      pinnedMajor: pinned, updateWaiting: major(m.version) > pinned,
    };
  });
}

export function moduleOn(clientId, id) {
  const m = moduleById(id);
  if (!m) return false;
  if (m.always) return true;
  const r = db.prepare('select enabled from client_modules where client_id=? and module_id=?').get(clientId, id);
  return !!r?.enabled;
}

export function setModule(clientId, id, enabled) {
  const m = moduleById(id);
  if (!m) throw Object.assign(new Error('No such module'), {status: 404});
  if (m.always) return;
  if (m.comingSoon && enabled) throw Object.assign(new Error(`${m.name} is coming soon`), {status: 400});
  db.prepare(`insert into client_modules(client_id,module_id,enabled,pinned_major) values(?,?,?,?)
    on conflict(client_id,module_id) do update set enabled=excluded.enabled`).run(clientId, id, enabled ? 1 : 0, major(m.version));
}

export function requireModule(id) {
  return (req, res, next) => {
    if (!req.user?.client_id || !moduleOn(req.user.client_id, id)) return res.status(403).json({error: `The ${moduleById(id)?.name || id} module is off for your account`});
    next();
  };
}
