import { Type, Static } from '@sinclair/typebox';
import type { OutgoingFeatureMessage } from '@tak-ps/etl';

export const ConnectKeyRule = Type.Object({
    Name: Type.String({
        description: 'Label for this rule in the logs - ie: Volunteers or Sworn',
    }),
    ConnectKey: Type.String({
        description: 'CalTopo Connect Key that receives the positions - from the Trackable Devices page of the Team Account',
    }),
    CallsignContains: Type.Array(Type.String(), {
        default: [],
        description: 'Forward a position only if its callsign contains one of these values (case-insensitive) - leave empty to match every callsign',
    }),
});

export const PLIConfig = Type.Object({
    ConnectKeys: Type.Array(ConnectKeyRule, {
        description: 'Rules checked in order - a position goes to the first rule whose CallsignContains matches, positions matching no rule are dropped',
    }),
    Types: Type.Array(Type.String(), {
        default: ['a-f-G'],
        description: 'CoT type prefixes forwarded as positions - a-f-G matches friendly ground units',
    }),
    DevicesOnly: Type.Boolean({
        default: true,
        description: 'Only forward positions sent by a TAK client about itself (carrying battery or TAK version details), not markers placed on the map',
    }),
}, {
    description: 'Forward TAK positions (PLI) to CalTopo Trackable Devices - subscribe the Layer to feature:* and add an Outgoing filter to keep the volume down',
});

export type ConnectKeyRule = Static<typeof ConnectKeyRule>;
export type PLIConfig = Static<typeof PLIConfig>;

export type PositionReport = {
    rule: ConnectKeyRule;
    id: string;
    lat: number;
    lng: number;
};

/**
 * Decide whether a streamed CoT is forwarded to CalTopo as a position report
 * Returns the report, or the reason it was skipped
 */
export function positionReport(
    message: Static<typeof OutgoingFeatureMessage>,
    config: PLIConfig,
    now = Date.now(),
): PositionReport | { skip: string } {
    const feature = message.geojson;
    const props = feature.properties;

    if (feature.geometry.type !== 'Point') return { skip: `${feature.geometry.type} is not a Point` };
    if (!config.Types.some((prefix) => props.type.startsWith(prefix))) return { skip: `type ${props.type} is not a position` };

    if (config.DevicesOnly && props.status?.battery === undefined && !props.takv) {
        return { skip: 'not sent by a TAK client' };
    }

    const stale = Date.parse(props.stale);
    if (Number.isFinite(stale) && stale < now) return { skip: `stale since ${props.stale}` };

    const callsign = (props.callsign || '').trim();
    if (!callsign) return { skip: 'no callsign' };

    const lower = callsign.toLowerCase();
    const rule = config.ConnectKeys.find((r) => {
        return !r.CallsignContains.length || r.CallsignContains.some((value) => lower.includes(value.toLowerCase()));
    });
    if (!rule) return { skip: `callsign ${callsign} matches no Connect Key rule` };

    const [lng, lat] = feature.geometry.coordinates as number[];

    return { rule, id: callsign, lat, lng };
}
