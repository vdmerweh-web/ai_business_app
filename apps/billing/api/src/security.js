// Security middleware: headers, CSRF origin check, login lockout. No secrets here.
import crypto from 'crypto';import {q} from './db.js';
const ALLOWED=new Set(['https://app.planet-grid.com','https://api.planet-grid.com','https://planet-grid.com',...(process.env.EXTRA_ORIGINS||'').split(',').filter(Boolean)]);
export function headers(req,res,next){res.removeHeader('X-Powered-By');res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin',
 'Strict-Transport-Security':'max-age=31536000; includeSubDomains','X-Frame-Options':'DENY','Cross-Origin-Opener-Policy':'same-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()'});
 // PDFs (/api/pdf/*) are previewed in the app's own side panel iframe: allow same-origin framing for these only.
 if(/^\/(api\/)?pdf\//.test(req.path)){res.set({'X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':"frame-ancestors 'self'; base-uri 'none'"});}
 else if(!res.get('Content-Security-Policy'))res.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
 if(!/^\/(api\/)?public\//.test(req.path))res.set('Cache-Control','no-store');next();}
// CSRF: browsers always send Origin on cross-site POST/PUT/DELETE. Reject foreign origins for cookie-auth routes.
export function csrf(req,res,next){if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
 if(/^\/(api\/)?(bot|public)\//.test(req.path))return next();// bearer-token bot API and public endpoints (no cookie use)
 const o=req.get('origin');if(!o){const rf=req.get('referer');if(!rf||[...ALLOWED].some(a=>rf.startsWith(a+'/')))return next();return res.status(403).json({error:'Blocked: wrong origin'});}
 if(ALLOWED.has(o))return next();res.status(403).json({error:'Blocked: wrong origin'});}
// Account lockout: 8 failed logins for an email within 15 min locks that email for 15 min.
let ready=false;async function init(){if(ready)return;await q(`create table if not exists login_failures(id serial primary key,email text not null,ip_hash text,at timestamptz default now()); create index if not exists login_failures_email on login_failures(lower(email),at)`);ready=true;}
const ipH=ip=>crypto.createHash('sha256').update('pg:'+String(ip||'')).digest('hex').slice(0,16);
export async function locked(email){await init();const[{n}]=await q(`select count(*)::int n from login_failures where lower(email)=lower($1) and at>now()-interval '15 minutes'`,[String(email||'')]);return n>=8;}
export async function failed(email,ip){await init();await q('insert into login_failures(email,ip_hash) values($1,$2)',[String(email||'').slice(0,200),ipH(ip)]);await q(`delete from login_failures where at<now()-interval '1 day'`);}
export async function cleared(email){await init();await q('delete from login_failures where lower(email)=lower($1)',[String(email||'')]);}
export {ipH};
