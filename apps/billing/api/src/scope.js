// Per-account scope for the bot. Future: a scoped actions API (per-plan limits) plugs in here.
// Today it only describes what a conversation's account may act on; no actions are executed.
import {q} from './db.js';
export async function scopeFor(conv,user){
 const accountId=conv.client_id??null;
 const domains=accountId?(await q(`select domain,status from domains where client_id=$1 and status<>'inactive' order by domain`,[accountId])):[];
 return {accountId,userRole:user.role,domains:domains.map(d=>d.domain),domainStatus:Object.fromEntries(domains.map(d=>[d.domain,d.status])),
  actions:[],limits:null}; // actions/limits: reserved for the scoped API layer (not built yet)
}
// Bot-side guard: is a file within this conversation's scope?
export const fileInScope=(f,conv)=>f.conversation_id===conv.id||(f.in_library&&f.client_id!=null&&f.client_id===conv.client_id);
