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

seedTenants();

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
  const list = req.user.client_id ? featuresFor(req.user.client_id) : FEATURES.filter(f => f.id === 'server-admin');
  res.json(list);
});
r.use('/inventory', requireFeature('server-admin'));
inventoryRoutes(r, {W});
r.use('/chat', requireFeature('server-admin'));
chatRoutes(r, {W});
r.use('/bobby', requireFeature('bobby'));
bobbyRoutes(r, {W});
r.use((req, res) => res.status(404).json({error: 'Not found'}));
// Mounted at /api (normal) and at / so Google's /auth/google/callback works when nginx forwards it unchanged.
app.use('/api', r);
app.use('/', r);
const PORT = +process.env.PORT || 3600;
app.listen(PORT, () => {
  console.log(`codegreene api on :${PORT}; ${ALLOWED.size} allowed emails; mock login ${MOCK ? 'ON (dev)' : 'off'}; webhook ${process.env.CG_WEBHOOK_URL ? 'set' : 'not set'}; grok ${apiKeySet() ? 'configured' : 'key not set'}`);
  startRetryWorker();
  startInventoryWatch();
});
