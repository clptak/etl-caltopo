# Mission Sync - design notes

Replaces the Node-RED Caltopo ↔ TAK Mission sync with this ETL.

## Directions

- **CalTopo → TAK** - CloudTAK's Data Sync with Mission Diff already writes a Layer's
  features into a Mission and removes the ones that disappear. Those items live in the
  Mission's `layer-<id>` subtree, which also tells the sync they came from CalTopo.
- **TAK → CalTopo** - this ETL reads the Mission, compares it with the CalTopo Map and
  the links saved from the last run (`lib/sync.ts`), then writes the changes to CalTopo.

## Status

| Piece | State |
| ----- | ----- |
| Mission read (`lib/mission.ts`) | Service account Profile API Token |
| Signed CalTopo Team Map read | Done |
| TAK → CalTopo plan (create / update / adopt / delete, empty Mission guard) | Done, dry run only |
| Writes to existing CalTopo Maps | Not started |
| Saving links in the Layer's ephemeral store | Not started |
| Icon & style translation from the Node-RED engine | Not started |
| Locking against overlapping runs | Not started |

## Planned CloudTAK change - Layer scoped Mission reads

The Profile API Token is a stopgap: it can do anything its account can do in CloudTAK,
anyone who can edit the Layer can read it, and the account's TAK certificate has to be
renewed by logging it in again.

The replacement lets a Layer token read **only the Mission its own Data Sync points at**:

1. In CloudTAK `GET /api/marti/missions/:guid/cot`, also accept a Layer resource token
   (`AuthResourceAccess.LAYER`) - today `MissionControl.context()` calls `Auth.as_user()`,
   which rejects every resource token.
2. For a Layer token, load the Layer's `incoming.data` Data Sync and refuse (403) unless
   `:guid` is that Data's `mission_guid` (or its name).
3. Read the Mission as the Data's Connection (`TAKServerControl.asConnection()`) with the
   Data's `mission_token`, as the Data Sync submission path already does in
   `connection-layer-cot.ts`.
4. Test: a Layer token reads its own Mission, gets 403 for any other GUID, and a Layer
   without a Data Sync gets 403.

Then in this ETL, `missionReader()` returns a reader that calls the same route with the
Layer's own `ETL_TOKEN`, and the `MissionToken` setting is removed. Before switching,
check the Data's Connection has the same Mission access the service account had.

Offer the CloudTAK change upstream (dfpc-coe/CloudTAK) so the fork does not carry it.
