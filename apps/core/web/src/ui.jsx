import React, {useId, useState} from 'react';
import {Loader2} from 'lucide-react';
import {api} from './lib.js';

export const put = (p, b) => api(p, {method: 'PUT', body: JSON.stringify(b || {})});
export function Card({children, className = ''}) {
  return <div className={`rise rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 ${className}`}>{children}</div>;
}
export function Btn({children, kind = 'main', busy, className = '', ...p}) {
  const k = kind === 'main' ? 'bg-brand-700 text-white hover:bg-brand-900' : kind === 'danger' ? 'bg-red-700 text-white hover:bg-red-800' : 'bg-white text-slate-900 ring-1 ring-slate-300 hover:bg-slate-50';
  return (
    <button type="button" {...p} disabled={busy || p.disabled} className={`inline-flex items-center gap-2 rounded-xl px-4 min-h-11 font-medium transition-all hover:-translate-y-px disabled:opacity-60 disabled:hover:translate-y-0 ${k} ${className}`}>
      {busy && <Loader2 size={16} className="animate-spin" aria-hidden/>}{children}
    </button>
  );
}
export function Field({label, hint, children, id}) {
  const auto = useId();
  const fid = id || auto;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fid} className="text-sm font-medium text-slate-800">{label}</label>
      {React.cloneElement(children, {id: fid, 'aria-describedby': hint ? fid + '-h' : undefined, className: `min-h-11 rounded-xl border border-slate-300 px-3 py-2 bg-white ${children.props.className || ''}`})}
      {hint && <p id={fid + '-h'} className="text-xs text-slate-600">{hint}</p>}
    </div>
  );
}
export function Msg({msg}) {
  if (!msg) return null;
  const err = msg.err;
  return <p role={err ? 'alert' : 'status'} className={`mt-3 rounded-xl px-4 py-3 text-sm ${err ? 'bg-red-50 text-red-900 ring-1 ring-red-200' : 'bg-brand-50 text-brand-900 ring-1 ring-brand-600/20'}`}>{msg.text}</p>;
}
export function Badge({children, tone = 'slate'}) {
  const t = {slate: 'bg-slate-100 text-slate-800', green: 'bg-brand-50 text-brand-800 ring-1 ring-brand-600/20', amber: 'bg-amber-50 text-amber-900 ring-1 ring-amber-600/20', red: 'bg-red-50 text-red-900 ring-1 ring-red-200'}[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}
// Run an async action with a busy flag and a message.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const run = async (fn, ok) => {
    setBusy(true); setMsg(null);
    try { const r = await fn(); if (ok) setMsg({text: typeof ok === 'function' ? ok(r) : ok}); return r; }
    catch (e) { setMsg({text: e.message, err: true}); }
    finally { setBusy(false); }
  };
  return {busy, msg, setMsg, run};
}
export function Tabs({tabs, cur, onPick, label}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map(t => (
        <button key={t.id} role="tab" type="button" aria-selected={cur === t.id} aria-controls={'panel-' + t.id} id={'tab-' + t.id}
          onClick={() => onPick(t.id)}
          className={`px-3 min-h-11 -mb-px border-b-2 transition-colors ${cur === t.id ? 'border-brand-700 font-semibold text-brand-900' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>{t.label}</button>
      ))}
    </div>
  );
}
