import test from 'node:test';
import assert from 'node:assert';
import { planTakToCalTopo, canonicalTak, canonicalCalTopo, hash, toCalTopo, summary, describe, nextLinks } from '../lib/sync.js';
import { folderNames } from '../lib/mission.js';
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

    assert.deepEqual(plan.actions, [{ op: 'delete', tak: 't-2', caltopo: 'c-2', title: 'CP 2', class: 'Marker' }]);
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

test('folderNames - items map to their innermost Mission folder', () => {
    const folders = folderNames([
        { name: 'Segments', uids: [{ data: 's-1' }], mission_layers: [{ name: 'Night', uids: [{ data: 's-2' }] }] },
        { name: 'Assignments', uids: [{ data: 'a-1' }] },
    ]);

    assert.deepEqual([...folders], [['s-1', 'Segments'], ['s-2', 'Night'], ['a-1', 'Assignments']]);
});

test('planTakToCalTopo - TAK folders become CalTopo Folders, Assignments become the Assignment class', () => {
    const line = tak('a-1', 'ASSIGNMENT 01', { type: 'LineString', coordinates: [[-111.6, 35.1], [-111.7, 35.2]], props: { stroke: '#FF0000' } });
    const ipp = tak('a-2', 'IPP');
    const segment = tak('s-1', '01', { type: 'Polygon', coordinates: [[[-111.6, 35.1], [-111.7, 35.1], [-111.7, 35.2], [-111.6, 35.1]]] });
    const ring = tak('r-1', '50% Search-Hiker AZ', { type: 'Polygon', coordinates: [[[-111.6, 35.1], [-111.7, 35.1], [-111.7, 35.2], [-111.6, 35.1]]] });

    const folders = new Map([['a-1', 'Assignments'], ['a-2', 'Assignments'], ['s-1', 'Segments'], ['r-1', 'LPB Search-Hiker - AZ']]);
    // The Map already has a "segments" Folder, matched regardless of case
    const map = [{ id: 'f-1', properties: { class: 'Folder', title: 'segments' } }];

    const plan = planTakToCalTopo([line, ipp, segment, ring], map, { links: [] }, folders);

    assert.deepEqual(plan.actions.map(describe), [
        'folder - LPB Search-Hiker - AZ',
        'create - ASSIGNMENT 01 (a-1) as Assignment',
        'create - IPP (a-2) as Marker',
        'create - 01 (s-1) as Shape in Segments',
        'create - 50% Search-Hiker AZ (r-1) as Shape in LPB Search-Hiker - AZ',
    ]);
    assert.deepEqual(plan.warnings, ['IPP is a Point in the Assignments folder - CalTopo Assignments are lines or polygons, so it becomes a top level Marker']);

    const assignment = plan.actions[1];
    assert.ok(assignment.op === 'create');
    assert.deepEqual(assignment.caltopo.properties, { class: 'Assignment', number: 'ASSIGNMENT 01', status: 'DRAFT', description: '', stroke: '#FF0000' });
    assert.equal(assignment.caltopo.folder, undefined);
});

test('planTakToCalTopo - a TAK item moved to another folder is an update', () => {
    const segment = tak('s-1', '01');
    const object = { id: 'c-1', properties: { class: 'Marker', title: '01', description: '', folderId: 'f-1' }, geometry: { type: 'Point', coordinates: [-111.65, 35.19] } };
    const folderObject = { id: 'f-1', properties: { class: 'Folder', title: 'Segments' } };
    const titles = new Map([['f-1', 'Segments']]);

    const linked = { tak: 's-1', caltopo: 'c-1', origin: 'tak' as const, takHash: hash(canonicalTak(segment, 'Segments')), caltopoHash: hash(canonicalCalTopo(object, titles)) };

    assert.deepEqual(planTakToCalTopo([segment], [object, folderObject], { links: [linked] }, new Map([['s-1', 'Segments']])).actions, []);

    const moved = planTakToCalTopo([segment], [object, folderObject], { links: [linked] }, new Map([['s-1', 'Search Area']]));
    assert.deepEqual(moved.actions.map(describe), ['folder - Search Area', 'update - 01 (s-1) as Marker in Search Area']);
});

test('planTakToCalTopo - adopted objects are never deleted from CalTopo', () => {
    const t = tak('ct-1', 'From CalTopo');
    const c = caltopo('ct-1', 'From CalTopo');

    const plan = planTakToCalTopo([tak('other', 'Other')], [c], { links: [link(t, c, 'caltopo')] });
    assert.deepEqual(plan.actions.map((a) => a.op), ['create']);
});

test('nextLinks - applied actions become links, failed ones are retried next run', () => {
    const kept = tak('t-1', 'CP 1');
    const c = caltopo('c-1', 'CP 1');
    const state = { links: [link(kept, c), link(tak('gone', 'Gone'), caltopo('c-9', 'Gone'), 'caltopo')] };

    const plan = planTakToCalTopo(
        [{ ...kept, properties: { ...kept.properties, callsign: 'CP 1 moved' } }, tak('new-1', 'New'), tak('new-2', 'Failed'), tak('ct-1', 'Adopted')],
        [c, caltopo('ct-1', 'Adopted')],
        state
    );
    // new-2 failed to write
    const applied = plan.actions.filter((a) => !(a.op === 'create' && a.tak === 'new-2'));

    const links = nextLinks(state, [kept, tak('new-1', 'New'), tak('new-2', 'Failed'), tak('ct-1', 'Adopted')], applied);

    assert.deepEqual(links.map((l) => [l.tak, l.caltopo, l.origin]), [
        ['t-1', 'c-1', 'tak'],
        ['new-1', 'new-1', 'tak'],
        ['ct-1', 'ct-1', 'caltopo'],
    ]);
    assert.notEqual(links[0].takHash, state.links[0].takHash);
    assert.equal(links[1].takHash, links[1].caltopoHash);
});
