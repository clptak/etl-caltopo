import test from 'node:test';
import assert from 'node:assert';
import { planTakToCalTopo, canonicalTak, canonicalCalTopo, hash, toCalTopo, summary } from '../lib/sync.js';
import type { Link } from '../lib/sync.js';
import type { MissionFeature } from '../lib/mission.js';

function tak(id: string, callsign: string, opts: { coordinates?: unknown, type?: string, remarks?: string, props?: Record<string, unknown> } = {}): MissionFeature {
    return {
        id,
        properties: { callsign, type: 'u-d-p', remarks: opts.remarks ?? '', ...opts.props },
        geometry: { type: opts.type ?? 'Point', coordinates: opts.coordinates ?? [-111.65, 35.19, 2100] },
    };
}

function caltopo(id: string, title: string, opts: { coordinates?: unknown, type?: string, description?: string } = {}) {
    return {
        id,
        properties: { class: 'Marker', title, description: opts.description ?? '' },
        geometry: { type: opts.type ?? 'Point', coordinates: opts.coordinates ?? [-111.65, 35.19] },
    };
}

function link(t: ReturnType<typeof tak>, c: ReturnType<typeof caltopo>, origin: Link['origin'] = 'tak'): Link {
    return { tak: t.id, caltopo: c.id, origin, takHash: hash(canonicalTak(t)), caltopoHash: hash(canonicalCalTopo(c)) };
}

test('canonical - altitude dropped & coordinates rounded so both sides compare equal', () => {
    assert.equal(
        hash(canonicalTak(tak('a', 'CP 1', { coordinates: [-111.6500000004, 35.19, 2100] }))),
        hash(canonicalCalTopo(caltopo('b', 'CP 1')))
    );
});

test('planTakToCalTopo - unlinked items are created, or adopted when CalTopo already has the ID', () => {
    const plan = planTakToCalTopo(
        [tak('new-1', 'Staging'), tak('ct-1', 'From CalTopo'), tak('ct-2', 'Moved in TAK', { coordinates: [-111.7, 35.2] })],
        [caltopo('ct-1', 'From CalTopo'), caltopo('ct-2', 'Moved in TAK')],
        { links: [] }
    );

    assert.deepEqual(plan.actions.map((a) => [a.op, a.op === 'adopt' ? a.same : undefined]), [
        ['create', undefined],
        ['adopt', true],
        ['adopt', false],
    ]);
    assert.equal(summary(plan), 'create 1, adopt 2 (1 differ)');
});

test('planTakToCalTopo - linked items update only when TAK changed, flagging CalTopo edits as conflicts', () => {
    const same = tak('t-1', 'CP 1');
    const moved = tak('t-2', 'CP 2');
    const both = tak('t-3', 'CP 3');
    const objects = [caltopo('c-1', 'CP 1'), caltopo('c-2', 'CP 2'), caltopo('c-3', 'CP 3')];
    const links = [link(same, objects[0]), link(moved, objects[1]), link(both, objects[2])];

    const plan = planTakToCalTopo(
        [same, { ...moved, geometry: { type: 'Point', coordinates: [-111.7, 35.2] } }, { ...both, properties: { ...both.properties, callsign: 'CP 3 (TAK)' } }],
        [objects[0], objects[1], { ...objects[2], properties: { ...objects[2].properties, title: 'CP 3 (CalTopo)' } }],
        { links }
    );

    assert.deepEqual(plan.actions.map((a) => a.op === 'update' ? [a.caltopo, a.conflict] : a.op), [
        ['c-2', false],
        ['c-3', true],
    ]);
});

test('planTakToCalTopo - items removed from the Mission are deleted from CalTopo', () => {
    const kept = tak('t-1', 'CP 1');
    const removed = tak('t-2', 'CP 2');
    const objects = [caltopo('c-1', 'CP 1'), caltopo('c-2', 'CP 2')];

    const plan = planTakToCalTopo([kept], objects, { links: [link(kept, objects[0]), link(removed, objects[1])] });

    assert.deepEqual(plan.actions, [{ op: 'delete', tak: 't-2', caltopo: 'c-2', title: 'CP 2' }]);
    assert.deepEqual(plan.warnings, []);
});

test('planTakToCalTopo - an empty Mission never deletes, deletions in CalTopo are left alone', () => {
    const t = tak('t-1', 'CP 1');
    const c = caltopo('c-1', 'CP 1');

    const empty = planTakToCalTopo([], [c], { links: [link(t, c)] });
    assert.deepEqual(empty.actions, []);
    assert.match(empty.warnings[0], /Mission returned no items while 1 are linked - not deleting 1/);

    const gone = planTakToCalTopo([t], [], { links: [link(t, c)] });
    assert.deepEqual(gone.actions, [{ op: 'skip', id: 't-1', title: 'CP 1', reason: 'deleted in CalTopo' }]);
});

test('planTakToCalTopo - TAK client positions & unsupported geometry are skipped', () => {
    const plan = planTakToCalTopo([
        tak('ANDROID-1', 'CCSO-SAR 1'),
        tak('t-1', 'Unit', { props: { takv: { platform: 'ATAK' } } }),
        tak('t-2', 'Circle', { type: 'MultiPolygon', coordinates: [] }),
    ], [], { links: [] });

    assert.deepEqual(plan.actions.map((a) => a.op === 'skip' && a.reason), [
        'TAK client position',
        'TAK client position',
        'MultiPolygon geometry',
    ]);
});

test('toCalTopo - Points become Markers, lines & polygons Shapes with their styling', () => {
    assert.deepEqual(toCalTopo(tak('p', 'LZ', { remarks: 'Helispot', props: { 'marker-color': '#00FF00' } })), {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-111.65, 35.19] },
        properties: { class: 'Marker', title: 'LZ', description: 'Helispot', 'marker-color': '00FF00' },
    });

    const polygon = toCalTopo(tak('s', 'Segment A', {
        type: 'Polygon',
        coordinates: [[[-111.6, 35.1], [-111.7, 35.1], [-111.7, 35.2], [-111.6, 35.1]]],
        props: { stroke: '#FF0000', 'stroke-width': 3, 'stroke-opacity': 1, fill: '#FF0000', 'fill-opacity': 0.1 },
    }));
    assert.deepEqual(polygon.properties, {
        class: 'Shape', title: 'Segment A', description: '',
        stroke: '#FF0000', 'stroke-width': 3, 'stroke-opacity': 1, fill: '#FF0000', 'fill-opacity': 0.1,
    });
});
