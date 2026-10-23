# Running the ETL locally against a dev CloudTAK

No AWS is needed. The ETL runs as a plain Node process on your machine and talks
to a dev CloudTAK's API exactly as the deployed Lambda would.

## Prerequisites

- A dev CloudTAK API running from source (`npm run dev` in `CloudTAK/api`),
  reachable at `http://localhost:5001`, with its JSON `api/.env` holding
  `SigningSecret`.
- `psql` access to that CloudTAK's database.
- Node 24+, then `npm ci` in this repo.

## One-time setup

```sh
scripts/dev-layer.sh
```

This registers the `etl-caltopo` Integration and a server-level Layer named
`CalTopo Sync (dev)` in the dev database, then writes a gitignored `.env`:

```json
{ "ETL_API": "http://localhost:5001", "ETL_LAYER": "1", "ETL_TOKEN": "etl.…" }
```

The rows are written to the database directly because CloudTAK's Create Layer
API refuses any Task image that is not in AWS ECR. The script is idempotent,
so re-running it reuses the same Layer and refreshes the token.

Override the defaults with `DEV_DB`, `ETL_API`, `CLOUDTAK_ENV` or `LAYER_NAME`.

## Running

```sh
npx tsx task.ts               # one scheduled run (what EventBridge triggers)
npx tsx task.ts capabilities  # print the Layer's config schema
```

With no Layer environment set, a run fetches the Layer and then stops with an
`Internal Validation Error ... Body: {}`, which shows that authentication works.
Set the environment from the Layer's page in the CloudTAK UI (server-level Layers
are listed under Server Admin → Layers).

## Caution

The dev Layer has no Connection, so anything it submits goes to the dev
CloudTAK's TAK server using the server certificate. Check which TAK server
that is before giving the Layer a real `Source`.
