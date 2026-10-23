import test from 'node:test';
import assert from 'node:assert';
import { IconIndex } from '../lib/style.js';
import icons from '../lib/icons.js';
import { planTakToCalTopo, canonicalTak, canonicalCalTopo, hash, toCalTopo, describe } from '../lib/sync.js';

const INDEX = new IconIndex([
    { iconLabel: 'helibase', cotType: 'a-f-G', iconName: 'Helibase.png', iconsetUid: 'wildfire', iconsetFolder: 'WildFire' },
    { iconLabel: 'cp', cotType: 'a-f-G', iconName: 'Incident Command Post.png', iconsetUid: 'wildfire', iconsetFolder: 'WildFire' },
    { iconLabel: 'custom-friendly', cotType: 'a-f-G', iconName: '', iconsetUid: '', iconsetFolder: '' },
    { iconLabel: 'point', cotType: 'u-d-p', iconName: '', iconsetUid: null, iconsetFolder: null },
]);

test('IconIndex - an iconset icon wins, in either TAK path form and any case', () => {
    assert.equal(INDEX.symbol('wildfire:WildFire/Helibase.png', 'a-f-G'), 'helibase');
    assert.equal(INDEX.symbol('wildfire/wildfire/helibase.png', 'a-f-G'), 'helibase');
    assert.equal(INDEX.symbol('wildfire:WildFire/Helibase', 'a-f-G'), 'helibase');
});

test('IconIndex - otherwise the CoT type, a direct mapping beating an iconset one', () => {
    assert.equal(INDEX.symbol(undefined, 'a-f-G'), 'custom-friendly');
    assert.equal(INDEX.symbol('wildfire:WildFire/Unknown.png', 'u-d-p'), 'point');
    assert.equal(INDEX.symbol(undefined, 'b-x-unmapped'), undefined);
});

test('IconIndex - the Node-RED icon-configs mappings load and map a friendly ground point', () => {
    const index = new IconIndex(icons);
    assert.match(index.symbol(undefined, 'a-f-G') ?? '', /^icon-/);
    assert.equal(index.symbol(undefined, 'u-d-p'), 'point');
});

test('toCalTopo - markers get a symbol, "None" remarks are dropped, shapes keep their line & fill', () => {
    const ipp = toCalTopo({ id: 'ipp', properties: { callsign: 'IPP', type: 'u-d-p', remarks: 'None' }, geometry: { type: 'Point', coordinates: [-111.6, 35.1, 2100] } });
    assert.deepEqual(ipp.properties, { class: 'Marker', title: 'IPP', description: '', 'marker-symbol': 'point' });

    const segment = toCalTopo({
        id: 's-1',
        properties: { callsign: '01', type: 'u-d-f', stroke: '#d63939', 'stroke-width': 3, 'stroke-opacity': 1, fill: '#d63939', 'fill-opacity': 0.5, 'stroke-style': 'solid' },
        geometry: { type: 'Polygon', coordinates: [[[-111.6, 35.1], [-111.7, 35.1], [-111.7, 35.2], [-111.6, 35.1]]] },
    });
    assert.deepEqual(segment.properties, {
        class: 'Shape', title: '01', description: '',
        stroke: '#D63939', 'stroke-width': 3, 'stroke-opacity': 1, fill: '#D63939', 'fill-opacity': 0.5, pattern: null,
    });
});

test('planTakToCalTopo - a style change in TAK is an update, CalTopo storing the same style is not', () => {
    const line = { id: 'l-1', properties: { callsign: 'Trail', type: 'u-d-f', stroke: '#FF0000', 'stroke-width': 3 }, geometry: { type: 'LineString', coordinates: [[-111.6, 35.1], [-111.7, 35.2]] } };
    // CalTopo hands colours back as sent, lower case in older objects
    const object = { id: 'l-1', properties: { class: 'Shape', title: 'Trail', description: '', stroke: '#ff0000', 'stroke-width': 3 }, geometry: line.geometry };

    assert.equal(hash(canonicalTak(line)), hash(canonicalCalTopo(object)));

    const link = { tak: 'l-1', caltopo: 'l-1', origin: 'tak' as const, takHash: hash(canonicalTak(line)), caltopoHash: hash(canonicalCalTopo(object)) };
    assert.deepEqual(planTakToCalTopo([line], [object], { links: [link] }).actions, []);

    const recoloured = { ...line, properties: { ...line.properties, stroke: '#0000FF' } };
    assert.deepEqual(planTakToCalTopo([recoloured], [object], { links: [link] }).actions.map(describe), ['update - Trail (l-1) as Shape']);
});

test('toCalTopo - TAK dashed & dotted lines get CalTopo patterns, a dotted line colours its dots', () => {
    const line = (style: string) => toCalTopo({
        id: 'l', properties: { callsign: 'Ring', type: 'u-d-f', stroke: '#FF0000', 'stroke-width': 2, 'stroke-opacity': 1, 'stroke-style': style },
        geometry: { type: 'LineString', coordinates: [[-111.6, 35.1], [-111.7, 35.2]] },
    }).properties;

    assert.equal(line('solid').pattern, undefined);
    assert.equal(line('outlined').pattern, undefined);
    assert.equal(line('dashed').pattern, 'M0 -1 L0 1,,8,F');
    assert.deepEqual([line('dotted').pattern, line('dotted').fill], ['M0 -1 L0 1,,8,F', '#FF0000']);
    assert.equal(line('dashed').fill, undefined);

});

test('toCalTopo - an unfilled polygon (ie: a probability ring) becomes a closed line so its dots stay visible', () => {
    const outline = [[-111.6, 35.1], [-111.7, 35.1], [-111.7, 35.2], [-111.6, 35.1]];

    const ring = toCalTopo({
        id: 'r', properties: { callsign: '50%', type: 'u-d-f', stroke: '#FF0000', 'stroke-width': 2, 'stroke-style': 'dotted', fill: '#FF0000', 'fill-opacity': 0 },
        geometry: { type: 'Polygon', coordinates: [outline] },
    });
    assert.deepEqual(ring.geometry, { type: 'LineString', coordinates: outline });
    assert.deepEqual(ring.properties, {
        class: 'Shape', title: '50%', description: '',
        stroke: '#FF0000', 'stroke-width': 2, pattern: 'M0 -1 L0 1,,8,F', fill: '#FF0000', 'fill-opacity': 1,
    });

    // Without a fill colour at all it is an outline too, while a visible fill keeps the polygon
    assert.equal(toCalTopo({ id: 'o', properties: { callsign: 'Area', stroke: '#FF0000' }, geometry: { type: 'Polygon', coordinates: [outline] } }).geometry.type, 'LineString');
    assert.equal(toCalTopo({ id: 'f', properties: { callsign: 'Seg', fill: '#FF0000', 'fill-opacity': 0.5 }, geometry: { type: 'Polygon', coordinates: [outline] } }).geometry.type, 'Polygon');
});

test('toCalTopo - a pattern or fill the TAK item dropped is cleared in CalTopo', () => {
    const line = toCalTopo({ id: 'l', properties: { callsign: 'Trail', stroke: '#FF0000', 'stroke-style': 'solid' }, geometry: { type: 'LineString', coordinates: [[-111.6, 35.1], [-111.7, 35.2]] } });
    assert.deepEqual([line.properties.pattern, line.properties.fill, line.properties['fill-opacity']], [null, null, null]);
});

test('IconIndex.tak - a CalTopo symbol becomes its iconset icon & CoT type, or only the CoT type', () => {
    assert.deepEqual(INDEX.tak('helibase'), { icon: 'wildfire/WildFire/Helibase.png', type: 'a-f-G' });
    assert.deepEqual(INDEX.tak('custom-friendly'), { type: 'a-f-G' });
    assert.deepEqual(INDEX.tak('point'), { type: 'u-d-p' });
    assert.equal(INDEX.tak('not-mapped'), undefined);
    assert.equal(INDEX.tak(undefined), undefined);

    // The first mapping using a symbol wins, as in Node-RED
    const index = new IconIndex([
        { iconLabel: 'cp', cotType: 'a-f-G', iconName: 'ICP.png', iconsetUid: 'first', iconsetFolder: 'A' },
        { iconLabel: 'cp', cotType: 'a-f-G', iconName: 'ICP.png', iconsetUid: 'second', iconsetFolder: 'B' },
    ]);
    assert.equal(index.tak('cp')?.icon, 'first/A/ICP.png');
});

test('IconIndex - an iconset symbol survives the round trip CalTopo → TAK → CalTopo', () => {
    const index = new IconIndex(icons);

    for (const symbol of ['cp', 'helibase', 'logs-staging']) {
        const tak = index.tak(symbol);
        assert.ok(tak?.icon, `${symbol} maps to an iconset icon`);
        assert.equal(index.symbol(tak.icon, tak.type), symbol);
    }
});
