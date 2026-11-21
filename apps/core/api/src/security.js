// Headers, CSRF origin check. No secrets here.
const APP=process.env.APP_URL||'https://app.codegreene.com';
const ALLOWED=new Set([APP,...(process.env.EXTRA_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean)]);
export function headers(req,res,next){res.removeHeader('X-Powered-By');res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin',
 'Strict-Transport-Security':'max-age=31536000; includeSubDomains','X-Frame-Options':'DENY','Cross-Origin-Opener-Policy':'same-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
 'X-Robots-Tag':'noindex, nofollow','Cache-Control':'no-store'});
 if(!res.get('Content-Security-Policy'))res.set('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");next();}
// Browsers send Origin on cross-site POST/PUT/DELETE; reject foreign origins on cookie-auth routes. Bot routes use a bearer token instead.
export function csrf(req,res,next){if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
 if(/^\/(api\/)?bot\//.test(req.path))return next();
 const o=req.get('origin');if(!o){const rf=req.get('referer');if(!rf||[...ALLOWED].some(a=>rf.startsWith(a+'/')))return next();return res.status(403).json({error:'Blocked: wrong origin'});}
 if(ALLOWED.has(o))return next();res.status(403).json({error:'Blocked: wrong origin'});}
