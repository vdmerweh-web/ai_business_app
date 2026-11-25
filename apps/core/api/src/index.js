import express from 'express';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import './db.js';
import {seedTenants} from './clients.js';
import {headers, csrf} from './security.js';
import {authRoutes, gate, MOCK, ALLOWED} from './auth.js';
import {botRoutes, chatRoutes, startRetryWorker, botAuth} from './chat.js';
import {inventoryRoutes, inventoryBotRoutes, startInventoryWatch} from './inventory.js';
import {FEATURES} from './features.js';
import {featuresFor, requireFeature} from './clients.js';
import {bobbyRoutes, apiKeySet} from './bobby.js';
import {isAppAdmin, agentsPublic, CLIENT_MENU_IDS} from './staffcfg.js';
import {promptLogInit, usageRoutes} from './promptLog.js';
import {xaiBalanceInit} from './xaiBalance.js';
import {changeLogInit, changeRoutes} from './changeLog.js';
import fs from 'fs';
import {fileURLToPath} from 'url';
import {db} from './db.js';
import {loadReserved} from './hostnames.js';
import {seedModules} from './modules.js';
import {seedTestClients, flagToGrid, platformRoutes} from './platform.js';
import {siteServeRoutes} from './siteserve.js';
import {publicRoutes} from './publicapi.js';
import {sitesApiRoutes, clientIdFor} from './sitesapi.js';
import {schedulerRoutes, startScheduler, registerRunner, onFlag} from './scheduler.js';
import {hookRoutes, hookAdminRoutes, startHookWorker, onHookFlag} from './hooks.js';
import {measureAll} from './storage.js';
import {runBobbyTask} from './bobby.js';
import * as Sites from './sites.js';
import {seoCheck} from './seo.js';

seedTenants();
promptLogInit();
changeLogInit();
xaiBalanceInit();
loadReserved();
for (const c of db.prepare('select id from clients').all()) seedModules(c.id);
seedTestClients();
onFlag(flagToGrid);
onHookFlag(flagToGrid);
const jobSite = job => { const s = job.site_id && db.prepare('select * from sites where id=? and client_id=?').get(job.site_id, job.client_id); if (!s) throw new Error('This job needs a site'); return s; };
registerRunner('ping', async () => ({message: 'pong'}));
registerRunner('build_site', async job => { await Sites.build(jobSite(job), 'test'); return {message: 'Test copy rebuilt'}; });
registerRunner('reset_test', async job => ({message: 'Copied: ' + JSON.stringify(await Sites.resetTest(jobSite(job)))}));
registerRunner('seo_check', async job => { const r = seoCheck(jobSite(job).slug, 'test'); return {message: `SEO score ${r.overall}/100`}; });
registerRunner('bobby_task', async (job, payload) => runBobbyTask(job.client_id, payload.prompt, {jobId: job.id, title: job.title}));
const EMBED = fs.readFileSync(fileURLToPath(new URL('./embed/pg.js', import.meta.url)), 'utf8');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(headers);
app.use(cookieParser());
app.use(express.json({limit: '4mb', verify: (req, res, buf) => { if (/^\/(api\/)?hooks\//.test(req.url)) req.rawBody = Buffer.from(buf); }}));
app.use(csrf);
const W = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({error: e.status ? e.message : 'Something went wrong'});
});
const lim = (n, ms = 60e3) => rateLimit({windowMs: ms, limit: n, standardHeaders: 'draft-7', legacyHeaders: false, message: {error: 'Too many requests, please slow down'}});
// Module tag loader for client sites (public, cached for 5 minutes).
app.get('/embed/pg.js', (req, res) => {
  res.removeHeader('X-Frame-Options');
  res.set({'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Robots-Tag': 'noindex'}).send(EMBED);
});
siteServeRoutes(app);
const r = express.Router();
r.get('/health', (req, res) => res.json({ok: true, grokConfigured: apiKeySet()}));
r.use('/bot', lim(240));
r.use('/hooks', lim(120));
hookRoutes(r, {W});
publicRoutes(r, {W});
botRoutes(r, {W});
inventoryBotRoutes(r, {W, bot: botAuth});
authRoutes(r, {loginLimit: lim(20, 15 * 60e3)});
r.use(lim(300));
r.use(gate);
r.get('/sections', (req, res) => {
  const admin = isAppAdmin(req.user);
  const base = (req.user.client_id ? featuresFor(req.user.client_id, req.user) : FEATURES.filter(f => f.staffOnly || f.id === 'server-admin'))
    .map(f => ({...f}));
  let list;
  if (!admin) {
    const allow = new Set(CLIENT_MENU_IDS);
    list = (req.user.client_id ? featuresFor(req.user.client_id, req.user) : FEATURES)
      .filter(f => allow.has(f.id));
    // Always show the four client items in order, even if a flag was missed.
    const byId = new Map(list.map(f => [f.id, f]));
    list = CLIENT_MENU_IDS.map(id => byId.get(id) || FEATURES.find(f => f.id === id)).filter(Boolean)
      .map(f => ({id: f.id, name: f.name, description: f.description, comingSoon: !!f.comingSoon}));
  } else {
    const byId = new Map(base.map(f => [f.id, f]));
    const first = CLIENT_MENU_IDS.map(id => byId.get(id) || FEATURES.find(f => f.id === id)).filter(Boolean);
    const agents = agentsPublic().filter(a => !CLIENT_MENU_IDS.includes(a.id)).map(a => ({
      id: a.id, name: a.name, description: a.description, comingSoon: !a.connected, bot: a.name, agent: true, connected: a.connected,
    }));
    const rest = FEATURES.filter(f => f.staffOnly && !CLIENT_MENU_IDS.includes(f.id)).map(f => ({
      id: f.id, name: f.name, description: f.description, comingSoon: !!f.comingSoon, bot: f.bot, staffOnly: true,
    }));
    const platform = {id: 'platform', name: 'Platform', description: 'Bot links, flags, scheduler, storage and reserved names', comingSoon: false, staffOnly: true};
    const usage = {id: 'usage', name: 'AI usage', description: 'Time and credits used by every AI helper, per prompt', comingSoon: false, staffOnly: true};
    list = [...first, ...agents, ...rest, platform, usage].map(f => ({
      id: f.id, name: f.name, description: f.description, comingSoon: !!f.comingSoon, bot: f.bot, staffOnly: !!f.staffOnly, connected: f.connected, agent: !!f.agent,
    }));
  }
  res.json(list);
});
r.use('/inventory', requireFeature('server-admin'));
inventoryRoutes(r, {W});
// Chat for Admin (and other connected agents) — admin only
r.use('/chat', (req, res, next) => {
  if (!isAppAdmin(req.user)) return res.status(403).json({error: 'This part is only for the site admin'});
  next();
});
chatRoutes(r, {W});
r.use('/bobby', requireFeature('bobby'));
bobbyRoutes(r, {W});
usageRoutes(r, {W});
sitesApiRoutes(r, {W});
schedulerRoutes(r, {W, clientIdFor, isAdmin: isAppAdmin});
r.use('/platform', (req, res, next) => isAppAdmin(req.user) ? next() : res.status(403).json({error: 'This part is only for the site admin'}));
platformRoutes(r, {W});
hookAdminRoutes(r, {W});
changeRoutes(r, {W});
r.use((req, res) => res.status(404).json({error: 'Not found'}));
app.use('/api', r);
app.use('/', r);
const PORT = +process.env.PORT || 3600;
app.listen(PORT, () => {
  console.log(`codegreene api on :${PORT}; ${ALLOWED.size} allowed emails; mock login ${MOCK ? 'ON (dev)' : 'off'}; webhook ${process.env.CG_WEBHOOK_URL ? 'set' : 'not set'}; grok ${apiKeySet() ? 'configured' : 'key not set'}`);
  startRetryWorker();
  startInventoryWatch();
  startScheduler();
  startHookWorker();
  setTimeout(() => measureAll(flagToGrid), 60e3).unref();
  setInterval(() => measureAll(flagToGrid), 6 * 3600e3).unref();
});
