import crypto from 'crypto';import bcrypt from 'bcryptjs';import {createRemoteJWKSet,jwtVerify} from 'jose';
import {q} from './db.js';import {TYPES,LV,ROLES,PROTECTED_EMAIL,effective} from './perms.js';import {checkSignup,createAccount} from './signup.js';
const H=t=>crypto.createHash('sha256').update(t).digest('hex');
const APP=process.env.APP_URL||'https://app.planet-grid.com';
const RED=process.env.GOOGLE_REDIRECT_URI||APP+'/api/auth/google/callback';
const GID=process.env.GOOGLE_CLIENT_ID||'',GSEC=process.env.GOOGLE_CLIENT_SECRET||'';
export async function newSession(res,uid){const t=crypto.randomBytes(32).toString('hex');await q(`insert into sessions values($1,$2,now()+interval '7 days')`,[H(t),uid]);
 res.cookie('pgsid',t,{httpOnly:true,secure:process.env.COOKIE_SECURE!=='false',sameSite:'lax',maxAge:7*864e5,path:'/'});}
const b64u=b=>b.toString('base64url');
const JWKS=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
// Public auth routes (before the login gate).
export function authRoutes(r){
 r.get('/auth/config',(req,res)=>res.json({google:!!(GID&&GSEC)}));
 const gurl=async signup=>{const state=b64u(crypto.randomBytes(24)),verifier=b64u(crypto.randomBytes(48)),nonce=b64u(crypto.randomBytes(16));
  await q(`delete from oauth_states where expires<now()`);await q(`insert into oauth_states(state,verifier,nonce,expires,signup) values($1,$2,$3,now()+interval '10 minutes',$4)`,[state,verifier,nonce,signup]);
  const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  Object.entries({client_id:GID,redirect_uri:RED,response_type:'code',scope:'openid email profile',state,nonce,prompt:'select_account',
   code_challenge:b64u(crypto.createHash('sha256').update(verifier).digest()),code_challenge_method:'S256'}).forEach(([k,v])=>u.searchParams.set(k,v));
  return u.toString();};
 r.get('/auth/google/start',async(req,res)=>{if(!GID||!GSEC)return res.status(404).json({error:'Google sign-in is not set up'});res.redirect(await gurl(null));});
 // Signup with Google: form fields are validated first and held with the OAuth state; the account is made on callback.
 r.post('/auth/google/signup',async(req,res)=>{try{if(!GID||!GSEC)return res.status(404).json({error:'Google sign-in is not set up'});
  const d=checkSignup(req.body||{},{google:true});res.json({url:await gurl({name:d.name,company:d.company,domain:d.domain,phone:d.phone})});}catch(e){res.status(400).json({error:e.message})}});
 // If Google returns to another host (e.g. api.planet-grid.com), hand the login over to the app host with a one-time, 60s token so the cookie lands on app.
 const done=async(req,res,uid)=>{if(new URL(RED).host===new URL(APP).host){await newSession(res,uid);return res.redirect(APP+'/');}
  const t=b64u(crypto.randomBytes(32));await q(`insert into oauth_states(state,verifier,nonce,expires) values($1,$2,'',now()+interval '60 seconds')`,['h:'+H(t),String(uid)]);res.redirect(APP+'/api/auth/google/finish?t='+t);};
 r.get('/auth/google/finish',async(req,res)=>{const[st]=await q(`delete from oauth_states where state=$1 and expires>now() returning verifier`,['h:'+H(String(req.query.t||''))]);
  if(!st)return res.redirect(APP+'/#/login?error='+encodeURIComponent('Sign-in expired, please try again'));const[u]=await q('select id from users where id=$1 and active',[+st.verifier]);if(!u)return res.redirect(APP+'/#/login');await newSession(res,u.id);res.redirect(APP+'/');});
 r.get('/auth/google/callback',async(req,res)=>{const fail=m=>res.redirect(APP+'/#/login?error='+encodeURIComponent(m));
  try{const{code,state}=req.query;if(!code||!state)return fail('Google sign-in was cancelled');
   const[st]=await q(`delete from oauth_states where state=$1 and expires>now() returning *`,[String(state)]);if(!st)return fail('Sign-in expired, please try again');
   const tr=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({code,client_id:GID,client_secret:GSEC,redirect_uri:RED,grant_type:'authorization_code',code_verifier:st.verifier})});
   const tok=await tr.json();if(!tr.ok||!tok.id_token)return fail('Google sign-in failed');
   const{payload:p}=await jwtVerify(tok.id_token,JWKS,{issuer:['https://accounts.google.com','accounts.google.com'],audience:GID});
   if(p.nonce!==st.nonce)return fail('Sign-in check failed');if(!p.email_verified)return fail('Your Google email is not verified');
   const email=String(p.email).toLowerCase();
   const[u]=await q(`select * from users where active and (google_sub=$1 or (google_sub is null and (lower(email)=$2 or lower(google_email)=$2))) order by (google_sub=$1) desc nulls last limit 1`,[p.sub,email]);
   if(!u&&st.signup){const id=await createAccount({...st.signup,email},{googleSub:p.sub}).catch(e=>{fail(e.message);return null});if(!id)return;return done(req,res,id);}
   if(!u)return fail(`No account for ${email}. Create one on the sign-up page.`);
   if(u.invited)await q('update users set invited=false where id=$1',[u.id]);
   if(!u.google_sub)await q(`update users set google_sub=$2,google_email=coalesce(google_email,$3) where id=$1`,[u.id,p.sub,email]);
   return done(req,res,u.id);
  }catch(e){console.error('google',e.message);fail('Google sign-in failed');}});
}
const pub=u=>({id:u.id,email:u.email,name:u.name,role:u.role,client_id:u.client_id,client_name:u.client_name,perms:u.perms,effective:effective(u),active:u.active,google_email:u.google_email,google_linked:!!u.google_sub,own_client_id:u.own_client_id,invited:u.invited,phone:u.phone,has_password:!!u.pw_hash,protected:u.email.toLowerCase()===PROTECTED_EMAIL,created_at:u.created_at});
function cleanPerms(p){const o={};for(const t of TYPES)if(p&&LV[p[t]]!==undefined)o[t]=p[t];return o;}
const isOwner=u=>u.role==='owner'||u.email.toLowerCase()===PROTECTED_EMAIL;
export function userRoutes(r,{need,W}){
 const staff=(req,res,next)=>req.user.client_id?res.status(403).json({error:'Not available in the client portal'}):next();
 const get=async id=>(await q(`select u.*,c.name client_name from users u left join clients c on c.id=u.client_id where u.id=$1`,[id]))[0];
 const guard=(me,t)=>{if(!t)throw Object.assign(new Error('No such user'),{status:404});
  if(isOwner(t)&&!isOwner(me))throw Object.assign(new Error('Only an owner can change an owner'),{status:403});};
 r.post('/me/password',W(async(req,res)=>{const{current,password}=req.body||{};const[u]=await q('select pw_hash from users where id=$1',[req.user.id]);
  if(u.pw_hash&&!(await bcrypt.compare(String(current||''),u.pw_hash)))throw new Error('Current password is wrong');
  if(String(password||'').length<10)throw new Error('Use at least 10 characters');await q('update users set pw_hash=$2 where id=$1',[req.user.id,await bcrypt.hash(password,12)]);await q('delete from sessions where user_id=$1 and token_hash<>$2',[req.user.id,req.tokenHash]);res.json({ok:1})}));
 r.get('/roles',staff,need('users','read'),(req,res)=>res.json({types:TYPES,levels:Object.keys(LV),roles:Object.fromEntries(Object.entries(ROLES).map(([k,v])=>[k,v]))}));
 r.get('/users',staff,need('users','read'),W(async(req,res)=>res.json((await q(`select u.*,c.name client_name from users u left join clients c on c.id=u.client_id order by u.client_id nulls first,u.email`)).map(pub))));
 r.post('/users',staff,need('users','edit'),W(async(req,res)=>{const b=req.body||{};const email=String(b.email||'').trim().toLowerCase();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw new Error('Enter a valid email');if(!ROLES[b.role])throw new Error('Pick a role');
  if(b.role==='owner'&&!isOwner(req.user))throw new Error('Only an owner can add an owner');
  const cid=b.role==='client'||b.client_id?+b.client_id||null:null;if(b.role==='client'&&!cid)throw new Error('Pick the client this user belongs to');
  let org=null;if(cid){org=(await q(`select id from orgs where client_id=$1`,[cid]))[0]?.id||(await q(`insert into orgs(name,kind,client_id) select name,'client',id from clients where id=$1 returning id`,[cid]))[0].id;}
  else org=(await q(`select id from orgs where kind='owner' order by id limit 1`))[0].id;
  if(b.password&&String(b.password).length<10)throw new Error('Temporary password: at least 10 characters');
  const[u]=await q(`insert into users(email,pw_hash,org_id,client_id,role,perms,name,google_email) values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
   [email,b.password?await bcrypt.hash(String(b.password),12):null,org,cid,b.role,cleanPerms(b.perms),b.name||null,b.google_email?String(b.google_email).trim().toLowerCase():null]).catch(e=>{if(e.code==='23505')throw new Error('That email already has a login');throw e});
  if(!cid&&+b.own_client_id)await q('update users set own_client_id=$2 where id=$1',[u.id,+b.own_client_id]);
  res.json(pub(await get(u.id)))}));
 r.put('/users/:id',staff,need('users','edit'),W(async(req,res)=>{const t=await get(req.params.id);guard(req.user,t);const b=req.body||{};const prot=t.email.toLowerCase()===PROTECTED_EMAIL;
  const role=prot?'owner':(b.role??t.role);if(!ROLES[role])throw new Error('Pick a role');if(role==='owner'&&!isOwner(req.user))throw new Error('Only an owner can make an owner');
  const active=prot?true:(b.active??t.active);
  if(t.role==='owner'&&(role!=='owner'||!active)&&(await q(`select count(*)::int n from users where role='owner' and active and id<>$1`,[t.id]))[0].n===0)throw new Error('Keep at least one active owner');
  const ge=b.google_email!==undefined?(String(b.google_email||'').trim().toLowerCase()||null):t.google_email;
  const oc=t.client_id?null:(b.own_client_id!==undefined?(+b.own_client_id||null):t.own_client_id);
  await q(`update users set role=$2,perms=$3,active=$4,name=$5,google_email=$6,google_sub=case when $7 then null else google_sub end,own_client_id=$8 where id=$1`,[t.id,role,cleanPerms(b.perms??t.perms),active,b.name??t.name,ge,!!b.unlink_google||ge!==t.google_email,oc]);
  if(oc!==t.own_client_id)await q(`update sessions set mode=null where user_id=$1`,[t.id]);
  if(!active)await q('delete from sessions where user_id=$1',[t.id]);res.json(pub(await get(t.id)))}));
 r.put('/users/:id/password',staff,need('users','edit'),W(async(req,res)=>{const t=await get(req.params.id);guard(req.user,t);const pw=String(req.body?.password||'');
  if(pw.length<10)throw new Error('Temporary password: at least 10 characters');await q('update users set pw_hash=$2 where id=$1',[t.id,await bcrypt.hash(pw,12)]);
  if(t.id!==req.user.id)await q('delete from sessions where user_id=$1',[t.id]);res.json({ok:1})}));
 r.delete('/users/:id',staff,need('users','delete'),W(async(req,res)=>{const t=await get(req.params.id);guard(req.user,t);
  if(t.email.toLowerCase()===PROTECTED_EMAIL||t.id===req.user.id)throw new Error("You can't delete this user");
  await q('delete from sessions where user_id=$1',[t.id]);await q('delete from users where id=$1',[t.id]);res.json({ok:1})}));
}
