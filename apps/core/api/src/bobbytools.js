// Bobby's skills for Sites, SEO, Scheduler and change requests.
// Rules (from the plan): Bobby edits client content and client blocks on the TEST copy only.
// He can ask to publish, but a person must approve. He can never change shared module code;
// he logs a change request instead.
import {db} from './db.js';
import * as S from './sites.js';
import {seoCheck} from './seo.js';
import {modulesFor, moduleById} from './modules.js';
import {createJob, jobPublic, KINDS} from './scheduler.js';
import {storageFor} from './storage.js';

const fn = (name, description, properties = {}, required = []) => ({type: 'function', function: {name, description, parameters: {type: 'object', properties, required, additionalProperties: false}}});
const site = {type: 'string', description: 'The site name (slug), like "sunny-bakery".'};
export const SITE_TOOLS = [
  fn('list_sites', 'List this client\'s sites with their test and live links.'),
  fn('get_site_content', 'Get the pages and sections of a site\'s TEST copy (what you can edit).', {site}, ['site']),
  fn('update_site_content', 'Replace the TEST copy content of a site (pages and sections) and rebuild the test copy. Section types: hero, text, image (needs alt, width, height; max 1000 px wide), features, module (module: contact-form | funnel | bookings, id), block (name of a client block). The first page must be "index". You can also set seo {siteUrl, type, business{...}, ogImage, gaId, searchConsole} and redirects [{from:"/old.php", to:"/new"}]. Never touches live.', {site, spec: {type: 'object', description: 'The full site content (same shape as get_site_content returns).'}}, ['site', 'spec']),
  fn('save_client_block', 'Save a client block (a one-off piece for this client only, like a price calculator or a slider) on the TEST copy. Plain HTML, CSS and JavaScript. Then place it on a page with a section {type:"block", name}. Going live needs the client and Hannes or Grid to approve.', {site, name: {type: 'string', description: 'Small letters, numbers and dashes, like "price-calculator".'}, html: {type: 'string'}, css: {type: 'string'}, js: {type: 'string'}, description: {type: 'string'}}, ['site', 'name', 'html']),
  fn('seo_check', 'Run the SEO (Search Engine Optimization) check on the TEST copy. Gives each page a score out of 100 and fixes to suggest.', {site}, ['site']),
  fn('request_publish', 'Ask to copy the TEST copy to LIVE. A person must approve it in the Sites page. You cannot publish by yourself.', {site, note: {type: 'string', description: 'What changed, in one or two short sentences.'}}, ['site', 'note']),
  fn('list_modules', 'List the modules (shared features) and whether each is on for this client.'),
  fn('request_module_change', 'Log a change request when the client wants a shared module (like the CRM or contact form) to work differently. You cannot change module code yourself.', {module: {type: 'string', description: 'Module id, like "crm" or "contact-form".'}, text: {type: 'string', description: 'What the client asked for, in their words.'}}, ['text']),
  fn('schedule_job', 'Schedule a job for later or on repeat. Kinds: ' + Object.entries(KINDS).map(([k, v]) => `${k} (${v})`).join('; ') + '. Schedules: "daily 00:00", "weekly mon 08:30", "once 2026-12-01 09:00", "hourly", "every 30 min". Only schedule what the client asked for.', {kind: {type: 'string'}, title: {type: 'string'}, schedule: {type: 'string'}, prompt: {type: 'string', description: 'For bobby_task: what Bobby should do.'}, site: {type: 'string', description: 'For site jobs: the site name.'}, timezone: {type: 'string', description: 'Like "Africa/Johannesburg" or "America/Denver". Optional.'}}, ['kind', 'schedule']),
  fn('list_jobs', 'List this client\'s scheduled jobs and their last results.'),
  fn('cancel_job', 'Cancel one scheduled job. Only when the client asked.', {id: {type: 'number'}}, ['id']),
  fn('get_storage', 'Show how much database and file space this client uses compared with their plan.'),
];
export const SITE_TOOL_NAMES = new Set(SITE_TOOLS.map(t => t.function.name));

function siteBySlug(client, slug) {
  const s = db.prepare('select * from sites where client_id=? and (slug=? or id=?)').get(client.id, String(slug || '').toLowerCase(), +slug || -1);
  if (!s) throw Object.assign(new Error('No site with that name for this client'), {status: 404});
  return s;
}

export async function runSiteTool(client, user, name, args = {}) {
  try {
    if (name === 'list_sites') return S.sitesForClient(client.id).map(s => { const p = S.sitePublic(s, user); return {name: s.slug, title: s.name, testUrl: p.testUrl, liveUrl: p.liveUrl, pendingPublish: p.pendingPublish.length}; });
    if (name === 'get_site_content') { const s = siteBySlug(client, args.site); return {site: s.slug, copy: 'test', spec: S.F.readSpec(s.slug, 'test'), blocks: S.F.listBlocks(s.slug, 'test')}; }
    if (name === 'update_site_content') {
      const s = siteBySlug(client, args.site);
      S.F.writeSpec(s.slug, 'test', args.spec);
      let built = true;
      await S.build(s, 'test').catch(() => { built = false; });
      return {ok: true, copy: 'test', built, testUrl: S.sitePublic(s, user).testUrl, note: 'Only the test copy changed. Ask the client to look, then use request_publish.'};
    }
    if (name === 'save_client_block') {
      const s = siteBySlug(client, args.site);
      const out = S.F.saveBlock(s.slug, args.name, args, `${client.agent_name || 'Bobby'} (AI helper)`);
      return {ok: true, ...out, copy: 'test', note: 'Saved on the test copy. Add a section {type:"block", name} to show it. Going live needs approval from the client and Hannes or Grid.'};
    }
    if (name === 'seo_check') { const s = siteBySlug(client, args.site); return seoCheck(s.slug, 'test'); }
    if (name === 'request_publish') {
      const s = siteBySlug(client, args.site);
      const p = S.publishPublic(S.requestPublish(s, user, 'bobby', args.note));
      return {ok: true, request: p, note: p.needsAdmin ? 'Waiting for the client AND Hannes or Grid to approve (it has a client block).' : 'Waiting for the client to approve it on the Sites page.'};
    }
    if (name === 'list_modules') return modulesFor(client.id).map(m => ({id: m.id, name: m.name, on: m.enabled, version: m.version, comingSoon: m.comingSoon}));
    if (name === 'request_module_change') {
      const text = String(args.text || '').trim().slice(0, 2000);
      if (text.length < 5) return {error: 'Say what should change'};
      const row = db.prepare("insert into change_requests(client_id,module_id,text,requested_by,via) values(?,?,?,?,'bobby') returning id").get(client.id, moduleById(args.module) ? args.module : null, text, user?.email || 'bobby');
      return {ok: true, id: row.id, note: 'Logged. Hannes or Grid will decide if the module should change for everyone.'};
    }
    if (name === 'schedule_job') {
      const s = args.site ? siteBySlug(client, args.site) : null;
      const job = createJob({clientId: client.id, siteId: s?.id || null, kind: args.kind, title: args.title, payload: args.kind === 'bobby_task' ? {prompt: String(args.prompt || '').slice(0, 2000)} : {}, schedule: args.schedule, tz: args.timezone, createdBy: `${client.agent_name || 'Bobby'} for ${user?.email || 'client'}`});
      return {ok: true, job: jobPublic(job)};
    }
    if (name === 'list_jobs') return db.prepare('select * from sched_jobs where client_id=? order by id desc limit 30').all(client.id).map(jobPublic);
    if (name === 'cancel_job') {
      const r = db.prepare("update sched_jobs set status='cancelled' where id=? and client_id=? and status != 'running'").run(+args.id, client.id);
      return r.changes ? {ok: true} : {error: 'No such job'};
    }
    if (name === 'get_storage') return await storageFor(client.id);
  } catch (e) {
    return {error: e.message};
  }
  return {error: 'Unknown tool'};
}

export const SITE_PROMPT = [
  'Sites: each site has a TEST copy and a LIVE copy. You only ever change the TEST copy. To go live, use request_publish; the client approves it on the Sites page (client blocks also need Hannes or Grid).',
  'You may change page content and build client blocks (one-off pieces just for this client). You can NEVER change shared module code (contact form, CRM, bookings, funnels and so on). If the client wants a module to work differently, use request_module_change.',
  'Module tags: place modules with a section {type:"module", module:"contact-form"|"funnel"|"bookings", id}. In text you may also write shortcodes like [pg_contact_form id="main"].',
  'SEO (Search Engine Optimization): every page needs a title (10-60 letters), a description (50-160 letters), one main heading, and pictures with alt text, width and height (top pictures up to 2000 px wide, others up to 1000 px). Use seo_check and suggest fixes on the test copy.',
  'Scheduler: you can schedule jobs with schedule_job when the client asks. Jobs at the same time are spread out a little, and there are daily limits.',
].join('\n');
