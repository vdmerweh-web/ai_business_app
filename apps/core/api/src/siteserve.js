// Serves built sites.
//  - /s/<slug>/        live copy (public, not indexed, sandboxed because it shares the app's address)
//  - /s/<slug>/test/   test copy (only for people signed in to that client, or admins)
//  - /_host/...        <slug>.codegreene.com once DNS points there (nginx forwards those hosts here)
import fs from 'fs';
import path from 'path';
import {db} from './db.js';
import {publicDir} from './sitefiles.js';
import {sessionUser} from './auth.js';
import {isAppAdmin} from './staffcfg.js';
import {siteSlugForHost} from './hostnames.js';
import {readSpec} from './sitefiles.js';

const APP = process.env.APP_URL || 'https://app.codegreene.com';
const TYPES = {'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.woff2': 'font/woff2'};

function resolveFile(root, rel) {
  rel = decodeURIComponent(rel || '').replace(/\\/g, '/');
  if (rel.includes('\0')) return null;
  let p = path.normalize(path.join(root, rel));
  if (p !== root && !p.startsWith(root + path.sep)) return null;
  try {
    if (fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  } catch {
    if (!path.extname(p) && fs.existsSync(p + '.html')) p += '.html';
  }
  return fs.existsSync(p) && fs.statSync(p).isFile() ? p : null;
}

function csp(sandbox) {
  const base = `default-src 'self'; script-src 'self' 'unsafe-inline' ${APP} https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; connect-src 'self' ${APP} https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com; frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://calendly.com; form-action 'self' ${APP}; base-uri 'self'; object-src 'none'`;
  // Sandbox (no same-origin) so site scripts and client blocks can never use the app's sign-in cookie.
  return sandbox ? base + '; sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox' : base + "; frame-ancestors 'self'";
}

function send(res, file, {sandbox, index}) {
  const ext = path.extname(file).toLowerCase();
  res.removeHeader('X-Frame-Options');
  res.set({
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Content-Security-Policy': csp(sandbox),
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    'X-Robots-Tag': index ? 'all' : 'noindex, nofollow',
  });
  if (!sandbox) res.set('X-Frame-Options', 'SAMEORIGIN');
  fs.createReadStream(file).pipe(res);
}

// 301 redirects for rebuilt sites (old addresses -> new pages), set in the site's SEO settings.
function redirectFor(slug, copy, rel) {
  const spec = readSpec(slug, copy);
  const from = '/' + String(rel || '').replace(/^\/+/, '');
  const hit = (spec?.redirects || []).find(r => r.from === from || r.from === from.replace(/\/$/, ''));
  return hit ? hit.to : null;
}

function notFound(res, msg = 'This page is not here.') {
  res.status(404).set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found</title><body style="font-family:system-ui;max-width:40rem;margin:4rem auto;padding:1rem"><h1>Not found</h1><p>${msg}</p></body></html>`);
}

export function siteServeRoutes(app) {
  app.get(['/s/:slug', '/s/:slug/*'], (req, res) => {
    const slug = String(req.params.slug).toLowerCase();
    const site = db.prepare('select * from sites where slug=?').get(slug);
    if (!site) return notFound(res, 'There is no site with that name.');
    let rest = req.params[0] || '';
    if (!req.path.endsWith('/') && !rest) return res.redirect(301, `/s/${slug}/`);
    let copy = 'live';
    if (rest === 'test' || rest.startsWith('test/')) {
      if (rest === 'test') return res.redirect(301, `/s/${slug}/test/`);
      copy = 'test'; rest = rest.slice(5);
    }
    const file = resolveFile(publicDir(slug, copy), rest);
    if (!file) {
      const to = redirectFor(slug, copy, rest);
      if (to) return res.redirect(301, /^https:/.test(to) ? to : `/s/${slug}/${copy === 'test' ? 'test/' : ''}${to.replace(/^\//, '')}`);
      return notFound(res, 'This page is not built yet, or it does not exist.');
    }
    if (copy === 'test' && file.endsWith('.html')) {
      const u = sessionUser(req);
      if (!u || !(isAppAdmin(u) || u.client_id === site.client_id)) return res.redirect(302, '/login?next=' + encodeURIComponent(req.originalUrl));
    }
    send(res, file, {sandbox: true, index: false});
  });
  app.get('/_host/*', (req, res) => {
    const slug = siteSlugForHost(req.get('x-forwarded-host') || req.get('host'));
    if (!slug) return notFound(res, 'There is no site at this address yet.');
    const file = resolveFile(publicDir(slug, 'live'), req.params[0] || '');
    if (!file) {
      const to = redirectFor(slug, 'live', req.params[0] || '');
      return to ? res.redirect(301, to) : notFound(res);
    }
    send(res, file, {sandbox: false, index: true});
  });
}
