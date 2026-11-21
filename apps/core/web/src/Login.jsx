import React, {useEffect, useState} from 'react';
import {api, post} from './lib.js';

export default function Login() {
  const [cfg, setCfg] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const err = new URLSearchParams(location.search).get('error');
  const [e2, setE2] = useState('');
  const [devEmail, setDevEmail] = useState('hannes@codegreene.com');
  useEffect(() => {
    document.title = 'Sign in · App';
    api('/auth/config').then(setCfg).catch(() => setCfg({}));
  }, []);

  const signIn = async e => {
    e.preventDefault();
    setBusy(true); setE2('');
    try {
      await post('/auth/login', {email, password});
      location.href = '/';
    } catch (x) { setE2(x.message); }
    setBusy(false);
  };

  return (
    <main id="main" className="min-h-screen grid place-items-center glow p-4">
      <div className="rise w-full max-w-md bg-white/90 backdrop-blur rounded-3xl shadow-xl shadow-brand-900/10 p-8 border border-white">
        <img src="/favicon.svg" alt="" className="w-12 h-12 mb-6"/>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
        <p className="text-slate-600 mt-2">Your site is ready. Sign in to meet your helper and start using your app.</p>
        {(err || e2) && <p role="alert" className="mt-4 rounded-xl bg-red-50 text-red-800 px-4 py-3 text-sm">{err || e2}</p>}

        <form className="mt-6 space-y-3" onSubmit={signIn}>
          <div>
            <label htmlFor="email" className="block text-sm font-medium">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5"/>
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5"/>
          </div>
          <button disabled={busy} className="w-full rounded-xl bg-brand-900 text-white py-3 font-medium hover:bg-brand-700 transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {cfg?.google && (
          <div className="mt-8">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Staff sign-in</p>
            <a href="/api/auth/google/start" className="flex items-center justify-center gap-3 w-full rounded-xl border border-slate-300 bg-white py-3 font-medium hover:border-brand-600 hover:text-brand-700 transition-colors">
              <svg aria-hidden width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
              Sign in with Google
            </a>
          </div>
        )}

        {cfg && !cfg.google && !cfg.mock && !cfg.password && <p className="mt-6 text-sm text-slate-600">Sign-in isn't configured on this server yet.</p>}
        {cfg?.mock && (
          <form className="mt-6 border-t pt-6" onSubmit={async e => { e.preventDefault(); try { await post('/auth/dev-login', {email: devEmail}); location.href = '/'; } catch (x) { setE2(x.message); } }}>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Development only</p>
            <label htmlFor="dev-email" className="block mt-2 text-sm font-medium">Mock sign-in as</label>
            <input id="dev-email" type="email" value={devEmail} onChange={e => setDevEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"/>
            <button className="mt-3 w-full rounded-xl border border-brand-700 text-brand-700 py-2 font-medium hover:bg-brand-50">Mock sign in</button>
          </form>
        )}
      </div>
    </main>
  );
}
