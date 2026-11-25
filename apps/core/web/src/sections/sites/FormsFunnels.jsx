import React, {useEffect, useState} from 'react';
import {Plus, Trash2, Save} from 'lucide-react';
import {api} from '../../lib.js';
import {Card, Btn, Field, Msg, useAction, put} from '../../ui.jsx';

const TYPES = ['text', 'email', 'tel', 'textarea', 'number', 'date', 'choice'];
// Edits the questions of one form or funnel. Saves to the test copy and the live copy (they are settings, not visitor data).
export default function FormsFunnels({site, kind}) {
  const [rows, setRows] = useState(null);
  const [cur, setCur] = useState(0);
  const a = useAction();
  const itemsKey = kind === 'forms' ? 'fields' : 'steps';
  const textKey = kind === 'forms' ? 'label' : 'question';
  useEffect(() => { api(`/sites/${site.id}/${kind}?copy=test`).then(setRows).catch(e => setRows({error: e.message})); }, [site.id, kind]);
  if (!rows) return null;
  if (rows.error) return <Card><p className="text-sm">{rows.error}</p></Card>;
  const f = rows[cur];
  if (!f) return null;
  const items = f[itemsKey] || [];
  const setF = x => setRows(rows.map((r, i) => i === cur ? x : r));
  const setItem = (i, x) => setF({...f, [itemsKey]: items.map((it, j) => j === i ? x : it)});
  const save = () => a.run(async () => {
    const body = {title: f.title, success_text: f.success_text, fallback_text: f.fallback_text, [itemsKey]: items.map(it => ({...it, key: it.key || (it[textKey] || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}))};
    await put(`/sites/${site.id}/${kind}/${f.id}`, {...body, copy: 'test'});
    await put(`/sites/${site.id}/${kind}/${f.id}`, {...body, copy: 'live'});
  }, 'Saved on test and live.');
  return (
    <Card>
      <h2 className="text-xl font-semibold">{kind === 'forms' ? 'Form questions' : 'Funnel steps'}</h2>
      <p className="text-sm text-slate-600">{kind === 'forms' ? 'What your contact form asks. Name, email and phone go into your CRM. Other answers become custom fields.' : 'A funnel asks one question at a time, then saves the answers to your CRM.'}</p>
      {rows.length > 1 && <div className="mt-2 flex gap-2">{rows.map((r, i) => <Btn key={r.id} kind={i === cur ? 'main' : 'plain'} onClick={() => setCur(i)}>{r.title || r.id}</Btn>)}</div>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Title"><input value={f.title || ''} onChange={e => setF({...f, title: e.target.value})}/></Field>
        <Field label="Thank-you words"><input value={f.success_text || ''} onChange={e => setF({...f, success_text: e.target.value})}/></Field>
      </div>
      <ul className="mt-3 grid gap-2">{items.map((it, i) => (
        <li key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_auto_auto] items-end rounded-xl ring-1 ring-slate-200 p-3">
          <Field label={`${kind === 'forms' ? 'Question' : 'Step'} ${i + 1}`}><input value={it[textKey] || ''} onChange={e => setItem(i, {...it, [textKey]: e.target.value})}/></Field>
          <Field label="Answer type"><select value={it.type || 'text'} onChange={e => setItem(i, {...it, type: e.target.value})}>{TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
          <label className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={!!it.required} onChange={e => setItem(i, {...it, required: e.target.checked})}/> Must answer</label>
          <Btn kind="plain" onClick={() => setF({...f, [itemsKey]: items.filter((_, j) => j !== i)})}><Trash2 size={16} aria-hidden/><span className="sr-only">Remove {i + 1}</span></Btn>
          {it.type === 'choice' && <div className="sm:col-span-4"><Field label="Choices" hint="Separate with commas."><input value={(it.options || []).join(', ')} onChange={e => setItem(i, {...it, options: e.target.value.split(',').map(x => x.trim()).filter(Boolean)})}/></Field></div>}
        </li>))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn kind="plain" onClick={() => setF({...f, [itemsKey]: [...items, {[textKey]: '', type: 'text', required: false}]})}><Plus size={16} aria-hidden/>Add</Btn>
        <Btn busy={a.busy} onClick={save}><Save size={16} aria-hidden/>Save</Btn>
      </div>
      <Msg msg={a.msg}/>
    </Card>
  );
}
