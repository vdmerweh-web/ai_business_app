# Client blocks

Client blocks are small pieces of HTML, CSS and JavaScript made for one client's site
(usually by Bobby). They are never shared between clients and never change a shared module.

On the server they live in `sites-data/<site>/<test|live>/blocks/<name>/`:

- `block.html`, `block.css`, `block.js`: the block itself
- `meta.json`: `version` (goes up by 1 on each save), `description`, `updatedAt`, `updatedBy`

Rules:

- Bobby and clients save blocks to the **test** copy only.
- Publishing test to live copies blocks too, and a change with blocks needs an admin OK.
- Old live blocks are moved into `history/` on publish, never deleted.

This folder is the copy kept in git, one folder per site: `client-blocks/<site>/<test|live>/<name>/`.
Update it from the server with:

```sh
deploy/sync-client-blocks.sh   # run on the Mac, in the repo root's apps/core folder
git add client-blocks && git commit -m "Sync client blocks"
```
