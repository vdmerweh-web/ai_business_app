import React, {useEffect, useState} from 'react';
import {Contact, Plus, Save, Search} from 'lucide-react';
import {api, post, when} from '../lib.js';
import Hint from '../Hint.jsx';
import {Card, Btn, Field, Msg, useAction, put} from '../ui.jsx';

const EMPTY = {name: '', email: '', phone: '', notes: '', custom: {}};
export default function Crm() {
  const [sites, setSites] = useState(null);
  const [siteId, setSiteId] = useState(null);
  const [copy, setCopy] = useState('live');
  const [q, setQ] = useState('');
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);
  const [nf, setNf] = useState({label: '', type: 'text', options: ''});
  const a = useAction();
  useEffect(() => { api('/sites').then(r => { setSites(r.sites); if (r.sites[0]) setSiteId(r.sites[0].id); }).catch(e => setSites({error: e.message})); }, []);
  const load = () => siteId && api(`/sites/${siteId}/crm?copy=${copy}&q=${encodeURIComponent(q)}`).then(setD).catch(e => setD({error: e.message}));
  useEffect(() => { load(); }, [siteId, copy]);
  if (!sites) return <p role="status">Loading…</p>;
  if (sites.error) return <Msg msg={{text: sites.error, err: true}}/>;
  if (!sites.length) return <div className="max-w-3xl mx-auto"><h1 className="text-3xl font-semibold">CRM</h1><p className="mt-2 text-slate-600">Add a site first. People who use your site's forms will show up here.</p></div>;
  const saveContact = () => a.run(async () => {
    if (edit.id) await put(`/sites/${siteId}/crm/contacts/${edit.id}`, {...edit, copy});
    else await post(`/sites/${siteId}/crm/contacts`, {...edit, copy});
    setEdit(null); await load();
  }, 'Saved.');
  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2"><Contact aria-hidden/> CRM<Hint term="CRM" meaning="Customer Relationship Management: your list of people who contacted you, with their messages and bookings."/></h1>
      <p className="mt-1 text-slate-600">Everyone who fills in a form, a funnel or makes a booking on your site.</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {sites.length > 1 && <label className="text-sm flex flex-col gap-1">Site<select value={siteId || ''} onChange={e => setSiteId(+e.target.value)} className="rounded-xl border border-slate-300 px-3 min-h-11">{sites.map(s => <option key={s.id} value={s.id}>{s.name}{s.clientName ? ` (${s.clientName})` : ''}</option>)}</select></label>}
        <label className="text-sm flex flex-col gap-1">Copy<select value={copy} onChange={e => setCopy(e.target.value)} className="rounded-xl border border-slate-300 px-3 min-h-11"><option value="live">Live (real people)</option><option value="test">Test (cleaned, fake data)</option></select></label>
        <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); load(); }} role="search">
          <label className="text-sm flex flex-col gap-1">Find a person<input value={q} onChange={e => setQ(e.target.value)} className="rounded-xl border border-slate-300 px-3 min-h-11"/></label>
          <Btn type="submit" kind="plain"><Search size={16} aria-hidden/>Find</Btn>
        </form>
        <Btn className="ml-auto" onClick={() => setEdit({...EMPTY})}><Plus size={16} aria-hidden/>Add a person</Btn>
      </div>
      {d?.error && <Msg msg={{text: d.error, err: true}}/>}
      {d && !d.error && <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Card>
          <h2 className="text-xl font-semibold">People ({d.contacts.length})</h2>
          {d.contacts.length ? <div className="mt-3 overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-slate-600"><th scope="col" className="py-2 pr-3">Name</th><th scope="col" className="pr-3">Email</th><th scope="col" className="pr-3">Phone</th><th scope="col" className="pr-3">From</th><th scope="col"><span className="sr-only">Edit</span></th></tr></thead>
            <tbody className="divide-y divide-slate-100">{d.contacts.map(c => <tr key={c.id}><td className="py-2 pr-3 font-medium">{c.name || '—'}</td><td className="pr-3 break-all">{c.email}</td><td className="pr-3">{c.phone}</td><td className="pr-3 text-slate-600">{c.source}</td><td><Btn kind="plain" onClick={() => setEdit({...c, custom: c.custom || {}})}>Edit<span className="sr-only"> {c.name}</span></Btn></td></tr>)}</tbody>
          </table></div> : <p className="mt-3 text-sm text-slate-600">Nobody yet.</p>}
        </Card>
        <div className="grid gap-5 content-start">
          {edit && <Card>
            <h2 className="text-lg font-semibold">{edit.id ? 'Edit person' : 'Add a person'}</h2>
            <div className="mt-3 grid gap-3">
              <Field label="Name"><input value={edit.name || ''} onChange={e => setEdit({...edit, name: e.target.value})}/></Field>
              <Field label="Email"><input type="email" value={edit.email || ''} onChange={e => setEdit({...edit, email: e.target.value})}/></Field>
              <Field label="Phone"><input value={edit.phone || ''} onChange={e => setEdit({...edit, phone: e.target.value})}/></Field>
              {d.fields.map(f => <Field key={f.key} label={f.label}>{f.type === 'choice' || f.type === 'yesno'
                ? <select value={edit.custom?.[f.key] || ''} onChange={e => setEdit({...edit, custom: {...edit.custom, [f.key]: e.target.value}})}><option value="">—</option>{(f.type === 'yesno' ? ['Yes', 'No'] : f.options || []).map(o => <option key={o}>{o}</option>)}</select>
                : <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={edit.custom?.[f.key] || ''} onChange={e => setEdit({...edit, custom: {...edit.custom, [f.key]: e.target.value}})}/>}</Field>)}
              <Field label="Notes"><textarea rows={3} value={edit.notes || ''} onChange={e => setEdit({...edit, notes: e.target.value})}/></Field>
            </div>
            <div className="mt-3 flex gap-2"><Btn busy={a.busy} onClick={saveContact}><Save size={16} aria-hidden/>Save</Btn><Btn kind="plain" onClick={() => setEdit(null)}>Close</Btn></div>
          </Card>}
          <Card>
            <h2 className="text-lg font-semibold">Your own fields</h2>
            <p className="text-sm text-slate-600">Extra things to keep for each person, just for you. Up to 30. Add the same field to the test copy to try it there.</p>
            <ul className="mt-2 text-sm list-disc pl-5">{d.fields.map(f => <li key={f.key}>{f.label} <span className="text-slate-500">({f.type})</span></li>)}</ul>
            <form className="mt-3 grid gap-2" onSubmit={e => { e.preventDefault(); a.run(() => post(`/sites/${siteId}/crm/fields`, {...nf, copy}).then(() => { setNf({label: '', type: 'text', options: ''}); load(); }), 'Field added.'); }}>
              <Field label="Field name"><input required value={nf.label} onChange={e => setNf({...nf, label: e.target.value})}/></Field>
              <Field label="Kind of answer"><select value={nf.type} onChange={e => setNf({...nf, type: e.target.value})}><option value="text">Words</option><option value="number">Number</option><option value="date">Date</option><option value="choice">Pick from a list</option><option value="yesno">Yes or no</option></select></Field>
              {nf.type === 'choice' && <Field label="Choices" hint="Separate with commas."><input value={nf.options} onChange={e => setNf({...nf, options: e.target.value})}/></Field>}
              <Btn type="submit" kind="plain" busy={a.busy}><Plus size={16} aria-hidden/>Add field</Btn>
            </form>
          </Card>
          <Msg msg={a.msg}/>
        </div>
        <Card className="lg:col-span-2">
          <h2 className="text-xl font-semibold">Latest messages</h2>
          {d.submissions.length ? <ul className="mt-2 text-sm divide-y divide-slate-100">{d.submissions.map(s => <li key={s.id} className="py-2"><span className="text-slate-600">{when(s.created_at)} · {s.module}{s.form_id ? ` (${s.form_id})` : ''}</span><span className="block break-words">{Object.entries(s.data || {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span></li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No messages yet.</p>}
        </Card>
      </div>}
    </div>
  );
}
