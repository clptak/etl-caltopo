#!/usr/bin/env bash
#
# Register this ETL as a Layer in a LOCAL dev CloudTAK and write the .env that
# lets `npx tsx task.ts` run against it - no AWS required.
#
# CloudTAK's Create Layer API refuses Tasks that are not in AWS ECR, so in dev
# the Integration, Layer and Incoming config rows are written straight to the
# dev database. Idempotent: re-running reuses the existing rows.
#
# The Layer token is signed with the SigningSecret from the dev CloudTAK's
# api/.env - the same { access: 'layer', id, internal: true } token CloudTAK
# gives a deployed Lambda.
#
# Usage: scripts/dev-layer.sh
#   DEV_DB       Postgres URL of the dev CloudTAK (default postgres://localhost:5432/tak_ps_etl)
#   ETL_API      Dev CloudTAK API URL                (default http://localhost:5001)
#   CLOUDTAK_ENV Dev CloudTAK's JSON api/.env        (default ~/CloudTAK/api/.env)
#   LAYER_NAME   Name of the dev Layer               (default "CalTopo Sync (dev)")
#   INCOMING_ENV JSON file of Incoming settings, ie: a Mission Sync Source (default
#                .incoming-env.json if present) - keep it out of git, it holds credentials
#   OUTGOING_ENV JSON file of Outgoing settings, ie: PLI Connect Keys (default .outgoing-env.json
#                if present) - keep it out of git, Connect Keys are credentials
#   DATA         Data Sync ID the Layer's Incoming submissions are written to - the CalTopo →
#                TAK half of a Mission Sync (default: leave as is)
#   CONNECTION   Connection ID to move the Layer to - Outgoing Layers only receive the
#                feature:* stream of their Connection (default: leave as is, new Layers
#                are server-level)

set -euo pipefail

cd "$(dirname "$0")/.."

DEV_DB="${DEV_DB:-postgres://localhost:5432/tak_ps_etl}"
ETL_API="${ETL_API:-http://localhost:5001}"
CLOUDTAK_ENV="${CLOUDTAK_ENV:-$HOME/CloudTAK/api/.env}"
LAYER_NAME="${LAYER_NAME:-CalTopo Sync (dev)}"
INCOMING_ENV="${INCOMING_ENV:-.incoming-env.json}"
OUTGOING_ENV="${OUTGOING_ENV:-.outgoing-env.json}"
VERSION="$(node -p "require('./package.json').version")"

case "$(node -p "new URL('$ETL_API').hostname")" in
    localhost|127.0.0.1) ;;
    *) echo "not ok - ETL_API must be a localhost dev CloudTAK" >&2; exit 1 ;;
esac

# Compact a JSON settings file - without one, the existing environment is left as it is
compact() {
    node -e "process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))))" "$1"
}

SET_INCOMING=false
INCOMING='{}'
if [ -f "$INCOMING_ENV" ]; then
    SET_INCOMING=true
    INCOMING="$(compact "$INCOMING_ENV")"
fi

SET_OUTGOING=false
OUTGOING='{}'
if [ -f "$OUTGOING_ENV" ]; then
    SET_OUTGOING=true
    OUTGOING="$(compact "$OUTGOING_ENV")"
fi

CONNECTION="${CONNECTION:-}"
DATA="${DATA:-}"

# Outgoing configs without filters only stream positions, matching the README's recommended filter
FILTERS='{"queries":[{"name":"Positions only","query":"$substring(properties.type, 0, 5) != '"'"'a-f-G'"'"'"}]}'

LAYER_ID="$(psql "$DEV_DB" -v ON_ERROR_STOP=1 -Atq \
    -v name="$LAYER_NAME" -v version="$VERSION" \
    -v incoming="$INCOMING" -v set_incoming="$SET_INCOMING" \
    -v outgoing="$OUTGOING" -v set_outgoing="$SET_OUTGOING" \
    -v connection="$CONNECTION" -v data="$DATA" -v filters="$FILTERS" <<'SQL'
INSERT INTO integrations (prefix, name, repo)
    VALUES ('etl-caltopo', 'CalTopo', 'https://github.com/clptak/etl-caltopo')
    ON CONFLICT (prefix) DO NOTHING;

INSERT INTO layers (name, description, connection, task, version)
    SELECT :'name', 'Local dev Layer for etl-caltopo', NULLIF(:'connection', '')::integer,
        (SELECT id FROM integrations WHERE prefix = 'etl-caltopo'), :'version'
    WHERE NOT EXISTS (SELECT 1 FROM layers WHERE name = :'name');

UPDATE layers SET connection = NULLIF(:'connection', '')::integer, updated = now()
    WHERE name = :'name' AND :'connection' <> '' AND connection IS DISTINCT FROM NULLIF(:'connection', '')::integer;

INSERT INTO layers_incoming (layer, cron, environment)
    SELECT id, 'rate(1 minute)', :'incoming'::jsonb FROM layers WHERE name = :'name'
    ON CONFLICT (layer) DO UPDATE SET
        environment = CASE WHEN :'set_incoming' = 'true' THEN EXCLUDED.environment ELSE layers_incoming.environment END,
        updated = now();

UPDATE layers_incoming SET data = NULLIF(:'data', '')::integer, updated = now()
    WHERE :'data' <> '' AND layer = (SELECT id FROM layers WHERE name = :'name');

INSERT INTO layers_outgoing (layer, subscriptions, environment, filters)
    SELECT id, ARRAY['feature:*'], :'outgoing'::jsonb, :'filters'::jsonb FROM layers WHERE name = :'name'
    ON CONFLICT (layer) DO UPDATE SET
        environment = CASE WHEN :'set_outgoing' = 'true' THEN EXCLUDED.environment ELSE layers_outgoing.environment END,
        filters = CASE WHEN layers_outgoing.filters = '{}'::jsonb THEN EXCLUDED.filters ELSE layers_outgoing.filters END,
        updated = now();

SELECT id || ' ' || COALESCE(connection::text, 'server') FROM layers WHERE name = :'name';
SQL
)"
LAYER_CONNECTION="${LAYER_ID#* }"
LAYER_ID="${LAYER_ID%% *}"

# HS256 JWT signed with node:crypto so the secret never reaches argv or stdout
ETL_API="$ETL_API" LAYER_ID="$LAYER_ID" CLOUDTAK_ENV="$CLOUDTAK_ENV" node --input-type=module <<'JS'
import fs from 'node:fs';
import crypto from 'node:crypto';

const secret = JSON.parse(fs.readFileSync(process.env.CLOUDTAK_ENV, 'utf8')).SigningSecret || 'coe-wildland-fire';
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ access: 'layer', id: Number(process.env.LAYER_ID), internal: true, iat: Math.floor(Date.now() / 1000) })}`;
const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');

fs.writeFileSync('.env', JSON.stringify({
    ETL_API: process.env.ETL_API,
    ETL_LAYER: process.env.LAYER_ID,
    ETL_TOKEN: `etl.${body}.${sig}`,
}, null, 4) + '\n', { mode: 0o600 });
JS

echo "ok - Layer $LAYER_ID ($LAYER_NAME) registered in $DEV_DB - Connection: $LAYER_CONNECTION"
if [ "$SET_INCOMING" = true ]; then echo "ok - Incoming settings loaded from $INCOMING_ENV"; fi
if [ "$SET_OUTGOING" = true ]; then echo "ok - Outgoing settings loaded from $OUTGOING_ENV"; fi
echo "ok - wrote .env - run the ETL with: npx tsx task.ts"
