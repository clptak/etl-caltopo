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
| Icon & style translation - marker symbols, line & fill colour / width / opacity, dashed & dotted lines | Done, verified on a real Map |
| CalTopo App Tracks → live TAK positions on the Connection (`AppTracks` setting, `lib/apptracks.ts`) | Done, verified in AWS |
| CalTopo → TAK - the Map's own objects sent to the Layer's Data Sync each run | Done, verified - objects land in the Layer's Mission folder once, a resend of unchanged objects adds nothing |
| Per pair status for the plugin (`sync:status`, `lib/status.ts`) | Done, tests only - not yet deployed |

## Pair status (`sync:status`)

Every run, dry runs included, saves the outcome of each pair in the Layer's incoming
ephemeral store, so the cloudtak-plugin-caltopo-sync UI can show how a pair is doing instead
of the Node-RED `/sync/health` and `/sync/run` results. The plugin reads it from
`GET /api/connection/:connection/layer/:layer` → `incoming.ephemeral['sync:status']`, which
needs a user with access to the Connection (a CloudTAK System Administrator on a
self-hosted CloudTAK).

```json
{
    "at": "2026-10-31T15:40:43.958Z",
    "pairs": [{
        "MapId": "APJ7U0R", "MissionGuid": "c66f4e80-…",
        "at": "2026-10-31T15:40:43.958Z",
        "ok": true, "dryRun": false,
        "mission": 12, "caltopo": 15, "linked": 12,
        "plan": { "update": 1, "skip": 2 },
        "applied": 1, "failed": 0,
        "toTak": 3, "appTracks": 1,
        "errors": []
    }]
}
```

- `pairs` follows the order of `Pairs` in the settings, so a removed pair drops out.
- `ok: false` comes with one line per failed step in `errors`, ie:
  - `sync: 401 Invalid Token`, when the Mission or Map could not be read and nothing ran;
  - `TAK -> CalTopo: 2 writes failed - retried next run`;
  - `CalTopo -> TAK: …`;
  - `App Tracks: …`.
- The counts a step never reached are left out.

**Saving the Layer's settings clears its ephemeral store**, as CloudTAK caches login
secrets there. That clears the saved links and the status along with it.
- The next run re-adopts every object by its TAK UID, with its origin recomputed from its
  Mission folder.
- An item deleted in TAK between the last run and the save is **not** deleted from CalTopo,
  as its link is gone.
- So in phase A, the plugin should write a pair's Layer settings once, when it creates the
  pair. It should avoid rewriting them, for example on credential rotation, while users are
  mid-edit.

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
| 2026-10-23 | An object is edited on the side it was created: CalTopo objects the sync created from TAK are never sent back to TAK, and TAK edits to objects that came from CalTopo are skipped | Stops the two halves echoing each other. Node-RED's last-edit-wins conflict handling is not ported |
| 2026-10-23 | CalTopo → TAK only runs for a Layer with a Data Sync and a single pair | Without a Data Sync a submission is broadcast to the Connection; a Data Sync is one Mission |
| 2026-10-23 | CloudTAK `DataMission.sync` now subscribes the Connection to a Mission it attaches (CloudTAK branch `dev-sqs-endpoint`) | It only did for Missions it created, and TAK Server drops streamed CoTs from an unsubscribed client - offer upstream |
| 2026-10-23 | Missions are read with a dedicated service account's Profile API Token | CloudTAK's Mission routes reject Layer tokens. Temporary - replaced by the Layer scoped read below |
| 2026-10-23 | TAK folders map to CalTopo Folders of the same name; the `Assignments` folder maps to the CalTopo Assignment class | Matches how segments, assignments & probability rings are organised in TAK |
| 2026-10-23 | A Point in the `Assignments` folder (ie: the IPP) becomes a top level Marker | CalTopo Assignments must be lines or polygons |
| 2026-10-23 | An Assignment's `number` is the full TAK callsign, ie: `ASSIGNMENT 01` | Kept as is for now - **may want to trim it later** to the team's numbering (ie: `01`) in `toCalTopo()` |
| 2026-10-23 | Objects are saved under their TAK UID with `POST /api/v1/map/{map}/{type}/{id}` | CalTopo documents that path as edit, but it also creates (as the Node-RED engine relied on) and keeps the ID - a lost link then finds its object instead of duplicating it |
| 2026-10-23 | Marker symbols come from the Node-RED `icon-configs.json`, copied into `lib/icons.ts` | Same mappings (and the team's custom CalTopo icons) as Node-RED. Agency specific - regenerate the file when icons change, and keep it out of an upstream PR |
| 2026-10-23 | TAK `stroke-style` dashed / dotted map to the CalTopo `pattern` strings in `PATTERNS` (`lib/sync.ts`) | Read from lines styled in the CalTopo UI - CalTopo does not document them. Dotted uses the tick style picked on the 75% ring rather than CalTopo's round dots, so dashed & dotted currently look the same - **may want a distinct dashed style later**. Outlined has no CalTopo equivalent and becomes solid |
| 2026-10-23 | A TAK Polygon without a visible fill (ie: probability rings) is written as a closed LineString | CalTopo colours a pattern's dots with the fill, so a transparent fill hid dotted rings. Dotted lines get an opaque fill |
| 2026-10-23 | Shapes always send `pattern`, `fill` & `fill-opacity`, as `null` when unused | CalTopo merges an edit into the object, so a dropped property would otherwise linger |
| 2026-10-23 | CalTopo marker symbols map back to TAK through the same icon-configs mappings (first mapping using a symbol wins) | Icons need the matching iconset - WildFire UID `83198b48…` - installed in every CloudTAK & TAK client, or they show a fallback for the CoT type |
| 2026-10-24 | An item's origin comes from the UID of its Mission folder: under `layer-<Layer id>` (the Layer's Data Sync folder) it came from CalTopo, anywhere else from TAK | **Incident:** the VPS Layer and the dev Layer both had id 1, so the VPS Data Sync took over dev's `layer-1` folder (still named "CalTopo Sync (dev)"), its Mission Diff removed the 5 items in it, and 5.17.2 - matching the folder by *name* - took them for TAK's and deleted them from CalTopo. Matching by UID keeps them CalTopo's, which are never deleted |
| 2026-10-24 | **Never run Layers of two CloudTAKs against the same Mission** | CloudTAK names a Layer's Mission folder `layer-<Layer id>`, so Layers with the same id on two CloudTAKs share - and empty - each other's folder |
| 2026-10-24 | Only hex colours are passed from CalTopo to TAK; the CalTopo → TAK and App Track steps fail independently | A finished App Track becomes a Shape with `fill: "solid"`, which CloudTAK rejected - failing the whole submission and, until 5.17.3, the App Track step after it |
| 2026-10-24 | CalTopo App Tracks are sent as live positions on the Connection, never into the Mission | Ported from the plugin's PLI share service: latest point, callsign lookup (team colour, role, prefix), phone split out, 2 minute stale, NameFilter. Skipped when the last point is older than MaxAge or a TAK client reported the same callsign within MaxAge - the PLI forwarding records seen callsigns in the Layer's outgoing ephemeral, as a Lambda cannot list connected clients |
| 2026-10-23 | The TAK remark `None` is treated as no description | TAK clients send it for an item without remarks |
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
