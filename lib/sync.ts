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

/** The content compared across both sides - geometry, title, description & folder */
export type Canonical = {
    geometry: { type: string; coordinates: unknown };
    title: string;
    description: string;
    folder: string;
};

/**
 * A CalTopo object as the sync would write it - folder is the CalTopo Folder's title,
 * resolved to a folderId when written
 */
export type CalTopoWrite = {
    type: 'Feature';
    geometry: { type: string; coordinates: unknown };
    properties: Record<string, unknown>;
    folder?: string;
};

/** Items in a TAK Mission folder of this name become CalTopo Assignments instead of a Folder */
export const ASSIGNMENTS = 'Assignments';

export type Action =
    | { op: 'create'; tak: string; title: string; caltopo: CalTopoWrite }
    | { op: 'update'; tak: string; caltopo: string; title: string; conflict: boolean; write: CalTopoWrite }
    | { op: 'adopt'; tak: string; caltopo: string; title: string; same: boolean }
    | { op: 'delete'; tak: string; caltopo: string; title: string }
    | { op: 'folder'; title: string }
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

function isAssignments(folder: string | undefined): boolean {
    return !!folder && folder.trim().toLowerCase() === ASSIGNMENTS.toLowerCase();
}

/** Lines & polygons in the TAK Assignments folder become CalTopo Assignments */
export function isAssignment(feature: MissionFeature, folder: string | undefined): boolean {
    return isAssignments(folder) && feature.geometry.type !== 'Point';
}

/**
 * The CalTopo Folder a TAK item goes in - its TAK folder's name, except Assignments which
 * are a CalTopo class rather than a Folder. A Point in the Assignments folder can not be an
 * Assignment, so it stays at the top level of the Map
 */
export function calTopoFolder(feature: MissionFeature, folder: string | undefined): string {
    if (!folder || isAssignments(folder)) return '';
    return folder.trim();
}

export function canonicalTak(feature: MissionFeature, folder?: string): Canonical {
    return {
        geometry: { type: feature.geometry.type, coordinates: round(feature.geometry.coordinates) },
        title: text(feature.properties.callsign),
        description: text(feature.properties.remarks),
        folder: isAssignment(feature, folder) ? ASSIGNMENTS : calTopoFolder(feature, folder),
    };
}

/** folderTitles maps CalTopo Folder IDs to their titles */
export function canonicalCalTopo(feature: CalTopoFeature, folderTitles: Map<string, string> = new Map()): Canonical {
    const props = feature.properties as Record<string, unknown>;
    const assignment = props.class === 'Assignment';

    return {
        geometry: { type: feature.geometry?.type, coordinates: round(feature.geometry?.coordinates) },
        title: assignment ? text(props.number) || text(props.title) : text(props.title),
        description: text(props.description),
        folder: assignment ? ASSIGNMENTS : folderTitles.get(String(props.folderId ?? '')) ?? '',
    };
}

export function hash(canonical: Canonical): string {
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * A TAK item as a CalTopo Marker, Shape or Assignment - icon translation is not done yet,
 * so Markers keep CalTopo's default symbol. An Assignment is numbered after its callsign and
 * starts as a DRAFT
 */
export function toCalTopo(feature: MissionFeature, folder?: string): CalTopoWrite {
    const canonical = canonicalTak(feature, folder);
    const props = feature.properties;
    const color = (value: unknown) => typeof value === 'string' ? value.replace(/^#/, '') : undefined;

    const properties: Record<string, unknown> = isAssignment(feature, folder) ? {
        class: 'Assignment',
        number: canonical.title,
        status: 'DRAFT',
        description: canonical.description,
    } : {
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

    const write: CalTopoWrite = { type: 'Feature', geometry: canonical.geometry, properties };
    if (canonical.folder && canonical.folder !== ASSIGNMENTS) write.folder = canonical.folder;

    return write;
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
 * - CalTopo Folders named after the TAK folders are created when the Map does not have one
 *
 * Items deleted in CalTopo but still in the Mission are left to the CalTopo → TAK half
 *
 * folders maps TAK item UIDs to the name of the Mission folder they are in
 */
export function planTakToCalTopo(tak: MissionFeature[], caltopo: CalTopoFeature[], state: SyncState, folders: Map<string, string> = new Map()): Plan {
    const actions: Action[] = [];
    const warnings: string[] = [];

    const objects = new Map(caltopo.map((f) => [f.id, f]));
    const links = new Map(state.links.map((l) => [l.tak, l]));

    const folderTitles = new Map(caltopo
        .filter((f) => f.properties.class === 'Folder')
        .map((f) => [f.id, text(f.properties.title)]));
    const existingFolders = new Set([...folderTitles.values()].map((t) => t.toLowerCase()));
    const newFolders = new Set<string>();

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
        const folder = folders.get(feature.id);
        const canonical = canonicalTak(feature, folder);
        const link = links.get(feature.id);

        if (canonical.folder && canonical.folder !== ASSIGNMENTS && !existingFolders.has(canonical.folder.toLowerCase())) {
            newFolders.add(canonical.folder);
        }

        if (isAssignments(folder) && feature.geometry.type === 'Point') {
            warnings.push(`${canonical.title || feature.id} is a Point in the ${ASSIGNMENTS} folder - CalTopo Assignments are lines or polygons, so it becomes a top level Marker`);
        }

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
                conflict: hash(canonicalCalTopo(object, folderTitles)) !== link.caltopoHash,
                write: toCalTopo(feature, folder),
            });
        } else if (objects.has(feature.id)) {
            actions.push({
                op: 'adopt',
                tak: feature.id,
                caltopo: feature.id,
                title: canonical.title,
                same: hash(canonical) === hash(canonicalCalTopo(objects.get(feature.id)!, folderTitles)),
            });
        } else {
            actions.push({ op: 'create', tak: feature.id, title: canonical.title, caltopo: toCalTopo(feature, folder) });
        }
    }

    // Folders first, as the objects created in them need their IDs
    actions.unshift(...[...newFolders].map((title): Action => ({ op: 'folder', title })));

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

    const parts = ['folder', 'create', 'update', 'adopt', 'delete', 'skip'].filter((op) => counts.get(op)).map((op) => {
        let part = `${op} ${counts.get(op)}`;
        if (op === 'adopt' && differ) part += ` (${differ} differ)`;
        if (op === 'update' && conflicts) part += ` (${conflicts} conflict)`;
        return part;
    });

    return parts.length ? parts.join(', ') : 'no changes';
}

/** Where a written object goes, ie: "Shape in Segments" or "Assignment" */
function placement(write: CalTopoWrite): string {
    return `${write.properties.class}${write.folder ? ` in ${write.folder}` : ''}`;
}

/** One log line for an action */
export function describe(action: Action): string {
    switch (action.op) {
        case 'folder': return `folder - ${action.title}`;
        case 'create': return `create - ${action.title || '<untitled>'} (${action.tak}) as ${placement(action.caltopo)}`;
        case 'update': return `update - ${action.title || '<untitled>'} (${action.tak}) as ${placement(action.write)}${action.conflict ? ': conflict - also changed in CalTopo' : ''}`;
        case 'adopt': return `adopt - ${action.title || '<untitled>'} (${action.tak}): ${action.same ? 'same content' : 'content differs'}`;
        case 'delete': return `delete - ${action.title || '<untitled>'} (${action.tak})`;
        case 'skip': return `skip - ${action.title || '<untitled>'} (${action.id}): ${action.reason}`;
    }
}
