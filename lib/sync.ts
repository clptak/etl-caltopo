import { createHash } from 'node:crypto';
import type { Static } from '@sinclair/typebox';
import type { TeamMapFeature } from './caltopo.js';
import type { MissionFeature } from './mission.js';
import { ICONS } from './style.js';
import type { IconIndex } from './style.js';

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

/** The content compared across both sides - geometry, title, description, folder & styling */
export type Canonical = {
    geometry: { type: string; coordinates: unknown };
    title: string;
    description: string;
    folder: string;
    style: Record<string, unknown>;
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

/**
 * takHash / caltopoHash are each side's content hash once the action is applied, so the
 * links saved afterwards record what was synced. from is the class the CalTopo object has
 * now, as changing an object's class means deleting it under the old one
 */
export type Action =
    | { op: 'create'; tak: string; title: string; takHash: string; caltopo: CalTopoWrite }
    | { op: 'update'; tak: string; caltopo: string; title: string; takHash: string; from: string; conflict: boolean; write: CalTopoWrite }
    | { op: 'adopt'; tak: string; caltopo: string; title: string; takHash: string; caltopoHash: string; same: boolean }
    | { op: 'delete'; tak: string; caltopo: string; title: string; class: string }
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

/**
 * CalTopo line patterns - SVG path, spacing & fill flag - read from lines styled in the CalTopo
 * UI. TAK dotted rings use the short tick pattern the team picked on the 75% ring rather than
 * CalTopo's round dots, so dashed and dotted currently look the same. A solid line has no
 * pattern; TAK's outlined style has no CalTopo equivalent
 */
export const PATTERNS: Record<string, string> = {
    dashed: 'M0 -1 L0 1,,8,F',
    dotted: 'M0 -1 L0 1,,8,F',
};

/**
 * The geometry a TAK item is written to CalTopo with - a Polygon without a visible fill (ie:
 * a probability ring) becomes its closed outer ring as a LineString, as CalTopo colours a
 * pattern's dots with the fill and a transparent fill hides them
 */
export function calTopoGeometry(feature: MissionFeature): { type: string; coordinates: unknown } {
    const { type, coordinates } = feature.geometry;
    const opacity = feature.properties['fill-opacity'];
    const filled = typeof feature.properties.fill === 'string' && (typeof opacity !== 'number' || opacity > 0);

    if (type === 'Polygon' && !filled && Array.isArray(coordinates) && Array.isArray(coordinates[0])) {
        return { type: 'LineString', coordinates: round(coordinates[0]) };
    }

    return { type, coordinates: round(coordinates) };
}

/**
 * The CalTopo styling of a TAK item - the marker symbol & colour of a Point, the line of a
 * LineString and the line & fill of a filled Polygon. Keys are CalTopo's, in a fixed order so the
 * same style always hashes the same
 */
export function calTopoStyle(feature: MissionFeature, icons: IconIndex = ICONS): Record<string, unknown> {
    const props = feature.properties;
    const style: Record<string, unknown> = {};

    const hex = (value: unknown) => typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value) ? value.replace(/^#?/, '#').toUpperCase() : undefined;
    const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

    const geometry = calTopoGeometry(feature);

    if (geometry.type === 'Point') {
        style['marker-symbol'] = icons.symbol(props.icon, props.type);
        // CalTopo marker colours carry no #
        style['marker-color'] = hex(props['marker-color'])?.slice(1);
    } else {
        style.stroke = hex(props.stroke);
        style['stroke-width'] = number(props['stroke-width']);
        style['stroke-opacity'] = number(props['stroke-opacity']);
        style.pattern = typeof props['stroke-style'] === 'string' ? PATTERNS[props['stroke-style']] : undefined;

        if (geometry.type === 'Polygon') {
            style.fill = hex(props.fill);
            style['fill-opacity'] = number(props['fill-opacity']);
        } else if (props['stroke-style'] === 'dotted') {
            // The fill of a CalTopo line colours its dots, so it must be opaque
            style.fill = style.stroke;
            style['fill-opacity'] = 1;
        }
    }

    for (const key of Object.keys(style)) if (style[key] === undefined) delete style[key];
    return style;
}

/** TAK clients send the remark "None" for an item without remarks */
function remarks(value: unknown): string {
    const remark = text(value);
    return remark === 'None' ? '' : remark;
}

export function canonicalTak(feature: MissionFeature, folder?: string): Canonical {
    return {
        geometry: calTopoGeometry(feature),
        title: text(feature.properties.callsign),
        description: remarks(feature.properties.remarks),
        folder: isAssignment(feature, folder) ? ASSIGNMENTS : calTopoFolder(feature, folder),
        style: calTopoStyle(feature),
    };
}

/** folderTitles maps CalTopo Folder IDs to their titles */
export function canonicalCalTopo(feature: CalTopoFeature, folderTitles: Map<string, string> = new Map()): Canonical {
    const props = feature.properties as Record<string, unknown>;
    const assignment = props.class === 'Assignment';

    // The same keys calTopoStyle() writes for this geometry, read back from the object
    const keys = feature.geometry?.type === 'Point' ? ['marker-symbol', 'marker-color']
        : feature.geometry?.type === 'Polygon' ? ['stroke', 'stroke-width', 'stroke-opacity', 'pattern', 'fill', 'fill-opacity']
            : ['stroke', 'stroke-width', 'stroke-opacity', 'pattern', 'fill', 'fill-opacity'];
    const style: Record<string, unknown> = {};
    for (const key of keys) {
        const value = typeof props[key] === 'string' && ['stroke', 'fill'].includes(key) ? String(props[key]).toUpperCase() : props[key];
        if (value !== undefined && value !== null) style[key] = value;
    }

    return {
        geometry: { type: feature.geometry?.type, coordinates: round(feature.geometry?.coordinates) },
        title: assignment ? text(props.number) || text(props.title) : text(props.title),
        description: remarks(props.description),
        folder: assignment ? ASSIGNMENTS : folderTitles.get(String(props.folderId ?? '')) ?? '',
        style,
    };
}

export function hash(canonical: Canonical): string {
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * A TAK item as a CalTopo Marker, Shape or Assignment with its symbol & styling. An
 * Assignment is numbered after its callsign and starts as a DRAFT
 */
export function toCalTopo(feature: MissionFeature, folder?: string): CalTopoWrite {
    const canonical = canonicalTak(feature, folder);

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

    Object.assign(properties, canonical.style);

    // CalTopo merges an edit into the object, so a pattern or fill the item no longer has is
    // cleared explicitly rather than left behind
    if (canonical.geometry.type !== 'Point') {
        for (const key of ['pattern', 'fill', 'fill-opacity']) {
            if (!(key in properties)) properties[key] = null;
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
 *   as a conflict when the CalTopo object changed too - unless they came from CalTopo, which owns them
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

        // Only an object the sync writes needs its CalTopo Folder - an adopted one already has one
        const writes = link ? link.origin === 'tak' : !objects.has(feature.id);
        if (writes && canonical.folder && canonical.folder !== ASSIGNMENTS && !existingFolders.has(canonical.folder.toLowerCase())) {
            newFolders.add(canonical.folder);
        }

        if (writes && isAssignments(folder) && feature.geometry.type === 'Point') {
            warnings.push(`${canonical.title || feature.id} is a Point in the ${ASSIGNMENTS} folder - CalTopo Assignments are lines or polygons, so it becomes a top level Marker`);
        }

        if (link) {
            const object = objects.get(link.caltopo);
            if (!object) {
                actions.push({ op: 'skip', id: feature.id, title: canonical.title, reason: 'deleted in CalTopo' });
                continue;
            }

            if (hash(canonical) === link.takHash) continue;

            // CalTopo owns what came from CalTopo - the CalTopo → TAK half overwrites it in TAK
            if (link.origin === 'caltopo') {
                actions.push({ op: 'skip', id: feature.id, title: canonical.title, reason: 'came from CalTopo - edit it there' });
                continue;
            }

            actions.push({
                op: 'update',
                tak: feature.id,
                caltopo: link.caltopo,
                title: canonical.title,
                takHash: hash(canonical),
                from: String(object.properties.class ?? ''),
                conflict: hash(canonicalCalTopo(object, folderTitles)) !== link.caltopoHash,
                write: toCalTopo(feature, folder),
            });
        } else if (objects.has(feature.id)) {
            const caltopoHash = hash(canonicalCalTopo(objects.get(feature.id)!, folderTitles));

            actions.push({
                op: 'adopt',
                tak: feature.id,
                caltopo: feature.id,
                title: canonical.title,
                takHash: hash(canonical),
                caltopoHash,
                same: hash(canonical) === caltopoHash,
            });
        } else {
            actions.push({ op: 'create', tak: feature.id, title: canonical.title, takHash: hash(canonical), caltopo: toCalTopo(feature, folder) });
        }
    }

    // Folders first, as the objects created in them need their IDs
    actions.unshift(...[...newFolders].map((title): Action => ({ op: 'folder', title })));

    // Only objects the sync created are deleted - an adopted object came from CalTopo, and
    // leaving the Mission (ie: mid Data Sync) is no reason to remove it from CalTopo
    const present = new Set(tak.map((f) => f.id));
    const removed = state.links.filter((l) => l.origin === 'tak' && !present.has(l.tak) && objects.has(l.caltopo));

    if (removed.length && !synced.length) {
        warnings.push(`Mission returned no items while ${state.links.length} are linked - not deleting ${removed.length} CalTopo objects`);
    } else {
        for (const link of removed) {
            actions.push({
                op: 'delete',
                tak: link.tak,
                caltopo: link.caltopo,
                title: text(objects.get(link.caltopo)!.properties.title),
                class: String(objects.get(link.caltopo)!.properties.class ?? ''),
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

/**
 * The links once a plan is applied - applied holds the actions that succeeded, so a failed
 * write keeps its old link (or none) and is retried next run. Links of adopted objects whose
 * item left the Mission are dropped, as those objects are never deleted
 */
export function nextLinks(state: SyncState, tak: MissionFeature[], applied: Action[]): Link[] {
    const links = new Map(state.links.map((l) => [l.tak, l]));

    for (const action of applied) {
        if (action.op === 'create') {
            links.set(action.tak, { tak: action.tak, caltopo: action.tak, origin: 'tak', takHash: action.takHash, caltopoHash: action.takHash });
        } else if (action.op === 'update') {
            const link = links.get(action.tak)!;
            links.set(action.tak, { ...link, takHash: action.takHash, caltopoHash: action.takHash });
        } else if (action.op === 'adopt') {
            links.set(action.tak, { tak: action.tak, caltopo: action.caltopo, origin: 'caltopo', takHash: action.takHash, caltopoHash: action.caltopoHash });
        } else if (action.op === 'delete') {
            links.delete(action.tak);
        }
    }

    const present = new Set(tak.map((f) => f.id));
    return [...links.values()].filter((l) => l.origin === 'tak' || present.has(l.tak));
}

/**
 * The CalTopo objects the CalTopo → TAK half sends to the Mission - everything but Folders,
 * objects without geometry, App Tracks (sent as live positions instead, see lib/apptracks.ts)
 * and the objects this sync created from TAK, which TAK owns and would otherwise echo back
 */
export function calTopoToTak(caltopo: CalTopoFeature[], links: Link[]): CalTopoFeature[] {
    const fromTak = new Set(links.filter((l) => l.origin === 'tak').map((l) => l.caltopo));

    return caltopo.filter((f) => !fromTak.has(f.id) && !['Folder', 'AppTrack'].includes(String(f.properties.class)) && f.geometry);
}
