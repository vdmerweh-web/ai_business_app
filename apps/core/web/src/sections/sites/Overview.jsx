import React, {useEffect, useState} from 'react';
import {ExternalLink, RefreshCw, Rocket, RotateCcw, ShieldCheck} from 'lucide-react';
import {api, post, when} from '../../lib.js';
import Hint from '../../Hint.jsx';
import {Card, Btn, Msg, Badge, useAction} from '../../ui.jsx';

export default function Overview({site, isAdmin, reload}) {
  const a = useAction();
  const [detail, setDetail] = useState(null);
  const [storage, setStorage] = useState(null);
  const [iso, setIso] = useState(null);
  const load = () => api('/sites/' + site.id).then(setDetail).catch(() => {});
  useEffect(() => { load(); api('/storage' + (isAdmin ? '?clientId=' + site.clientId : '')).then(setStorage).catch(() => {}); }, [site.id]);
  const after = async () => { await reload(); await load(); };
  const pend = site.pendingPublish[0];
  const mb = b => (b / 1048576).toFixed(1) + ' MB';
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {['test', 'live'].map(copy => (
        <Card key={copy}>
          <h2 className="text-xl font-semibold">{copy === 'test' ? 'Test copy' : 'Live copy'} <Badge tone={site.copies[copy]?.build === 'ok' ? 'green' : site.copies[copy]?.build === 'failed' ? 'red' : 'amber'}>{site.copies[copy]?.build || 'new'}</Badge></h2>
          <p className="mt-1 text-sm text-slate-600">{copy === 'test' ? 'Only you can see this. Bobby makes changes here. Search engines are told not to list it.' : 'What visitors see. It only changes when a publish is approved.'}</p>
          {site.copies[copy]?.builtAt && <p className="mt-1 text-sm">Last built: {when(site.copies[copy].builtAt)}</p>}
          {site.copies[copy]?.buildError && <p className="mt-1 text-sm text-red-800">Build problem: {site.copies[copy].buildError}</p>}
          {isAdmin && site.copies[copy]?.database && <p className="mt-1 text-xs text-slate-500">Database: <code>{site.copies[copy].database}</code></p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <a className="inline-flex items-center gap-2 rounded-xl px-4 min-h-11 ring-1 ring-slate-300 hover:bg-slate-50" href={copy === 'test' ? site.testUrl : site.liveUrl} target="_blank" rel="noopener">Open <ExternalLink size={16} aria-hidden/><span className="sr-only">(opens in a new tab)</span></a>
            {(copy === 'test' || isAdmin) && <Btn kind="plain" busy={a.busy} onClick={() => a.run(() => post(`/sites/${site.id}/build`, {copy}).then(after), 'Built again.')}><RefreshCw size={16} aria-hidden/>Build again</Btn>}
          </div>
          {copy === 'live' && <p className="mt-3 text-xs text-slate-600">Later address: {site.futureUrl} (needs DNS<Hint term="DNS" meaning="Domain Name System: the internet's address book that points a name to our server."/> first).</p>}
        </Card>
      ))}
      <Card>
        <h2 className="text-xl font-semibold flex items-center gap-2"><Rocket size={20} aria-hidden/> Publish test to live</h2>
        <p className="mt-1 text-sm text-slate-600">Copies the test pages and client blocks over the live copy. Data (messages, bookings) is never copied this way.</p>
        {site.blocksChanged && <p className="mt-2 text-sm text-amber-900">This change includes a client block, so Hannes or Grid must also give an OK.</p>}
        {pend ? (
          <div className="mt-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-600/20">
            <p className="font-medium">Waiting for OK{pend.via === 'bobby' ? ' (asked by Bobby)' : ''}</p>
            {pend.note && <p className="text-sm mt-1">“{pend.note}”</p>}
            <p className="text-sm mt-1">Client OK: {pend.clientOk ? 'yes' : 'not yet'}{pend.needsAdmin && <> · Admin OK: {pend.adminOk ? 'yes' : 'not yet'}</>}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn busy={a.busy} onClick={() => a.run(() => post(`/sites/${site.id}/publish-requests/${pend.id}/approve`).then(async r => { await after(); return r; }), r => r.message)}>Give my OK</Btn>
              <Btn kind="plain" busy={a.busy} onClick={() => a.run(() => post(`/sites/${site.id}/publish-requests/${pend.id}/cancel`).then(after), 'Cancelled.')}>Cancel</Btn>
            </div>
          </div>
        ) : (
          <Btn className="mt-3" busy={a.busy} onClick={() => a.run(() => post(`/sites/${site.id}/publish-requests`, {note: ''}).then(after), 'Asked. Now give your OK below.')}>Ask to publish</Btn>
        )}
      </Card>
      <Card>
        <h2 className="text-xl font-semibold flex items-center gap-2"><RotateCcw size={20} aria-hidden/> Reset the test copy</h2>
        <p className="mt-1 text-sm text-slate-600">Copies data from live to test, after cleaning it: names, emails, phone numbers and messages are replaced with fake ones. Nothing ever goes from test to live.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn kind="plain" busy={a.busy} onClick={() => confirm('Replace the test data with cleaned live data?') && a.run(() => post(`/sites/${site.id}/reset-test`, {}), r => 'Done. Copied: ' + Object.entries(r.copied).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(', '))}>Reset data</Btn>
          <Btn kind="plain" busy={a.busy} onClick={() => confirm('Replace the test data AND the test pages with the live ones? Test page changes are kept in history.') && a.run(() => post(`/sites/${site.id}/reset-test`, {content: true}).then(async r => { await after(); return r; }), 'Done. Test now matches live (with cleaned data).')}>Reset data and pages</Btn>
        </div>
        {isAdmin && <>
          <Btn kind="plain" className="mt-3" busy={a.busy} onClick={() => a.run(() => api(`/sites/${site.id}/isolation`).then(setIso))}><ShieldCheck size={16} aria-hidden/>Check that test cannot reach live</Btn>
          {iso && <p className="mt-2 text-sm" role="status">Test login opens test: {iso.testLoginOpensTest ? 'yes' : 'no'} · Test login opens live: <strong>{iso.testLoginOpensLive ? 'YES (problem!)' : 'no (good)'}</strong> · Live login opens test: {iso.liveLoginOpensTest ? 'yes' : 'no'}</p>}
        </>}
      </Card>
      <Msg msg={a.msg}/>
      {storage && (
        <Card className="lg:col-span-2">
          <h2 className="text-xl font-semibold">Space used</h2>
          <p className="text-sm text-slate-600">{storage.plan.name}: {storage.plan.dbMb} MB of data and {storage.plan.filesMb} MB of files. Video is not stored here; add it from YouTube or Vimeo.</p>
          {[['Data', storage.db, storage.plan.dbMb], ['Files', storage.files, storage.plan.filesMb]].map(([n, u, max]) => (
            <div key={n} className="mt-3">
              <div className="flex justify-between text-sm"><span>{n}</span><span>{mb(u.bytes)} of {max} MB ({u.pct}%)</span></div>
              <div className="mt-1 h-2.5 rounded-full bg-slate-100" role="progressbar" aria-label={n + ' space used'} aria-valuenow={Math.min(100, u.pct)} aria-valuemin={0} aria-valuemax={100}>
                <div className={`h-2.5 rounded-full transition-all ${u.level === 'over' ? 'bg-red-600' : u.level === 'warn' ? 'bg-amber-500' : 'bg-brand-600'}`} style={{width: Math.min(100, u.pct) + '%'}}/>
              </div>
            </div>
          ))}
          <p className="mt-3 text-sm">{storage.message}</p>
        </Card>
      )}
      {detail?.publishLog?.length > 0 && (
        <Card className="lg:col-span-2">
          <h2 className="text-xl font-semibold">Publish history</h2>
          <ul className="mt-2 text-sm divide-y divide-slate-100">{detail.publishLog.map(p => <li key={p.id} className="py-2">{when(p.createdAt)} · {p.status} · by {p.via}{p.note ? ` · “${p.note}”` : ''}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
