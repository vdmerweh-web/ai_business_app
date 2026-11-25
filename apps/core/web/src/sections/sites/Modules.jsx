import React, {useEffect, useState} from 'react';
import {Puzzle, MessageSquarePlus} from 'lucide-react';
import {api, post} from '../../lib.js';
import Hint from '../../Hint.jsx';
import FormsFunnels from './FormsFunnels.jsx';
import {Card, Btn, Field, Msg, Badge, useAction, put} from '../../ui.jsx';

const TAG = {
  'contact-form': (s, c) => `<pg-contact-form site="${s}" copy="${c}" form="main" api="${location.origin}"><p>Please email or phone us.</p></pg-contact-form>`,
  funnel: (s, c) => `<pg-funnel site="${s}" copy="${c}" funnel="quote" api="${location.origin}"><p>Please contact us for a quote.</p></pg-funnel>`,
  bookings: (s, c) => `<pg-booking site="${s}" copy="${c}" calendar="main" api="${location.origin}"><p>Please contact us to book.</p></pg-booking>`,
};
export default function Modules({site, isAdmin}) {
  const [mods, setMods] = useState(null);
  const [crs, setCrs] = useState([]);
  const [text, setText] = useState(''), [mod, setMod] = useState('');
  const a = useAction();
  const q = isAdmin ? '?clientId=' + site.clientId : '';
  const load = () => { api('/modules' + q).then(setMods); api('/change-requests' + q).then(setCrs).catch(() => {}); };
  useEffect(load, [site.id]);
  if (!mods) return <p role="status">Loading…</p>;
  return (
    <div className="grid gap-5">
      <Card>
        <h2 className="text-xl font-semibold flex items-center gap-2"><Puzzle size={20} aria-hidden/> Modules</h2>
        <p className="text-sm text-slate-600">Modules are shared parts built once for everyone. Switch on the ones you want. A module shows on your site as one small tag. If the app is resting, the words inside the tag show instead.</p>
        <ul className="mt-4 grid gap-3 md:grid-cols-2">{mods.map(m => (
          <li key={m.id} className="rounded-xl ring-1 ring-slate-200 p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="font-medium">{m.name}</span>
              {m.id === 'crm' && <Hint term="CRM" meaning="Customer Relationship Management: a list of the people who contact you."/>}
              {m.id === 'seo' && <Hint term="SEO" meaning="Search Engine Optimization: making your site easy for Google to find."/>}
              <Badge>v{m.version}</Badge>
              {m.comingSoon && <Badge tone="amber">Coming soon</Badge>}
              <button type="button" role="switch" aria-checked={m.enabled} aria-label={`${m.name} module`} disabled={m.comingSoon || ['sites', 'seo'].includes(m.id) || a.busy}
                onClick={() => a.run(() => put(`/modules/${m.id}${q}`, {enabled: !m.enabled, clientId: isAdmin ? site.clientId : undefined}).then(setMods))}
                className={`ml-auto relative h-7 w-12 rounded-full transition-colors disabled:opacity-50 ${m.enabled ? 'bg-brand-600' : 'bg-slate-300'}`}>
                <span className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${m.enabled ? 'translate-x-5' : ''}`}/>
              </button>
            </div>
            <p className="text-sm text-slate-600">{m.description}</p>
            {m.updateWaiting && <p className="text-sm text-amber-900">A new big version is ready. Try it on your test copy, then <button type="button" className="underline" onClick={() => a.run(() => post(`/modules/${m.id}/accept-update${q}`, {clientId: isAdmin ? site.clientId : undefined}).then(setMods), 'Updated.')}>use it on live too</button>.</p>}
            {m.enabled && TAG[m.id] && <details className="text-sm"><summary className="cursor-pointer min-h-9">Show the tag</summary><pre className="mt-1 whitespace-pre-wrap break-all bg-slate-50 rounded-lg p-2 text-xs">{TAG[m.id](site.slug, 'live')}</pre><p className="text-xs text-slate-600">In page text you can also write a shortcode like [pg_contact_form id="main"].</p></details>}
          </li>))}
        </ul>
        <Msg msg={a.msg}/>
      </Card>
      {mods.find(m => m.id === 'contact-form')?.enabled && <FormsFunnels site={site} kind="forms"/>}
      {mods.find(m => m.id === 'funnel')?.enabled && <FormsFunnels site={site} kind="funnels"/>}
      <Card>
        <h2 className="text-xl font-semibold flex items-center gap-2"><MessageSquarePlus size={20} aria-hidden/> Ask for a module change</h2>
        <p className="text-sm text-slate-600">Want a module to work differently? Tell us here. We decide if it should change for everyone. Bobby can log these for you too. Need something just for you? Ask Bobby for a client block instead.</p>
        <form className="mt-3 grid gap-3 sm:grid-cols-[12rem_1fr_auto] items-end" onSubmit={e => { e.preventDefault(); a.run(() => post('/change-requests' + q, {text, module: mod || undefined, clientId: isAdmin ? site.clientId : undefined}).then(() => { setText(''); load(); }), 'Sent. Thank you!'); }}>
          <Field label="Module"><select value={mod} onChange={e => setMod(e.target.value)}><option value="">Not sure</option>{mods.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
          <Field label="What should change?"><input required minLength={5} value={text} onChange={e => setText(e.target.value)}/></Field>
          <Btn type="submit" busy={a.busy}>Send</Btn>
        </form>
        {crs.length > 0 && <ul className="mt-4 text-sm divide-y divide-slate-100">{crs.map(c => <li key={c.id} className="py-2"><Badge tone={c.status === 'done' ? 'green' : c.status === 'declined' ? 'red' : 'amber'}>{c.status}</Badge> {c.module_id ? `[${c.module_id}] ` : ''}{c.text} <span className="text-slate-500">· by {c.via === 'bobby' ? 'Bobby' : c.requested_by}</span>{c.note ? <span className="block text-slate-600">Reply: {c.note}</span> : null}</li>)}</ul>}
      </Card>
    </div>
  );
}
