# Deploy

Build and test on app.codegreene.com first. Only then deploy the same
commit to app.planet-grid.com. Each server pulls this repo with its own
read-only GitHub deploy key. Do not copy Hannes's personal GitHub key
onto a server.

`pull-and-build.sh` is the starting script. It only updates code and
rebuilds containers. It will not create, edit or print `.env`.

## One-time setup on a server (not done yet)

1. Create a read-only deploy key for this repo, one per server.
2. Clone the repo to a folder such as `/srv/apps/ai_business_app`.
3. Copy the existing running `.env` into `apps/core/.env` or
   `apps/billing/.env` (chmod 600). Do not start from an empty file on
   a live server.
4. When a pull-and-build in a side folder looks healthy, point the
   existing compose project / reverse proxy at it. Until then, leave the
   current `/srv/apps/codegreene-app` and `/srv/apps/billing` running.

## Commands

```bash
# On the test server (core app only)
./deploy/pull-and-build.sh core

# On Planet Grid (billing only). Back up the database first.
./deploy/pull-and-build.sh billing
```

The script refuses to build billing unless `ENABLE_BILLING=1` is set in
the environment or in `apps/billing/.env`. That flag must stay off on
the test server.
