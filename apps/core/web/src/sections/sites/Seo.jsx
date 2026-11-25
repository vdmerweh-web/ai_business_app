import React, {useEffect, useState} from 'react';
import {Search, Save} from 'lucide-react';
import {api} from '../../lib.js';
import Hint from '../../Hint.jsx';
import {Card, Btn, Field, Msg, Badge, useAction, put} from '../../ui.jsx';

const tone = n => n >= 85 ? 'green' : n >= 60 ? 'amber' : 'red';
export default function Seo({site}) {
  const [spec, setSpec] = useState(null);
  const [check, setCheck] = useState(null);
  const [copy, setCopy] = useState('test');
  const a = useAction();
  useEffect(() => { api('/sites/' + site.id).then(d => setSpec(d.spec.test)); }, [site.id]);
  const run = c => a.run(() => api(`/sites/${site.id}/seo?copy=${c}`).then(r => { setCheck(r); setCopy(c); }));
  useEffect(() => { run('test'); }, [site.id]);
  if (!spec) return <p role="status">Loading…</p>;
  const seo = spec.seo || {business: {}};
  const set = (k, v) => setSpec({...spec, seo: {...seo, [k]: v}});
  const setB = (k, v) => set('business', {...(seo.business || {}), [k]: v});
  const redirectsText = (spec.redirects || []).map(r => `${r.from} -> ${r.to}`).join('\n');
  return (
    <div className="grid gap-5">
      <Card>
        <h2 className="text-xl font-semibold flex items-center gap-2"><Search size={20} aria-hidden/> Page check</h2>
        <p className="text-sm text-slate-600">SEO<Hint term="SEO" meaning="Search Engine Optimization: making your site easy for Google to find and show."/> score for each page, out of 100, with what to fix. Bobby can run this too.</p>
        <div className="mt-3 flex gap-2">
          <Btn kind={copy === 'test' ? 'main' : 'plain'} busy={a.busy} onClick={() => run('test')}>Check test copy</Btn>
          <Btn kind={copy === 'live' ? 'main' : 'plain'} busy={a.busy} onClick={() => run('live')}>Check live copy</Btn>
        </div>
        {check && !check.error && (
          <div className="mt-4">
            <p className="text-lg">Overall: <Badge tone={tone(check.overall)}>{check.overall}/100</Badge></p>
            {check.site.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm">{check.site.map((s, i) => <li key={i}>{s.text} <span className="text-slate-600">{s.fix}</span></li>)}</ul>}
            <ul className="mt-3 grid gap-3 md:grid-cols-2">{check.pages.map(p => (
              <li key={p.page} className="rounded-xl ring-1 ring-slate-200 p-4">
                <p className="font-medium">{p.page === 'index' ? 'Home' : p.page} <Badge tone={tone(p.score)}>{p.score}/100</Badge></p>
                {p.issues.length ? <ul className="mt-2 text-sm list-disc pl-5">{p.issues.map((x, i) => <li key={i}><span className={x.level === 'high' ? 'text-red-800 font-medium' : ''}>{x.text}</span> <span className="text-slate-600">{x.fix}</span></li>)}</ul> : <p className="text-sm mt-1 text-brand-800">All good.</p>}
              </li>))}
            </ul>
          </div>
        )}
      </Card>
      <Card>
        <h2 className="text-xl font-semibold">SEO settings</h2>
        <p className="text-sm text-slate-600">Every page already gets a title, description, main address (canonical), share tags for Facebook and X, structured data, a sitemap and a robots file. The test copy is always hidden from Google.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Site address for Google" hint="Like https://sunnybakery.co.za. Leave empty to use the codegreene.com address."><input value={seo.siteUrl || ''} onChange={e => set('siteUrl', e.target.value)}/></Field>
          <Field label="Kind of business" hint="Used in structured data (JSON-LD), which helps Google understand you."><select value={seo.type || 'LocalBusiness'} onChange={e => set('type', e.target.value)}><option value="LocalBusiness">Local business (a shop or service in one area)</option><option value="Organization">Organisation</option></select></Field>
          <Field label="Business name"><input value={seo.business?.name || ''} onChange={e => setB('name', e.target.value)}/></Field>
          <Field label="Phone"><input value={seo.business?.phone || ''} onChange={e => setB('phone', e.target.value)}/></Field>
          <Field label="Email"><input type="email" value={seo.business?.email || ''} onChange={e => setB('email', e.target.value)}/></Field>
          <Field label="Street"><input value={seo.business?.street || ''} onChange={e => setB('street', e.target.value)}/></Field>
          <Field label="Town or city"><input value={seo.business?.city || ''} onChange={e => setB('city', e.target.value)}/></Field>
          <Field label="Country code" hint="Like ZA or US."><input value={seo.business?.country || ''} onChange={e => setB('country', e.target.value)}/></Field>
          <Field label="Share picture link" hint="https:// link to a picture shown when someone shares your site (about 1200 × 630 px)."><input value={seo.ogImage || ''} onChange={e => set('ogImage', e.target.value)}/></Field>
          <Field label="X (Twitter) name" hint="Like @sunnybakery. Optional."><input value={seo.twitter || ''} onChange={e => set('twitter', e.target.value)}/></Field>
          <Field label="Google Analytics measurement ID" hint="Starts with G-. Only added to the live copy, so test visits never count."><input value={seo.gaId || ''} onChange={e => set('gaId', e.target.value.trim())}/></Field>
          <Field label="Google Search Console code" hint="The code from the “HTML tag” check (only the content part)."><input value={seo.searchConsole || ''} onChange={e => set('searchConsole', e.target.value.trim())}/></Field>
          <div className="sm:col-span-2">
            <Field label="Old addresses to send on (301 redirects)" hint="One per line, like /old-about.php -> /about. Use this when a site is rebuilt so old Google links still work.">
              <textarea rows={4} defaultValue={redirectsText} onChange={e => setSpec({...spec, redirects: e.target.value.split('\n').map(l => l.split('->').map(x => x.trim())).filter(p => p.length === 2 && p[0] && p[1]).map(([from, to]) => ({from, to}))})}/>
            </Field>
          </div>
        </div>
        <Btn className="mt-4" busy={a.busy} onClick={() => a.run(() => put(`/sites/${site.id}/spec`, {spec}).then(() => run('test')), 'Saved on the test copy.')}><Save size={16} aria-hidden/>Save SEO settings</Btn>
        <Msg msg={a.msg}/>
      </Card>
    </div>
  );
}
