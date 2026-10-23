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

## Testing PLI forwarding

The live `feature:*` stream reaches a Layer through AWS SQS, so locally a position is
sent straight to the Outgoing handler instead:

1. Put the Outgoing settings in `.outgoing-env.json` (gitignored, Connect Keys are
   credentials) - see the README's PLI table, ie:

   ```json
   {
       "PLI": {
           "ConnectKeys": [
               { "Name": "Volunteers", "ConnectKey": "<volunteer key>", "CallsignContains": ["CCSO-SAR"] },
               { "Name": "Sworn", "ConnectKey": "<sworn key>", "CallsignContains": ["MCSO"] }
           ]
       },
       "DEBUG": true
   }
   ```

2. Load them into the dev Layer: `scripts/dev-layer.sh`
3. Send a position: `npx tsx scripts/dev-position.ts "CCSO-SAR Test" 40.3 -105.6`

With a real Connect Key the device appears under the Team's Trackable Devices in CalTopo.
Callsigns that match no rule, or a non-friendly type passed as the 4th argument (ie:
`a-h-G`), are logged as skipped when `DEBUG` is on.

## Streaming live TAK positions locally

To have real TAK clients flow through the ETL without AWS, local emulators stand in
for SQS (the Outgoing queue) and STS (the account lookup CloudTAK builds queue URLs
from), and `scripts/dev-queue.ts` does the Lambda trigger's job:

```
TAK clients → TAK Server → dev CloudTAK Connection → ElasticMQ (SQS) → scripts/dev-queue.ts → handler → CalTopo
```

This needs a CloudTAK that builds its queue URLs from `AWS_ENDPOINT_URL_SQS` (the
`dev-sqs-endpoint` branch of the CloudTAK fork).

1. Start the emulators (the `--env-file` keeps docker-compose from reading this repo's
   JSON `.env`):

   ```sh
   docker-compose --env-file /dev/null -f docker-compose.dev.yml up -d
   ```

2. Create a Connection in the dev CloudTAK UI with a certificate whose TAK groups see
   the clients, then move the dev Layer onto it - Outgoing Layers only receive their
   own Connection's stream:

   ```sh
   CONNECTION=<connection id> scripts/dev-layer.sh
   ```

3. Restart the dev CloudTAK pointed at the emulators, with Connections and ETL events
   on (the default `npm run dev` turns both off):

   ```sh
   cd ~/CloudTAK/api
   AWS_ENDPOINT_URL_SQS=http://localhost:9324 AWS_ENDPOINT_URL_STS=http://localhost:5055 \
   AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
   npx tsx watch index.ts --no-events --no-geofence
   ```

   The fake credentials only reach the emulators - other AWS calls of the dev CloudTAK
   fail as they do without credentials.

4. Run the queue consumer: `npx tsx scripts/dev-queue.ts`

New Outgoing configs get a `Positions only` filter, so only `a-f-G` positions reach the
queue. Callsigns still have to match a PLI rule in `.outgoing-env.json`. Unlike the
Lambda, a message that fails is dropped rather than retried.

## Mission Sync dry run

The `Sync` Source compares each TAK Mission with its CalTopo Map and logs what it
would create, update, adopt or delete in CalTopo - nothing is written yet.

CloudTAK's Mission routes only accept a user's token, so Missions are read with a
**Profile API Token of a dedicated service account** (an LDAP account whose groups can
read the Missions): log in to CloudTAK as that account, then Menu → Settings → API
Tokens. A password protected Mission also needs the account subscribed to it. Once
CloudTAK lets a Layer read its own Data Sync Mission, `missionReader()` in `task.ts`
switches to that and the token goes away.

1. Put the Incoming settings in `.incoming-env.json` (gitignored, it holds credentials):

   ```json
   {
       "Source": {
           "Mode": "Sync",
           "CredentialId": "<CalTopo service account credential ID>",
           "CredentialSecret": "<CalTopo service account credential secret>",
           "MissionToken": "<CloudTAK profile API token>",
           "Pairs": [{ "MapId": "<CalTopo map ID>", "MissionGuid": "<TAK mission GUID>" }],
           "DryRun": true
       },
       "DEBUG": true
   }
   ```

2. Load them into the dev Layer: `scripts/dev-layer.sh`
3. Run one sync: `npx tsx task.ts`

With `DEBUG` on, each planned action is listed under the pair's summary line.

## Caution

The dev Layer has no Connection, so anything it submits goes to the dev
CloudTAK's TAK server using the server certificate. Check which TAK server
that is before giving the Layer a real `Source`.
