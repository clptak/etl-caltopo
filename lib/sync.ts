import { createHash } from 'node:crypto';
import type { Static } from '@sinclair/typebox';
import type { TeamMapFeature } from './caltopo.js';
import type { MissionFeature } from './mission.js';

type CalTopoFeature = Static<typeof TeamMapFeature>;

const GEOMETRIES = ['Point', 'LineString', 'Polygon'];

/**
 * A TAK item and the CalTopo object it is synced with - the hashes are of each side's
 * content when the pair was last synced, so a later hash that differs means that side changed
 */
export type Link = {
    tak: string;
    caltopo: string;
    origin: 'tak' | 'caltopo';
    takHash: string;
    caltopoHash: string;
};

export type SyncState = {
    links: Link[];
};

/** The content compared across both sides - geometry, title & description */
export type Canonical = {
    geometry: { type: string; coordinates: unknown };
    title: string;
    description: string;
};

/** A CalTopo object as the sync would write it */
export type CalTopoWrite = {
    type: 'Feature';
    geometry: { type: string; coordinates: unknown };
    properties: Record<string, unknown>;
};

export type Action =
    | { op: 'create'; tak: string; title: string; caltopo: CalTopoWrite }
    | { op: 'update'; tak: string; caltopo: string; title: string; conflict: boolean; write: CalTopoWrite }
    | { op: 'adopt'; tak: string; caltopo: string; title: string; same: boolean }
    | { op: 'delete'; tak: string; caltopo: string; title: string }
    | { op: 'skip'; id: string; title: string; reason: string };

export type Plan = {
    actions: Action[];
    warnings: string[];
};

/** Drop altitude & round to ~10cm so both sides compare equal after a round trip */
function round(coordinates: unknown): unknown {
    if (typeof coordinates === 'number') return Math.round(coordinates * 1e6) / 1e6;
    if (!Array.isArray(coordinates)) return coordinates;

    if (coordinates.length && typeof coordinates[0] === 'number') {
        return coordinates.slice(0, 2).map(round);
    }

    return coordinates.map(round);
}

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function canonicalTak(feature: MissionFeature): Canonical {
    return {
        geometry: { type: feature.geometry.type, coordinates: round(feature.geometry.coordinates) },
        title: text(feature.properties.callsign),
        description: text(feature.properties.remarks),
    };
}

export function canonicalCalTopo(feature: CalTopoFeature): Canonical {
    return {
        geometry: { type: feature.geometry?.type, coordinates: round(feature.geometry?.coordinates) },
        title: text(feature.properties.title),
        description: text(feature.properties.description),
    };
}

export function hash(canonical: Canonical): string {
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * A TAK item as a CalTopo Marker or Shape - icon translation is not done yet, so Markers
 * keep CalTopo's default symbol
 */
export function toCalTopo(feature: MissionFeature): CalTopoWrite {
    const canonical = canonicalTak(feature);
    const props = feature.properties;
    const color = (value: unknown) => typeof value === 'string' ? value.replace(/^#/, '') : undefined;

    const properties: Record<string, unknown> = {
        class: canonical.geometry.type === 'Point' ? 'Marker' : 'Shape',
        title: canonical.title,
        description: canonical.description,
    };

    if (canonical.geometry.type === 'Point') {
        if (color(props['marker-color'])) properties['marker-color'] = color(props['marker-color']);
    } else {
        if (color(props.stroke)) properties.stroke = `#${color(props.stroke)}`;
        if (typeof props['stroke-width'] === 'number') properties['stroke-width'] = props['stroke-width'];
        if (typeof props['stroke-opacity'] === 'number') properties['stroke-opacity'] = props['stroke-opacity'];
        if (canonical.geometry.type === 'Polygon') {
            if (color(props.fill)) properties.fill = `#${color(props.fill)}`;
            if (typeof props['fill-opacity'] === 'number') properties['fill-opacity'] = props['fill-opacity'];
        }
    }

    return { type: 'Feature', geometry: canonical.geometry, properties };
}

/** Why a Mission item is never synced to CalTopo, or undefined if it is */
export function unsupported(feature: MissionFeature): string | undefined {
    const props = feature.properties;

    if (feature.id.startsWith('ANDROID-') || props.takv || props.group) return 'TAK client position';
    if (!GEOMETRIES.includes(feature.geometry.type)) return `${feature.geometry.type} geometry`;

    return undefined;
}

/**
 * Plan the TAK → CalTopo half of a Map/Mission pair
 *
 * - linked items whose TAK content changed since the last sync are updated in CalTopo, flagged
 *   as a conflict when the CalTopo object changed too
 * - unlinked items sharing their ID with a CalTopo object (created from CalTopo, ie: by the
 *   Node-RED sync or CloudTAK's Data Sync) are adopted rather than created a second time
 * - other unlinked items are created
 * - linked items removed from the Mission are deleted from CalTopo, unless the Mission came
 *   back empty, which is more likely a failed read than a cleared Mission
 *
 * Items deleted in CalTopo but still in the Mission are left to the CalTopo → TAK half
 */
export function planTakToCalTopo(tak: MissionFeature[], caltopo: CalTopoFeature[], state: SyncState): Plan {
    const actions: Action[] = [];
    const warnings: string[] = [];

    const objects = new Map(caltopo.map((f) => [f.id, f]));
    const links = new Map(state.links.map((l) => [l.tak, l]));

    const synced: MissionFeature[] = [];
    for (const feature of tak) {
        const reason = unsupported(feature);
        if (reason) {
            actions.push({ op: 'skip', id: feature.id, title: text(feature.properties.callsign), reason });
        } else {
            synced.push(feature);
        }
    }

    for (const feature of synced) {
        const canonical = canonicalTak(feature);
        const link = links.get(feature.id);

        if (link) {
            const object = objects.get(link.caltopo);
            if (!object) {
                actions.push({ op: 'skip', id: feature.id, title: canonical.title, reason: 'deleted in CalTopo' });
                continue;
            }

            if (hash(canonical) === link.takHash) continue;

            actions.push({
                op: 'update',
                tak: feature.id,
                caltopo: link.caltopo,
                title: canonical.title,
                conflict: hash(canonicalCalTopo(object)) !== link.caltopoHash,
                write: toCalTopo(feature),
            });
        } else if (objects.has(feature.id)) {
            actions.push({
                op: 'adopt',
                tak: feature.id,
                caltopo: feature.id,
                title: canonical.title,
                same: hash(canonical) === hash(canonicalCalTopo(objects.get(feature.id)!)),
            });
        } else {
            actions.push({ op: 'create', tak: feature.id, title: canonical.title, caltopo: toCalTopo(feature) });
        }
    }

    const present = new Set(tak.map((f) => f.id));
    const removed = state.links.filter((l) => !present.has(l.tak) && objects.has(l.caltopo));

    if (removed.length && !synced.length) {
        warnings.push(`Mission returned no items while ${state.links.length} are linked - not deleting ${removed.length} CalTopo objects`);
    } else {
        for (const link of removed) {
            actions.push({
                op: 'delete',
                tak: link.tak,
                caltopo: link.caltopo,
                title: text(objects.get(link.caltopo)!.properties.title),
            });
        }
    }

    return { actions, warnings };
}

/** One line per action count, ie: "create 3, adopt 2 (1 differ), skip 1" */
export function summary(plan: Plan): string {
    const counts = new Map<string, number>();
    for (const action of plan.actions) counts.set(action.op, (counts.get(action.op) ?? 0) + 1);

    const differ = plan.actions.filter((a) => a.op === 'adopt' && !a.same).length;
    const conflicts = plan.actions.filter((a) => a.op === 'update' && a.conflict).length;

    const parts = ['create', 'update', 'adopt', 'delete', 'skip'].filter((op) => counts.get(op)).map((op) => {
        let part = `${op} ${counts.get(op)}`;
        if (op === 'adopt' && differ) part += ` (${differ} differ)`;
        if (op === 'update' && conflicts) part += ` (${conflicts} conflict)`;
        return part;
    });

    return parts.length ? parts.join(', ') : 'no changes';
}
