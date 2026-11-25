import React, {useEffect, useState} from 'react';
import {Boxes, Save, Plus} from 'lucide-react';
import {api} from '../../lib.js';
import {Card, Btn, Field, Msg, Badge, useAction, put} from '../../ui.jsx';

// Client blocks: small pieces of code just for this client. Saved to TEST only; publishing needs an admin OK.
export default function Blocks({site}) {
  const [list, setList] = useState(null);
  const [cur, setCur] = useState(null);
  const a = useAction();
  const load = () => api('/sites/' + site.id).then(d => setList(d.blocks));
  useEffect(() => { load(); }, [site.id]);
  const open = name => a.run(() => api(`/sites/${site.id}/blocks/${name}?copy=test`).then(b => setCur({...b, description: b.meta?.description || ''})));
  if (!list) return <p role="status">Loading…</p>;
  const live = Object.fromEntries(list.live.map(b => [b.name, b.version]));
  return (
    <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
      <Card>
        <h2 className="font-semibold flex items-center gap-2"><Boxes size={18} aria-hidden/> Client blocks</h2>
        <p className="text-sm text-slate-600 mt-1">Special parts made just for this site, usually by Bobby. Add one to a page with a “Client block” part.</p>
        <ul className="mt-3 flex flex-col gap-1">{list.test.map(b => (
          <li key={b.name}><button type="button" onClick={() => open(b.name)} aria-current={cur?.name === b.name ? 'true' : undefined} className={`w-full text-left px-3 min-h-11 rounded-lg ${cur?.name === b.name ? 'bg-brand-50 font-medium' : 'hover:bg-slate-50'}`}>{b.name} <Badge>v{b.version}</Badge> {live[b.name] !== b.version && <Badge tone="amber">not live</Badge>}</button></li>))}
          {!list.test.length && <li className="text-sm text-slate-600">None yet.</li>}
        </ul>
        <Btn kind="plain" className="mt-3 w-full" onClick={() => { const n = prompt('Block name (small letters and dashes), like price-calculator'); if (n) setCur({name: n.toLowerCase(), html: '<div class="my-block">\n  Hello\n</div>', css: '', js: '', description: ''}); }}><Plus size={16} aria-hidden/>New block</Btn>
      </Card>
      {cur ? (
        <Card>
          <h2 className="text-xl font-semibold">{cur.name}</h2>
          <p className="text-sm text-amber-900 bg-amber-50 rounded-lg px-3 py-2 mt-2 ring-1 ring-amber-600/20">Saves to the test copy only. Going live needs your OK and an admin OK.</p>
          <div className="mt-3 grid gap-3">
            <Field label="What it does"><input value={cur.description} onChange={e => setCur({...cur, description: e.target.value})}/></Field>
            <Field label="HTML (the content)"><textarea rows={8} className="font-mono text-xs" value={cur.html} onChange={e => setCur({...cur, html: e.target.value})}/></Field>
            <Field label="CSS (the look)"><textarea rows={5} className="font-mono text-xs" value={cur.css} onChange={e => setCur({...cur, css: e.target.value})}/></Field>
            <Field label="JavaScript (what it does when clicked)" hint="Optional. Runs only on this site."><textarea rows={5} className="font-mono text-xs" value={cur.js} onChange={e => setCur({...cur, js: e.target.value})}/></Field>
          </div>
          <Btn className="mt-3" busy={a.busy} onClick={() => a.run(async () => { const r = await put(`/sites/${site.id}/blocks/${cur.name}`, cur); await load(); return r; }, r => `Saved as version ${r.version} on the test copy.`)}><Save size={16} aria-hidden/>Save to test</Btn>
          <Msg msg={a.msg}/>
        </Card>
      ) : <Card><p className="text-slate-600">Pick a block to look at, or make a new one.</p><Msg msg={a.msg}/></Card>}
    </div>
  );
}
