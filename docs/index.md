# ETL-CalTopo

Bring CalTopo maps into the TAK System – and TAK back into CalTopo – through
[CloudTAK](https://github.com/dfpc-coe/CloudTAK).

ETL-CalTopo is a CloudTAK **Layer** task: a small program CloudTAK runs on a schedule in your
AWS account. Each Layer is set up for one job.

## What it can do

| Mode | What it does | Set up with |
|---|---|---|
| **Mission Sync** (`Sync`) | Keeps a CalTopo team map and a TAK Mission in step, both ways. TAK folders become CalTopo folders, the Assignments folder becomes CalTopo Assignments. | [Set up the first pair](setup.md) |
| **Single Map** (`Map`) | Brings the objects of one shared CalTopo map into TAK, one way. | A Layer with `Source.Mode` `Map` and the map ID |
| **Team Account** (`Team`) | Shows the live Shared Locations of a CalTopo team's devices in TAK. | A Layer with `Source.Mode` `Team` and [CalTopo credentials](credentials.md) |

On its **Outgoing** side the same Layer can also:

- **Create CalTopo maps from CloudTAK** – a CloudTAK Event flagged `caltopo_map` becomes a new
  map in the team account. See [Creating CalTopo maps](map-creation.md).
- **Send TAK positions to CalTopo** as Trackable Devices. See [TAK positions to CalTopo](pli.md).

## How a Mission Sync pair works

Three CloudTAK pieces, best thought of as a robot that copies between CalTopo and TAK:

- **Connection – the robot's ID badge.** A machine login CloudTAK uses on the TAK Server.
- **Layer – the robot's job.** Every minute it copies changes between **one** CalTopo map and
  **one** TAK Mission, working under its badge.
- **Data Sync – the robot's key to one Mission.** The Layer can only put CalTopo items *into* a
  Mission through a Data Sync on **its own** Connection.

```
  caltopo.com                CloudTAK – Connection "Caltopo"                 TAK Server
 ┌─────────────┐     ┌────────────────────────────────────────────┐     ┌──────────────┐
 │ map APJ7U0R │◄───►│ Layer "CalTopo APJ7U0R" ──► Data Sync ──────│────►│ Mission      │
 └─────────────┘     │ (every minute, in AWS)     (key to Mission) │     │              │
                     └────────────────────────────────────────────┘     └──────────────┘
```

The Layer reads the Mission directly (by its GUID) to copy TAK items to CalTopo, and writes
CalTopo items into the Mission through the Data Sync. A pair needs both.

!!! danger "Two rules that can't be undone"
    - **Never delete a Data Sync, and never turn its Mission Sync off.** CloudTAK then deletes
      the TAK Mission itself.
    - **CalTopo has no undo.** Every new pair starts as a dry run – read it before going live.

## Where to start

- **Setting up a CloudTAK for the first time?** [Set up CloudTAK and the first pair](setup.md).
- **Using the CalTopo Sync plugin?** [With the CalTopo Sync plugin](plugin.md) – pairs are then
  a few clicks.
- **No plugin?** [Pairing by hand](ADMIN_PAIRING.md) for each further pair.
- **New version out?** [Updating to a new version](updating.md).
