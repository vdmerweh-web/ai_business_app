import React, {useEffect, useState} from 'react';
import {CalendarDays, Save} from 'lucide-react';
import {api, post, when} from '../../lib.js';
import {Card, Btn, Field, Msg, useAction, put} from '../../ui.jsx';

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
export default function Bookings({site}) {
  const [copy, setCopy] = useState('live');
  const [d, setD] = useState(null);
  const [st, setSt] = useState(null);
  const a = useAction();
  const load = c => api(`/sites/${site.id}/bookings?copy=${c}`).then(r => { setD(r); setSt(r.settings || {mode: 'builtin', slot_minutes: 30, hours: {}, timezone: 'Africa/Johannesburg'}); }).catch(e => setD({error: e.message}));
  useEffect(() => { load(copy); }, [site.id, copy]);
  if (!d) return <p role="status">Loading…</p>;
  if (d.error) return <Card><p>{d.error}</p></Card>;
  const hours = st.hours || {};
  const setDay = (k, from, to, open) => setSt({...st, hours: {...hours, [k]: open ? [[from, to]] : []}});
  const save = () => a.run(async () => {
    for (const c of ['test', 'live']) await put(`/sites/${site.id}/bookings/settings`, {...st, copy: c});
  }, 'Saved on test and live.');
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <h2 className="text-xl font-semibold flex items-center gap-2"><CalendarDays size={20} aria-hidden/> Booking settings</h2>
        <fieldset className="mt-3">
          <legend className="font-medium">How should people book?</legend>
          <label className="flex items-center gap-2 min-h-11"><input type="radio" name="mode" checked={st.mode !== 'calendly'} onChange={() => setSt({...st, mode: 'builtin'})}/> Our built-in calendar</label>
          <label className="flex items-center gap-2 min-h-11"><input type="radio" name="mode" checked={st.mode === 'calendly'} onChange={() => setSt({...st, mode: 'calendly'})}/> My Calendly link</label>
        </fieldset>
        {st.mode === 'calendly' ? (
          <Field label="Calendly link" hint="Like https://calendly.com/your-name/30min. Visitors get a button to book on Calendly."><input value={st.calendly_url || ''} onChange={e => setSt({...st, calendly_url: e.target.value})}/></Field>
        ) : (<>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Field label="Length of one booking (minutes)"><input type="number" min={10} max={240} value={st.slot_minutes || 30} onChange={e => setSt({...st, slot_minutes: +e.target.value})}/></Field>
            <Field label="Time zone" hint="Like Africa/Johannesburg."><input value={st.timezone || ''} onChange={e => setSt({...st, timezone: e.target.value})}/></Field>
          </div>
          <fieldset className="mt-3"><legend className="font-medium">Open hours</legend>
            {DAYS.map(([k, name]) => { const h = hours[k]?.[0]; return (
              <div key={k} className="flex flex-wrap items-center gap-2 py-1">
                <label className="flex items-center gap-2 w-36 min-h-11"><input type="checkbox" checked={!!h} onChange={e => setDay(k, '09:00', '17:00', e.target.checked)}/> {name}</label>
                {h && <><label className="sr-only" htmlFor={`f-${k}`}>{name} from</label><input id={`f-${k}`} type="time" value={h[0]} onChange={e => setDay(k, e.target.value, h[1], true)} className="rounded-lg border border-slate-300 px-2 min-h-11"/>
                <span aria-hidden>to</span><label className="sr-only" htmlFor={`t-${k}`}>{name} until</label><input id={`t-${k}`} type="time" value={h[1]} onChange={e => setDay(k, h[0], e.target.value, true)} className="rounded-lg border border-slate-300 px-2 min-h-11"/></>}
              </div>); })}
          </fieldset>
        </>)}
        <Btn className="mt-4" busy={a.busy} onClick={save}><Save size={16} aria-hidden/>Save</Btn>
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="font-medium">Link your own calendar</h3>
          <p className="text-sm text-slate-600">So bookings show in your Google or Outlook calendar. This is not switched on yet.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn kind="plain" onClick={() => a.run(() => post(`/sites/${site.id}/bookings/connect/google`))}>Link Google Calendar</Btn>
            <Btn kind="plain" onClick={() => a.run(() => post(`/sites/${site.id}/bookings/connect/outlook`))}>Link Outlook</Btn>
          </div>
        </div>
        <Msg msg={a.msg}/>
      </Card>
      <Card>
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold">Bookings</h2>
          <label className="ml-auto text-sm flex items-center gap-2">Show <select value={copy} onChange={e => setCopy(e.target.value)} className="rounded-lg border border-slate-300 px-2 min-h-11"><option value="live">live</option><option value="test">test</option></select></label>
        </div>
        {d.bookings.length ? <ul className="mt-3 divide-y divide-slate-100">{d.bookings.map(b => <li key={b.id} className="py-2 text-sm"><strong>{when(b.starts_at)}</strong> · {b.name} · {b.email}{b.phone ? ` · ${b.phone}` : ''}{b.note ? <span className="block text-slate-600">{b.note}</span> : null}</li>)}</ul> : <p className="mt-3 text-sm text-slate-600">No bookings yet.</p>}
      </Card>
    </div>
  );
}
