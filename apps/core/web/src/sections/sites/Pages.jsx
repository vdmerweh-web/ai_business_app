import React, {useEffect, useState} from 'react';
import {ArrowUp, ArrowDown, Trash2, Plus, Save} from 'lucide-react';
import {api, post} from '../../lib.js';
import {Card, Btn, Field, Msg, useAction, put} from '../../ui.jsx';

const NEW = {
  hero: {type: 'hero', heading: 'A big welcome line', text: 'One short line about what you do.', buttonText: 'Contact us', buttonLink: '#contact'},
  text: {type: 'text', heading: 'A heading', text: 'Your words here.'},
  features: {type: 'features', heading: 'What we do', items: [{title: 'One', text: 'Short text.'}, {title: 'Two', text: 'Short text.'}]},
  image: {type: 'image', src: 'https://', alt: '', width: 1000, height: 600, caption: ''},
  module: {type: 'module', module: 'contact-form', id: 'main', heading: 'Contact us', fallback: 'Please email or phone us.'},
  block: {type: 'block', name: '', heading: ''},
};
const LABEL = {hero: 'Big top part', text: 'Text', features: 'List of points', image: 'Picture', module: 'Module (form, funnel, booking)', block: 'Client block'};

function SectionEdit({s, set}) {
  const f = (k, label, opts = {}) => (
    <Field label={label} hint={opts.hint}>
      {opts.area ? <textarea rows={4} value={s[k] || ''} onChange={e => set({...s, [k]: e.target.value})}/>
        : opts.select ? <select value={s[k] || ''} onChange={e => set({...s, [k]: e.target.value})}>{opts.select.map(o => <option key={o} value={o}>{o}</option>)}</select>
        : <input type={opts.num ? 'number' : 'text'} value={s[k] ?? ''} onChange={e => set({...s, [k]: opts.num ? +e.target.value : e.target.value})}/>}
    </Field>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {s.type !== 'image' && f('heading', 'Heading')}
      {s.type === 'hero' && <>{f('text', 'Text', {area: true})}{f('buttonText', 'Button words')}{f('buttonLink', 'Button link', {hint: 'Like #contact, book.html or https://…'})}{f('image', 'Top picture link (optional)', {hint: 'https:// link. Up to 2000 px wide.'})}{s.image && <>{f('imageAlt', 'Top picture alt text', {hint: 'Describe the picture for people who cannot see it.'})}{f('imageWidth', 'Width (px)', {num: true})}{f('imageHeight', 'Height (px)', {num: true})}</>}</>}
      {s.type === 'text' && f('text', 'Text', {area: true, hint: 'Leave an empty line between paragraphs. You can add [pg_contact_form id="main"].'})}
      {s.type === 'image' && <>{f('src', 'Picture link', {hint: 'https:// link. Up to 1000 px wide.'})}{f('alt', 'Alt text', {hint: 'Describe the picture for people who cannot see it.'})}{f('width', 'Width (px)', {num: true})}{f('height', 'Height (px)', {num: true})}{f('caption', 'Caption (optional)')}</>}
      {s.type === 'module' && <>{f('module', 'Which module', {select: ['contact-form', 'funnel', 'bookings']})}{f('id', 'Which one', {hint: 'Form: main · Funnel: quote · Booking: main'})}{f('fallback', 'Words to show if the app is resting')}{f('anchor', 'Jump name (optional)', {hint: 'Like contact, so a button can link to #contact.'})}</>}
      {s.type === 'block' && f('name', 'Block name', {hint: 'The name of a client block from the Client blocks tab.'})}
      {s.type === 'features' && (
        <div className="sm:col-span-2 grid gap-2">
          {(s.items || []).map((it, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] items-end">
              <Field label={`Point ${i + 1} title`}><input value={it.title} onChange={e => { const items = [...s.items]; items[i] = {...it, title: e.target.value}; set({...s, items}); }}/></Field>
              <Field label={`Point ${i + 1} text`}><input value={it.text} onChange={e => { const items = [...s.items]; items[i] = {...it, text: e.target.value}; set({...s, items}); }}/></Field>
              <Btn kind="plain" onClick={() => set({...s, items: s.items.filter((_, j) => j !== i)})}><Trash2 size={16} aria-hidden/><span className="sr-only">Remove point {i + 1}</span></Btn>
            </div>
          ))}
          <Btn kind="plain" onClick={() => set({...s, items: [...(s.items || []), {title: '', text: ''}]})}><Plus size={16} aria-hidden/>Add a point</Btn>
        </div>
      )}
    </div>
  );
}

export default function Pages({site}) {
  const [spec, setSpec] = useState(null);
  const [history, setHistory] = useState([]);
  const [pi, setPi] = useState(0);
  const [raw, setRaw] = useState(null);
  const a = useAction();
  const load = () => api('/sites/' + site.id).then(d => { setSpec(d.spec.test); setHistory(d.history); });
  useEffect(() => { load(); }, [site.id]);
  if (!spec) return <p role="status">Loading pages…</p>;
  const page = spec.pages[pi] || spec.pages[0];
  const setPage = p => setSpec({...spec, pages: spec.pages.map((x, i) => i === pi ? p : x)});
  const setSec = (i, s) => setPage({...page, sections: page.sections.map((x, j) => j === i ? s : x)});
  const move = (i, d) => { const s = [...page.sections]; const [x] = s.splice(i, 1); s.splice(i + d, 0, x); setPage({...page, sections: s}); };
  const save = () => a.run(async () => { const r = await put(`/sites/${site.id}/spec`, {spec: raw != null ? JSON.parse(raw) : spec}); await load(); setRaw(null); return r; }, r => r.built ? 'Saved on the test copy and built. Open the test copy to look.' : 'Saved, but the build had a problem. See Overview.');
  return (
    <div className="grid gap-5 lg:grid-cols-[14rem_1fr]">
      <Card>
        <h2 className="font-semibold">Pages</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {spec.pages.map((p, i) => <li key={i}><button type="button" aria-current={i === pi ? 'page' : undefined} onClick={() => setPi(i)} className={`w-full text-left px-3 min-h-11 rounded-lg ${i === pi ? 'bg-brand-50 font-medium' : 'hover:bg-slate-50'}`}>{p.slug === 'index' ? 'Home' : p.title || p.slug}</button></li>)}
        </ul>
        <Btn kind="plain" className="mt-3 w-full" onClick={() => { const slug = prompt('Page address name (small letters and dashes), like about-us'); if (slug && /^[a-z0-9][a-z0-9-]*$/.test(slug)) { setSpec({...spec, pages: [...spec.pages, {slug, title: slug.replace(/-/g, ' '), description: '', sections: [{...NEW.text, heading: slug.replace(/-/g, ' ')}]}]}); setPi(spec.pages.length); } }}><Plus size={16} aria-hidden/>Add page</Btn>
        {history.length > 0 && <details className="mt-4 text-sm"><summary className="cursor-pointer min-h-11 flex items-center">Older versions</summary>
          <ul className="mt-1">{history.slice(0, 10).map(h => <li key={h}><button type="button" className="underline text-brand-800 min-h-9" onClick={() => confirm('Go back to this version on the test copy?') && a.run(() => post(`/sites/${site.id}/history/restore`, {file: h}).then(load), 'Restored on the test copy.')}>{h.replace('spec-', '').replace('.json', '').slice(0, 16).replace('T', ' ')}</button></li>)}</ul>
        </details>}
      </Card>
      <div className="grid gap-4">
        <Card>
          <p className="text-sm text-amber-900 bg-amber-50 rounded-lg px-3 py-2 ring-1 ring-amber-600/20">You are changing the <strong>test copy</strong>. Live only changes when you publish.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Page title" hint="10 to 60 letters. Shows in Google and on the browser tab."><input value={page.title} onChange={e => setPage({...page, title: e.target.value})}/></Field>
            <Field label="Page description" hint="50 to 160 letters. Shows under the title in Google."><textarea rows={2} value={page.description} onChange={e => setPage({...page, description: e.target.value})}/></Field>
          </div>
          {page.slug !== 'index' && <Btn kind="danger" className="mt-3" onClick={() => confirm('Remove this page from the test copy?') && (setSpec({...spec, pages: spec.pages.filter((_, i) => i !== pi)}), setPi(0))}><Trash2 size={16} aria-hidden/>Remove page</Btn>}
        </Card>
        {page.sections.map((s, i) => (
          <Card key={i}>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{i + 1}. {LABEL[s.type]}</h3>
              <div className="ml-auto flex gap-1">
                <Btn kind="plain" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} aria-hidden/><span className="sr-only">Move up</span></Btn>
                <Btn kind="plain" disabled={i === page.sections.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} aria-hidden/><span className="sr-only">Move down</span></Btn>
                <Btn kind="plain" onClick={() => setPage({...page, sections: page.sections.filter((_, j) => j !== i)})}><Trash2 size={16} aria-hidden/><span className="sr-only">Remove part {i + 1}</span></Btn>
              </div>
            </div>
            <div className="mt-3"><SectionEdit s={s} set={x => setSec(i, x)}/></div>
          </Card>
        ))}
        <Card>
          <h3 className="font-semibold">Add a part</h3>
          <div className="mt-2 flex flex-wrap gap-2">{Object.keys(NEW).map(k => <Btn key={k} kind="plain" onClick={() => setPage({...page, sections: [...page.sections, {...NEW[k]}]})}><Plus size={16} aria-hidden/>{LABEL[k]}</Btn>)}</div>
        </Card>
        <div className="flex flex-wrap gap-2 items-center sticky bottom-3">
          <Btn busy={a.busy} onClick={save}><Save size={16} aria-hidden/>Save test copy</Btn>
          <details className="text-sm"><summary className="cursor-pointer min-h-11 flex items-center px-2">Advanced: edit as text</summary>
            <textarea aria-label="Site content as JSON text" rows={14} className="mt-2 w-full font-mono text-xs rounded-xl border border-slate-300 p-2" value={raw ?? JSON.stringify(spec, null, 1)} onChange={e => setRaw(e.target.value)}/>
          </details>
        </div>
        <Msg msg={a.msg}/>
      </div>
    </div>
  );
}
