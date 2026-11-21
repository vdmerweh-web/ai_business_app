import React,{useEffect,useState} from 'react';import * as D from '@radix-ui/react-dialog';import {X} from 'lucide-react';
// PWA (Progressive Web App) install helpers: saved beforeinstallprompt, platform detection, and a plain-language steps dialog.
let deferred=null;const subs=new Set();const ping=()=>subs.forEach(f=>f());
if(typeof window!=='undefined'){window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;ping()});window.addEventListener('appinstalled',()=>{deferred=null;ping()})}
export const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
export const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
export function useInstall(){const[,f]=useState(0);useEffect(()=>{const g=()=>f(n=>n+1);subs.add(g);return()=>subs.delete(g)},[]);
 const[open,setOpen]=useState(false);
 const start=async()=>{if(deferred){const d=deferred;d.prompt();await d.userChoice.catch(()=>{});deferred=null;ping()}else setOpen(true)};
 return{show:!isStandalone(),canPrompt:!!deferred,start,open,setOpen}}
export const ShareIcon=()=><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline -mt-1"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 11v9h14v-9"/></svg>;
export function InstallSteps(){const ua=navigator.userAgent;
 if(isIOS()){const chrome=/CriOS/.test(ua),other=/FxiOS|EdgiOS/.test(ua);
  return <ol className="list-decimal ml-5 space-y-2 text-sm">
   <li>Tap the Share button <ShareIcon/> (a square with an arrow pointing up). {chrome?'In Chrome it is at the top right, next to the address bar.':other?'Look for it in the toolbar or the menu.':'In Safari it is at the bottom of the screen (on iPad: at the top).'}</li>
   <li>Scroll down and tap "Add to Home Screen". If you don't see it, tap "More" or "Edit Actions" first.</li><li>Tap "Add".</li>
   <li>Open Planet Grid from the new icon on your home screen. Notifications only work when you open it from there.</li></ol>}
 if(/Android/i.test(ua))return <ol className="list-decimal ml-5 space-y-2 text-sm"><li>Tap the browser menu (the three dots, usually top right).</li><li>Tap "Install app" or "Add to Home screen".</li><li>Tap "Install" or "Add", then open Planet Grid from your home screen.</li></ol>;
 return <ol className="list-decimal ml-5 space-y-2 text-sm"><li>In Chrome or Edge, click the install icon at the right end of the address bar, or open the browser menu and choose "Install Planet Grid" (it may be under "Cast, save and share" or "Apps").</li><li>Click "Install". Planet Grid opens in its own window.</li><li>Safari and Firefox on a computer can't install apps: open this page in Chrome or Edge.</li></ol>}
export function InstallDialog({open,setOpen}){return <D.Root open={open} onOpenChange={setOpen}><D.Portal><D.Overlay className="overlay fixed inset-0 bg-navy/40 z-50"/>
 <D.Content className="pop fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(440px,92vw)] bg-white rounded-xl shadow-2xl p-6">
  <div className="flex items-start justify-between mb-3"><D.Title className="text-lg font-semibold">Install the Planet Grid app</D.Title><D.Close aria-label="Close" className="p-1 rounded hover:bg-slate-100 cursor-pointer"><X size={18}/></D.Close></div>
  <D.Description className="text-sm text-muted mb-4">Put Planet Grid on your home screen so it opens like an app, full screen, and can send you notifications.</D.Description>
  <InstallSteps/><D.Close className="mt-5 w-full h-10 rounded-lg bg-grid text-white font-medium cursor-pointer">Got it</D.Close></D.Content></D.Portal></D.Root>}
const HK='pg_install_hint_v1';
export function InstallHint(){const i=useInstall();const[hide,setHide]=useState(()=>{try{return !!localStorage.getItem(HK)}catch{return true}});
 if(hide||!i.show)return null;const done=()=>{try{localStorage.setItem(HK,'1')}catch{}setHide(true)};
 return <><section aria-label="Install the app" className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-grid/30 bg-grid/5 px-4 py-3 text-sm">
  <span className="flex-1 min-w-[12rem]">Tip: install Planet Grid on this device so it opens like an app and can send you notifications.</span>
  <button type="button" onClick={i.start} className="h-9 px-3 rounded-lg bg-grid text-white font-medium cursor-pointer">Install app</button>
  <button type="button" onClick={done} className="h-9 px-3 rounded-lg border border-line bg-white cursor-pointer">No thanks</button></section><InstallDialog open={i.open} setOpen={i.setOpen}/></>}
export const openCookies=()=>window.pgConsent&&window.pgConsent.open();
