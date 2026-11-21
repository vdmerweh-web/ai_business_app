// Company switcher. Search + "view as" are scoped on the server:
// platform owner (real owner staff login) can search/switch into any account; client logins only ever see their own account and its sites.
import {q} from './db.js';
const err=(m,s=400)=>Object.assign(new Error(m),{status:s});
export async function accountsInit(){await q(`alter table sessions add column if not exists view_client_id int references clients on delete set null;
 create table if not exists audit_log(id serial primary key,at timestamptz default now(),user_id int,action text not null,detail jsonb);`);}
const ROWS=`select c.id,c.ref,c.name,coalesce(array_agg(d.domain order by d.domain) filter (where d.domain is not null and d.status<>'inactive'),'{}') domains from clients c left join domains d on d.client_id=c.id`;
export function accountRoutes(r,{W}){
 r.get('/accounts/search',W(async(req,res)=>{const u=req.user;const t=String(req.query.q||'').trim().slice(0,80);
  const like='%'+t.replace(/[\\%_]/g,m=>'\\'+m)+'%';
  if(!u.platform_owner){if(!u.client_id&&!u.own_client_id)return res.json({owner:false,results:[]});
   // Clients: only their own account (and its sites).
   const cid=u.client_id||u.own_client_id;return res.json({owner:false,results:await q(`${ROWS} where c.id=$1 group by c.id`,[cid])});}
  if(t.length<3)return res.json({owner:true,results:[]});
  res.json({owner:true,results:await q(`${ROWS} where c.name ilike $1 or c.ref ilike $1 or exists(select 1 from domains x where x.client_id=c.id and x.domain ilike $1) group by c.id order by c.name limit 20`,[like])});}));
 r.post('/me/view',W(async(req,res)=>{const u=req.user;if(!u.platform_owner)throw err('Only the platform owner can switch companies',403);
  const cid=req.body?.client_id==null?null:+req.body.client_id;
  if(cid!==null){const[c]=await q('select id,name from clients where id=$1',[cid]);if(!c)throw err('No such account',404);}
  await q('update sessions set view_client_id=$2 where token_hash=$1',[req.tokenHash,cid]);
  await q('insert into audit_log(user_id,action,detail) values($1,$2,$3)',[u.id,cid?'view_as':'view_own',{from:u.viewing?.id||null,to:cid}]);
  res.json({ok:1,client_id:cid})}));}
