# Set up CloudTAK and the first pair

Setting up a CloudTAK from scratch to its first working CalTopo ↔ TAK pair. You do Parts 1–4
once per CloudTAK; Parts 5–9 create the first pair. After that, every further pair is made with
the [CalTopo Sync plugin](https://github.com/clptak/cloudtak-plugin-caltopo-sync)'s **+**
button, which copies the credentials from this first Layer – see [With the CalTopo Sync plugin](plugin.md). Without the plugin, add further pairs with [Pairing by hand](ADMIN_PAIRING.md).

!!! danger "Two rules that can't be undone"
    - **Never turn Mission Sync off on a Data Sync, and never delete a Data Sync.** CloudTAK
      **deletes the TAK Mission** when you do either.
    - **CalTopo has no undo.** Every new pair starts as a dry run (Part 8) – read it before going live.

Have these ready:

- The CalTopo **Credential ID**, **Credential Secret**, **Account ID** and **Team ID** from
  [CalTopo credentials](credentials.md). The Service Account needs **Write/Update** permission for
  two-way sync and map creation.
- A **CalTopo team map** to pair, and its **Map ID** – the part after `/m/` in the map's URL
  (`caltopo.com/m/APJ7U0R` → `APJ7U0R`).
- The **TAK Mission** to pair it with, and its exact name.
- Your CloudTAK's AWS account and the CloudTAK stack set up per [`deploy/README.md`](https://github.com/clptak/etl-caltopo/blob/main/deploy/README.md).

## Part 1 – Build and push the ETL image (on your computer)

1. Sign in to AWS from your terminal (use the profile for **this** CloudTAK's AWS account):
   ```bash
   aws login --profile [YOUR_AWS_PROFILE]
   ```
2. Get the code and build and push the image (about 5 minutes):
   ```bash
   git clone https://github.com/clptak/etl-caltopo.git
   cd etl-caltopo
   npm install
   AWS_PROFILE=[YOUR_AWS_PROFILE] AWS_REGION=us-east-1 AWS_ACCOUNT_ID=[YOUR_AWS_ACCOUNT_ID] Environment=[YOUR_AWS_ENVIRONMENT] npx cloudtak-etl
   ```
   `[YOUR_AWS_ENVIRONMENT]` is the middle of your CloudTAK's image store name:
   `tak-vpc-[YOUR_AWS_ENVIRONMENT]-cloudtak-tasks` (e.g. `ccso-dev`).

✅ **Check:** the run ends with lines like
`pushing manifest for …tak-vpc-…-cloudtak-tasks:etl-caltopo-v5.19.1 … done` and `DONE`. If it
ends with an error mentioning `expired` or `credentials`, sign in again (step 1) and rerun it.

## Part 2 – Register the Integration

1. In CloudTAK, open **Admin** → **Integrations**.
2. Click **+** and complete the form:
   - **Integration Name:** `CalTopo`
   - **Container Prefix:** `etl-caltopo` – the image tag without `-v<version>`. It must match
     exactly, or CloudTAK lists no versions.
   - **Integration Code Repository URL:** `https://github.com/clptak/etl-caltopo`
   - **Integration Markdown Readme URL:** `https://raw.githubusercontent.com/clptak/etl-caltopo/main/README.md`
3. Save.

✅ **Check:** open the Integration – it lists the version you pushed (e.g. `5.19.1`) with a
Capabilities document.

## Part 3 – Create the Connection

1. In CloudTAK, click **Connections**, then the **+** at the top right of the pane.

   ![Connections Icon](cloudtak_connections_icon.png)
2. Enter a name (`Caltopo`) and a description.
3. For **Connection Authentication**, use the method that fits your TAK Server. The user (with
   Cert Enrollment) or certificate must be in the **channels (groups)** of the Missions you will
   pair and of the users who should see CalTopo data. Click **Generate Certificate**.
4. When it says **Certificate Uploaded**, click **Save Connection**.

✅ **Check:** the Connection shows green in the Connections list.

## Part 4 – Create the CloudTAK API token

The sync reads Missions through CloudTAK with a personal API token (Layer tokens can't read
Missions yet).

1. Sign in to CloudTAK as the **service account** user – the one whose certificate is in the
   Missions' channels (often the same account as the Connection's).
2. Open **Settings** → **API Tokens** (`/menu/settings/tokens`) → **+**, name it `CalTopo Sync`,
   and copy the token. Make it on **this** CloudTAK – a token from another CloudTAK fails with
   `Invalid Token`.

## Part 5 – Create the Data Sync (the Layer's key to the Mission)

1. **Connections** → the `Caltopo` Connection → **Data Syncs** → **+** (Create Sync).
2. **Data Name:** the Mission's **exact** name, including capitals. A matching name attaches the
   existing Mission; anything else creates a **new, empty** Mission.
3. Leave **Mission Sync** and **Mission Layer Diff** on.
4. Click **Create Data**.

✅ **Check:** open the new Data Sync – it shows the Mission's GUID (also visible in the browser
address bar when you open the Mission from the map menu: `/menu/missions/<GUID>/`). Note the GUID
for Part 7.

## Part 6 – Create the Layer

1. **Connections** → the `Caltopo` Connection → **Layers** → **+**.
2. **Layer Name:** `CalTopo <Map ID>`, e.g. `CalTopo APJ7U0R`. CalTopo items land in a Mission
   folder with this name, so **don't rename the Layer later**.
3. **Task:** CalTopo, the version you pushed.
4. Under **Compute**: **Memory** `256`.
5. Under **Permissions**: tick **all** of them – `feature:*`, `event:read` and `event:update`.
   Without the `event` ones, Create Caltopo Map fails; they can't be added later from the UI.
6. Under **Incoming**: **Create Incoming Config** on, **Scheduled Runs** on, every `1` `Minute`.
7. Under **Outgoing**: **Create Outgoing Config** on.
8. Save the Layer.

## Part 7 – Give the Layer its Data Sync and settings

1. Open the Layer → **Incoming** → **Config** → the pencil → the gear next to **Data
   Destination** → pick the Data Sync from Part 5 → **Save**. Without it nothing goes from
   CalTopo to TAK.
2. Layer → **Incoming** → **Environment** → **Raw View**. Paste this, fill in the values and
   **Save**. Type the secrets in yourself – never send them by email or chat.
   ```json
   {
       "Source": {
           "Mode": "Sync",
           "CredentialId": "<CalTopo Credential ID>",
           "CredentialSecret": "<CalTopo Credential Secret>",
           "MissionToken": "<API token from Part 4>",
           "Pairs": [
               { "MapId": "<Map ID>", "MissionGuid": "<Mission GUID from Part 5>" }
           ],
           "DryRun": true
       },
       "DEBUG": true
   }
   ```
   One pair per Layer.
3. Layer → **Outgoing** → **Environment**. Fill in **AccountId**, **TeamId**, **CredentialId**
   and **CredentialSecret** (the same CalTopo service account), leave **MapEvents** on
   **Flagged**, and **Save**. This lets the plugin's **Create Caltopo Map** make maps.

## Part 8 – Read the dry run

Two minutes later: Layer → **Deployment** → **Layer Runtime Logs**. You should see lines like

```
ok - dry run <Mission GUID> -> <Map ID>: 4 Mission items, 12 CalTopo objects, 0 linked - create 4
ok - dry run CalTopo -> TAK: would send 12 CalTopo objects to Data Sync 1
```

Nothing is written yet. Check for:
- **`delete`** of anything that should stay – stop and ask.
- **`401 Invalid Token`** – the token is wrong or from another CloudTAK (Part 4).
- **`400 Error saving object`** – the CalTopo account can't edit the map, or it isn't a team map.
- **`the Layer has no Data Sync`** – Part 7 step 1 was missed.

## Part 9 – Go live

1. Layer → **Incoming** → **Environment** → **Raw View**: change `"DryRun": true` to `false`,
   then **Save**.
2. On the next run (≤ 1 minute), TAK items appear in the CalTopo map and CalTopo items appear in
   the Mission's `CalTopo <Map ID>` folder.
3. Once it runs cleanly, set `"DEBUG"` to `false`.

✅ **Check:** draw a marker in the CalTopo map – it shows in the Mission within two minutes. In
the CalTopo Sync plugin the pair shows **OK**.
