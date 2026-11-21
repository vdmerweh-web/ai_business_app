// Permission model: record types x levels. delete > edit > read > none.
export const TYPES=['clients','contracts','invoices','statements','payments','journal','settings','users','export','run','domains','crm','products','orders','projects','blog','leads'];
export const LV={none:0,read:1,edit:2,delete:3};
const all=l=>Object.fromEntries(TYPES.map(t=>[t,l]));
export const ROLES={
 owner:{label:'Owner',perms:all('delete')},
 admin:{label:'Admin',perms:all('delete')},
 bookkeeper:{label:'Bookkeeper',perms:{clients:'edit',contracts:'edit',invoices:'edit',statements:'read',payments:'delete',journal:'delete',settings:'read',users:'none',export:'read',run:'edit',domains:'edit',crm:'edit',leads:'read'}},
 partner:{label:'Partner',perms:{clients:'edit',contracts:'edit',domains:'edit',invoices:'edit',statements:'read',payments:'edit',journal:'edit',settings:'read',users:'none',export:'read',run:'read',crm:'edit',products:'edit',orders:'edit',projects:'edit',blog:'edit',leads:'edit'}},
 viewer:{label:'Viewer',perms:{...all('read'),users:'none'}},
 client:{label:'Client portal',perms:{...all('none'),invoices:'read',statements:'read',domains:'read',crm:'delete',products:'delete',orders:'delete',projects:'delete',blog:'delete',leads:'delete'}},
};
// Types a client-linked (portal) user may ever touch, whatever the overrides say.
const PORTAL_MAX={clients:'read',invoices:'read',statements:'read',payments:'none',contracts:'read',domains:'read',crm:'delete',products:'delete',orders:'delete',projects:'delete',blog:'delete',leads:'delete'};
export const PROTECTED_EMAIL='hannes@planet-grid.com';
export function effective(u){
 if(u.role==='owner'||u.email?.toLowerCase()===PROTECTED_EMAIL)return all('delete');
 const base=(ROLES[u.role]||ROLES.viewer).perms;const ov=u.perms||{};const p={};
 for(const t of TYPES){let l=LV[ov[t]]!==undefined?ov[t]:base[t];
  if(u.client_id){const mx=PORTAL_MAX[t]||'none';if(LV[l]>LV[mx])l=mx;}p[t]=l;}
 return p;}
export const can=(u,t,l)=>LV[u.p?.[t]||'none']>=LV[l];
