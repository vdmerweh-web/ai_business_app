import React,{useState} from 'react';import {toast} from 'sonner';import {api} from '../lib.js';import {useMe} from '../store.js';import AppSettings from './AppSettings.jsx';import {Card,Button,Input,Field,PageHead,Badge} from '../ui.jsx';
export default function Account(){const me=useMe();const[f,setF]=useState({current:'',password:'',again:''});
 return <><PageHead title="My account" sub={me.email}/><Card className="p-6 max-w-md"><div className="mb-5">Role: <Badge k="draft">{me.role}</Badge></div>
  <form onSubmit={e=>{e.preventDefault();if(f.password!==f.again)return toast.error("New passwords don't match");api('/me/password',{method:'POST',body:f}).then(()=>{toast.success('Password changed');setF({current:'',password:'',again:''})}).catch(x=>toast.error(x.message))}}>
   <div className="font-medium mb-3">Change password</div>
   <Field label="Current password" hint="Leave empty if you only used Google so far"><Input type="password" autoComplete="current-password" value={f.current} onChange={e=>setF({...f,current:e.target.value})}/></Field>
   <Field label="New password" hint="At least 10 characters"><Input type="password" autoComplete="new-password" value={f.password} onChange={e=>setF({...f,password:e.target.value})} required/></Field>
   <Field label="New password again"><Input type="password" autoComplete="new-password" value={f.again} onChange={e=>setF({...f,again:e.target.value})} required/></Field>
   <Button>Change password</Button></form></Card>
 <Card className="p-6 max-w-md mt-4"><div className="font-medium mb-2">Log out</div>
  <p className="text-muted text-sm mb-4">Sign out of Planet Grid on this device.</p>
  <Button type="button" onClick={()=>api('/logout',{method:'POST'}).then(()=>location.reload())}>Log out</Button></Card>
 <AppSettings/></>}
