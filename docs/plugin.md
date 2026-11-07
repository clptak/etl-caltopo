# With the CalTopo Sync plugin

The [CalTopo Sync plugin](https://github.com/clptak/cloudtak-plugin-caltopo-sync) is an optional
CloudTAK frontend plugin. It does nothing the ETL can't do on its own – it hides the CloudTAK
plumbing so an admin never types a GUID or opens **Connections** after the first pair.

## What it adds

| In the plugin | What it does for you | Without the plugin |
|---|---|---|
| **CloudTAK ETL Pairs** list | Every pair with its last run, item counts and errors, refreshed every minute | Each Layer's **Layer Runtime Logs** |
| **+** (new pair) | Pick the Mission by name and enter the CalTopo map. It finds or creates the Data Sync, creates the Layer with the credentials copied from an existing CalTopo Layer, and starts it as a dry run | [Pairing by hand](ADMIN_PAIRING.md) |
| **Go Live** | Turns the dry run off after you've read the planned changes | Set `DryRun` to `false` in the Layer's Raw View |
| **Fix** | Shown when a Layer has no Data Sync ("CalTopo → TAK not connected"). Reuses or creates the Mission's Data Sync and links it | [Set up › Part 7](setup.md#part-7-give-the-layer-its-data-sync-and-settings) step 1 |
| **Items Missing** list | Names each CalTopo object CloudTAK would reject, and why | `warn - CalTopo -> TAK: not sent …` lines in the logs |
| **Create Caltopo Map** | Creates a team map through the Layer (a flagged CloudTAK Event) and fills it into the pair form | [Creating CalTopo maps](map-creation.md) |
| **Download Caltopo-Friendly GeoJSON** | Exports a Mission as GeoJSON that CalTopo imports cleanly | – |

!!! note "The first pair is still set up by hand"
    **+** copies the CalTopo credentials and API token from a CalTopo Layer already on the
    Connection, so each Connection's first pair is made with [Set up](setup.md) Parts 5–9.
    Every pair after that is made with **+**.

## Which plugin version

The ETL-backed plugin is on the plugin's **`etl-backend`** branch until it is merged into
`main`. Older plugin versions on `main` used a separate Node-RED sync instead of this ETL – don't
run both on the same Mission.

Needs etl-caltopo **5.18.0** or later for the pair list, **5.19.0** for Create Caltopo Map and
**5.19.1** for the Items Missing list.

## Installing the plugin

CloudTAK plugins are compiled into the web app, so the plugin is installed on the CloudTAK
server:

```bash
cd <CloudTAK>/app/plugins
git clone -b etl-backend https://github.com/clptak/cloudtak-plugin-caltopo-sync.git caltopo-sync
```

Then rebuild the CloudTAK web app the way your deployment does. Only CloudTAK **System
Administrators** see the pair list.

## Updating the plugin

```bash
cd <CloudTAK>/app/plugins/caltopo-sync
git pull
```

Rebuild CloudTAK, then close every CloudTAK browser tab and reopen it – browsers keep the old
version until all tabs are closed.

## More

The plugin repo has its own admin guide (`docs/cloudtak-etl-guide.md`) on reading the pair list
and which buttons are safe, and a release playbook for rolling updates out to several
CloudTAKs.
