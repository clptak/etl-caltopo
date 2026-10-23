import test from 'node:test';
import assert from 'node:assert';
import { positionReport } from '../lib/pli.js';
import type { PLIConfig } from '../lib/pli.js';

const NOW = Date.parse('2026-06-01T12:00:00Z');

const CONFIG: PLIConfig = {
    ConnectKeys: [
        { Name: 'Volunteers', ConnectKey: 'KEY-VOL', CallsignContains: ['CCSO-SAR'] },
        { Name: 'Sworn', ConnectKey: 'KEY-SWORN', CallsignContains: ['mcso'] },
    ],
    Types: ['a-f-G'],
    DevicesOnly: true,
};

function pli(callsign: string, props: Record<string, unknown> = {}, geometry: Record<string, unknown> = { type: 'Point', coordinates: [-105.6, 40.3, 2900] }) {
    return {
        type: 'feature',
        xml: '<event/>',
        geojson: {
            id: `ANDROID-${callsign}`,
            type: 'Feature',
            path: '/',
            properties: {
                callsign,
                type: 'a-f-G-U-C',
                how: 'm-g',
                time: '2026-06-01T11:59:50Z',
                start: '2026-06-01T11:59:50Z',
                stale: '2026-06-01T12:05:00Z',
                center: [-105.6, 40.3],
                status: { battery: '88' },
                ...props,
            },
            geometry,
        },
    };
}

function report(message: ReturnType<typeof pli>, config: PLIConfig = CONFIG) {
    // @ts-expect-error sample message is a partial OutgoingFeatureMessage
    return positionReport(message, config, NOW);
}

test('positionReport - callsign rules pick the Connect Key, case-insensitive & in order', () => {
    assert.deepEqual(report(pli('CCSO-SAR 12')), {
        rule: CONFIG.ConnectKeys[0], id: 'CCSO-SAR 12', lat: 40.3, lng: -105.6,
    });

    const sworn = report(pli('MCSO Deputy 4'));
    assert.ok(!('skip' in sworn));
    assert.equal(sworn.rule.Name, 'Sworn');

    assert.deepEqual(report(pli('Civilian 1')), { skip: 'callsign Civilian 1 matches no Connect Key rule' });
});

test('positionReport - a rule without CallsignContains matches every callsign', () => {
    const config = { ...CONFIG, ConnectKeys: [{ Name: 'All', ConnectKey: 'KEY-ALL', CallsignContains: [] }] };

    const res = report(pli('Anyone'), config);
    assert.ok(!('skip' in res));
    assert.equal(res.rule.Name, 'All');
});

test('positionReport - only fresh TAK client positions are forwarded', () => {
    assert.deepEqual(report(pli('CCSO-SAR 1', { type: 'a-h-G' })), { skip: 'type a-h-G is not a position' });
    assert.deepEqual(report(pli('CCSO-SAR 1', { status: undefined })), { skip: 'not sent by a TAK client' });
    assert.deepEqual(report(pli('CCSO-SAR 1', { stale: '2026-06-01T11:00:00Z' })), { skip: 'stale since 2026-06-01T11:00:00Z' });
    assert.deepEqual(report(pli('   ')), { skip: 'no callsign' });
    assert.deepEqual(
        report(pli('CCSO-SAR 1', {}, { type: 'LineString', coordinates: [[0, 0], [1, 1]] })),
        { skip: 'LineString is not a Point' },
    );

    // A TAK version block marks a TAK client as well as battery status
    assert.ok(!('skip' in report(pli('CCSO-SAR 1', { status: undefined, takv: { platform: 'ATAK-CIV' } }))));

    // Markers are forwarded when DevicesOnly is off
    assert.ok(!('skip' in report(pli('CCSO-SAR 1', { status: undefined }), { ...CONFIG, DevicesOnly: false })));
});
