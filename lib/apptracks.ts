import { Type, Static } from '@sinclair/typebox';
import type { TeamMapFeature } from './caltopo.js';

type CalTopoFeature = Static<typeof TeamMapFeature>;

/**
 * CalTopo App Tracks (people recording in the CalTopo app) sent to TAK as live positions,
 * ported from the cloudtak-plugin-caltopo-sync PLI share service
 */
export const AppTrackConfig = Type.Object({
    MaxAge: Type.Integer({
        default: 600,
        minimum: 30,
        description: 'Seconds since a track\'s last point after which it is no longer sent - a stopped recording stays on the CalTopo Map',
    }),
    GroupName: Type.String({
        default: 'White',
        description: 'TAK team colour of a track no CallsignLookup entry matches',
    }),
    Role: Type.String({
        default: 'Team Member',
        description: 'TAK role of a track no CallsignLookup entry matches',
    }),
    CallsignLookup: Type.Array(Type.Object({
        Text: Type.String({ description: 'Matched case-insensitively in the track title and removed from the callsign' }),
        UidPrefix: Type.String({ default: '', description: 'Prefixed to the callsign' }),
        GroupName: Type.String({ description: 'TAK team colour' }),
        Role: Type.String({ default: 'Team Member', description: 'TAK role' }),
    }), {
        default: [],
        description: 'Checked in order - the first entry whose Text is in the track title sets its team colour, role and callsign prefix',
    }),
    NameFilter: Type.Array(Type.String(), {
        default: [],
        description: 'Only send tracks whose title contains one of these values (case-insensitive) - leave empty to send every track',
    }),
}, {
    description: 'Send CalTopo App Tracks to the Connection as live TAK positions - skipped for a callsign a TAK client reported within MaxAge',
});

export type AppTrackConfig = Static<typeof AppTrackConfig>;

/** How long a TAK position lives - the Sync runs every minute, so this outlives one missed run */
export const PLI_STALE = 2 * 60 * 1000;

/** Callsigns of TAK clients seen by the PLI forwarding, with when they were last recorded */
export type SeenCallsigns = Record<string, number>;

/** Re-record a callsign at most this often, as each record is a write to the Layer */
export const SEEN_REFRESH = 5 * 60 * 1000;

/**
 * The seen callsigns with this one recorded, or undefined when it was recorded recently enough
 * that no write is needed. Records older than an hour are dropped
 */
export function recordSeen(seen: SeenCallsigns, callsign: string, now = Date.now()): SeenCallsigns | undefined {
    const key = callsign.trim().toLowerCase();
    if (!key) return undefined;
    if (seen[key] && now - seen[key] < SEEN_REFRESH) return undefined;

    const next: SeenCallsigns = {};
    for (const [k, at] of Object.entries(seen)) if (now - at < 60 * 60 * 1000) next[k] = at;
    next[key] = now;
    return next;
}

/** The newest point of a track - CalTopo App Track points are [lng, lat, alt, epoch ms] */
export function latestPoint(track: CalTopoFeature): { coordinates: number[]; time?: number } | undefined {
    const points = track.geometry?.type === 'LineString' && Array.isArray(track.geometry.coordinates)
        ? (track.geometry.coordinates as number[][]).filter((p) => Array.isArray(p) && p.length >= 2)
        : [];
    if (!points.length) return undefined;

    const timed = points.filter((p) => typeof p[3] === 'number');
    const latest = timed.length ? timed.reduce((a, b) => (b[3] > a[3] ? b : a)) : points[points.length - 1];

    return { coordinates: latest, time: typeof latest[3] === 'number' ? latest[3] : undefined };
}

export type AppTrackPosition = {
    id: string;
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: number[] };
    properties: Record<string, unknown>;
};

/**
 * A live TAK position for a CalTopo App Track, or why it is not sent. The uid comes from the
 * CalTopo object so a renamed track stays one TAK contact
 */
export function appTrackPosition(
    track: CalTopoFeature,
    config: AppTrackConfig,
    seen: SeenCallsigns = {},
    now = Date.now(),
): AppTrackPosition | { skip: string } {
    const title = String(track.properties.title ?? '').trim();
    if (!title) return { skip: 'no title' };

    const lower = title.toLowerCase();
    if (config.NameFilter.length && !config.NameFilter.some((v) => v.trim() && lower.includes(v.trim().toLowerCase()))) {
        return { skip: 'filtered out by NameFilter' };
    }

    const latest = latestPoint(track);
    if (!latest) return { skip: 'no points' };
    if (latest.time !== undefined && now - latest.time > config.MaxAge * 1000) {
        return { skip: `last point ${Math.round((now - latest.time) / 1000)}s old` };
    }

    // A 10 digit number in the title is a phone number, not part of the callsign
    const phone = title.match(/\d{10}/)?.[0];
    let callsign = title.replace(/\d{10}/g, '').replace(/\s+/g, ' ').trim();
    let group = config.GroupName;
    let role = config.Role;

    const entry = config.CallsignLookup.find((e) => e.Text && lower.includes(e.Text.toLowerCase()));
    if (entry) {
        group = entry.GroupName || group;
        role = entry.Role || role;
        const text = new RegExp(entry.Text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        callsign = `${entry.UidPrefix}${callsign.replace(text, '').replace(/\s+/g, ' ').trim()}`;
    }

    callsign = callsign.toUpperCase();

    // Someone running a TAK client under the track's title or callsign already shows as themselves
    const seenAt = Math.max(seen[lower] ?? 0, seen[callsign.toLowerCase()] ?? 0);
    if (seenAt && now - seenAt < config.MaxAge * 1000) return { skip: 'also reporting from a TAK client' };

    const time = new Date(latest.time ?? now).toISOString();

    return {
        id: `caltopo-apptrack-${track.id}`,
        type: 'Feature',
        geometry: { type: 'Point', coordinates: latest.coordinates.slice(0, 3) },
        properties: {
            type: 'a-f-G-U-C',
            how: 'm-g',
            callsign,
            time,
            start: time,
            stale: new Date(now + PLI_STALE).toISOString(),
            group: { name: group, role },
            contact: { callsign, ...(phone ? { phone } : {}) },
        },
    };
}
