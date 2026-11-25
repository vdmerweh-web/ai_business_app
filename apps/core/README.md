# Codegreene App (app.codegreene.com)

Codegreene's main internal app. React 18 + Vite + Tailwind 4 front end (served by nginx), Express 4 API, SQLite. Follows the Planet Grid app pattern but is fully separate: its own DB, its own cookie (`cg_sid`), its own secrets and Google client.

## Sections
Menu order (each feature is switched on per client):

| Section | What it does |
|---|---|
| Bobby (first) | The client's in-app helper (they can rename him). Chat, first-login welcome, credit meter (R100 of Grok a month), and tools that read only that client's data. |
| Web | Coming soon: look at site pages and change header, footer and sections by talking to Bobby. |
| Resources | Coming soon: upload logos, pictures, backgrounds and PDFs. Files can already be sent in the Bobby chat. |
| CRM | Coming soon: contact-form messages land here. CRM means Customer Relationship Management. |
| Scott | Coming soon: the public-site helper. He can book calendar times and send information emails. |
| Server Admin | Staff only. Server and site inventory plus a chat with the **Admin** bot. Tabs: Overview, Full report, Chat with Admin. |

A typical new client already has a draft site, subscribes to the base plan, signs in, and meets Bobby first. Features live in `api/src/features.js` and a page in `web/src/sections/`, registered in `PAGES` in `web/src/App.jsx`. The Admin bot chat is still tagged with its section. Bobby chats are stored per client and never go to the Admin webhook.

## Where the inventory comes from
The old PHP page only checks a PIN and serves `/var/lib/bot_admin/index.html` (and `summary.md`). The Admin bot writes that file from the box (`/workspace/bot_admin/push.sh`).
The new app reads **the same file**: `/var/lib/bot_admin` is mounted read-only into the api container at `/report` (container joins group www-data, gid 33, because the files are root:www-data 0640).
- Every 60 s (and on "Check for a new report") the API parses the HTML into structured JSON: server cards, Active/Copy/Dead counts, and every section's paragraphs, lists and tables (cells, links, row status).
- Each distinct report is stored as a snapshot in SQLite (last 30 kept), so the page shows when it last changed.
- Admin can also push straight to the app: `POST /api/bot/inventory` with `{html, summary?}` and the bot bearer token. Then the PHP page can be retired.

## Security
- Staff: Google sign-in only: OIDC code flow with PKCE (S256), state and nonce; id_token verified with `jose` against Google's JWKS (issuer, audience, nonce, `email_verified`). Only `ALLOWED_EMAILS` can sign in; everyone allowed is an admin. Removing an email from the list locks that person out on the next request.
- Clients: email + password (scrypt). A test client (`amy@sunrisebakery.test`, Sunrise Bakery) is seeded; the password is written to `/srv/apps/codegreene-app/backups/TEST_LOGIN.txt` (mode 600) on first seed, never to the web or git.
- Session: 32-byte random token in an httpOnly, Secure, SameSite=Lax cookie; only its SHA-256 is stored; 7-day expiry; logout deletes it.
- CSRF: Origin/Referer check on every state-changing cookie request (`APP_URL` + `EXTRA_ORIGINS`). Bot routes use a bearer token instead.
- Rate limits: 20 sign-in starts/callbacks per 15 min per IP, 300 req/min for the app, 240/min for the bot API.
- Headers: CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP, X-Robots-Tag noindex (internal app; robots.txt disallows all).
- Uploads: PNG/JPEG/GIF/WebP/PDF/TXT, max 5 MB, magic-byte checked, served with a sandbox CSP.
- Containers: read-only root FS for the api, all capabilities dropped, no-new-privileges, ports bound to 127.0.0.1 only.
- Dev mock login (`DEV_MOCK_LOGIN=1`) only switches on when `APP_URL` is `http://localhost…`; it can't run in production.

## Bot link (Admin)
Same mechanism as Planet Grid:
- **Out:** each user message is POSTed to `CG_WEBHOOK_URL` with header `X-CG-Webhook-Secret: $CG_WEBHOOK_SECRET` and `Authorization: $CG_WEBHOOK_AUTH` (a bare token gets `Bearer `). Body: `{app, section, conversationId, conversationTitle, userEmail, userName, userRole, text, imageUrls, attachments, messageId, attempt, replyTo}`. Retries after 30 s, 2 min, 10 min, 30 min (5 attempts), with state in the DB so restarts don't lose or double-send.
- **In** (header `Authorization: Bearer $CG_BOT_TOKEN`):
  - `POST /api/bot/messages` `{conversationId, text, imageUrls?, fileIds?}`
  - `GET /api/bot/conversations/:id?after=<messageId>`
  - `GET /api/bot/files?conversationId=` · `GET /api/bot/files/:id?conversationId=` · `POST /api/bot/files?conversationId=&name=` (raw body)
  - `POST /api/bot/inventory` `{html, summary?}`

## Environment (.env, chmod 600, never committed)
| Name | Notes |
|---|---|
| APP_URL | `https://app.codegreene.com` |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | From box secrets `APP_CODEGREENE_GOOGLE_CLIENT_ID` / `_SECRET` |
| GOOGLE_REDIRECT_URI | Default `https://app.codegreene.com/auth/google/callback`. `/api/auth/google/callback` also works. Must match the Google client exactly. |
| ALLOWED_EMAILS | Comma list. Default `hannes@codegreene.com,josh@codegreene.com,mark@codegreene.com` |
| CG_WEBHOOK_URL, CG_WEBHOOK_AUTH, CG_WEBHOOK_SECRET | Admin's routine webhook |
| CG_BOT_TOKEN | ≥24 chars; given to Admin. `deploy.sh` generates one if unset and keeps it on redeploys. |
| EXTRA_ORIGINS | Optional extra allowed origins |
| INVENTORY_DIR / INVENTORY_GID | Default `/var/lib/bot_admin` / `33` |
| XAI_API_KEY | xAI Grok key. Leave empty until set; Bobby still shows the welcome and UI. |
| XAI_MODEL | Default `grok-4.3` (stretches the R100 allowance). |
| XAI_ZAR_PER_USD | Default `17.50`. Used to show credit use in rand. |
| DEV_MOCK_LOGIN | `0` in production |

## Resources (alpha has ~1.1 GB free)
Two containers: `api` (node:22-alpine, mem_limit 160 MB, V8 heap capped at 96 MB) and `web` (nginx:alpine, mem_limit 48 MB). Measured idle in local tests: api ≈ 25 MB, web ≈ 8 MB.
**SQLite instead of Postgres:** a Postgres container would add about 60–150 MB and another process for a handful of users and a few thousand rows. SQLite (better-sqlite3, WAL) runs in the api process, lives in one file on the `data` volume (`/data/app.db`), and backs up by copying that file.

## Deploy (alpha, 45.33.56.119). Only with Hannes's OK.
1. In the Google client, set the Authorized JavaScript origin to `https://app.codegreene.com` and the Authorized redirect URI to `https://app.codegreene.com/auth/google/callback`.
2. `deploy/deploy.sh code`: copies the code to `/srv/apps/codegreene-app`, writes `.env` from box secrets, builds and starts the containers on 127.0.0.1:3600 (api) and 3601 (web). No Apache changes.
3. `deploy/deploy.sh apache` (first time only): installs `deploy/app.codegreene.com.conf` (:80 with ACME webroot `/var/www/acme/app.codegreene.com`), runs configtest and reloads, runs `certbot certonly --webroot`, installs `deploy/app.codegreene.com-le-ssl.conf` (:443 → 127.0.0.1:3601), then configtest and reload again. It won't overwrite an existing vhost.
4. `deploy/deploy.sh status`
5. Give Admin `CG_BOT_TOKEN` and the API base `https://app.codegreene.com/api`; set `CG_WEBHOOK_*` to Admin's routine webhook and run `deploy.sh code` again.
6. When everyone is happy, retire `/var/www/bot_admin` (Hannes's call).

Rollback: `cd /srv/apps/codegreene-app && sudo docker compose down` and `sudo a2dissite app.codegreene.com-le-ssl app.codegreene.com && sudo apache2ctl configtest && sudo systemctl reload apache2`.

## Local test (box)
`.env` with `APP_URL=http://localhost:3601` and `DEV_MOCK_LOGIN=1`, then `docker compose -f docker-compose.yml -f docker-compose.boxtest.yml up -d --build` (the override uses host networking because the box's dockerd runs without iptables). Afterwards: `docker compose down -v`.

## Sites, builder, SEO, modules, scheduler (25 Nov 2026)

Containers: `api`, `web` (nginx), `db` (Postgres 16 for site databases), `builder` (Astro 5), `pgbackup` (daily `pg_dumpall` into `backups/pg`).

- **Sites**: each site has a `test` and a `live` copy. Each copy has its own Postgres database
  (`site_<slug>_<copy>`) and its own login (`<db>_user`, random password, stored encrypted with
  `SITE_SECRET_KEY`). The test login cannot open the live database (checked by `GET /api/sites/:id/isolation`).
  "Reset test" reads live with the live login, cleans names/emails/phones/messages, and writes with the test login.
- **Builder**: pages are kept as `sites-data/<slug>/<copy>/spec.json` and built to static HTML by the builder.
  Edits always go to test. Publishing copies test to live and needs the client's OK (plus an admin OK if
  client blocks changed). Old versions are kept in `history/`.
- **Module tags**: `/embed/pg.js` (v1.0.0) adds `<pg-contact-form>`, `<pg-funnel>` and `<pg-booking>`.
  The words inside a tag show if the app is down.
- **SEO**: every page gets title, description, canonical, robots, Open Graph, Twitter tags and JSON-LD
  (LocalBusiness/Organization, Article, breadcrumbs). Live copies get sitemap.xml and an indexable robots.txt;
  test copies are always noindex. Images need alt text and width/height (max 1000 px, hero 2000 px).
  301 redirects and the Google Analytics / Search Console fields live in the SEO tab. `GET /api/sites/:id/seo` scores pages.
- **Modules**: switched on or off per client (`/api/modules`). Each has a version; a new major version waits until the client accepts it.
  Bobby cannot change module code; he logs change requests for an admin.
- **CRM**: contacts, submissions and up to 30 custom fields per site copy. Contact form, funnel and bookings feed it.
- **Bookings**: built-in calendar (open hours, slot length, time zone) or a Calendly link. Google/Outlook linking is stubbed (501).
- **Scheduler**: in-process queue, `SCHED_WORKERS` (default 3) at once, jitter for jobs at the same time,
  per-client caps (runs/day, active jobs, AI rand/day), retries (1, 5, 15 min, 1 h) then a flag to Grid. Run log in `sched_runs`.
- **Bot webhooks**: `POST /api/hooks/{admin,grid}/message`, `GET /api/hooks/{bot}/inbox`. HMAC-SHA256 over
  `timestamp.nonce.METHOD.path.body` in `X-CG-Signature: sha256=…` with `X-CG-Timestamp` and `X-CG-Nonce` (5 minute window, nonces kept). All logged in `webhook_log`.
- **Hostnames**: `<slug>.codegreene.com` serves the live copy once DNS and the Apache vhost exist. Reserved names: `api/src/reserved-names.json`.
- **Storage**: per plan (`plans` table), measured every 6 hours, warning at 80%.
- **Mail**: transactional mail is stubbed into `mail_outbox` until a mail service is chosen.
- **Test client accounts**: `hannes+test@`, `josh+test@`, `mark+test@codegreene.com` (password logins, client view).
  Passwords are written once to `backups/TEST_CLIENT_LOGINS.txt` (mode 600) on the server.
- **Client blocks** in git: `client-blocks/`, synced with `deploy/sync-client-blocks.sh`.
