// Site builder service. POST /build {slug, copy, appUrl} -> builds /sites/<slug>/<copy>/public.
// One build at a time (a simple queue), so memory stays low.
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {spawn} from 'child_process';
import {generate} from './gen.js';

const SITES = process.env.SITES_DIR || '/sites';
const TOKEN = process.env.BUILDER_TOKEN || '';
const PORT = +(process.env.PORT || 3700);
const APP_DIR = process.env.APP_DIR || '/app';
let chain = Promise.resolve();

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {...opts, stdio: ['ignore', 'pipe', 'pipe']});
    let out = '';
    p.stdout.on('data', d => { out += d; if (out.length > 20000) out = out.slice(-20000); });
    p.stderr.on('data', d => { out += d; if (out.length > 20000) out = out.slice(-20000); });
    const t = setTimeout(() => p.kill('SIGKILL'), 170e3);
    p.on('close', code => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error('astro build failed: ' + out.split('\n').filter(l => /error|Error/.test(l)).slice(-3).join(' ').slice(0, 400))); });
  });
}

async function build({slug, copy, appUrl}) {
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug) || !['live', 'test'].includes(copy)) throw new Error('bad site');
  if (!/^https?:\/\/[a-z0-9.:-]+$/i.test(appUrl || '')) throw new Error('bad app url');
  const copyDir = path.join(SITES, slug, copy);
  const spec = JSON.parse(fs.readFileSync(path.join(copyDir, 'spec.json'), 'utf8'));
  const stamp = Date.now();
  const projDir = fs.mkdtempSync(path.join(os.tmpdir(), `b-${slug}-${copy}-`));
  const outDir = path.join(copyDir, `.public-new-${stamp}`);
  try {
    fs.cpSync(APP_DIR + '/template', projDir, {recursive: true});
    fs.symlinkSync(APP_DIR + '/node_modules', path.join(projDir, 'node_modules'));
    generate({spec, copyDir, projDir, outDir, slug, copy, appUrl});
    const t0 = Date.now();
    await run(process.execPath, [APP_DIR + '/node_modules/astro/astro.js', 'build', '--root', projDir, '--silent'], {cwd: projDir, env: {...process.env, ASTRO_TELEMETRY_DISABLED: '1', NODE_OPTIONS: '--max-old-space-size=320'}});
    // Swap the new build in. The old build output is only a build result and can be rebuilt any time.
    const pub = path.join(copyDir, 'public'), old = path.join(copyDir, `.public-old-${stamp}`);
    if (fs.existsSync(pub)) fs.renameSync(pub, old);
    fs.renameSync(outDir, pub);
    if (fs.existsSync(old)) fs.rmSync(old, {recursive: true, force: true});
    for (const f of ['content-assets.mjs', 'content-modules.mjs']) fs.rmSync(path.join(pub, f), {force: true}); // Astro leftovers, not part of the site
    const files = fs.readdirSync(pub);
    return {ok: true, ms: Date.now() - t0, files: files.length};
  } finally {
    fs.rmSync(projDir, {recursive: true, force: true});
    if (fs.existsSync(outDir)) fs.rmSync(outDir, {recursive: true, force: true});
  }
}

http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, {'Content-Type': 'application/json'}); res.end(JSON.stringify(obj)); };
  if (req.method === 'GET' && req.url === '/health') return send(200, {ok: true});
  if (req.method !== 'POST' || req.url !== '/build') return send(404, {error: 'not found'});
  if (TOKEN && req.headers['x-builder-token'] !== TOKEN) return send(403, {error: 'forbidden'});
  let body = '';
  req.on('data', d => { body += d; if (body.length > 10000) req.destroy(); });
  req.on('end', () => {
    let job;
    try { job = JSON.parse(body); } catch { return send(400, {error: 'bad json'}); }
    const p = chain.then(() => build(job));
    chain = p.catch(() => {});
    p.then(r => send(200, r), e => { console.error('build', job.slug, job.copy, e.message); send(500, {error: e.message}); });
  });
}).listen(PORT, () => console.log('site builder on :' + PORT));
