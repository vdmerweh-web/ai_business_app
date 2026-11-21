import React, {useEffect, useState} from 'react';
import {LogOut, Server, Loader2, Bot, Globe, Images, Contact, MessagesSquare, Menu, X, BarChart3} from 'lucide-react';
import {api, post, useRoute} from './lib.js';
import Login from './Login.jsx';
import ServerAdmin from './sections/ServerAdmin.jsx';
import Bobby from './sections/Bobby.jsx';
import ComingSoon from './sections/ComingSoon.jsx';
import AgentChat from './sections/AgentChat.jsx';
import Usage from './sections/Usage.jsx';
import Chat from './Chat.jsx';

const ICONS = {bobby: Bot, web: Globe, resources: Images, crm: Contact, scott: MessagesSquare, 'server-admin': Server, grid: Bot, admin: Server, usage: BarChart3};
function PageFor(section) {
  if (!section) return null;
  if (section.id === 'bobby') return Bobby;
  if (section.id === 'server-admin') return ServerAdmin;
  if (section.id === 'usage') return Usage;
  if (section.id === 'admin' && section.connected) return function AdminChat() { return <Chat section="server-admin" bot="Admin"/> };
  if (section.id === 'grid' && section.connected) return function GridChat() { return <Chat section="grid" bot="Grid"/> };
  if (section.id === 'scott' && section.connected) return function ScottChat() { return <Chat section="scott" bot="Scott"/> };
  if (section.id === 'grid' || section.id === 'admin' || (section.id === 'scott' && section.agent)) return AgentChat;
  return ComingSoon;
}
const PAGES = {
  'bobby': {Page: Bobby},
  'web': {Page: ComingSoon},
  'resources': {Page: ComingSoon},
  'crm': {Page: ComingSoon},
  'scott': {Page: ComingSoon},
  'server-admin': {Page: ServerAdmin},
  'usage': {Page: Usage},
  'grid': {Page: AgentChat},
  'admin': {Page: AgentChat},
};

export default function App() {
  const [me, setMe] = useState(undefined);
  const [sections, setSections] = useState([]);
  const [path, go] = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { api('/me').then(setMe).catch(() => setMe(null)); }, []);
  useEffect(() => { if (me) api('/sections').then(setSections).catch(() => {}); }, [me]);
  useEffect(() => {
    if (!me || !sections.length) return;
    if (path === '/' || path === '/login') go('/' + sections[0].id);
  }, [me, path, sections]);
  useEffect(() => { setMenuOpen(false); }, [path]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = e => { if (e.key === 'Escape') setMenuOpen(false); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const cur = sections.find(s => path === '/' + s.id || path.startsWith('/' + s.id + '/')) || sections[0];
  const P = cur && {Page: PageFor(cur)};
  const agentName = me?.client?.agentName || 'Bobby';
  useTitle(cur ? `${cur.id === 'bobby' ? agentName : cur.name} · ${me?.client?.name || 'App'}` : 'App');

  if (me === undefined) {
    return <div role="status" className="min-h-screen grid place-items-center"><Loader2 className="animate-spin text-brand-600" aria-hidden/><span className="sr-only">Loading</span></div>;
  }
  if (!me) return <Login/>;

  const nav = (
    <ul className="flex flex-col gap-1">
      {sections.map(s => {
        const I = ICONS[s.id] || Server;
        const on = cur?.id === s.id;
        const label = s.id === 'bobby' ? agentName : s.name;
        return (
          <li key={s.id}>
            <a
              href={'/' + s.id}
              aria-current={on ? 'page' : undefined}
              onClick={e => { e.preventDefault(); go('/' + s.id); }}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg transition-colors min-h-11 ${on ? 'bg-white/15 font-medium' : 'hover:bg-white/10 text-white/85'}`}
            >
              <I size={18} aria-hidden/>
              <span className="whitespace-nowrap">{label}</span>
              {s.comingSoon && <span className="ml-auto text-[10px] uppercase tracking-wide text-white/60">Soon</span>}
            </a>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="min-h-screen w-full min-w-0 overflow-x-hidden md:grid md:grid-cols-[16rem_1fr]">
      <a href="#main" className="skip">Skip to content</a>
      <header className="bg-brand-900 text-white w-full md:min-h-screen flex flex-col gap-3 p-3 md:p-4 items-stretch sticky top-0 z-40">
        <div className="flex items-center gap-2 w-full md:w-auto">
          <a href="/" onClick={e => { e.preventDefault(); go('/'); }} className="flex items-center gap-2 font-semibold text-lg min-h-11">
            <img src="/favicon.svg" alt="" className="w-8 h-8"/>
            <span className="truncate max-w-[12rem]">{me.client?.name || 'App'}</span>
          </a>
          <button
            type="button"
            className="ml-auto md:hidden p-2.5 rounded-lg hover:bg-white/10 min-h-11 min-w-11"
            aria-expanded={menuOpen}
            aria-controls="app-nav"
            onClick={() => setMenuOpen(o => !o)}
          >
            {menuOpen ? <X size={22} aria-hidden/> : <Menu size={22} aria-hidden/>}
            <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
          </button>
        </div>
        <nav id="app-nav" aria-label="Main" className={`flex-1 w-full ${menuOpen ? 'block' : 'hidden'} md:block`}>
          {nav}
        </nav>
        <div className={`${menuOpen ? 'flex' : 'hidden'} md:flex flex-col gap-2 items-stretch text-sm w-full`}>
          <span className="text-white/70 truncate px-3" title={me.email}>{me.email}</span>
          <button onClick={async () => { await post('/auth/logout'); location.href = '/login'; }} className="flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-white/10 min-h-11">
            <LogOut size={16} aria-hidden/>Sign out
          </button>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="p-4 md:p-8 min-w-0 w-full overflow-x-hidden">{P ? <P.Page section={cur} me={me} path={path} go={go} onMe={setMe}/> : <p>Loading sections…</p>}</main>
    </div>
  );
}
function useTitle(t) { useEffect(() => { document.title = t; }, [t]); }
