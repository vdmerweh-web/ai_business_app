# Planet Grid Billing (v1)

**Web:** https://app.planet-grid.com   **API:** https://api.planet-grid.com
**Log in:** hannes@planet-grid.com (your password)

## What it does
- **Clients:** list, balance, reference (e.g. PG042). Clients pay with this reference.
- **Client page:** add payments, credits, once-off charges. Add or end contracts (monthly or yearly). Download the invoice and the 6-month statement PDF.
- **Monthly run:** choose a month, then **Preview**. Preview saves nothing.
  **Finalise** makes real invoices with real numbers (next is 5289, after your manual 5277–5288). You must type FINALISE.
- **Export:** CSV journal for Sage / Xero / QuickBooks. Default is the tax year (Mar–Feb).
- **Settings:** bank details, name, phone, tagline (shown on PDFs).
- **View:** every invoice (old and new) and statement opens in the browser from the client page or the Invoices list.
- No emails are sent. You download the PDFs.

## Money rule
Balance = debits minus credits. Plus = client owes you. Minus = in credit.

## Legacy data
13 active clients. Opening balance at 2026-01-01, then the 2026 entries up to Oct 2026.
Total owed: R4,270. The 15 bank lines after 17 Sep 2026 are NOT booked yet.

## Server
/srv/apps/billing, run with `docker compose up -d --build`. Ports are 127.0.0.1 only.
Database: Postgres in Docker, volume `billing_pgdata`. Secrets are in `.env` (not in git).
Seed data is not in this repo (it held real client details). A new install should restore from an encrypted backup. See seed/README.md.

## Journal
Journal tab: every ledger line, newest first. Filter by date, client, account. Download CSV.
"New journal entry": DT must equal CT before you can save. Only your own journals (MJ…) can be edited or deleted.

## Backup and restore
Backups: server ~/backups, box /workspace/grid_bot/backups, Mac ~/bots/grid_bot/backups.
Make one (on the server):
`cd /srv/apps/billing && docker compose exec -T db pg_dump -U billing -Fc billing > ~/backups/billing_backup_DATE.dump`
Restore (this replaces the current data):
`docker compose stop api && docker compose exec -T db pg_restore -U billing -d billing --clean --if-exists < ~/backups/billing_backup_DATE.dump && docker compose start api`
Or, from the .sql file: `docker compose exec -T db psql -U billing billing < file.sql` (into an empty database).
