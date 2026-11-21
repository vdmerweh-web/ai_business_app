import React, {useEffect, useState} from 'react';
import {api} from '../lib.js';
import Hint from '../Hint.jsx';

const ms = n => !n ? '—' : n < 1000 ? `${Math.round(n)} ms` : `${(n/1000).toFixed(1)} s`;
const r = n => `R ${Number(n || 0).toFixed(2)}`;
const when = s => s ? new Date(s).toLocaleString('en-ZA', {timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short'}) : '';

export default function Usage() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 30*864e5).toLocaleDateString('en-CA', {timeZone: 'Africa/Johannesburg'}));
  const [to, setTo] = useState(() => new Date().toLocaleDateString('en-CA', {timeZone: 'Africa/Johannesburg'}));
  const [sum, setSum] = useState(null);
  const [recent, setRecent] = useState([]);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);

  const load = () => {
    setErr('');
    Promise.all([
      api(`/usage/summary?from=${from}&to=${to}`),
      api('/usage/recent?limit=50'),
    ]).then(([s, rec]) => { setSum(s); setRecent(rec); }).catch(e => setErr(e.message));
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="max-w-[1240px]">
      <h1 className="text-2xl font-semibold tracking-tight">AI usage
        <Hint term="AI usage" meaning="AI means Artificial Intelligence. This page shows time and credits used by every helper, for every prompt."/>
      </h1>
      <p className="text-muted mt-1 max-w-2xl">This is only for site admins. It helps you judge whether all tasks can run on one server. You can see totals per company, person, helper and day, plus recent prompts. Other companies’ prompts are never shown to a client login.</p>
      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); load(); }}>
        <label className="text-sm">From<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="ml-2 h-10 rounded-lg border border-line px-2"/></label>
        <label className="text-sm">To<input type="date" value={to} onChange={e => setTo(e.target.value)} className="ml-2 h-10 rounded-lg border border-line px-2"/></label>
        <button className="h-10 px-4 rounded-lg bg-navy text-white">Update</button>
        {sum?.serverName && <span className="text-sm text-muted">Server: {sum.serverName}</span>}
      </form>
      {err && <p role="alert" className="mt-3 text-over">{err}</p>}
      {sum && (
        <>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Prompts" value={sum.totals?.prompts || 0} hint="How many times a helper was asked, including errors."/>
            <Stat label="Credits used" value={r(sum.totals?.credits)} hint="Rand of Grok credits used in this date range."/>
            <Stat label="Average time" value={ms(sum.totals?.avg_ms)} hint="Average wall time from start to finish for each prompt."/>
            <Stat label="Average load" value={Number(sum.totals?.avg_load || 0).toFixed(2)} hint="Average server load (load average) at prompt time. Lower is quieter."/>
          </ul>
          {sum.totals?.errors > 0 && <p className="mt-2 text-sm text-over">{sum.totals.errors} prompt(s) ended with an error.</p>}
          <Table title="Per company" rows={sum.byClient} name={x => x.name + (x.ref ? ` (${x.ref})` : '')}/>
          <Table title="Per person" rows={sum.byUser} name={x => x.email}/>
          <Table title="Per helper" rows={sum.byAgent} name={x => x.agent}/>
          <Table title="Per day" rows={sum.byDay} name={x => x.day}/>
        </>
      )}
      <h2 className="mt-10 text-xl font-semibold">Recent prompts</h2>
      <div className="mt-3 overflow-x-auto rounded-2xl bg-white ring-1 ring-line">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left bg-slate-50 border-b border-line">
            {['When','Helper','Company','Person','Time','Credits','Status','Trigger'].map(h => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {recent.map(p => (
              <React.Fragment key={p.id}>
                <tr className="border-t border-line hover:bg-slate-50 cursor-pointer" onClick={() => setOpen(open === p.id ? null : p.id)}>
                  <td className="px-3 py-2 whitespace-nowrap">{when(p.created_at)}</td>
                  <td className="px-3 py-2">{p.ai_agent}</td>
                  <td className="px-3 py-2">{p.client_name || '—'}</td>
                  <td className="px-3 py-2">{p.user_email || '—'}</td>
                  <td className="px-3 py-2">{ms(p.duration_ms)}{p.model_ms ? ` (model ${ms(p.model_ms)})` : ''}</td>
                  <td className="px-3 py-2">{r(p.cost_zar)}</td>
                  <td className="px-3 py-2">{p.status}</td>
                  <td className="px-3 py-2">{p.trigger_type || 'chat'}{p.trigger_name ? ` · ${p.trigger_name}` : ''}</td>
                </tr>
                {open === p.id && (
                  <tr className="bg-slate-50"><td colSpan={8} className="px-3 py-3">
                    <p className="text-xs text-muted mb-1">Prompt text (admin only). Server: {p.server_name || '—'}; load: {p.load_1 != null ? Number(p.load_1).toFixed(2) : '—'}</p>
                    <pre className="whitespace-pre-wrap text-sm max-h-64 overflow-auto">{p.prompt_text || '(empty)'}</pre>
                    {p.error_message && <p className="mt-2 text-over text-sm">{p.error_message}</p>}
                    <p className="mt-1 text-xs text-muted">Response length: {p.response_length || 0} characters · model: {p.model || '—'} · tokens in/out: {p.input_tokens || 0}/{p.output_tokens || 0}</p>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
            {!recent.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-muted">No prompts yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({label, value, hint}) {
  return (
    <li className="rise rounded-2xl bg-white p-4 ring-1 ring-line">
      <p className="text-sm text-muted">{label}<Hint term={label} meaning={hint}/></p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </li>
  );
}

function Table({title, rows, name}) {
  const ms2 = n => !n ? '—' : n < 1000 ? `${Math.round(n)} ms` : `${(n/1000).toFixed(1)} s`;
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-3 overflow-x-auto rounded-2xl bg-white ring-1 ring-line">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left bg-slate-50 border-b border-line">
            {['Name','Prompts','Errors','Total time','Average time','Credits','Avg load'].map(h => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {(rows || []).map((x, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-3 py-2">{name(x)}</td>
                <td className="px-3 py-2">{x.prompts}</td>
                <td className="px-3 py-2">{x.errors || 0}</td>
                <td className="px-3 py-2">{ms2(x.total_ms)}</td>
                <td className="px-3 py-2">{ms2(x.avg_ms)}</td>
                <td className="px-3 py-2">R {Number(x.credits || 0).toFixed(2)}</td>
                <td className="px-3 py-2">{Number(x.avg_load || 0).toFixed(2)}</td>
              </tr>
            ))}
            {!(rows || []).length && <tr><td colSpan={7} className="px-3 py-4 text-muted text-center">None in this range.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
