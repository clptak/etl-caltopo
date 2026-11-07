# ETL-CalTopo

Bring CalTopo maps into the TAK System – and TAK back into CalTopo – through
[CloudTAK](https://github.com/dfpc-coe/CloudTAK).

**📖 Documentation: <https://clptak.github.io/etl-caltopo/>** – the full guide, built from
[`docs/`](docs/index.md) with MkDocs (see [Building and running › These docs](docs/development.md#these-docs)).

## What it does

| Mode | What it does |
|---|---|
| **Mission Sync** | Keeps a CalTopo team map and a TAK Mission in step, both ways |
| **Single Map** | Brings the objects of one shared CalTopo map into TAK |
| **Team Account** | Shows the live Shared Locations of a CalTopo team's devices in TAK |

On its Outgoing side a Layer can also create CalTopo maps from flagged CloudTAK Events and send
TAK positions to CalTopo as Trackable Devices.

The optional [CalTopo Sync plugin](https://github.com/clptak/cloudtak-plugin-caltopo-sync) adds a
CloudTAK panel for creating and watching pairs – the ETL works without it.

## Guide

| | |
|---|---|
| [Overview](docs/index.md) | How a pair works: Connection, Layer, Data Sync |
| [Set up CloudTAK and the first pair](docs/setup.md) | Image push, Integration, Connection, API token, Data Sync, Layer, credentials, dry run, go live |
| [CalTopo credentials](docs/credentials.md) | Creating the CalTopo service account |
| [With the CalTopo Sync plugin](docs/plugin.md) | What the plugin adds, installing it |
| [Pairing by hand](docs/ADMIN_PAIRING.md) | Each further pair without the plugin |
| [Creating CalTopo maps](docs/map-creation.md) | Outgoing `event:create` settings |
| [TAK positions to CalTopo](docs/pli.md) | Outgoing PLI settings |
| [Updating to a new version](docs/updating.md) | New image, redeploy each Layer |
| [AWS cheat sheet](docs/AWS_CHEATSHEET.md) | Signing in and common errors |
| [Building and running](docs/development.md) | Development |

> **Two rules that can't be undone:** never delete a Data Sync or turn its Mission Sync off –
> CloudTAK then deletes the TAK Mission. And CalTopo has no undo – read every dry run first.
