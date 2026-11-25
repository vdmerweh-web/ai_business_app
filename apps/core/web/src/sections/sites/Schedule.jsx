import React, {useEffect, useState} from 'react';
import {Clock, Plus} from 'lucide-react';
import {api, post, when} from '../../lib.js';
import {Card, Btn, Field, Msg, Badge, useAction, put} from '../../ui.jsx';

const tone = s => s === 'done' || s === 'ok' || s === 'active' ? 'green' : s === 'failed' || s === 'flagged' ? 'red' : 'amber';
// Shared by the site Scheduler tab (site given) and the admin Platform page (all clients).
export function JobsPanel({site, clientId, isAdmin, all}) {
  const [d, setD] = useState(null);
  const [f, setF] = useState({kind: site ? 'seo_check' : 'ping', title: '', schedule: 'daily 06:00', tz: '', prompt: ''});
  const [caps, setCaps] = useState(null);
  const a = useAction();
  const q = all ? '' : clientId && isAdmin ? '?clientId=' + clientId : '';
  const load = () => api('/scheduler/jobs' + q).then(r => { setD(r); setCaps(r.caps); });
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [q]);
  if (!d) return <p role="status">Loading…</p>;
  const jobs = site ? d.jobs.filter(j => !j.siteId || j.siteId === site.id) : d.jobs;
  const act = (j, x) => a.run(() => post(`/scheduler/jobs/${j.id}/${x}`).then(load));
  const add = e => {
    e.preventDefault();
    a.run(() => post('/scheduler/jobs' + q, {kind: f.kind, title: f.title || undefined, schedule: f.schedule, tz: f.tz || undefined, siteId: site?.id, clientId: isAdmin ? clientId : undefined, payload: f.kind === 'bobby_task' ? {prompt: f.prompt} : {}}).then(load), 'Added.');
  };
  return (
    <div className="grid gap-5">
      <Card>
        <h2 className="text-xl font-semibold flex items-center gap-2"><Clock size={20} aria-hidden/> Jobs</h2>
        <p className="text-sm text-slate-600">Jobs run by themselves at set times. At most {d.workers} run at once. Jobs set for the same time are spread out a little so they do not all start together. If a job fails, it tries again, then tells Grid.{d.usedToday && <> Today: {d.usedToday.runs} runs{caps ? ` of ${caps.max_jobs_per_day}` : ''}, R{(+d.usedToday.zar).toFixed(2)} AI credits{caps ? ` of R${caps.max_ai_zar_per_day}` : ''}.</>}</p>
        {jobs.length ? <ul className="mt-3 divide-y divide-slate-100">{jobs.map(j => (
          <li key={j.id} className="py-3 flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{j.title || d.kinds[j.kind]} <Badge tone={tone(j.status)}>{j.status}</Badge></p>
              <p className="text-sm text-slate-600">{all && j.clientName ? j.clientName + ' · ' : ''}{j.schedule} ({j.tz}){j.nextRunAt && j.status === 'active' ? ` · next: ${when(j.nextRunAt)}` : ''}{j.jitterMinutes ? ` · spread by ${j.jitterMinutes} min` : ''}{j.createdBy === 'bobby' ? ' · made by Bobby' : ''}</p>
              {j.lastError && <p className="text-sm text-red-800">Last problem: {j.lastError}</p>}
            </div>
            <div className="flex flex-wrap gap-1">
              {['active', 'flagged'].includes(j.status) && <Btn kind="plain" onClick={() => act(j, 'pause')}>Pause</Btn>}
              {['paused', 'flagged'].includes(j.status) && <Btn kind="plain" onClick={() => act(j, 'resume')}>Resume</Btn>}
              {!['running', 'cancelled'].includes(j.status) && <Btn kind="plain" onClick={() => act(j, 'run-now')}>Run now</Btn>}
              {!['running', 'cancelled'].includes(j.status) && <Btn kind="plain" onClick={() => confirm('Cancel this job?') && act(j, 'cancel')}>Cancel</Btn>}
            </div>
          </li>))}</ul> : <p className="mt-3 text-sm text-slate-600">No jobs yet.</p>}
        <Msg msg={a.msg}/>
      </Card>
      {!all && <Card>
        <h2 className="text-xl font-semibold flex items-center gap-2"><Plus size={20} aria-hidden/> Add a job</h2>
        <p className="text-sm text-slate-600">You can also just ask Bobby, like “Every Monday at 8, check my site's SEO.”</p>
        <form onSubmit={add} className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="What to do"><select value={f.kind} onChange={e => setF({...f, kind: e.target.value})}>{Object.entries(d.kinds).filter(([k]) => site || !['build_site', 'reset_test', 'seo_check'].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Name (optional)"><input value={f.title} onChange={e => setF({...f, title: e.target.value})}/></Field>
          <Field label="When" hint={'Like "daily 06:00", "weekly mon 08:30", "once 2026-12-24 09:00", "hourly", "every 30 min" or "now".'}><input required value={f.schedule} onChange={e => setF({...f, schedule: e.target.value})}/></Field>
          <Field label="Time zone (optional)" hint="Leave empty to use your normal time zone."><input value={f.tz} onChange={e => setF({...f, tz: e.target.value})}/></Field>
          {f.kind === 'bobby_task' && <div className="sm:col-span-2"><Field label="What should Bobby do?" hint="This uses AI credits each time."><textarea required rows={3} value={f.prompt} onChange={e => setF({...f, prompt: e.target.value})}/></Field></div>}
          <div className="sm:col-span-2"><Btn type="submit" busy={a.busy}>Add job</Btn></div>
        </form>
      </Card>}
      {isAdmin && caps && clientId && <Card>
        <h2 className="text-xl font-semibold">Limits for this client</h2>
        <form className="mt-3 grid gap-3 sm:grid-cols-4 items-end" onSubmit={e => { e.preventDefault(); a.run(() => put('/scheduler/caps/' + clientId, caps).then(setCaps), 'Saved.'); }}>
          <Field label="Job runs per day"><input type="number" min={0} value={caps.max_jobs_per_day} onChange={e => setCaps({...caps, max_jobs_per_day: e.target.value})}/></Field>
          <Field label="Active jobs"><input type="number" min={0} value={caps.max_active_jobs} onChange={e => setCaps({...caps, max_active_jobs: e.target.value})}/></Field>
          <Field label="AI credits per day (R)"><input type="number" min={0} step="0.5" value={caps.max_ai_zar_per_day} onChange={e => setCaps({...caps, max_ai_zar_per_day: e.target.value})}/></Field>
          <Btn type="submit" busy={a.busy}>Save limits</Btn>
        </form>
      </Card>}
      <Card>
        <h2 className="text-xl font-semibold">Run log</h2>
        {d.runs.length ? <ul className="mt-2 text-sm divide-y divide-slate-100">{d.runs.slice(0, 50).filter(r => !site || jobs.some(j => j.id === r.job_id)).map(r => <li key={r.id} className="py-2"><Badge tone={tone(r.status)}>{r.status}</Badge> {when(r.started_at)} · {all && r.client_name ? r.client_name + ' · ' : ''}{r.kind} (try {r.attempt}){r.message ? ' · ' + r.message : ''}</li>)}</ul> : <p className="mt-2 text-sm text-slate-600">Nothing has run yet.</p>}
      </Card>
    </div>
  );
}
export default function Schedule({site, isAdmin}) {
  return <JobsPanel site={site} clientId={site.clientId} isAdmin={isAdmin}/>;
}
