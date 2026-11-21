# ai_business_app

One shared codebase for the business app that runs on both of Hannes's
servers:

- Test: [app.codegreene.com](https://app.codegreene.com) on the alpha server
- Live: [app.planet-grid.com](https://app.planet-grid.com) on the Planet Grid server

The same code is meant to run on both, no matter which clients are hosted
there. Each server has its own settings file (`.env`) and its own data.
Features are switched on per client. Planet Grid billing is a module that
stays on only for Planet Grid, and must keep working exactly as it does now.

This repo was started on 21 Nov 2026 by putting the two existing apps side
by side. They are not fully merged yet. See `MERGE_PLAN.md` for the steps
to unify them safely.

## What is in this repo

```
apps/core/        The newer client app (from app.codegreene.com).
                  Bobby is first in the menu, then Web, Resources,
                  CRM (Customer Relationship Management) and Scott.
                  Web, Resources, CRM and Scott are still "coming soon".

apps/billing/     The live Planet Grid app (from app.planet-grid.com).
                  Invoices, statements, CRM, website editor, files,
                  blog, leads and mail. Do not change billing logic
                  just to match the test app.

plugins/          Code added to client websites: cookie consent,
                  contact form (talks to the CRM), blog widget, and
                  the site starter template.

deploy/           How a server pulls this repo and builds the Docker
                  containers (the packed-up services that run the app).
```

## What stays out of this repo

- Client site content: pages, images, uploads and anything a client wrote
- Databases, database dumps and backups
- `.env` and any other secrets (passwords, keys, tokens)
- `node_modules`, build output, logs

A `seed.json` that held real client names, emails, phone numbers and
balances was also left out. The live Planet Grid database already has
that data. A new server should be restored from an encrypted backup.

## How the two servers stay in sync

1. Change the code in this repo.
2. Build and test on **app.codegreene.com** first.
3. When that looks right, deploy the **same** containers to
   **app.planet-grid.com**.
4. Each server pulls the repo with its own read-only deploy key (a GitHub
   key that can only download this one repo). Hannes's personal GitHub
   key never sits on a server.
5. Each server keeps its own `.env` and its own database. A deploy must
   not overwrite those.

Nothing is auto-deployed to Planet Grid until Hannes says so.

## How to run with Docker

You need Docker and Docker Compose on the machine. Copy the example
settings, then start only the app that machine should run.

### Test / core app (Bobby-first)

```bash
cd apps/core
cp .env.example .env
chmod 600 .env
# Fill in the keys you have. Leave XAI_API_KEY empty if Bobby should
# show the screen but not yet reply.
docker compose up -d --build
```

The API (the back end) listens on `127.0.0.1:3600`. The web front end
listens on `127.0.0.1:3601`. Put a reverse proxy in front for HTTPS.

On the shared development box, the Docker network is limited, so use the
override file as well:

```bash
docker compose -f docker-compose.yml -f docker-compose.boxtest.yml up -d --build
```

### Planet Grid billing app

```bash
cd apps/billing
cp .env.example .env
chmod 600 .env
# Fill in DB_PASSWORD and the other keys. ENABLE_BILLING stays for
# Planet Grid only.
docker compose up -d --build
```

The API listens on `127.0.0.1:3000`. The web front end listens on
`127.0.0.1:3001`. The first start of an empty database does **not** load
real clients (seed data is not in git). Restore from a backup if you need
the live books.

## Menu the client sees (set 21 Nov 2026)

The client can rename the agents (Bobby and Scott).

1. **Bobby** — first item. The client's AI (Artificial Intelligence)
   helper: manager, worker, project manager and data processor. He runs
   on the R100 of Grok credits in the base plan. He can work all internal
   apps and read all data. He should still ask before he deletes anything,
   spends money, or sends an email.
2. **Web** — view site pages and change header, footer and sections by
   talking to Bobby.
3. **Resources** — upload designs, images, backgrounds and PDFs (Portable
   Document Format files).
4. **CRM** — contact forms on the website feed into this. It keeps every
   customer, chat and job in one place.
5. **Scott** — the public website chat. He can book calendar appointments
   and email info. Each action can wait for approval or go straight out.
   Scott can only insert into the CRM, calendar and mail, and reply with
   info. Grid and Bobby are the main ways to program Scott.

Billing comes after these, and stays as it is, switched on only for
Planet Grid.

Most new clients will first see a draft site that was already built,
then subscribe to the base plan, then meet Bobby.

## Source of this first commit

- `apps/core` is the code from `/srv/apps/codegreene-app` on alpha,
  git commit `aa46b9f`, plus the Apache (web server) vhost files and the
  box-test Compose file from the earlier deploy kit.
- `apps/billing` is the code from `/srv/apps/billing` on
  102.209.118.114, as it was on 21 Nov 2026, without `.env`, backups or
  seed data.
- `plugins` come from `/srv/apps/sites/_template`, the JavaScript in
  `/srv/apps/sites/new/js`, and the marketing-site cookie banner.

The two production servers were not changed when this repo was created.
