import React, {useEffect, useState} from 'react';
import {api, post} from '../lib.js';
import Hint from '../Hint.jsx';

const when = s => s ? new Date(s).toLocaleString('en-ZA', {timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short'}) : '';

function brief(before, after) {
  if (!after && !before) return '—';
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const bits = [];
  for (const k of keys) {
    if (k === 'id') continue;
    const a = before ? before[k] : undefined;
    const b = after ? after[k] : undefined;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const show = v => v === undefined || v === null || v === '' ? 'blank' : String(v);
    if (before == null) bits.push(`${k}: ${show(b)}`);
    else bits.push(`${k}: ${show(a)} → ${show(b)}`);
  }
  return bits.join('; ') || 'No field changes';
}

export default function ChangeLog({clientId, title = 'Recent changes'} = {}) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(null);

  const load = () => {
    setErr('');
    const q = '/changes?limit=30' + (clientId ? `&client_id=${clientId}` : '');
    api(q).then(setRows).catch(e => {
      if (/only for the site admin/i.test(e.message)) setRows(null);
      else setErr(e.message);
    });
  };
  useEffect(() => { load(); }, [clientId]);

  const undo = (id) => {
    if (!window.confirm('Undo this change? The earlier values will be put back, unless the record has changed again.')) return;
    setBusy(id);
    post('/changes/' + id + '/undo', {}).then(() => load()).catch(e => {
      setErr(e.message || 'Undo was not applied.');
    }).finally(() => setBusy(null));
  };

  if (rows == null && !err) return null;

  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold">{title}
        <Hint term="Change log" meaning="This is a list of changes to client records and agent settings, so a site admin can undo a change. Invoices, payments and ledger entries cannot be changed or undone here."/>
      </h2>
      <p className="text-slate-600 mt-1 max-w-2xl">Only a site admin can undo. An undo is itself logged. If the record has changed again, undo is refused and you are warned. Invoices, payments and the ledger are never included.</p>
      {err && <p role="alert" className="mt-2 text-red-800 text-sm">{err}</p>}
      <div className="mt-3 overflow-x-auto rounded-2xl bg-white ring-1 ring-slate-200">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left bg-slate-50 border-b border-slate-200">
            {['When','What','Via','By','Status',''].map(h => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {(rows || []).map(r => (
              <tr key={r.id} className="border-t border-slate-200">
                <td className="px-3 py-2 whitespace-nowrap">{when(r.created_at)}</td>
                <td className="px-3 py-2">{r.entity} #{r.record_id}: {brief(r.before, r.after)}</td>
                <td className="px-3 py-2">{r.via}{r.prompt_log_id ? ` · prompt ${r.prompt_log_id}` : ''}</td>
                <td className="px-3 py-2">{r.changed_by_email || '—'}</td>
                <td className="px-3 py-2">{r.undone_at ? `Undone ${when(r.undone_at)}` : (r.undo_of ? 'Undo' : 'Active')}</td>
                <td className="px-3 py-2 text-right">
                  {r.canUndo && <button className="h-8 px-3 rounded-lg border border-slate-200 text-sm" disabled={busy===r.id} onClick={() => undo(r.id)}>{busy===r.id ? 'Undoing…' : 'Undo'}</button>}
                </td>
              </tr>
            ))}
            {!(rows || []).length && <tr><td colSpan={6} className="px-3 py-4 text-slate-600 text-center">No client or agent changes logged yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
