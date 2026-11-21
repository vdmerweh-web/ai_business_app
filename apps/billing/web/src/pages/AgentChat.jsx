import React from 'react';
import {MessagesSquare} from 'lucide-react';
import Hint from '../Hint.jsx';

const COPY = {
  grid: {
    title: 'Grid',
    lead: 'This chat will let you talk to Grid in the app.',
    body: 'We are still connecting this helper. When it is ready, you will chat with Grid from this page.',
  },
  admin: {
    title: 'Admin',
    lead: 'This chat will let you talk to the Admin helper.',
    body: 'We are still connecting this helper. When it is ready, you will chat with Admin from this page.',
  },
  scott: {
    title: 'Scott',
    lead: 'This chat will let you talk to Scott, the helper for the public site.',
    body: 'We are still connecting this helper. When it is ready, you will set up how Scott books calendar times and sends information emails. You will be able to ask him to wait for your OK, or to send mail straight away.',
  },
};

export default function AgentChat({section}) {
  const id = section?.id || section;
  const c = COPY[id] || {title: section?.name || 'Helper', lead: 'This chat is still being connected.', body: 'Please check back soon.'};
  return (
    <div className="max-w-2xl mx-auto">
      <div className="rise rounded-2xl bg-white p-8 md:p-12 shadow-sm ring-1 ring-line text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-grid/10 text-grid grid place-items-center ring-1 ring-grid/20">
          <MessagesSquare size={28} aria-hidden/>
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">{c.title}</h1>
        <p className="mt-2 inline-block rounded-full bg-amber-50 text-amber-900 text-xs font-medium px-3 py-1 ring-1 ring-amber-600/20">Connecting soon</p>
        <p className="mt-5 text-lg text-ink">{c.lead}</p>
        <p className="mt-3 text-muted">{c.body}</p>
      </div>
    </div>
  );
}
