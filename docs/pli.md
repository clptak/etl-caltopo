# TAK positions to CalTopo (PLI)

Subscribe the Outgoing flow of the Layer to `feature:*` and set `PLI`. Every CoT the Layer's Connection receives is
streamed to the Layer, and each fresh friendly position sent by a TAK client is reported to CalTopo with the Connect Key of
the first rule its callsign matches. The callsign becomes the device ID in CalTopo. Positions matching no rule are dropped,
and a position CalTopo rejects is logged rather than retried, as a retry would already be out of date.

A PLI only Layer can leave the `event:create` settings blank.

| Variable                      | Default     | Description                                                                         |
| ----------------------------- | ----------- | ----------------------------------------------------------------------------------- |
| `PLI.ConnectKeys[].Name`      |             | Label for the rule in the logs - ie: `Volunteers`                                   |
| `PLI.ConnectKeys[].ConnectKey` |            | CalTopo Connect Key that receives the positions                                     |
| `PLI.ConnectKeys[].CallsignContains` | `[]` | Match callsigns containing one of these values (case-insensitive) - empty matches all |
| `PLI.Types`                   | `["a-f-G"]` | CoT type prefixes forwarded as positions                                            |
| `PLI.DevicesOnly`             | `true`      | Only forward positions a TAK client sends about itself (battery or TAK version details), not map markers |

Each streamed CoT is one Lambda invocation, so add an Outgoing filter to the Layer to drop everything that is not a
position before it leaves CloudTAK. A filter query that evaluates to `true` drops the CoT, ie:

```
$substring(properties.type, 0, 5) != 'a-f-G'
```

Keep the Layer at its default 256 MB - the task uses about 175 MB even for a single forwarded position, so 128 MB runs out of memory.
