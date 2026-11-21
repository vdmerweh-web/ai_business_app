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

seedTenants();
promptLogInit();
xaiBalanceInit();

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(headers);
app.use(cookieParser());
app.use(express.json({limit: '4mb'}));
app.use(csrf);
const W = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({error: e.status ? e.message : 'Something went wrong'});
});
const lim = (n, ms = 60e3) => rateLimit({windowMs: ms, limit: n, standardHeaders: 'draft-7', legacyHeaders: false, message: {error: 'Too many requests, please slow down'}});
const r = express.Router();
r.get('/health', (req, res) => res.json({ok: true, grokConfigured: apiKeySet()}));
r.use('/bot', lim(240));
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
    const usage = {id: 'usage', name: 'AI usage', description: 'Time and credits used by every AI helper, per prompt', comingSoon: false, staffOnly: true};
    list = [...first, ...agents, ...rest, usage].map(f => ({
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
r.use((req, res) => res.status(404).json({error: 'Not found'}));
app.use('/api', r);
app.use('/', r);
const PORT = +process.env.PORT || 3600;
app.listen(PORT, () => {
  console.log(`codegreene api on :${PORT}; ${ALLOWED.size} allowed emails; mock login ${MOCK ? 'ON (dev)' : 'off'}; webhook ${process.env.CG_WEBHOOK_URL ? 'set' : 'not set'}; grok ${apiKeySet() ? 'configured' : 'key not set'}`);
  startRetryWorker();
  startInventoryWatch();
});
