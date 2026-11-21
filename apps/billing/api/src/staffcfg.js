// Per-server admin config. Admins see every menu item; everyone else is a client
// and only sees Bobby, Web, CRM and Scott. Emails and agent lists come from env
// vars (not from a hard-coded domain name).
const KNOWN = {
  grid: {id: 'grid', name: 'Grid', description: 'The Grid helper in this app. Admins can talk to Grid here.'},
  admin: {id: 'admin', name: 'Admin', description: 'The Admin helper, used for server and site work.'},
  bobby: {id: 'bobby', name: 'Bobby', description: 'The in-app helper: manager, worker, project helper and data helper.'},
  scott: {id: 'scott', name: 'Scott', description: 'The helper for the public site. He will book calendar times and send information emails.'},
};

function splitList(v) {
  return String(v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

export function adminEmails() {
  const fromAdmin = splitList(process.env.ADMIN_EMAILS);
  if (fromAdmin.length) return new Set(fromAdmin);
  const fromAllowed = splitList(process.env.ALLOWED_EMAILS);
  if (fromAllowed.length) return new Set(fromAllowed);
  return new Set();
}

export function isAppAdmin(u) {
  if (!u) return false;
  // "View as company" and client-mode must look like a client, even for an admin email.
  if (u.viewing || u.mode === 'client') return false;
  const email = String(u.email_real || u.email || '').toLowerCase();
  const set = adminEmails();
  if (set.size) return set.has(email);
  // Safety net if the env list was not set: keep real staff owners/admins from being locked out.
  return !u.client_id && (u.role === 'owner' || u.role === 'admin' || email === 'hannes@planet-grid.com');
}

export function adminAgents() {
  const ids = splitList(process.env.ADMIN_AGENTS);
  return ids.map(id => KNOWN[id]).filter(Boolean);
}

export function agentConnected(id) {
  if (id === 'bobby') return true;
  if (id === 'grid') return !!(process.env.GRID_WEBHOOK_URL || '').trim();
  if (id === 'admin') return !!(process.env.CG_WEBHOOK_URL || process.env.ADMIN_WEBHOOK_URL || '').trim();
  if (id === 'scott') return !!(process.env.SCOTT_WEBHOOK_URL || '').trim();
  return false;
}

export function agentsPublic() {
  return adminAgents().map(a => ({...a, connected: agentConnected(a.id)}));
}

export const CLIENT_MENU_IDS = ['bobby', 'web', 'crm', 'scott'];

export function clientApiAllowed(path) {
  const p = String(path || '');
  return (
    p === '/me' || p.startsWith('/me/') ||
    p === '/logout' ||
    p === '/bobby' || p.startsWith('/bobby/') ||
    p === '/crm' || p.startsWith('/crm/') ||
    p === '/accounts/search' ||
    p === '/push' || p.startsWith('/push/') ||
    p === '/privacy' || p.startsWith('/privacy/')
  );
}
