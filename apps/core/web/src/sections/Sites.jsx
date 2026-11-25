import React, {useEffect, useState} from 'react';
import {Globe, Plus, ExternalLink} from 'lucide-react';
import {api, post} from '../lib.js';
import Hint from '../Hint.jsx';
import {Card, Btn, Field, Msg, Badge, useAction, Tabs} from '../ui.jsx';
import Overview from './sites/Overview.jsx';
import Pages from './sites/Pages.jsx';
import Seo from './sites/Seo.jsx';
import Modules from './sites/Modules.jsx';
import Bookings from './sites/Bookings.jsx';
import Schedule from './sites/Schedule.jsx';
import Blocks from './sites/Blocks.jsx';

const TABS = [
  {id: 'overview', label: 'Overview'}, {id: 'pages', label: 'Pages'}, {id: 'seo', label: 'SEO'},
  {id: 'modules', label: 'Modules'}, {id: 'bookings', label: 'Bookings'}, {id: 'blocks', label: 'Client blocks'}, {id: 'schedule', label: 'Scheduler'},
];

export default function Sites({me, path, go}) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({name: '', slug: '', clientId: ''});
  const add = useAction();
  const m = /^\/web\/(\d+)(?:\/([a-z]+))?/.exec(path);
  const siteId = m ? +m[1] : null, tab = m?.[2] || 'overview';
  const load = () => api('/sites').then(setData).catch(e => setData({error: e.message}));
  useEffect(() => { load(); }, []);

  if (!data) return <p role="status">Loading your sites…</p>;
  if (data.error) return <Msg msg={{text: data.error, err: true}}/>;
  const site = siteId && data.sites.find(s => s.id === siteId);
  if (site) {
    return (
      <div className="max-w-6xl mx-auto">
        <a href="/web" onClick={e => { e.preventDefault(); go('/web'); }} className="text-sm text-brand-800 underline">← All sites</a>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight flex items-center gap-2"><Globe aria-hidden/> {site.name}</h1>
        <p className="text-slate-600">Address name: <code>{site.slug}</code>{data.isAdmin && <> · Client: {site.clientName}</>}</p>
        <div className="mt-4"><Tabs label="Site parts" tabs={TABS} cur={tab} onPick={t => go(`/web/${site.id}/${t}`)}/></div>
        <div role="tabpanel" id={'panel-' + tab} aria-labelledby={'tab-' + tab} className="mt-5">
          {tab === 'overview' && <Overview site={site} me={me} isAdmin={data.isAdmin} reload={load}/>}
          {tab === 'pages' && <Pages site={site}/>}
          {tab === 'seo' && <Seo site={site}/>}
          {tab === 'modules' && <Modules site={site} isAdmin={data.isAdmin}/>}
          {tab === 'bookings' && <Bookings site={site}/>}
          {tab === 'blocks' && <Blocks site={site}/>}
          {tab === 'schedule' && <Schedule site={site} isAdmin={data.isAdmin}/>}
        </div>
      </div>
    );
  }
  const submit = e => {
    e.preventDefault();
    add.run(async () => {
      const s = await post('/sites', {...form, clientId: form.clientId || undefined});
      await load(); setForm({name: '', slug: '', clientId: ''}); go('/web/' + s.id);
    });
  };
  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-3xl font-semibold tracking-tight">Sites</h1>
      <p className="mt-1 text-slate-600 max-w-2xl">Each site has a <strong>test copy</strong> and a <strong>live copy</strong>. You and Bobby change the test copy. When you are happy, you publish it to live. Each copy keeps its own data, so test data never mixes with real data.</p>
      {!data.ready && <Msg msg={{text: 'Site databases are not switched on for this server yet.', err: true}}/>}
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {data.sites.map(s => (
          <li key={s.id}>
            <Card className="h-full flex flex-col gap-2">
              <h2 className="text-lg font-semibold"><a className="hover:underline" href={'/web/' + s.id} onClick={e => { e.preventDefault(); go('/web/' + s.id); }}>{s.name}</a></h2>
              <p className="text-sm text-slate-600">{data.isAdmin && <>{s.clientName} · </>}<code>{s.slug}</code></p>
              <div className="flex flex-wrap gap-2">
                <Badge tone={s.copies.test?.build === 'ok' ? 'green' : s.copies.test?.build === 'failed' ? 'red' : 'amber'}>Test: {s.copies.test?.build || 'new'}</Badge>
                <Badge tone={s.copies.live?.build === 'ok' ? 'green' : s.copies.live?.build === 'failed' ? 'red' : 'amber'}>Live: {s.copies.live?.build || 'new'}</Badge>
                {s.pendingPublish.length > 0 && <Badge tone="amber">Waiting for OK</Badge>}
              </div>
              <div className="mt-auto flex flex-wrap gap-3 text-sm">
                <a className="inline-flex items-center gap-1 text-brand-800 underline" href={s.testUrl} target="_blank" rel="noopener">Test copy <ExternalLink size={14} aria-hidden/><span className="sr-only">(opens in a new tab)</span></a>
                <a className="inline-flex items-center gap-1 text-brand-800 underline" href={s.liveUrl} target="_blank" rel="noopener">Live copy <ExternalLink size={14} aria-hidden/><span className="sr-only">(opens in a new tab)</span></a>
              </div>
            </Card>
          </li>
        ))}
        {!data.sites.length && <li className="text-slate-600">No sites yet. Add your first one below.</li>}
      </ul>
      <Card className="mt-8">
        <h2 className="text-xl font-semibold flex items-center gap-2"><Plus size={20} aria-hidden/> Add a site</h2>
        <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Site name" hint="Like “Sunny Bakery”."><input required value={form.name} onChange={e => setForm({...form, name: e.target.value})}/></Field>
          <Field label="Address name" hint="Small letters, numbers and dashes. Later this becomes name.codegreene.com."><input required pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" value={form.slug} onChange={e => setForm({...form, slug: e.target.value.toLowerCase()})}/></Field>
          {data.isAdmin && (
            <Field label="For which client?" hint="Admins can add a site for any client.">
              <select value={form.clientId} onChange={e => setForm({...form, clientId: e.target.value})}>
                <option value="">My own (Codegreene)</option>
                {data.clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.is_test ? ' (test account)' : ''}</option>)}
              </select>
            </Field>
          )}
          <div className="sm:col-span-2"><Btn type="submit" busy={add.busy}>Add site</Btn></div>
        </form>
        <Msg msg={add.msg}/>
        <p className="mt-4 text-xs text-slate-600">Each copy gets its own database<Hint term="Database" meaning="The place where your site's data, like messages and bookings, is kept."/> and its own login, so the test copy can never touch live data.</p>
      </Card>
    </div>
  );
}
