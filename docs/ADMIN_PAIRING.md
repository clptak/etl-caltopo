# Pairing an existing TAK Mission with a CalTopo Map

For a CloudTAK administrator, through the CloudTAK web UI. Use this when the
cloudtak-plugin-caltopo-sync plugin isn't creating the pair for you. In the steps, *Map* means
the CalTopo map and *Mission* means the TAK Mission.

> **Two rules that can't be undone**
> - **Never turn Mission Sync off on a Data Sync, and never delete a Data Sync.** CloudTAK
>   **deletes the TAK Mission** when you do either. To stop syncing, disable or delete the
>   **Layer** instead (step 8).
> - **CalTopo has no undo.** Always do the dry run (step 6) before letting the Layer write.

## Once per CloudTAK (already done on map.clpdevtak.com)

| What | Where | Check |
|---|---|---|
| AWS stack + CloudTAK AWS settings | `deploy/README.md` | Admin → Integrations lists **CalTopo** |
| A Connection for the team | Connections → `+` → **User Login** with the LDAP service account → Generate Certificate → Save Connection | The Connection shows green |
| An API token for the service account | Log in as the service account → Settings → **API Tokens** (`/menu/settings/tokens`) | Make it on **this** CloudTAK. A token from another CloudTAK fails with `Invalid Token` |
| CalTopo service account | CalTopo team admin | The account needs **UPDATE** on the team. Without it, every write fails with `400 Error saving object` |

The service account behind the Connection and the token must be able to see the Mission (be in
its groups).

## For each Mission ↔ Map pair

### 1. Collect three values

- **Mission name**: exact, including case, e.g. `2026-08-05_search_arizona_12345_OP-00`.
- **Mission GUID**: map menu → **Data Sync** → open the Mission → its info shows the GUID.
- **Map ID**: the part after `/m/` in the CalTopo URL. In `caltopo.com/m/APJ7U0R`, the ID is
  `APJ7U0R`. It must be a **team** map that the service account can edit.

Check that no other CloudTAK already runs a CalTopo Layer on this Mission. Two Layers on the
same Mission delete each other's items.

### 2. Create the Data Sync (attaches the existing Mission)

> **Two things are called "Data Sync" in CloudTAK.** The **Data Sync** entry in the map menu
> (ambulance icon) is a normal TAK Mission that users create and subscribe to. The pairing
> needs the other kind: a Data Sync that belongs to a **Connection**. That one links the
> Connection's certificate to the Mission so the Layer can write into it. Don't create
> anything from the map menu for this step.

Connections → the team Connection → **Data Sync** → `+` (`/connection/<id>/data/new`):

- **Data Name**: the exact Mission name. If the name matches an existing Mission, CloudTAK
  attaches it. If it doesn't match exactly, CloudTAK creates a **new, empty** Mission instead.
- **Mission Sync**: ON
- **Mission Layer Diff**: ON
- **Create Data**

Afterwards, open the Data Sync and check that it shows the same Mission GUID as step 1.

### 3. Create the Layer

Connections → the team Connection → **Layers** → `+`:

- **Name**: something short like `CalTopo Sync`. The Mission folder that holds CalTopo
  items gets this name. **Don't rename the Layer later** (see Troubleshooting).
- **Task**: CalTopo, latest version
- **Memory**: 256 MB or more (it uses about 175 MB)
- **Schedule**: `rate(1 minute)`
- Leave it **Disabled** for now if the form offers that option.

### 4. Point the Layer at the Data Sync

Layer → **Incoming** → **Config** → **Data Destination** = the Data Sync from step 2 → Save.

Then open the Mission in a TAK client or CloudTAK. A folder with **exactly the Layer's name**
should appear.

### 5. Enter the settings (dry run)

Layer → **Incoming** → **Environment** → **Raw View**. Paste the JSON below, fill in the
values, and Save. Type the secrets in yourself. Never send them by email or chat.

```json
{
    "Source": "Sync",
    "CredentialId": "<CalTopo service account credential id>",
    "CredentialSecret": "<CalTopo service account secret>",
    "MissionToken": "<API token from /menu/settings/tokens>",
    "Pairs": [
        { "MapId": "APJ7U0R", "MissionGuid": "<Mission GUID>" }
    ],
    "DryRun": true,
    "AppTracks": {
        "MaxAge": 600,
        "GroupName": "Orange",
        "Role": "Team Member",
        "CallsignLookup": [],
        "NameFilter": []
    },
    "DEBUG": true
}
```

- **One pair per Layer.** For CalTopo → TAK to work, the Layer needs exactly one pair.
- Leave out `AppTracks` if CalTopo app users shouldn't show up as live TAK positions.

Enable the Layer (Layer → edit → **Enabled**).

### 6. Read the dry run

Layer → **Deployment** → **Layer Runtime Logs**. Within a couple of minutes you should see
the plan: what it would create, update, adopt or delete on the Map. **Nothing is written yet.**

Things to check:
- **No `delete` lines** for things that should stay.
- **No `401` or `Invalid Token`** errors. If you see them, the MissionToken is wrong or came
  from a different CloudTAK.
- **No `400 Error saving object`** errors. If you see them, the CalTopo account can't edit
  this Map.

### 7. Go live

Change `"DryRun": true` to `false` in Raw View and Save. On the next run (≤ 1 minute):

- **On the Map:** TAK items appear as follows.
  - Segments go in a *Segments* folder.
  - Assignments go in the *Assignments* folder as Assignment objects.
  - Other items go in folders named like their TAK folders.
- **In the Mission:** Map items appear in the folder named after the Layer.
- **Second run:** the logs should show it as a no-op (nothing to change).

Once it's stable, set `DEBUG` to `false`.

### 8. Pause or stop

- **Pause:** Layer → edit → turn **Enabled** off.
- **Stop for good:** delete the **Layer**. The Mission and the Map both keep everything.
  **Don't touch the Data Sync** (see the rules at the top).

## How the sync behaves (tell your users)

- **Each item is edited on the side where it was created.**
  - Edits made in TAK to a CalTopo-created item are ignored, and vice versa.
  - Deleting a TAK-created item in TAK deletes it from the Map.
  - Items that came from CalTopo are never deleted by the sync.
- **CalTopo app users** show up in TAK as live positions while they're recording.
  - A finished track becomes a line on the Map and in the Mission.
  - Anyone who is also on a TAK client shows only once, as themselves.
- **Icons:** CalTopo markers use the agency iconset. TAK clients without it installed show a
  default icon.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| CalTopo items don't appear in the Mission (or are broadcast without a Mission) | The Mission folder's name must match the Layer name **exactly**. Rename the folder in Mission Layers (pencil icon) to match. |
| `401 Invalid Token` in the logs | The MissionToken is wrong or from another CloudTAK. Make a new token on this CloudTAK. |
| `400 Error saving object` | The CalTopo service account can't edit this Map, or the Map isn't a team map. |
| A new empty Mission appeared | The Data Sync name didn't match the existing Mission. **Don't delete that Data Sync** (that deletes its Mission). Ask for help. |
| Items vanish from the Mission | A second Layer (often on another CloudTAK) runs on the same Mission. Disable it. |
| Nothing happens at all | Check that the Layer is Enabled, the Connection is green, and the Deployment tab shows stack status `CREATE_COMPLETE`/`UPDATE_COMPLETE`. |

## PLI (TAK positions → CalTopo)

PLI forwarding is configured on the Layer's **Outgoing** tab and is per Connection, not per pair.
If a team has several CalTopo Layers on one Connection, put the PLI connect keys on **only one**
of them. Otherwise every position is forwarded twice.

## Cost

Each Layer is a small AWS Lambda that runs once a minute. That costs close to nothing; PLI
forwarding scales with the number of positions.
