import React from 'react';
import {Sparkles} from 'lucide-react';
import Hint from '../Hint.jsx';

const COPY = {
  web: {
    title: 'Web',
    lead: 'Soon you will be able to look at every page of your site here.',
    body: 'You will click a header, a footer, or any section, and talk to your helper to change it. You can already rename your helper on the first menu item.',
  },
  crm: {
    title: 'CRM',
    lead: 'Soon, messages from your site’s contact form will land here.',
    body: 'This is where you will keep the people who write to you, and follow up with them.',
  },
  scott: {
    title: 'Scott',
    lead: 'Soon, Scott will be the helper on your public site.',
    body: 'He will be able to book calendar times and send information emails. You and your in-app helper will set him up. Scott will only add to your CRM, calendar and mail, and answer with information. You will be able to ask him to wait for your OK before he sends mail, or to send it straight away.',
  },
  resources: {
    title: 'Resources',
    lead: 'Soon this page will hold logos, pictures, backgrounds and documents.',
    body: 'You will upload images and PDF files (Portable Document Format, a common document type) here. For now, you can send a logo or a picture to your helper in the chat.',
  },
};

export default function ComingSoon({section}) {
  const id = section?.id || section;
  const c = COPY[id] || {title: section?.name || 'Coming soon', lead: 'This part is coming soon.', body: 'We will switch it on for you when it is ready.'};
  return (
    <div className="max-w-2xl mx-auto">
      <div className="rise rounded-2xl bg-white p-8 md:p-12 shadow-sm ring-1 ring-line text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-grid/10 text-grid grid place-items-center ring-1 ring-grid/20">
          <Sparkles size={28} aria-hidden/>
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">
          {c.title}
          {id === 'crm' && <Hint term="CRM" meaning="Customer Relationship Management: a list of the people who contact you."/>}
        </h1>
        <p className="mt-2 inline-block rounded-full bg-amber-50 text-amber-900 text-xs font-medium px-3 py-1 ring-1 ring-amber-600/20">Coming soon</p>
        <p className="mt-5 text-lg text-ink">{c.lead}</p>
        <p className="mt-3 text-muted">{c.body}</p>
      </div>
    </div>
  );
}
