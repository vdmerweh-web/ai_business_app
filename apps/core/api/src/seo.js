// SEO (Search Engine Optimization) check. Scores each built page of a copy (0-100)
// and suggests fixes. Bobby uses this as his "SEO check" skill on the TEST copy.
import fs from 'fs';
import path from 'path';
import {parse} from 'node-html-parser';
import {readSpec, publicDir} from './sitefiles.js';

const R = (level, text, fix, cost) => ({level, text, fix, cost});
function checkPage(html, page, copy) {
  const doc = parse(html);
  const issues = [];
  const title = doc.querySelector('title')?.text.trim() || '';
  if (!title) issues.push(R('high', 'The page has no title.', 'Give the page a short title (10 to 60 letters).', 20));
  else if (title.length < 10 || title.length > 60) issues.push(R('medium', `The title is ${title.length} letters long.`, 'Keep the title between 10 and 60 letters.', 8));
  const desc = doc.querySelector('meta[name="description"]')?.getAttribute('content') || '';
  if (!desc) issues.push(R('high', 'There is no description.', 'Write a 1 to 2 sentence description (50 to 160 letters).', 15));
  else if (desc.length < 50 || desc.length > 160) issues.push(R('medium', `The description is ${desc.length} letters long.`, 'Keep it between 50 and 160 letters.', 6));
  if (!doc.querySelector('link[rel="canonical"]')) issues.push(R('medium', 'No canonical link (the main address of this page).', 'Set the site address under SEO settings.', 6));
  if (!doc.querySelector('meta[property="og:title"]') || !doc.querySelector('meta[property="og:description"]')) issues.push(R('low', 'Share tags (Open Graph) are missing.', 'Add a title and description; share tags are made from them.', 4));
  if (!doc.querySelector('meta[property="og:image"]')) issues.push(R('low', 'No share picture.', 'Add a share picture under SEO settings so links look good on social media.', 3));
  if (!doc.querySelector('script[type="application/ld+json"]')) issues.push(R('low', 'No structured data (JSON-LD).', 'Fill in your business details under SEO settings.', 4));
  const h1 = doc.querySelectorAll('h1');
  if (h1.length !== 1) issues.push(R('high', `The page has ${h1.length} main headings (h1).`, 'Use exactly one main heading per page. Usually this is the first section heading.', 12));
  let prev = 1;
  for (const h of doc.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    const n = +h.tagName[1];
    if (n > prev + 1) { issues.push(R('medium', `A heading jumps from h${prev} to h${n} ("${h.text.trim().slice(0, 40)}").`, 'Do not skip heading levels.', 5)); break; }
    prev = n;
  }
  const imgs = doc.querySelectorAll('img');
  const noAlt = imgs.filter(i => !(i.getAttribute('alt') || '').trim() && i.getAttribute('role') !== 'presentation');
  if (noAlt.length) issues.push(R('high', `${noAlt.length} picture(s) have no alt text.`, 'Describe each picture in a few words for people who cannot see it.', 10));
  const noSize = imgs.filter(i => !i.getAttribute('width') || !i.getAttribute('height'));
  if (noSize.length) issues.push(R('medium', `${noSize.length} picture(s) have no width/height.`, 'Add width and height so the page does not jump (better Core Web Vitals).', 6));
  const words = doc.querySelector('main')?.text.split(/\s+/).filter(Boolean).length || 0;
  if (words < 120) issues.push(R('low', `Only about ${words} words on this page.`, 'Add a bit more helpful text (aim for 150 words or more).', 4));
  if (doc.querySelectorAll('script[src]').filter(s => !s.hasAttribute('defer') && !s.hasAttribute('async') && s.getAttribute('type') !== 'module').length) issues.push(R('low', 'A script may slow the page down.', 'Load scripts with defer.', 3));
  const robots = doc.querySelector('meta[name="robots"]')?.getAttribute('content') || '';
  if (copy === 'live' && /noindex/.test(robots) && !page?.noindex) issues.push(R('high', 'This live page tells Google not to list it.', 'Remove the "hide from Google" setting.', 20));
  const score = Math.max(0, 100 - issues.reduce((a, i) => a + i.cost, 0));
  return {title, description: desc, words, score, issues: issues.map(({cost, ...x}) => x)};
}

export function seoCheck(slug, copy = 'test') {
  const spec = readSpec(slug, copy);
  if (!spec) return {error: 'This copy has no content yet'};
  const dir = publicDir(slug, copy);
  const pages = spec.pages.map(p => {
    const file = path.join(dir, p.slug === 'index' ? 'index.html' : p.slug + '.html');
    if (!fs.existsSync(file)) return {page: p.slug, score: 0, issues: [{level: 'high', text: 'This page is not built yet.', fix: 'Build the test copy first.'}]};
    return {page: p.slug, ...checkPage(fs.readFileSync(file, 'utf8'), p, copy)};
  });
  const site = [];
  if (!fs.existsSync(path.join(dir, 'sitemap.xml'))) site.push({level: 'medium', text: 'No sitemap.xml.', fix: 'Rebuild the site.'});
  if (!fs.existsSync(path.join(dir, 'robots.txt'))) site.push({level: 'medium', text: 'No robots.txt.', fix: 'Rebuild the site.'});
  if (!spec.seo?.siteUrl) site.push({level: 'low', text: 'The site address for search engines is not set.', fix: `Set it under SEO settings (for now we use https://${slug}.codegreene.com).`});
  if (copy === 'live' && !spec.seo?.gaId) site.push({level: 'low', text: 'Google Analytics is not set.', fix: 'Paste your Google Analytics measurement ID (starts with G-) under SEO settings.'});
  const overall = pages.length ? Math.round(pages.reduce((a, p) => a + p.score, 0) / pages.length) : 0;
  return {copy, overall, site, pages, checkedAt: new Date().toISOString()};
}
