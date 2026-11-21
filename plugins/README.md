# Website plugins and templates

These are snippets and starter files that the system adds to a client's website.
They are part of the product. The client's own pages, pictures and uploads are
not in this repo — those stay on the server that hosts that client.

## site-template

The shared starter for a new client site: cookie consent, cookies page, privacy
page, and a font helper. Replace the placeholders in the HTML before a site
goes live (business name, domain, and so on).

`consent.js` talks to the Planet Grid public API to log consent choices (no IP
is stored, only a hash).

## site-widgets

JavaScript used on client sites:

- `js/leads.js` — contact form. Sends the message to the CRM (Customer
  Relationship Management) API.
- `js/blog.js` — reads published blog posts from the API.
- `js/site.js` — shared front-end helpers.
- `consent.js` — same cookie-consent script as the template.

## www-cookie-consent.js

The cookie banner used on the public planet-grid.com marketing site. Kept here
so both servers can ship the same snippet.

When Web and Scott are built, new widgets (chat bubble, booking form) should
be added in this folder so every client site can receive the same plugin, no
matter which server hosts them.
