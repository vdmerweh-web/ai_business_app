// Site content on disk (bind mount ./sites-data -> /sites):
//   /sites/<slug>/<copy>/spec.json          pages and sections (what Bobby edits)
//   /sites/<slug>/<copy>/blocks/<name>/     client blocks (block.html, block.css, block.js, meta.json)
//   /sites/<slug>/<copy>/history/           older spec.json files, so changes can be rolled back
//   /sites/<slug>/<copy>/public/            the built Astro site (written by the builder)
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const SITES_DIR = process.env.SITES_DIR || '/sites';
const err = (m, s = 400) => Object.assign(new Error(m), {status: s});
const okSlug = s => /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(s);
const okCopy = c => c === 'live' || c === 'test';
export function copyDir(slug, copy) {
  if (!okSlug(slug) || !okCopy(copy)) throw err('Bad site name');
  return path.join(SITES_DIR, slug, copy);
}
export const publicDir = (slug, copy) => path.join(copyDir(slug, copy), 'public');

export function defaultSpec(name) {
  return {
    name, theme: {color: '#0f766e', accent: '#f59e0b', font: 'system'},
    footer: {text: `© ${new Date().getFullYear()} ${name}`},
    pages: [
      {slug: 'index', title: name, description: `Welcome to ${name}.`, sections: [
        {type: 'hero', heading: `Welcome to ${name}`, text: 'Tell people in one short line what you do and who you help.', buttonText: 'Contact us', buttonLink: '#contact'},
        {type: 'features', heading: 'What we do', items: [
          {title: 'Fast', text: 'We get back to you within one day.'},
          {title: 'Friendly', text: 'Plain words, no jargon.'},
          {title: 'Local', text: 'We know your area.'},
        ]},
        {type: 'module', module: 'contact-form', id: 'main', anchor: 'contact', heading: 'Contact us', fallback: 'Our form is resting. Please email or phone us.'},
      ]},
      {slug: 'book', title: 'Book a time', description: `Book a time with ${name}.`, sections: [
        {type: 'text', heading: 'Book a time', text: 'Pick a time that suits you.'},
        {type: 'module', module: 'bookings', id: 'main', fallback: 'Booking is resting. Please contact us to book.'},
      ]},
    ],
  };
}

// Site-wide SEO settings: business details for structured data (JSON-LD), share picture,
// Google Analytics measurement ID and the Google Search Console check code.
function cleanSeo(x) {
  const t = v => String(v ?? '').trim().slice(0, 200);
  return {
    siteUrl: /^https:\/\/[a-z0-9.-]+\/?$/i.test(x.siteUrl || '') ? x.siteUrl.replace(/\/$/, '') : '',
    type: ['LocalBusiness', 'Organization'].includes(x.type) ? x.type : 'LocalBusiness',
    business: {name: t(x.business?.name), phone: t(x.business?.phone), email: t(x.business?.email), street: t(x.business?.street), city: t(x.business?.city), region: t(x.business?.region), postalCode: t(x.business?.postalCode), country: t(x.business?.country)},
    ogImage: /^https:\/\//.test(x.ogImage || '') ? t(x.ogImage) : '',
    twitter: /^@?[A-Za-z0-9_]{1,15}$/.test(x.twitter || '') ? '@' + String(x.twitter).replace(/^@/, '') : '',
    gaId: /^G-[A-Z0-9]{4,12}$/.test(x.gaId || '') ? x.gaId : '',
    searchConsole: /^[A-Za-z0-9_-]{10,100}$/.test(x.searchConsole || '') ? x.searchConsole : '',
  };
}

const SECTION_TYPES = new Set(['hero', 'text', 'image', 'features', 'module', 'block']);
const str = (v, n) => String(v ?? '').slice(0, n);
// Keep the spec small and safe. Text is plain text; the builder escapes it.
export function cleanSpec(s) {
  if (!s || typeof s !== 'object') throw err('Bad site content');
  const pages = (Array.isArray(s.pages) ? s.pages : []).slice(0, 20).map(p => {
    const slug = str(p.slug, 40).toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw err(`Bad page name "${slug}"`);
    return {
      slug, title: str(p.title, 120), description: str(p.description, 300),
      ...(p.kind === 'article' ? {kind: 'article', datePublished: str(p.datePublished, 30), author: str(p.author, 120)} : {}),
      ...(p.ogImage && /^https:\/\//.test(p.ogImage) ? {ogImage: str(p.ogImage, 500)} : {}),
      ...(p.noindex ? {noindex: true} : {}),
      sections: (Array.isArray(p.sections) ? p.sections : []).slice(0, 30).map(x => {
        if (!SECTION_TYPES.has(x.type)) throw err(`Unknown section type "${x.type}"`);
        const o = {type: x.type};
        for (const k of ['heading', 'text', 'buttonText', 'buttonLink', 'src', 'alt', 'caption', 'module', 'id', 'fallback', 'anchor', 'name', 'image', 'imageAlt']) if (x[k] != null) o[k] = str(x[k], k === 'text' ? 5000 : 500);
        for (const k of ['width', 'height', 'imageWidth', 'imageHeight']) if (x[k] != null && +x[k] > 0) o[k] = Math.round(+x[k]);
        // SEO (Search Engine Optimization) image rules: alt text, width/height, and size limits
        // (hero pictures up to 2000 px wide, other pictures up to 1000 px wide).
        if (o.type === 'image' && (!o.width || !o.height)) throw err('Every picture needs its width and height (in pixels), so the page does not jump while loading.');
        if (o.type === 'image' && o.width > 1000) throw err(`This picture is ${o.width} px wide. Pictures inside a page may be up to 1000 px wide. Please make it smaller.`);
        if (o.image && !/^https:\/\//.test(o.image)) throw err('Pictures must use an https:// link');
        if (o.image && (!o.imageAlt || !o.imageWidth || !o.imageHeight)) throw err('The big top picture needs alt text, a width and a height.');
        if (o.imageWidth > 2000) throw err(`The top picture is ${o.imageWidth} px wide. Top pictures may be up to 2000 px wide. Please make it smaller.`);
        if (Array.isArray(x.items)) o.items = x.items.slice(0, 12).map(i => ({title: str(i.title, 120), text: str(i.text, 600)}));
        if (o.type === 'image' && !o.alt) throw err('Every picture needs alt text (words that describe it for people who cannot see it).');
        if (o.buttonLink && !/^(#|\/|https?:\/\/|mailto:|tel:|[a-z0-9-]+\.html)/i.test(o.buttonLink)) delete o.buttonLink;
        if (o.src && !/^https:\/\//.test(o.src)) throw err('Pictures must use an https:// link');
        return o;
      }),
    };
  });
  if (!pages.length || pages[0].slug !== 'index') throw err('The first page must be called "index" (the home page)');
  return {
    name: str(s.name, 120),
    theme: {color: /^#[0-9a-f]{6}$/i.test(s.theme?.color) ? s.theme.color : '#0f766e', accent: /^#[0-9a-f]{6}$/i.test(s.theme?.accent) ? s.theme.accent : '#f59e0b', font: ['system', 'serif', 'rounded'].includes(s.theme?.font) ? s.theme.font : 'system'},
    footer: {text: str(s.footer?.text, 300)},
    seo: cleanSeo(s.seo || {}),
    redirects: (Array.isArray(s.redirects) ? s.redirects : []).slice(0, 500).map(r => ({from: str(r.from, 300), to: str(r.to, 300)}))
      .filter(r => /^\/[^\s]*$/.test(r.from) && /^(\/[^\s]*|https:\/\/[^\s]+)$/.test(r.to) && r.from !== r.to),
    pages,
  };
}

export function readSpec(slug, copy) {
  try { return JSON.parse(fs.readFileSync(path.join(copyDir(slug, copy), 'spec.json'), 'utf8')); } catch { return null; }
}
export function writeSpec(slug, copy, spec) {
  const dir = copyDir(slug, copy);
  fs.mkdirSync(path.join(dir, 'history'), {recursive: true});
  const cur = path.join(dir, 'spec.json');
  if (fs.existsSync(cur)) {
    fs.copyFileSync(cur, path.join(dir, 'history', `spec-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
  }
  fs.writeFileSync(cur + '.tmp', JSON.stringify(cleanSpec(spec), null, 1));
  fs.renameSync(cur + '.tmp', cur);
}
export function listHistory(slug, copy) {
  try { return fs.readdirSync(path.join(copyDir(slug, copy), 'history')).filter(f => f.startsWith('spec-')).sort().reverse(); } catch { return []; }
}
export function restoreHistory(slug, copy, file) {
  if (!/^spec-[0-9TZ-]+\.json$/.test(file)) throw err('Bad file');
  const spec = JSON.parse(fs.readFileSync(path.join(copyDir(slug, copy), 'history', file), 'utf8'));
  writeSpec(slug, copy, spec);
}

const okBlock = n => /^[a-z][a-z0-9-]{1,30}$/.test(n);
export function listBlocks(slug, copy) {
  const d = path.join(copyDir(slug, copy), 'blocks');
  try {
    return fs.readdirSync(d).filter(okBlock).map(name => {
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(d, name, 'meta.json'), 'utf8')); } catch {}
      return {name, ...meta};
    });
  } catch { return []; }
}
export function readBlock(slug, copy, name) {
  if (!okBlock(name)) throw err('Bad block name');
  const d = path.join(copyDir(slug, copy), 'blocks', name);
  const r = f => { try { return fs.readFileSync(path.join(d, f), 'utf8'); } catch { return ''; } };
  return {name, html: r('block.html'), css: r('block.css'), js: r('block.js'), meta: JSON.parse(r('meta.json') || '{}')};
}
// Client blocks are only ever written to the TEST copy. Publishing copies them to live.
export function saveBlock(slug, name, {html = '', css = '', js = '', description = ''}, by) {
  if (!okBlock(name)) throw err('Block names use small letters, numbers and dashes, like "price-calculator".');
  const total = String(html).length + String(css).length + String(js).length;
  if (total > 60000) throw err('That block is too big (limit about 60 KB).');
  const d = path.join(copyDir(slug, 'test'), 'blocks', name);
  fs.mkdirSync(d, {recursive: true});
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(d, 'meta.json'), 'utf8')); } catch {}
  const version = (meta.version || 0) + 1;
  fs.writeFileSync(path.join(d, 'block.html'), String(html));
  fs.writeFileSync(path.join(d, 'block.css'), String(css));
  fs.writeFileSync(path.join(d, 'block.js'), String(js));
  fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({version, description: String(description).slice(0, 300), updatedAt: new Date().toISOString(), updatedBy: by || null}, null, 1));
  return {name, version};
}
export function blocksHash(slug, copy) {
  const h = crypto.createHash('sha256');
  for (const b of listBlocks(slug, copy).sort((a, b) => a.name.localeCompare(b.name))) {
    const x = readBlock(slug, copy, b.name);
    h.update(b.name + '\0' + x.html + '\0' + x.css + '\0' + x.js + '\0');
  }
  return h.digest('hex');
}
// Publish: copy test content (spec and blocks) over live. Live keeps a history copy.
export function copyContentTestToLive(slug) {
  const spec = readSpec(slug, 'test');
  if (!spec) throw err('The test copy has no content yet');
  writeSpec(slug, 'live', spec);
  const src = path.join(copyDir(slug, 'test'), 'blocks'), dst = path.join(copyDir(slug, 'live'), 'blocks');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(path.join(copyDir(slug, 'live'), 'history'), {recursive: true});
  if (fs.existsSync(dst)) fs.renameSync(dst, path.join(copyDir(slug, 'live'), 'history', 'blocks-' + stamp));
  if (fs.existsSync(src)) fs.cpSync(src, dst, {recursive: true});
}
export function copyContentLiveToTest(slug) {
  const spec = readSpec(slug, 'live');
  if (spec) writeSpec(slug, 'test', spec);
  const src = path.join(copyDir(slug, 'live'), 'blocks'), dst = path.join(copyDir(slug, 'test'), 'blocks');
  if (fs.existsSync(dst)) {
    fs.mkdirSync(path.join(copyDir(slug, 'test'), 'history'), {recursive: true});
    fs.renameSync(dst, path.join(copyDir(slug, 'test'), 'history', 'blocks-' + new Date().toISOString().replace(/[:.]/g, '-')));
  }
  if (fs.existsSync(src)) fs.cpSync(src, dst, {recursive: true});
}
export function dirBytes(p) {
  let n = 0;
  try {
    for (const e of fs.readdirSync(p, {withFileTypes: true})) {
      const f = path.join(p, e.name);
      n += e.isDirectory() ? dirBytes(f) : (fs.statSync(f).size || 0);
    }
  } catch {}
  return n;
}
