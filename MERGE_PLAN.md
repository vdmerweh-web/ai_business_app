# Merge plan: one app, two servers

This repo holds both existing apps in separate folders so nothing is lost
and Planet Grid billing is not risked. A full merge (one set of
containers, one login, one menu) is too big to finish safely in this
first commit. This file lists the concrete steps to get there.

## Why they are still separate

| | apps/core (test app) | apps/billing (Planet Grid) |
|---|---|---|
| Live URL | app.codegreene.com | app.planet-grid.com |
| Database | SQLite in the API container | Postgres in its own container |
| First screen after login | Bobby | Dashboard / clients / invoices |
| Feature switches | Per client, in `api/src/features.js` | Not the same system |
| Website editor, CRM, files, blog, leads | Coming soon / stubs | Already built |
| Invoices, statements, journal, mail PDFs | Not present | Live, and must not change in behaviour |
| Auth | Google for staff, email+password for clients | Google + password, different cookie and session |

Both behaviours have to be kept behind config. We must not drop a
Planet Grid screen just because the test app does not have it yet, and
we must not replace Bobby's new menu with the old billing menu.

## Rules that stay in force the whole way

- Build and test on app.codegreene.com first. Only then ship the same
  build to app.planet-grid.com.
- Do not change billing calculations, invoice numbers, PDF text, or mail
  text unless Hannes asks.
- Billing stays switched off on every server except Planet Grid
  (`ENABLE_BILLING=0` by default).
- Each server keeps its own `.env` and database. Deploys never overwrite
  those.
- Back up the billing database before any billing deploy.
- Do not send invoices, or email clients, unless Hannes says so.
- Bobby can read all of a client's data and work the internal apps, but
  he still asks before he deletes anything, spends money, or sends mail.
- Scott can only insert into the CRM, calendar and mail, and reply with
  info.

## Steps

### 1. Deploy keys and a safe pull (do this next)

On GitHub, add a read-only deploy key for each server (one key that can
only download this repo). Install that key only on that server, not
Hannes's personal `vdmerweh` key.

On each server, clone this repo to a new folder (do not replace the
running copy until a pull has been tested). Use `deploy/pull-and-build.sh`
to `git pull --ff-only` and `docker compose up -d --build` in the app
folder for that server. Confirm `/health` still answers. Leave the
current running folders in place until that is proven.

### 2. Point the test server at `apps/core`

Once step 1 works, app.codegreene.com should run from this repo's
`apps/core` instead of the standalone git repo in `/srv/apps/codegreene-app`.
Keep the existing SQLite volume and `.env`. No change for clients.

### 3. Point Planet Grid at `apps/billing`

Same idea: `/srv/apps/billing` becomes a checkout of this repo, running
only `apps/billing`, with the existing Postgres volume and `.env`. Take a
database backup first. Billing behaviour must match what is live today.

### 4. Shared config flags

Add `APP_NAME` and `ENABLE_BILLING` (already named in the root
`.env.example`) so a later combined compose file can start core always,
and billing only when the flag is on. Move hard-coded Planet Grid URLs
in `apps/billing/docker-compose.yml` (for example `APP_URL` and
`ADMIN_EMAIL`) fully into `.env`, with the current values as the Planet
Grid defaults.

### 5. One login, one menu (the real merge)

- Keep the client menu order: Bobby, Web, Resources, CRM, Scott, then
  Billing when `ENABLE_BILLING` is on for that client or tenant.
- Reuse the billing app's existing CRM, website editor (`Editor.jsx`),
  Files, Blog and Leads as the implementations behind Web, Resources and
  CRM, instead of rewriting them. Wire contact forms (`plugins/site-widgets/js/leads.js`)
  into that CRM.
- Put Bobby in front as the first screen for a new subscriber. Staff on
  Planet Grid still need a way to reach invoices, the journal and the
  monthly run.
- Decide the database: either give core a Postgres mode so both apps can
  share one database on Planet Grid, or keep two databases and have
  Bobby talk to billing through an internal API. Do not migrate Planet
  Grid off Postgres in a hurry — the books live there.
- Sessions and cookies are different today (`cg_sid` vs the billing
  session). Plan a single sign-in without logging everyone out twice.

### 6. Scott and the website plugins

Scott (the public chat) should live in `apps/core` as a bounded agent,
and on the public site as a plugin in `plugins/`. He may only write to
CRM, calendar and mail, and reply with info. Approval-or-send is a
per-action setting. Grid and Bobby program him; he does not program
himself into other apps.

### 7. Switch features per client, not per server

`apps/core` already does this in `api/src/features.js`. Extend that list
with `billing` (Planet Grid only) and later with whatever a plan
includes. A server can host many clients; the code does not change when
a client is added.

### 8. Retire the old side-by-side folders

When Planet Grid is running from the merged app, and the test app is
too, delete the temporary split in the docs (not the billing module).
Keep `MERGE_PLAN.md` as history.

## What this first commit already did

- Copied both codebases, Docker files, Apache vhost examples, and
  website plugins into one private repo.
- Left client content, databases, backups, `.env` values and seed data
  out.
- Documented the deploy order: test server first, then Planet Grid, each
  with its own read-only key.
