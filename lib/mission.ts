import { Type, Static } from '@sinclair/typebox';
import { fetch } from '@tak-ps/etl';

/** The subset of a CloudTAK Mission feature the sync uses */
export const MissionFeature = Type.Object({
    id: Type.String(),
    path: Type.Optional(Type.String()),
    properties: Type.Record(Type.String(), Type.Unknown()),
    geometry: Type.Object({
        type: Type.String(),
        coordinates: Type.Unknown(),
    }),
});

export type MissionFeature = Static<typeof MissionFeature>;

const MissionFeatures = Type.Object({
    features: Type.Array(MissionFeature),
});

/** A Mission folder (TAK Mission Layer) - folders nest and list the UIDs of the items in them */
type MissionLayer = {
    name: string;
    uid?: string;
    uids?: Array<{ data: string }>;
    mission_layers?: MissionLayer[];
};

const MissionLayers = Type.Object({
    data: Type.Array(Type.Unsafe<MissionLayer>(Type.Object({
        name: Type.String(),
    }, { additionalProperties: true }))),
});

/** Map each item UID to the name of the innermost Mission folder it is in */
export function folderNames(layers: MissionLayer[]): Map<string, string> {
    const folders = new Map<string, string>();

    const walk = (list: MissionLayer[]) => {
        for (const layer of list) {
            for (const uid of layer.uids ?? []) folders.set(uid.data, layer.name);
            walk(layer.mission_layers ?? []);
        }
    };

    walk(layers);
    return folders;
}

/**
 * Map each item UID to the UID of the innermost Mission folder it is in - names can be shared or
 * renamed, UIDs can not (ie: CloudTAK files a Layer's Data Sync items under layer-<Layer id>)
 */
export function folderIds(layers: MissionLayer[]): Map<string, string> {
    const folders = new Map<string, string>();

    const walk = (list: MissionLayer[]) => {
        for (const layer of list) {
            if (layer.uid) for (const uid of layer.uids ?? []) folders.set(uid.data, layer.uid);
            walk(layer.mission_layers ?? []);
        }
    };

    walk(layers);
    return folders;
}

/** The folder of each Mission item, by name for CalTopo placement and by UID for ownership */
export type MissionFolders = {
    names: Map<string, string>;
    ids: Map<string, string>;
};

/**
 * Reads the current contents of a TAK Mission
 *
 * The sync only depends on this interface, so how the Mission is read can change without
 * touching it - ie: once CloudTAK lets a Layer read its own Data Sync Mission
 */
export interface MissionReader {
    features(guid: string): Promise<MissionFeature[]>;

    /** The Mission folder of each item UID - items outside a folder are absent */
    folders(guid: string): Promise<MissionFolders>;
}

/**
 * Reads a Mission through CloudTAK's Mission API as a CloudTAK user, with a Profile API
 * Token of a dedicated service account - CloudTAK's Mission routes do not accept Layer tokens.
 * The account's TAK certificate must be able to read the Mission and, for a password
 * protected Mission, the account must be subscribed to it
 */
export class ProfileTokenReader implements MissionReader {
    api: URL;
    token: string;

    constructor(api: string | URL, token: string) {
        this.api = new URL(api);
        this.token = token;
    }

    async features(guid: string): Promise<MissionFeature[]> {
        return (await (await this.get(guid, 'cot')).typed(MissionFeatures)).features;
    }

    async folders(guid: string): Promise<MissionFolders> {
        const layers = (await (await this.get(guid, 'layer')).typed(MissionLayers)).data;
        return { names: folderNames(layers), ids: folderIds(layers) };
    }

    async get(guid: string, resource: 'cot' | 'layer') {
        const url = new URL(`/api/marti/missions/${encodeURIComponent(guid)}/${resource}`, this.api);

        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${this.token}` },
            safeUrlAllow: [this.api.origin],
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`CloudTAK responded with HTTP ${res.status} reading Mission ${guid} ${resource}${body ? `: ${body.trim().slice(0, 500)}` : ''}`);
        }

        return res;
    }
}
