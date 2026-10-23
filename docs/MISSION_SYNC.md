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
| TAK → CalTopo plan (create / update / adopt / delete, empty Mission guard) | Done |
| Folder placement - TAK folder → CalTopo Folder of the same name, `Assignments` folder → CalTopo Assignment class | Done |
| Writes to existing CalTopo Maps - Folders, Markers, Shapes & Assignments saved under their TAK UID | Done, verified on a real Map |
| Saving links in the Layer's ephemeral store | Done - a second run of an unchanged Mission writes nothing |
| Locking against overlapping runs (`sync:lock`, honoured for 5 minutes) | Done |
| Deleting from CalTopo (`DELETE /api/v1/map/{map}/{type}/{id}`, signed like a GET) | Done, verified on a real Map |
| Icon & style translation from the Node-RED engine | Not started |

## Placement rules

- An item in a TAK Mission folder goes in a CalTopo Folder with the same title (matched
  regardless of case, created when the Map does not have one) - ie: `Segments`,
  `Search Area`, `LPB Search-Hiker - AZ`
- Lines & polygons in the `Assignments` folder become CalTopo **Assignment** objects
  (`number` from the callsign, `status: DRAFT`) rather than objects in a Folder
- A Point in `Assignments` (ie: the IPP) can not be an Assignment, so it becomes a top
  level Marker - logged as a warning
- Items outside any folder stay at the top level of the Map

## Decisions

| Date | Decision | Why / follow up |
| ---- | -------- | --------------- |
| 2026-10-23 | CalTopo → TAK uses CloudTAK's Data Sync with Mission Diff; this ETL only does TAK → CalTopo | Data Sync already writes and removes Mission items - no need to rebuild it |
| 2026-10-23 | Missions are read with a dedicated service account's Profile API Token | CloudTAK's Mission routes reject Layer tokens. Temporary - replaced by the Layer scoped read below |
| 2026-10-23 | TAK folders map to CalTopo Folders of the same name; the `Assignments` folder maps to the CalTopo Assignment class | Matches how segments, assignments & probability rings are organised in TAK |
| 2026-10-23 | A Point in the `Assignments` folder (ie: the IPP) becomes a top level Marker | CalTopo Assignments must be lines or polygons |
| 2026-10-23 | An Assignment's `number` is the full TAK callsign, ie: `ASSIGNMENT 01` | Kept as is for now - **may want to trim it later** to the team's numbering (ie: `01`) in `toCalTopo()` |
| 2026-10-23 | Objects are saved under their TAK UID with `POST /api/v1/map/{map}/{type}/{id}` | CalTopo documents that path as edit, but it also creates (as the Node-RED engine relied on) and keeps the ID - a lost link then finds its object instead of duplicating it |
| 2026-10-23 | The CalTopo service account needs UPDATE on a team Map it can see | A Map it can only read (ie: shared by link) rejects every write with `400 Error saving object` - edit links do not apply to the API |

## Planned CloudTAK change - Layer scoped Mission reads

The Profile API Token is a stopgap: it can do anything its account can do in CloudTAK,
anyone who can edit the Layer can read it, and the account's TAK certificate has to be
renewed by logging it in again.

The replacement lets a Layer token read **only the Mission its own Data Sync points at**:

1. In CloudTAK `GET /api/marti/missions/:guid/cot` **and** `GET /api/marti/missions/:guid/layer`
   (the sync reads the Mission folders for placement), also accept a Layer resource token
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
