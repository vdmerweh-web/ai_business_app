import React, {useEffect, useState} from 'react';
import {Network, Flag, Send, Mail as MailIcon, HardDrive, ListX, MessageSquarePlus} from 'lucide-react';
import {api, post, when} from '../lib.js';
import Hint from '../Hint.jsx';
import {Card, Btn, Field, Msg, Badge, useAction, Tabs, put} from '../ui.jsx';
import {JobsPanel} from './sites/Schedule.jsx';

const TABS = [{id: 'flags', label: 'Flags'}, {id: 'hooks', label: 'Bot messages'}, {id: 'jobs', label: 'Scheduler'}, {id: 'storage', label: 'Space'}, {id: 'changes', label: 'Change requests'}, {id: 'mail', label: 'Mail outbox'}, {id: 'names', label: 'Reserved names'}];
const tone = s => s === 'done' ? 'green' : s === 'declined' ? 'red' : 'amber';

function Flags() {
  const [rows, setRows] = useState(null); const a = useAction();
  const load = () => api('/platform/flags').then(setRows);
  useEffect(() => { load(); }, []);
  if (!rows) return <p role="status">Loading…</p>;
  return <Card><h2 className="text-xl font-semibold flex items-center gap-2"><Flag size={20} aria-hidden/> Flags</h2><p className="text-sm text-slate-600">Problems that were sent to Grid: failed jobs, bad bot messages, space warnings.</p>
    {rows.length ? <ul className="mt-3 divide-y divide-slate-100 text-sm">{rows.map(f => <li key={f.id} className="py-2 flex flex-wrap gap-2 items-center"><Badge tone={f.resolved_at ? 'green' : 'red'}>{f.resolved_at ? 'sorted' : 'open'}</Badge><span className="text-slate-600">{when(f.created_at)} · {f.source}{f.client_name ? ' · ' + f.client_name : ''}</span><span className="basis-full sm:basis-auto flex-1">{f.text}</span>{!f.resolved_at && <Btn kind="plain" busy={a.busy} onClick={() => a.run(() => post(`/platform/flags/${f.id}/resolve`).then(load))}>Mark sorted</Btn>}</li>)}</ul> : <p className="mt-3 text-sm">No flags.</p>}<Msg msg={a.msg}/></Card>;
}
function Hooks() {
  const [d, setD] = useState(null); const [to, setTo] = useState('grid'); const [text, setText] = useState(''); const a = useAction();
  const load = () => api('/platform/hooks').then(setD);
  useEffect(() => { load(); }, []);
  if (!d) return <p role="status">Loading…</p>;
  return <div className="grid gap-5">
    <Card><h2 className="text-xl font-semibold flex items-center gap-2"><Network size={20} aria-hidden/> Admin and Grid messages</h2>
      <p className="text-sm text-slate-600">Bots send each other signed messages through webhooks<Hint term="Webhook" meaning="A web address one program calls to tell another program something happened."/>. Each message is signed with a secret key (HMAC<Hint term="HMAC" meaning="Hash-based Message Authentication Code: a stamp that proves who sent a message and that nobody changed it."/>), so fakes are turned away.</p>
      <p className="mt-2 text-sm">Secrets set: <strong>{d.configured ? 'yes' : 'no'}</strong> · Send to Admin by web address: {d.adminOut ? 'yes' : 'no (Admin reads its inbox)'} · Send to Grid by web address: {d.gridOut ? 'yes' : 'no (Grid reads its inbox)'}</p>
      <form className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr_auto] items-end" onSubmit={e => { e.preventDefault(); a.run(() => post('/platform/hooks/send', {to, text}).then(() => { setText(''); load(); }), 'Queued.'); }}>
        <Field label="To"><select value={to} onChange={e => setTo(e.target.value)}><option value="grid">Grid</option><option value="admin">Admin</option></select></Field>
        <Field label="Message"><input required value={text} onChange={e => setText(e.target.value)}/></Field>
        <Btn type="submit" busy={a.busy}><Send size={16} aria-hidden/>Send</Btn>
      </form><Msg msg={a.msg}/>
      <ul className="mt-4 divide-y divide-slate-100 text-sm">{d.messages.map(m => <li key={m.id} className="py-2"><span className="text-slate-600">{when(m.created_at)} · {m.from_bot} → {m.to_bot} · {m.delivered ? 'delivered' : m.read_at ? 'read' : `waiting (${m.attempts} tries)`}</span><span className="block break-words">{m.text}</span></li>)}</ul>
    </Card>
    <Card><h2 className="text-lg font-semibold">Webhook log</h2>
      <ul className="mt-2 divide-y divide-slate-100 text-sm">{d.log.map(l => <li key={l.id} className="py-2"><Badge tone={l.status < 300 ? 'green' : 'red'}>{l.status ?? '—'}</Badge> {when(l.created_at)} · {l.direction} {l.peer} {l.path} · signature {l.sig_ok ? 'good' : l.sig_ok === 0 ? 'BAD' : '—'}{l.summary ? ' · ' + l.summary : ''}</li>)}</ul>
    </Card>
  </div>;
}
function Storage() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/platform/storage').then(setRows); }, []);
  if (!rows) return <p role="status">Loading…</p>;
  return <Card><h2 className="text-xl font-semibold flex items-center gap-2"><HardDrive size={20} aria-hidden/> Space per client</h2>
    <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-600"><th scope="col" className="py-2 pr-3">Client</th><th scope="col" className="pr-3">Plan</th><th scope="col" className="pr-3">Data</th><th scope="col" className="pr-3">Files</th></tr></thead>
      <tbody className="divide-y divide-slate-100">{rows.map(r => <tr key={r.client.id}><td className="py-2 pr-3">{r.client.name}{r.client.is_test ? ' (test)' : ''}</td><td className="pr-3">{r.plan.name}</td><td className="pr-3"><Badge tone={r.db.level === 'over' ? 'red' : r.db.level === 'warn' ? 'amber' : 'green'}>{r.db.pct}%</Badge> of {r.plan.dbMb} MB</td><td className="pr-3"><Badge tone={r.files.level === 'over' ? 'red' : r.files.level === 'warn' ? 'amber' : 'green'}>{r.files.pct}%</Badge> of {r.plan.filesMb} MB</td></tr>)}</tbody></table></div></Card>;
}
function Changes() {
  const [rows, setRows] = useState(null); const [notes, setNotes] = useState({}); const a = useAction();
  const load = () => api('/change-requests').then(setRows);
  useEffect(() => { load(); }, []);
  if (!rows) return <p role="status">Loading…</p>;
  return <Card><h2 className="text-xl font-semibold flex items-center gap-2"><MessageSquarePlus size={20} aria-hidden/> Module change requests</h2><p className="text-sm text-slate-600">Bobby cannot change shared module code. When a client or Bobby wants a change, it lands here for you to decide.</p>
    {rows.length ? <ul className="mt-3 divide-y divide-slate-100">{rows.map(c => <li key={c.id} className="py-3 text-sm">
      <p><Badge tone={tone(c.status)}>{c.status}</Badge> <strong>{c.client_name}</strong>{c.module_id ? ` · ${c.module_id}` : ''} · {c.via === 'bobby' ? 'Bobby' : c.requested_by} · {when(c.created_at)}</p>
      <p className="mt-1">{c.text}</p>
      <div className="mt-2 flex flex-wrap gap-2 items-end"><Field label="Reply"><input value={notes[c.id] ?? c.note ?? ''} onChange={e => setNotes({...notes, [c.id]: e.target.value})}/></Field>
        {['planned', 'done', 'declined'].map(s => <Btn key={s} kind="plain" busy={a.busy} onClick={() => a.run(() => put(`/change-requests/${c.id}`, {status: s, note: notes[c.id] ?? c.note ?? ''}).then(load))}>{s === 'planned' ? 'Plan it' : s === 'done' ? 'Done' : 'Say no'}</Btn>)}</div>
    </li>)}</ul> : <p className="mt-3 text-sm">No requests.</p>}<Msg msg={a.msg}/></Card>;
}
function MailBox() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/mail-outbox').then(setRows); }, []);
  if (!rows) return <p role="status">Loading…</p>;
  return <Card><h2 className="text-xl font-semibold flex items-center gap-2"><MailIcon size={20} aria-hidden/> Mail outbox</h2><p className="text-sm text-slate-600">Emails the app would send (like “new booking”). Sending is switched off until a mail service is chosen, so they are only kept here.</p>
    {rows.length ? <ul className="mt-3 divide-y divide-slate-100 text-sm">{rows.map(m => <li key={m.id} className="py-2"><Badge>{m.status}</Badge> {when(m.created_at)} · to {m.to_addr} · <strong>{m.subject}</strong>{m.copy ? ` · ${m.copy} copy` : ''}</li>)}</ul> : <p className="mt-3 text-sm">Empty.</p>}</Card>;
}
function Names() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/platform/reserved-names').then(setRows); }, []);
  if (!rows) return <p role="status">Loading…</p>;
  return <Card><h2 className="text-xl font-semibold flex items-center gap-2"><ListX size={20} aria-hidden/> Reserved names ({rows.length})</h2><p className="text-sm text-slate-600">These can never be used as a site address name, because they are used already or saved for us.</p>
    <ul className="mt-3 flex flex-wrap gap-1.5">{rows.map(r => <li key={r.name}><Badge tone={r.points_to ? 'amber' : 'slate'}>{r.name}{r.points_to ? ` → ${r.points_to}` : ''}</Badge></li>)}</ul></Card>;
}
export default function Platform({path, go}) {
  const tab = (/^\/platform\/([a-z]+)/.exec(path) || [])[1] || 'flags';
  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-3xl font-semibold tracking-tight">Platform</h1>
      <p className="mt-1 text-slate-600">Admin view of the whole app: problems, bot messages, jobs, space and requests.</p>
      <div className="mt-4"><Tabs label="Platform parts" tabs={TABS} cur={tab} onPick={t => go('/platform/' + t)}/></div>
      <div role="tabpanel" id={'panel-' + tab} aria-labelledby={'tab-' + tab} className="mt-5">
        {tab === 'flags' && <Flags/>}{tab === 'hooks' && <Hooks/>}{tab === 'jobs' && <JobsPanel all isAdmin/>}
        {tab === 'storage' && <Storage/>}{tab === 'changes' && <Changes/>}{tab === 'mail' && <MailBox/>}{tab === 'names' && <Names/>}
      </div>
    </div>
  );
}
