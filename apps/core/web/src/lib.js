import React from 'react';
export async function api(path, opt = {}) {
  const r = await fetch('/api' + path, {
    credentials: 'same-origin',
    ...opt,
    headers: {...(opt.body && !(opt.body instanceof Blob) && !(opt.body instanceof FormData) ? {'Content-Type': 'application/json'} : {}), ...opt.headers},
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Request failed'), {status: r.status});
  return j;
}
export const post = (p, b) => api(p, {method: 'POST', body: JSON.stringify(b || {})});
export const patch = (p, b) => api(p, {method: 'PATCH', body: JSON.stringify(b || {})});
export function useRoute() {
  const [path, set] = React.useState(location.pathname);
  React.useEffect(() => {
    const f = () => set(location.pathname);
    addEventListener('popstate', f);
    return () => removeEventListener('popstate', f);
  }, []);
  return [path, p => { history.pushState(null, '', p); set(p); }];
}
export const when = s => {
  if (!s) return '';
  const d = new Date(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-ZA', {timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short'});
};
