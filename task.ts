import { Type, TSchema, Static } from '@sinclair/typebox';
import type Lambda from 'aws-lambda';
import { Feature } from '@tak-ps/node-cot';
import type { Event, OutgoingFeatureMessage } from '@tak-ps/etl';
import ETL, { SchemaType, handler as internal, local, DataFlowType, InvocationType, OutgoingMessageType, OutgoingAction } from '@tak-ps/etl';
import { coordEach } from '@turf/meta';
import { randomUUID } from 'node:crypto';
import CalTopo, { Credentials, MapObject, MapFeature, LocationFeature, NewMap, MapMode, MapSharing, LOCATION_TTL } from './lib/caltopo.js';
import { PLIConfig, positionReport } from './lib/pli.js';
import { ProfileTokenReader } from './lib/mission.js';
import type { MissionReader } from './lib/mission.js';
import { planTakToCalTopo, summary, describe, nextLinks } from './lib/sync.js';
import type { SyncState, Plan, Action, CalTopoWrite } from './lib/sync.js';

const MapSource = Type.Object({
    Mode: Type.Literal('Map'),
    MapId: Type.String({
        description: 'CalTopo Map or Share ID',
    }),
}, { title: 'Single Map' });

const TeamSource = Type.Composite([
    Type.Object({
        Mode: Type.Literal('Team'),
        AccountId: Type.String({
            description: 'CalTopo Team Account ID',
        }),
    }),
    Credentials,
    Type.Object({
        SinceDelta: Type.Optional(Type.Integer({
            minimum: 1,
            description: 'Only request locations updated within the last N seconds, leave blank to request all locations',
        })),
    })
], {
    title: 'Team Account',
    description: 'Surfaces the live Shared Locations of devices reporting to the Team Account',
});

const SyncSource = Type.Composite([
    Type.Object({
        Mode: Type.Literal('Sync'),
    }),
    Credentials,
    Type.Object({
        MissionToken: Type.String({
            description: 'CloudTAK Profile API Token of a dedicated service account whose TAK certificate can read the Missions - CloudTAK Mission routes do not accept Layer tokens yet',
        }),
        Pairs: Type.Array(Type.Object({
            MapId: Type.String({ description: 'CalTopo Map ID - the Service Account needs at least READ permission on it' }),
            MissionGuid: Type.String({ description: 'TAK Mission GUID' }),
        }), {
            description: 'CalTopo Maps synced with TAK Missions',
        }),
        DryRun: Type.Boolean({
            default: true,
            description: 'Log what would change in CalTopo without writing',
        }),
    })
], {
    title: 'Mission Sync',
    description: 'Syncs TAK Mission items to CalTopo Maps - TAK folders become CalTopo Folders, the Assignments folder becomes CalTopo Assignments',
});

/** Ephemeral key holding the start time of a writing sync run, and how long it is honoured */
const SYNC_LOCK = 'sync:lock';
const SYNC_LOCK_TTL = 5 * 60 * 1000;

const Env = Type.Object({
    Source: Type.Union([MapSource, TeamSource, SyncSource]),
    'DEBUG': Type.Boolean({
        default: false,
        description: 'Print results in logs'
    })
});

// Layers created before Team Account support store the Share ID at the top level
const LegacyEnv = Type.Object({
    ShareId: Type.String(),
    'DEBUG': Type.Boolean({ default: false })
});

// The Team Account fields are only required by event:create, so a PLI only Layer can leave them blank
const OutgoingEnv = Type.Composite([
    Type.Partial(Type.Object({
        AccountId: Type.String({
            description: 'CalTopo Service Account ID the credentials belong to - required by event:create',
        }),
        TeamId: Type.String({
            description: 'CalTopo Team ID the Maps are created in - from the Team admin page URL https://caltopo.com/group/{TeamId}/admin/details - the Service Account must have at least Update permissions on the Team - required by event:create',
        }),
    })),
    Type.Partial(Credentials),
    Type.Object({
        // Declared with enum rather than Type.Enum so the Layer environment UI renders a select
        MapMode: Type.Unsafe<MapMode>(Type.String({
            enum: Object.values(MapMode),
            default: MapMode.SAR,
            description: 'Mode of created Maps - sar (Search & Rescue) or cal (Recreational)'
        })),
        MapSharing: Type.Unsafe<MapSharing>(Type.String({
            enum: Object.values(MapSharing),
            default: MapSharing.SECRET,
            description: 'Default sharing of created Maps - PRIVATE (creator only), SECRET (secret URL), URL (public URL) or PUBLIC'
        })),
        MapLayers: Type.Array(Type.Object({
            layer: Type.String({ description: 'CalTopo layer ID - ie: mbt (MapBuilder Topo), mbh (MapBuilder Hybrid) or imagery' })
        }), {
            default: [{ layer: 'mbt' }],
            description: 'Active base layers of created Maps'
        }),
        MarkerColor: Type.String({
            default: 'FF0000',
            description: 'Hex colour (without #) of the Marker placed at the CoreEvent location'
        }),
        PLI: Type.Optional(PLIConfig),
        'DEBUG': Type.Boolean({
            default: false,
            description: 'Print results in logs'
        })
    })
], {
    description: 'event:create - creates a CalTopo Map in the Team Account for every CoreEvent created, the Map ID is filed under the caltopo external ID of the Event, which requires the event:read & event:update permissions. feature:* - forwards TAK positions to CalTopo Trackable Devices when PLI is configured'
});

/** The CoreEvent external ID system the created Map ID is filed under */
export const EXTERNAL_SYSTEM = 'caltopo';

// Subset of CloudTAK's CoreEventResponse carried by event:<action> messages
export const CoreEvent = Type.Object({
    id: Type.String(),
    name: Type.String(),
    remarks: Type.Optional(Type.String()),
    location: Type.Optional(Type.String()),
    external_ids: Type.Optional(Type.Record(Type.String(), Type.String())),
    links: Type.Optional(Type.Array(Type.Object({
        name: Type.String(),
        url: Type.String()
    }))),
    geometry: Type.Object({
        type: Type.Literal('Point'),
        coordinates: Type.Array(Type.Number())
    })
});

export type CoreEvent = Static<typeof CoreEvent>;
export type OutgoingEnv = Static<typeof OutgoingEnv>;

export default class Task extends ETL {
    static name = 'etl-caltopo';
    static flow = [ DataFlowType.Incoming, DataFlowType.Outgoing ];
    static invocation = [ InvocationType.Schedule ];

    async schema(
        type: SchemaType = SchemaType.Input,
        flow: DataFlowType = DataFlowType.Incoming
    ): Promise<TSchema> {
        if (flow === DataFlowType.Incoming) {
            if (type === SchemaType.Input) {
                return Env;
            } else {
                return MapObject;
            }
        } else if (type === SchemaType.Input) {
            return OutgoingEnv;
        } else {
            return Type.Object({});
        }
    }

    /**
     * feature:* - a streamed TAK position is forwarded to the CalTopo Connect Key of the
     * first PLI rule its callsign matches
     *
     * event:create - a created CoreEvent becomes a new CalTopo Map in the Team Account
     * with a Marker at the Event location carrying its callsign, remarks & location
     *
     * The Map ID is filed under the caltopo external ID of the Event, so an Event that
     * already has one (ie: a redelivered message) never gets a second Map
     */
    async outgoing(event: Lambda.SQSEvent): Promise<boolean> {
        const env = await this.env(OutgoingEnv, DataFlowType.Outgoing);
        const caltopo = this.client(env.DEBUG);

        for (const message of Task.outgoingMessages(event)) {
            if (message.type === OutgoingMessageType.Feature) {
                await this.forwardPosition(caltopo, message, env);
                continue;
            } else if (message.type !== OutgoingMessageType.Event || message.action !== OutgoingAction.Create) {
                if (env.DEBUG) console.log(`ok - skip - ${message.type}:${'action' in message ? message.action : '*'} is not an event:create`);
                continue;
            }

            const team = Task.teamAccount(env);

            // The message is a snapshot from creation time - read the Event back so a redelivery sees the Map ID
            const core = await this.coreEvent(this.type(CoreEvent, message.data).id);

            const known = core.external_ids?.[EXTERNAL_SYSTEM];
            if (known) {
                console.log(`ok - skip - event ${core.id} already has map ${known}`);
                continue;
            }

            const map = this.mapFromEvent(core, env);
            if (env.DEBUG) console.log(`ok - creating map "${map.properties.title}" for event ${core.id}`);

            const id = await caltopo.createMap(team.TeamId, team, map);
            console.log(`ok - created map ${id} for event ${core.id}`);

            await this.record(core, id, caltopo.mapUrl(id), env.MapSharing);
        }

        return true;
    }

    /**
     * Forward a streamed TAK position to CalTopo. A failure is logged rather than thrown - a
     * retried position is already out of date and failures would only fill the dead letter queue
     */
    async forwardPosition(caltopo: CalTopo, message: Static<typeof OutgoingFeatureMessage>, env: OutgoingEnv): Promise<void> {
        if (!env.PLI) {
            if (env.DEBUG) console.log(`ok - skip - feature ${message.geojson.id} as PLI is not configured`);
            return;
        }

        const report = positionReport(message, env.PLI);
        if ('skip' in report) {
            if (env.DEBUG) console.log(`ok - skip - feature ${message.geojson.id} (${message.geojson.properties.callsign}, ${message.geojson.properties.type}): ${report.skip}`);
            return;
        }

        try {
            await caltopo.positionReport(report.rule.ConnectKey, report.id, report.lat, report.lng);
            if (env.DEBUG) console.log(`ok - forwarded ${report.id} to ${report.rule.Name}`);
        } catch (err) {
            console.error(`not ok - failed to forward ${report.id} to ${report.rule.Name}:`, err instanceof Error ? err.message : String(err));
        }
    }

    /** The Team Account settings event:create needs - optional in the schema for PLI only Layers */
    static teamAccount(env: OutgoingEnv): { TeamId: string, CredentialId: string, CredentialSecret: string } {
        const { AccountId, TeamId, CredentialId, CredentialSecret } = env;

        if (!AccountId || !TeamId || !CredentialId || !CredentialSecret) {
            throw new Error('event:create requires the AccountId, TeamId, CredentialId & CredentialSecret Outgoing settings');
        }

        return { TeamId, CredentialId, CredentialSecret };
    }

    /** The current state of a CoreEvent - the Layer needs the event:read permission */
    async coreEvent(id: string): Promise<CoreEvent> {
        try {
            return this.type(CoreEvent, await this.fetch(`/api/core/event/${id}`));
        } catch (err) {
            throw new Error(`Failed to read CoreEvent ${id} - the Layer requires the event:read permission: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
    }

    /**
     * Map titled after the CoreEvent callsign with a single Marker at its location
     */
    mapFromEvent(core: CoreEvent, env: OutgoingEnv): Static<typeof NewMap> {
        const description = [
            core.remarks,
            core.location ? `Location: ${core.location}` : ''
        ].filter(Boolean).join('\n\n');

        return {
            properties: {
                title: core.name,
                mode: env.MapMode,
                mapConfig: JSON.stringify({
                    activeLayers: env.MapLayers.map((l) => [l.layer, 1])
                }),
                sharing: env.MapSharing
            },
            state: {
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: core.geometry.coordinates.slice(0, 2)
                    },
                    properties: {
                        title: core.name,
                        description,
                        'marker-symbol': 'point',
                        'marker-color': env.MarkerColor.replace(/^#/, ''),
                        'marker-size': '1'
                    }
                }]
            }
        };
    }

    /**
     * File the Map ID under the caltopo external ID of the Event and, when the Map is
     * reachable by URL (any sharing but PRIVATE), add that URL to the Event links.
     * PATCH replaces the links array, so the current links are re-sent with the Map appended.
     * A failure is logged rather than thrown - a retry would create a second Map
     */
    async record(core: CoreEvent, id: string, url: string, sharing: MapSharing): Promise<void> {
        const body: Record<string, unknown> = {
            external_id: { system: EXTERNAL_SYSTEM, value: id }
        };

        const links = core.links || [];
        if (sharing !== MapSharing.PRIVATE && !links.some((l) => l.url === url)) {
            body.links = [...links, { name: 'CalTopo Map', url }];
        }

        try {
            await this.fetch(`/api/core/event/${core.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        } catch (err) {
            console.error(`not ok - failed to record map ${id} on CoreEvent ${core.id} - the Layer requires the event:update permission:`, err);
        }
    }

    async control(): Promise<void> {
        const raw = await this.env(Type.Union([Env, LegacyEnv]));

        const env: Static<typeof Env> = 'ShareId' in raw
            ? { Source: { Mode: 'Map', MapId: raw.ShareId }, DEBUG: raw.DEBUG }
            : raw;

        const caltopo = this.client(env.DEBUG);

        if (env.Source.Mode === 'Sync') {
            await this.sync(caltopo, env.Source, env.DEBUG);
            return;
        }

        let features: Static<typeof Feature.InputFeature>[];
        if (env.Source.Mode === 'Map') {
            features = this.fromMap(await caltopo.map(env.Source.MapId));
        } else {
            console.log(`ok - requesting shared locations for ${env.Source.AccountId}`);

            const since = env.Source.SinceDelta
                ? Date.now() - env.Source.SinceDelta * 1000
                : undefined;

            features = this.fromLocations(await caltopo.locations(env.Source, { since }));
        }

        await this.submit({
            type: 'FeatureCollection',
            features: features
        }, {
            verbose: env.DEBUG
        });
    }

    client(verbose: boolean): CalTopo {
        return new CalTopo({ verbose });
    }

    /** How Missions are read - swapped for a Layer scoped reader once CloudTAK supports one */
    missionReader(source: Static<typeof SyncSource>): MissionReader {
        return new ProfileTokenReader(this.etl.api, source.MissionToken);
    }

    /**
     * Sync the TAK → CalTopo half of each Map/Mission pair - or with DryRun only log the plan
     *
     * The links of a pair are kept in the Layer's ephemeral store under sync:<MapId>:<MissionGuid>
     * and sync:lock holds the start time of a writing run, so an overlapping run skips
     */
    async sync(caltopo: CalTopo, source: Static<typeof SyncSource>, verbose: boolean): Promise<void> {
        const reader = this.missionReader(source);
        const ephemeral = { ...((await this.fetchLayer()).incoming?.ephemeral ?? {}) as Record<string, unknown> };

        if (!source.DryRun) {
            const lock = Number(ephemeral[SYNC_LOCK]);
            if (lock && Date.now() - lock < SYNC_LOCK_TTL) {
                console.log(`ok - skip - a sync started ${Math.round((Date.now() - lock) / 1000)}s ago is still running`);
                return;
            }

            await this.setEphemeral({ ...ephemeral, [SYNC_LOCK]: Date.now() }, DataFlowType.Incoming);
        }

        try {
            for (const pair of source.Pairs) {
                const key = `sync:${pair.MapId}:${pair.MissionGuid}`;
                const label = `${source.DryRun ? 'dry run' : 'sync'} ${pair.MissionGuid} -> ${pair.MapId}`;
                const state = (ephemeral[key] as SyncState | undefined) ?? { links: [] };

                try {
                    // Every source is read even when one fails, so one run reports every broken credential
                    const [missionRead, foldersRead, mapRead] = await Promise.allSettled([
                        reader.features(pair.MissionGuid),
                        reader.folders(pair.MissionGuid),
                        caltopo.teamMap(pair.MapId, source),
                    ]);

                    const failures = [missionRead, foldersRead, mapRead]
                        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
                        .map((r) => r.reason instanceof Error ? r.reason.message : String(r.reason));
                    if (failures.length) throw new Error(failures.join(' | '));

                    const mission = (missionRead as PromiseFulfilledResult<Awaited<ReturnType<MissionReader['features']>>>).value;
                    const folders = (foldersRead as PromiseFulfilledResult<Awaited<ReturnType<MissionReader['folders']>>>).value;
                    const map = (mapRead as PromiseFulfilledResult<Awaited<ReturnType<CalTopo['teamMap']>>>).value;

                    const plan = planTakToCalTopo(mission, map, state, folders);

                    console.log(`ok - ${label}: ${mission.length} Mission items, ${map.length} CalTopo objects, ${state.links.length} linked - ${summary(plan)}`);
                    for (const warning of plan.warnings) console.log(`warn - ${warning}`);

                    if (source.DryRun) {
                        if (verbose) for (const action of plan.actions) console.log(`  ${describe(action)}`);
                        continue;
                    }

                    const applied = await this.apply(caltopo, source, pair.MapId, map, plan);
                    ephemeral[key] = { links: nextLinks(state, mission, applied) } satisfies SyncState;

                    const failed = plan.actions.filter((a) => a.op !== 'skip').length - applied.filter((a) => a.op !== 'skip').length;
                    console.log(`ok - ${label}: applied ${applied.filter((a) => a.op !== 'skip').length}${failed ? `, ${failed} failed - retried next run` : ''}`);
                } catch (err) {
                    // One broken pair must not stop the others
                    console.error(`not ok - ${label}:`, err instanceof Error ? err.message : String(err));
                }
            }
        } finally {
            if (!source.DryRun) {
                delete ephemeral[SYNC_LOCK];
                await this.setEphemeral(ephemeral, DataFlowType.Incoming);
            }
        }
    }

    /**
     * Write a plan to CalTopo, returning the actions that succeeded - one failed write is
     * logged and the rest carry on. Objects are saved under their TAK UID, Folders first so
     * the objects created in them can reference their IDs
     */
    async apply(caltopo: CalTopo, source: Static<typeof SyncSource>, mapId: string, map: Awaited<ReturnType<CalTopo['teamMap']>>, plan: Plan): Promise<Action[]> {
        const folderIds = new Map(map
            .filter((f) => f.properties.class === 'Folder')
            .map((f) => [String(f.properties.title ?? '').trim().toLowerCase(), f.id]));

        const save = async (id: string, write: CalTopoWrite) => {
            const properties = { ...write.properties };

            if (write.folder) {
                const folderId = folderIds.get(write.folder.toLowerCase());
                if (!folderId) throw new Error(`CalTopo Folder ${write.folder} could not be created`);
                properties.folderId = folderId;
            }

            await caltopo.saveObject(mapId, source, String(properties.class), id, { type: 'Feature', geometry: write.geometry, properties });
        };

        const applied: Action[] = [];
        for (const action of plan.actions) {
            try {
                if (action.op === 'folder') {
                    const id = randomUUID();
                    await caltopo.saveObject(mapId, source, 'Folder', id, {
                        type: 'Feature',
                        properties: { class: 'Folder', title: action.title, visible: true, labelVisible: true },
                    });
                    folderIds.set(action.title.toLowerCase(), id);
                } else if (action.op === 'create') {
                    await save(action.tak, action.caltopo);
                } else if (action.op === 'update') {
                    // An object keeps its class for life, so a new class means a new object
                    if (action.from && action.from !== action.write.properties.class) {
                        await caltopo.deleteObject(mapId, source, action.from, action.caltopo);
                    }
                    await save(action.caltopo, action.write);
                } else if (action.op === 'delete') {
                    await caltopo.deleteObject(mapId, source, action.class, action.caltopo);
                }

                applied.push(action);
                if (action.op !== 'skip' && action.op !== 'adopt') console.log(`ok - ${describe(action)}`);
            } catch (err) {
                console.error(`not ok - ${describe(action)}:`, err instanceof Error ? err.message : String(err));
            }
        }

        return applied;
    }

    /**
     * Transform Shared Locations into CloudTAK features at each device's current position
     */
    fromLocations(locations: Static<typeof LocationFeature>[]): Static<typeof Feature.InputFeature>[] {
        const now = Date.now();
        const features: Static<typeof Feature.InputFeature>[] = [];

        for (const loc of locations) {
            let coord: number[] | undefined;
            if (loc.geometry?.type === 'Point') {
                coord = loc.geometry.coordinates;
            } else if (loc.geometry?.type === 'LineString' && loc.geometry.coordinates.length) {
                coord = loc.geometry.coordinates[loc.geometry.coordinates.length - 1];
            }

            if (!coord) continue;

            const updated = loc.properties.updated ?? coord[3] ?? now;
            const ttl = loc.properties.ttl ?? LOCATION_TTL;
            if (updated + ttl < now) continue;

            const id = String(loc.id);
            const callsign = loc.properties.title || loc.properties.device || id;

            const feat: Static<typeof Feature.InputFeature> = {
                id: `caltopo-loc-${id}`,
                type: 'Feature',
                properties: {
                    type: 'a-f-G-U-C',
                    how: 'm-g',
                    callsign,
                    time: new Date(updated).toISOString(),
                    start: new Date(updated).toISOString(),
                    stale: new Date(updated + ttl).toISOString(),
                    metadata: loc.properties
                },
                geometry: {
                    type: 'Point',
                    coordinates: coord.slice(0, 3)
                }
            };

            if (loc.properties['aircraft:heading'] !== undefined) {
                feat.properties.course = Math.round(loc.properties['aircraft:heading']);
            }

            features.push(feat);
        }

        return features;
    }

    /**
     * Transform the objects of a single CalTopo map into CloudTAK features
     */
    fromMap(objects: Static<typeof MapFeature>[]): Static<typeof Feature.InputFeature>[] {
        const folders: Map<string, Static<typeof MapObject>> = new Map();

        return objects
            .filter((feat) => {
                if (feat.properties.class === 'Folder') {
                    folders.set(feat.id, feat.properties);
                    return false;
                } else {
                    // SARTopo will send "features" like "Operational Periods" which do not have geometry
                    return !!feat.geometry;
                }
            })
            .map((calFeat) => {
                const feat: Static<typeof Feature.InputFeature> = {
                    id: calFeat.id,
                    type: 'Feature',
                    properties: {
                        metadata: calFeat.properties
                    },
                    geometry: calFeat.geometry
                };
                const metadata = feat.properties.metadata ?? {};

                feat.properties.callsign = String(calFeat.properties.title);
                feat.properties.remarks = calFeat.properties.description ? String(calFeat.properties.description) : '';

                if (metadata.fill !== undefined) feat.properties.fill = String(metadata.fill);
                if (metadata['fill-opacity'] !== undefined) feat.properties['fill-opacity'] = Number(metadata['fill-opacity']);
                if (metadata.stroke !== undefined) feat.properties.stroke = String(metadata.stroke);
                if (metadata['stroke-opacity'] !== undefined) feat.properties['stroke-opacity'] = Number(metadata['stroke-opacity']);
                if (metadata['stroke-width'] !== undefined) feat.properties['stroke-width'] = Number(metadata['stroke-width']);
                if (metadata.ico !== undefined) feat.properties.icon = String(metadata.icon);

                // CalTopo returns points with 4+ coords
                coordEach(feat.geometry, (coord) => {
                    return coord.splice(3)
                });

                feat.properties.archived = true;
                if (feat.geometry.type === 'Point') {
                    feat.properties.type = 'u-d-p';

                    if (metadata['marker-color']) {
                        feat.properties['marker-color'] = `#${metadata['marker-color']}`;
                        delete metadata['marker-color'];
                        feat.properties['marker-opacity'] = 1;
                    }
                }

                return feat;
            })
            // After all Features/Folders have been seperated, apply folder => path transform
            .map((feat) => {
                const metadata = feat.properties.metadata;
                if (metadata?.folderId && typeof metadata.folderId === 'string') {
                    const folder = folders.get(metadata.folderId);
                    if (folder) {
                        feat.path = `/${folder.title}`;
                    }
                }

                return feat;
            });
    }
}

await local(await Task.init(import.meta.url), import.meta.url);
export async function handler(event: Event = {}) {
    return await internal(await Task.init(import.meta.url), event);
}
