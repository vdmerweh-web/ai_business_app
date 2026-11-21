import React,{useEffect,useState} from 'react';import {toast} from 'sonner';import {api} from '../lib.js';import {Card,Button} from '../ui.jsx';
// "Install app" + notifications for the PWA (Progressive Web App). Plain language, keyboard and screen-reader friendly.
import {useInstall,InstallDialog,InstallSteps,isIOS,isStandalone,openCookies} from '../install.jsx';
const b64=s=>{const p='='.repeat((4-s.length%4)%4);const r=atob((s+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...r].map(c=>c.charCodeAt(0)))};
export default function AppSettings(){const supported='serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
 const inst=useInstall();const installed=!inst.show;const[sub,setSub]=useState(null);const[busy,setBusy]=useState(false);const[msg,setMsg]=useState('');
 const perm=supported?Notification.permission:'unsupported';
 useEffect(()=>{if(supported)navigator.serviceWorker.ready.then(r=>r.pushManager.getSubscription()).then(setSub).catch(()=>{})},[]);
 const say=(t,ok=true)=>{setMsg(t);ok?toast.success(t):toast.error(t)};
 const turnOn=async()=>{setBusy(true);try{const k=await api('/push/key');if(!k.enabled)throw new Error('Notifications are not set up on the server yet.');
   const p=await Notification.requestPermission();if(p!=='granted')throw new Error('Notifications are blocked. Allow them in your browser settings for this site, then try again.');
   const reg=await navigator.serviceWorker.ready;const s=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(k.key)});
   await api('/push/subscribe',{method:'POST',body:s.toJSON()});setSub(s);say('Notifications are on for this device.')}catch(e){say(e.message,false)}setBusy(false)};
 const test=async()=>{setBusy(true);try{await api('/push/test',{method:'POST'});say('Test notification sent. It should pop up in a few seconds.')}catch(e){say(e.message,false)}setBusy(false)};
 const turnOff=async()=>{setBusy(true);try{if(sub){await api('/push/unsubscribe',{method:'POST',body:{endpoint:sub.endpoint}});await sub.unsubscribe()}setSub(null);say('Notifications are off for this device.')}catch(e){say(e.message,false)}setBusy(false)};
 return <Card className="p-6 max-w-md mt-6"><section aria-labelledby="pg-app-h">
  <h2 id="pg-app-h" className="font-medium mb-1">Phone app and notifications</h2>
  <p className="text-sm text-muted mb-4">Put Planet Grid on your phone's home screen like an app, and get a message on your phone when something needs you.</p>
  <h3 className="text-[13px] font-medium mb-2">Install the app</h3>
  {installed?<p className="text-sm mb-4">You're using the installed app.</p>:inst.canPrompt?<Button type="button" className="mb-4" onClick={inst.start}>Install app</Button>:<div className="mb-4"><InstallSteps/></div>}
  <h3 className="text-[13px] font-medium mb-2">Notifications</h3>
  {!supported?<p className="text-sm">This browser can't show notifications.{isIOS()?' Install the app first (see above), then open it from your home screen.':''}</p>:<>
   <p className="text-sm mb-3">{sub?'Notifications are on for this device.':perm==='denied'?'Notifications are blocked for this site. Allow them in your browser settings, then come back.':'Notifications are off for this device.'}</p>
   <div className="flex flex-wrap gap-2">{!sub&&<Button type="button" disabled={busy} onClick={turnOn}>Turn on notifications</Button>}
    {sub&&<Button type="button" disabled={busy} onClick={test}>Send test notification</Button>}
    {sub&&<Button type="button" v="secondary" disabled={busy} onClick={turnOff}>Turn off</Button>}</div></>}
  <h3 className="text-[13px] font-medium mt-5 mb-2">Cookies</h3><Button type="button" v="secondary" onClick={openCookies}>Cookie settings</Button>
  <p role="status" aria-live="polite" className="sr-only">{msg}</p></section></Card>}
