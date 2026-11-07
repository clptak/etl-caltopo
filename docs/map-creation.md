# Creating CalTopo maps from CloudTAK

Enable the Outgoing flow of the Layer and subscribe it to `event:create`. The Service Account requires at minimum `Update`
permissions on the Team (see [CalTopo credentials](credentials.md)) and the Layer requires the `event:read` & `event:update` permissions.
Each created Map is titled after the CoreEvent callsign and contains a single Marker at the Event location whose description
carries the Event remarks and human readable location.

Only Events whose `metadata` has `"caltopo_map": true` get a Map - the CalTopo Sync plugin's Create Caltopo Map sets it.
Other plugins create Events too (ie: an incident and each OP's field team), so set `MapEvents` to `All` only on a Layer
that should map every Event.

The Map ID is filed under the `caltopo` external ID of the CoreEvent, so an Event that already has one (ie: a redelivered
message) never gets a second Map. Unless the Map is `PRIVATE`, its URL is also added to the Links of the CoreEvent.

| Variable           | Default               | Description                                                                                 |
| ------------------ | --------------------- | ------------------------------------------------------------------------------------------- |
| `AccountId`        |                       | Service Account ID the credentials belong to - required by `event:create`                   |
| `TeamId`           |                       | Team ID the Maps are created in, from the Team admin page URL `https://caltopo.com/group/{TeamId}/admin/details` - required by `event:create` |
| `CredentialId`     |                       | Service Account Credential ID - required by `event:create`                                  |
| `CredentialSecret` |                       | Service Account Credential Secret - required by `event:create`                              |
| `MapEvents`        | `Flagged`             | `Flagged` (only Events with `metadata.caltopo_map: true`) or `All`                          |
| `MapMode`          | `sar`                 | `sar` (Search & Rescue) or `cal` (Recreational)                                             |
| `MapSharing`       | `SECRET`              | `PRIVATE` (creator only), `SECRET` (secret URL), `URL` (public URL) or `PUBLIC`             |
| `MapLayers`        | `[{ "layer": "mbt" }]` | Active base layers - ie: `mbt` (MapBuilder Topo), `mbh` (MapBuilder Hybrid), `imagery`     |
| `MarkerColor`      | `FF0000`              | Hex colour of the Marker placed at the Event location                                       |
| `PLI`              |                       | Forward TAK positions to CalTopo - see below                                                |
| `DEBUG`            | `false`               | Print results in logs                                                                       |
