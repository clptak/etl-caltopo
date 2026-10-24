import test from 'node:test';
import assert from 'node:assert';
import { appTrackPosition, latestPoint, recordSeen, PLI_STALE, SEEN_REFRESH } from '../lib/apptracks.js';
import type { AppTrackConfig } from '../lib/apptracks.js';

const NOW = Date.parse('2026-10-24T16:30:00Z');

const CONFIG: AppTrackConfig = {
    MaxAge: 600,
    GroupName: 'White',
    Role: 'Team Member',
    CallsignLookup: [
        { Text: 'CCSO-SAR', UidPrefix: 'SAR-', GroupName: 'Cyan', Role: 'Team Lead' },
    ],
    NameFilter: [],
};

function track(title: string, points: number[][], id = 'track-1') {
    return { id, properties: { class: 'AppTrack', title }, geometry: { type: 'LineString', coordinates: points } };
}

const FRESH = [[-111.684, 35.173, 2144, NOW - 60_000], [-111.6835, 35.1729, 2145, NOW - 5_000]];

test('latestPoint - the point with the newest timestamp, else the last one', () => {
    assert.deepEqual(latestPoint(track('x', [FRESH[1], FRESH[0]]))?.coordinates, FRESH[1]);
    assert.deepEqual(latestPoint(track('x', [[1, 2], [3, 4]])), { coordinates: [3, 4], time: undefined });
    assert.equal(latestPoint(track('x', [])), undefined);
});

test('appTrackPosition - a fresh track becomes a live friendly position at its latest point', () => {
    const position = appTrackPosition(track('Caltopo Guy', FRESH), CONFIG, {}, NOW);
    assert.ok(!('skip' in position));

    assert.equal(position.id, 'caltopo-apptrack-track-1');
    assert.deepEqual(position.geometry, { type: 'Point', coordinates: [-111.6835, 35.1729, 2145] });
    assert.deepEqual(position.properties, {
        type: 'a-f-G-U-C',
        how: 'm-g',
        callsign: 'CALTOPO GUY',
        time: new Date(NOW - 5_000).toISOString(),
        start: new Date(NOW - 5_000).toISOString(),
        stale: new Date(NOW + PLI_STALE).toISOString(),
        group: { name: 'White', role: 'Team Member' },
        contact: { callsign: 'CALTOPO GUY' },
    });
});

test('appTrackPosition - the callsign lookup sets team colour, role & prefix, phone numbers are split out', () => {
    const position = appTrackPosition(track('ccso-sar Smith 5205551234', FRESH), CONFIG, {}, NOW);
    assert.ok(!('skip' in position));

    assert.equal(position.properties.callsign, 'SAR-SMITH');
    assert.deepEqual(position.properties.group, { name: 'Cyan', role: 'Team Lead' });
    assert.deepEqual(position.properties.contact, { callsign: 'SAR-SMITH', phone: '5205551234' });
});

test('appTrackPosition - stopped, filtered & also-on-TAK tracks are not sent', () => {
    const stale = [[-111.68, 35.17, 2144, NOW - 11 * 60_000]];
    assert.deepEqual(appTrackPosition(track('Old', stale), CONFIG, {}, NOW), { skip: 'last point 660s old' });

    assert.deepEqual(
        appTrackPosition(track('Hiker', FRESH), { ...CONFIG, NameFilter: ['ccso'] }, {}, NOW),
        { skip: 'filtered out by NameFilter' },
    );

    // Seen under the track title or the callsign it becomes
    assert.deepEqual(appTrackPosition(track('Caltopo Guy', FRESH), CONFIG, { 'caltopo guy': NOW - 60_000 }, NOW), { skip: 'also reporting from a TAK client' });
    assert.deepEqual(appTrackPosition(track('ccso-sar Smith', FRESH), CONFIG, { 'sar-smith': NOW - 60_000 }, NOW), { skip: 'also reporting from a TAK client' });

    // A TAK client not seen within MaxAge no longer hides the track
    assert.ok(!('skip' in appTrackPosition(track('Caltopo Guy', FRESH), CONFIG, { 'caltopo guy': NOW - 20 * 60_000 }, NOW)));
});

test('recordSeen - a callsign is written at most every SEEN_REFRESH, old records are dropped', () => {
    const first = recordSeen({ 'old-unit': NOW - 2 * 60 * 60_000 }, 'CCSO-SAR 12', NOW);
    assert.deepEqual(first, { 'ccso-sar 12': NOW });

    assert.equal(recordSeen(first!, 'ccso-sar 12', NOW + 60_000), undefined);
    assert.deepEqual(recordSeen(first!, 'ccso-sar 12', NOW + SEEN_REFRESH), { 'ccso-sar 12': NOW + SEEN_REFRESH });
    assert.equal(recordSeen({}, '  ', NOW), undefined);
});
