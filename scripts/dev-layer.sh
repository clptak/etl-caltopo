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
#   OUTGOING_ENV JSON file of Outgoing settings, ie: PLI Connect Keys (default .outgoing-env.json
#                if present) - keep it out of git, Connect Keys are credentials

set -euo pipefail

cd "$(dirname "$0")/.."

DEV_DB="${DEV_DB:-postgres://localhost:5432/tak_ps_etl}"
ETL_API="${ETL_API:-http://localhost:5001}"
CLOUDTAK_ENV="${CLOUDTAK_ENV:-$HOME/CloudTAK/api/.env}"
LAYER_NAME="${LAYER_NAME:-CalTopo Sync (dev)}"
OUTGOING_ENV="${OUTGOING_ENV:-.outgoing-env.json}"
VERSION="$(node -p "require('./package.json').version")"

case "$(node -p "new URL('$ETL_API').hostname")" in
    localhost|127.0.0.1) ;;
    *) echo "not ok - ETL_API must be a localhost dev CloudTAK" >&2; exit 1 ;;
esac

# Without a settings file an existing Outgoing environment is left as it is
SET_OUTGOING=false
OUTGOING='{}'
if [ -f "$OUTGOING_ENV" ]; then
    SET_OUTGOING=true
    OUTGOING="$(node -e "process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))))" "$OUTGOING_ENV")"
fi

LAYER_ID="$(psql "$DEV_DB" -v ON_ERROR_STOP=1 -Atq \
    -v name="$LAYER_NAME" -v version="$VERSION" \
    -v outgoing="$OUTGOING" -v set_outgoing="$SET_OUTGOING" <<'SQL'
INSERT INTO integrations (prefix, name, repo)
    VALUES ('etl-caltopo', 'CalTopo', 'https://github.com/clptak/etl-caltopo')
    ON CONFLICT (prefix) DO NOTHING;

INSERT INTO layers (name, description, connection, task, version)
    SELECT :'name', 'Local dev Layer for etl-caltopo', NULL,
        (SELECT id FROM integrations WHERE prefix = 'etl-caltopo'), :'version'
    WHERE NOT EXISTS (SELECT 1 FROM layers WHERE name = :'name' AND connection IS NULL);

INSERT INTO layers_incoming (layer, cron)
    SELECT id, 'rate(1 minute)' FROM layers WHERE name = :'name' AND connection IS NULL
    ON CONFLICT (layer) DO NOTHING;

INSERT INTO layers_outgoing (layer, subscriptions, environment)
    SELECT id, ARRAY['feature:*'], :'outgoing'::jsonb FROM layers WHERE name = :'name' AND connection IS NULL
    ON CONFLICT (layer) DO UPDATE SET environment = EXCLUDED.environment, updated = now()
    WHERE :'set_outgoing' = 'true';

SELECT id FROM layers WHERE name = :'name' AND connection IS NULL;
SQL
)"

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

echo "ok - Layer $LAYER_ID ($LAYER_NAME) registered in $DEV_DB"
if [ "$SET_OUTGOING" = true ]; then echo "ok - Outgoing settings loaded from $OUTGOING_ENV"; fi
echo "ok - wrote .env - run the ETL with: npx tsx task.ts"
