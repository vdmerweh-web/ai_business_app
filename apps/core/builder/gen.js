// Turns spec.json into an Astro project. Every piece of client text is escaped here.
// Client blocks (one client's own HTML/CSS/JS) are added as they are, inside a wrapper.
import fs from 'fs';
import path from 'path';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const TAGS = {'contact-form': 'pg-contact-form', funnel: 'pg-funnel', bookings: 'pg-booking'};
const ATTR = {'contact-form': 'form', funnel: 'funnel', bookings: 'calendar'};

function moduleTag(module, id, ctx, fallback) {
  const tag = TAGS[module];
  if (!tag) return '';
  const fb = fallback || 'This part is resting right now. Please contact us another way.';
  return `<${tag} site="${esc(ctx.slug)}" copy="${ctx.copy}" ${ATTR[module]}="${esc(id || 'main')}" api="${esc(ctx.appUrl)}"><p class="pg-fallback">${esc(fb)}</p></${tag}>`;
}
// Shortcodes like [pg_contact_form id="main"], [pg_funnel id="quote"], [pg_booking] become module tags.
function textHtml(text, ctx) {
  const parts = String(text || '').split(/(\[pg_(?:contact_form|funnel|booking)(?:\s+id="[a-z0-9-]{1,40}")?\])/);
  return parts.map(p => {
    const m = /^\[pg_(contact_form|funnel|booking)(?:\s+id="([a-z0-9-]{1,40})")?\]$/.exec(p);
    if (m) return moduleTag({contact_form: 'contact-form', funnel: 'funnel', booking: 'bookings'}[m[1]], m[2], ctx);
    return p.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean).map(x => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('');
  }).join('');
}
function link(href) {
  if (!href) return '#';
  if (/^[a-z0-9-]+\.html$/i.test(href)) return './' + href.replace(/\.html$/, '');
  return href;
}

function sectionHtml(s, i, ctx) {
  const H = i === 0 ? 'h1' : 'h2';
  const head = s.heading ? `<${H}>${esc(s.heading)}</${H}>` : '';
  const id = s.anchor ? ` id="${esc(s.anchor)}"` : '';
  if (s.type === 'hero') {
    const img = s.image ? `<img class="hero-img" src="${esc(s.image)}" alt="${esc(s.imageAlt)}" width="${s.imageWidth}" height="${s.imageHeight}" fetchpriority="high" decoding="async">` : '';
    const btn = s.buttonText ? `<a class="btn" href="${esc(link(s.buttonLink))}">${esc(s.buttonText)}</a>` : '';
    return `<section class="hero reveal"${id}><div class="wrap">${head}${textHtml(s.text, ctx)}${btn}</div>${img}</section>`;
  }
  if (s.type === 'text') return `<section class="text reveal"${id}><div class="wrap narrow">${head}${textHtml(s.text, ctx)}</div></section>`;
  if (s.type === 'image') return `<section class="image reveal"${id}><div class="wrap narrow">${head}<figure><img src="${esc(s.src)}" alt="${esc(s.alt)}" width="${s.width}" height="${s.height}" loading="${i < 2 ? 'eager' : 'lazy'}" decoding="async">${s.caption ? `<figcaption>${esc(s.caption)}</figcaption>` : ''}</figure></div></section>`;
  if (s.type === 'features') {
    const items = (s.items || []).map(x => `<li class="card"><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p></li>`).join('');
    return `<section class="features reveal"${id}><div class="wrap">${head}<ul class="grid">${items}</ul></div></section>`;
  }
  if (s.type === 'module') return `<section class="module reveal"${id}><div class="wrap narrow">${head}${moduleTag(s.module, s.id, ctx, s.fallback)}</div></section>`;
  if (s.type === 'block') {
    const b = ctx.blocks[s.name];
    if (!b) return `<!-- client block "${esc(s.name)}" not found -->`;
    return `<section class="block reveal"${id}><div class="wrap">${head}<div class="pg-block" data-block="${esc(s.name)}" data-version="${esc(b.version)}">${b.html}</div></div>${b.css ? `<style>${b.css.replace(/<\/style/gi, '')}</style>` : ''}${b.js ? `<script type="module">${b.js.replace(/<\/script/gi, '')}</script>` : ''}</section>`;
  }
  return '';
}

function css(theme) {
  const font = theme.font === 'serif' ? 'Georgia, "Times New Roman", serif' : theme.font === 'rounded' ? 'ui-rounded, "Nunito", system-ui, sans-serif' : 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  return `:root{--c:${theme.color};--a:${theme.accent};--ink:#0f172a;--muted:#475569;--bg:#ffffff;--soft:#f1f5f9}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:${font};color:var(--ink);background:var(--bg);line-height:1.6;font-size:1.0625rem}
img{max-width:100%;height:auto;display:block}a{color:var(--c)}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid var(--a);outline-offset:2px}
.skip{position:absolute;left:-999px;top:0;background:#000;color:#fff;padding:.5rem 1rem;z-index:10}.skip:focus{left:1rem}
.wrap{max-width:72rem;margin:0 auto;padding:0 1.25rem}.narrow{max-width:46rem}
.site-header{position:sticky;top:0;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid #e2e8f0;z-index:5}
.bar{display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:4rem;flex-wrap:wrap}.brand{font-weight:700;font-size:1.2rem;text-decoration:none;color:var(--ink)}
nav ul{display:flex;gap:.25rem;list-style:none;margin:0;padding:0;flex-wrap:wrap}nav a{display:inline-block;padding:.6rem .8rem;border-radius:.6rem;text-decoration:none;color:var(--ink)}nav a:hover,nav a[aria-current=page]{background:var(--soft)}
section{padding:3.5rem 0}h1{font-size:clamp(2rem,5vw,3.25rem);line-height:1.15;margin:0 0 1rem}h2{font-size:clamp(1.5rem,3vw,2.1rem);margin:0 0 1rem}h3{margin:.2rem 0 .4rem}
.hero{background:linear-gradient(135deg,color-mix(in srgb,var(--c) 12%,#fff),#fff);padding:5rem 0}.hero p{font-size:1.2rem;color:var(--muted);max-width:40rem}.hero-img{margin:2rem auto 0;max-width:72rem;width:100%;border-radius:1rem}
.btn,button.pg-btn{display:inline-block;background:var(--c);color:#fff;border:0;border-radius:.75rem;padding:.85rem 1.4rem;font-weight:600;text-decoration:none;font-size:1rem;cursor:pointer;transition:transform .15s ease,box-shadow .15s ease}.btn:hover,button.pg-btn:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(0,0,0,.12)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:1rem;list-style:none;padding:0;margin:0}.card{background:var(--soft);border-radius:1rem;padding:1.4rem;transition:transform .2s ease}.card:hover{transform:translateY(-2px)}
figure{margin:0}figcaption{color:var(--muted);font-size:.95rem;margin-top:.5rem}
.site-footer{background:var(--ink);color:#e2e8f0;padding:2rem 0;margin-top:2rem}.site-footer a{color:#fff}
.reveal{animation:fadeup .5s ease both}@keyframes fadeup{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
pg-contact-form,pg-funnel,pg-booking{display:block}.pg-fallback{background:var(--soft);padding:1rem;border-radius:.75rem}`;
}

function jsonLd(spec, page, ctx, url) {
  const seo = spec.seo || {}, b = seo.business || {};
  const org = {'@context': 'https://schema.org', '@type': seo.type || 'LocalBusiness', name: b.name || spec.name, url: ctx.siteUrl + '/'};
  if (b.phone) org.telephone = b.phone;
  if (b.email) org.email = b.email;
  if (seo.ogImage) org.image = seo.ogImage;
  if (b.street || b.city) org.address = {'@type': 'PostalAddress', streetAddress: b.street || undefined, addressLocality: b.city || undefined, addressRegion: b.region || undefined, postalCode: b.postalCode || undefined, addressCountry: b.country || undefined};
  const out = [org];
  if (page.slug !== 'index') out.push({'@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    {'@type': 'ListItem', position: 1, name: spec.pages[0].title || 'Home', item: ctx.siteUrl + '/'},
    {'@type': 'ListItem', position: 2, name: page.title, item: url},
  ]});
  if (page.kind === 'article') out.push({'@context': 'https://schema.org', '@type': 'Article', headline: page.title, description: page.description, datePublished: page.datePublished || undefined, author: page.author ? {'@type': 'Person', name: page.author} : undefined, image: page.ogImage || seo.ogImage || undefined, mainEntityOfPage: url});
  return out.map(o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('');
}

function headHtml(spec, page, ctx) {
  const seo = spec.seo || {};
  const url = ctx.siteUrl + '/' + (page.slug === 'index' ? '' : page.slug);
  const title = page.slug === 'index' ? (page.title || spec.name) : `${page.title} | ${spec.name}`;
  const img = page.ogImage || seo.ogImage;
  const noindex = ctx.copy === 'test' || page.noindex;
  const h = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(page.description)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta name="robots" content="${noindex ? 'noindex, nofollow' : 'index, follow'}">`,
    `<meta property="og:type" content="${page.kind === 'article' ? 'article' : 'website'}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(page.description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:site_name" content="${esc(spec.name)}">`,
    img ? `<meta property="og:image" content="${esc(img)}">` : '',
    `<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(page.description)}">`,
    img ? `<meta name="twitter:image" content="${esc(img)}">` : '',
    seo.twitter ? `<meta name="twitter:site" content="${esc(seo.twitter)}">` : '',
    seo.searchConsole && ctx.copy === 'live' ? `<meta name="google-site-verification" content="${esc(seo.searchConsole)}">` : '',
    `<meta name="theme-color" content="${esc(spec.theme.color)}">`,
    `<link rel="preconnect" href="${esc(ctx.appUrl)}">`,
    `<script src="${esc(ctx.appUrl)}/embed/pg.js" defer></script>`,
    jsonLd(spec, page, ctx, url),
  ];
  // Google Analytics only on the live copy, so test visits never count.
  if (seo.gaId && ctx.copy === 'live') h.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(seo.gaId)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${esc(seo.gaId)}');</script>`);
  return h.filter(Boolean).join('\n');
}

function readBlocks(dir) {
  const out = {};
  const bdir = path.join(dir, 'blocks');
  if (!fs.existsSync(bdir)) return out;
  for (const name of fs.readdirSync(bdir)) {
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(name)) continue;
    const r = f => { try { return fs.readFileSync(path.join(bdir, name, f), 'utf8'); } catch { return ''; } };
    let meta = {};
    try { meta = JSON.parse(r('meta.json') || '{}'); } catch {}
    out[name] = {html: r('block.html'), css: r('block.css'), js: r('block.js'), version: meta.version || 1};
  }
  return out;
}

// Write a complete Astro project for one copy into projDir. Returns extra files to drop into the output.
export function generate({spec, copyDir, projDir, outDir, slug, copy, appUrl}) {
  const siteUrl = spec.seo?.siteUrl || `https://${slug}.codegreene.com`;
  const ctx = {slug, copy, appUrl, siteUrl, blocks: readBlocks(copyDir)};
  fs.mkdirSync(path.join(projDir, 'src', 'pages'), {recursive: true});
  fs.mkdirSync(path.join(projDir, 'src', 'data'), {recursive: true});
  fs.mkdirSync(path.join(projDir, 'public'), {recursive: true});
  fs.writeFileSync(path.join(projDir, 'astro.config.mjs'), `export default {output:'static',site:${JSON.stringify(siteUrl)},outDir:${JSON.stringify(outDir)},build:{format:'file',inlineStylesheets:'always'},compressHTML:true,trailingSlash:'never',devToolbar:{enabled:false},cacheDir:${JSON.stringify(projDir + '/.astro-cache')},vite:{cacheDir:${JSON.stringify(projDir + '/.vite')},logLevel:'error'}};\n`);
  fs.writeFileSync(path.join(projDir, 'package.json'), '{"name":"site","private":true,"type":"module"}');
  const nav = '<ul>' + spec.pages.filter(p => !p.noindex || true).map(p => `<li><a href="./${p.slug === 'index' ? '' : esc(p.slug)}" data-page="${esc(p.slug)}">${esc(p.slug === 'index' ? 'Home' : p.title)}</a></li>`).join('') + '</ul>';
  const footer = `<p>${esc(spec.footer?.text || '')}</p>`;
  const style = css(spec.theme);
  for (const page of spec.pages) {
    const body = page.sections.map((s, i) => sectionHtml(s, i, ctx)).join('\n') || `<section><div class="wrap"><h1>${esc(page.title)}</h1></div></section>`;
    const data = {lang: 'en', name: spec.name, css: style, headHtml: headHtml(spec, page, ctx), navHtml: nav.replace(`data-page="${page.slug}"`, `data-page="${page.slug}" aria-current="page"`), footerHtml: footer, bodyHtml: body};
    fs.writeFileSync(path.join(projDir, 'src', 'data', page.slug + '.json'), JSON.stringify(data));
    fs.writeFileSync(path.join(projDir, 'src', 'pages', page.slug + '.astro'), `---\nimport Base from '../layouts/Base.astro';\nimport data from '../data/${page.slug}.json';\n---\n<Base {...data} />\n`);
  }
  // 404 page
  fs.writeFileSync(path.join(projDir, 'src', 'data', '__404.json'), JSON.stringify({lang: 'en', name: spec.name, css: style, headHtml: `<title>Page not found | ${esc(spec.name)}</title><meta name="robots" content="noindex">`, navHtml: nav, footerHtml: footer, bodyHtml: '<section><div class="wrap narrow"><h1>Page not found</h1><p>Sorry, this page is not here. <a href="./">Go to the home page</a>.</p></div></section>'}));
  fs.writeFileSync(path.join(projDir, 'src', 'pages', '404.astro'), `---\nimport Base from '../layouts/Base.astro';\nimport data from '../data/__404.json';\n---\n<Base {...data} />\n`);
  // robots.txt and sitemap.xml: test copies are hidden from search engines, live copies are open.
  const robots = copy === 'test' ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
  fs.writeFileSync(path.join(projDir, 'public', 'robots.txt'), robots);
  const today = new Date().toISOString().slice(0, 10);
  const urls = copy === 'test' ? [] : spec.pages.filter(p => !p.noindex).map(p => `<url><loc>${esc(siteUrl + '/' + (p.slug === 'index' ? '' : p.slug))}</loc><lastmod>${today}</lastmod></url>`);
  fs.writeFileSync(path.join(projDir, 'public', 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>\n`);
}
