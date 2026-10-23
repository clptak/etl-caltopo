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

/**
 * Reads the current contents of a TAK Mission
 *
 * The sync only depends on this interface, so how the Mission is read can change without
 * touching it - ie: once CloudTAK lets a Layer read its own Data Sync Mission
 */
export interface MissionReader {
    features(guid: string): Promise<MissionFeature[]>;
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
        const url = new URL(`/api/marti/missions/${encodeURIComponent(guid)}/cot`, this.api);

        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${this.token}` },
            safeUrlAllow: [this.api.origin],
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`CloudTAK responded with HTTP ${res.status} reading Mission ${guid}${body ? `: ${body.trim().slice(0, 500)}` : ''}`);
        }

        return (await res.typed(MissionFeatures)).features;
    }
}
