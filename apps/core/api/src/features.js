// Feature catalogue. Every feature is switched on per client (no global on-switch).
// Menu order is the order of this list. Coming-soon items still appear when enabled.
export const FEATURES = [
  {id: 'bobby', name: 'Bobby', description: 'Your in-app helper: manager, worker, project helper and data helper', comingSoon: false},
  {id: 'web', name: 'Sites', description: 'Your sites. Each one has a test copy and a live copy. Switch modules on or off and check your SEO (Search Engine Optimization)', comingSoon: false},
  {id: 'crm', name: 'CRM', description: 'CRM (Customer Relationship Management) is the list of people who contact you. Messages from your site form will land here', comingSoon: false},
  {id: 'scott', name: 'Scott', description: 'The helper on your public site. He can book calendar times and send information emails', comingSoon: true},
  {id: 'resources', name: 'Resources', description: 'Upload logos, pictures, backgrounds and PDF files (Portable Document Format, a common document type)', comingSoon: true, staffOnly: true},
  {id: 'server-admin', name: 'Server Admin', description: 'Server and site inventory, with a chat to the Admin bot', bot: 'Admin', comingSoon: false, staffOnly: true},
];

export const FEATURE_IDS = new Set(FEATURES.map(f => f.id));
export const CLIENT_DEFAULTS = ['bobby', 'web', 'crm', 'scott'];
export const STAFF_DEFAULTS = [...CLIENT_DEFAULTS, 'resources', 'server-admin'];

export function featureById(id) {
  return FEATURES.find(f => f.id === id) || null;
}
