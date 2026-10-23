/**
 * Send one TAK position through the Outgoing handler, as CloudTAK would via SQS
 *
 * Reads the dev Layer from the CloudTAK in .env (see scripts/dev-layer.sh), so the
 * Layer's Outgoing settings decide whether - and to which Connect Key - it is forwarded
 *
 * Usage: npx tsx scripts/dev-position.ts <callsign> <lat> <lng> [cot type]
 */
import process from 'node:process';
import { handler } from '../task.js';

const [callsign, lat, lng, type = 'a-f-G-U-C'] = process.argv.slice(2);

if (!callsign || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    console.error('Usage: npx tsx scripts/dev-position.ts <callsign> <lat> <lng> [cot type]');
    process.exit(1);
}

const now = new Date();

const message = {
    type: 'feature',
    xml: '<event/>',
    geojson: {
        id: `DEV-${callsign.replace(/\s+/g, '-')}`,
        type: 'Feature',
        path: '/',
        properties: {
            callsign,
            type,
            how: 'm-g',
            time: now.toISOString(),
            start: now.toISOString(),
            stale: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
            center: [Number(lng), Number(lat)],
            status: { battery: '100' },
        },
        geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
    },
};

await handler({ Records: [{ body: JSON.stringify(message) }] } as never);

console.log(`ok - ${callsign} processed`);
