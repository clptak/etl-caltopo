/**
 * The outcome of the last Sync run, kept in the Layer's incoming ephemeral store so the
 * cloudtak-plugin-caltopo-sync UI (or an admin) can show how each pair is doing without
 * reading the Lambda logs
 */
export const STATUS_KEY = 'sync:status';

export type PairStatus = {
    MapId: string;
    MissionGuid: string;
    /** When this pair last finished a run */
    at: string;
    /** False when the pair could not be read or a step failed - see errors */
    ok: boolean;
    dryRun: boolean;
    /** Items read on each side, and the saved links between them */
    mission?: number;
    caltopo?: number;
    linked?: number;
    /** Planned TAK → CalTopo actions by kind, e.g. { create: 2, skip: 1 } */
    plan?: Record<string, number>;
    /** Planned writes that succeeded and failed - failures are retried next run */
    applied?: number;
    failed?: number;
    /** CalTopo objects sent to the Mission and App Tracks sent as positions */
    toTak?: number;
    appTracks?: number;
    errors: string[];
};

export type SyncStatus = {
    /** When the run finished */
    at: string;
    pairs: PairStatus[];
};

export function pairStatus(pair: { MapId: string; MissionGuid: string }, dryRun: boolean): PairStatus {
    return { MapId: pair.MapId, MissionGuid: pair.MissionGuid, at: '', ok: true, dryRun, errors: [] };
}

/** Record a failed step on a pair */
export function failed(status: PairStatus, label: string, err: unknown): void {
    status.ok = false;
    status.errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
}
