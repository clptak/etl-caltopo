# Updating to a new version

A Layer keeps running the version it was deployed with until its stack is redeployed. To move
to a new etl-caltopo version:

## 1. Push the new image

Sign in to AWS and push the image as in [Set up › Part 1](setup.md#part-1-build-and-push-the-etl-image-on-your-computer),
from a checkout of the new version. Running more than one CloudTAK? Each has its own AWS
account – push to each one.

✅ **Check:** the run ends with `pushing manifest for …:etl-caltopo-v<version> … done` and `DONE`.

## 2. Update each CalTopo Layer

In CloudTAK, as an admin, for **every** CalTopo Layer:

1. **Connections** → the Caltopo Connection → the Layer → **Deployment**.
2. Change the **Task** version to the new one, e.g. `etl-caltopo-v5.19.1`. If CloudTAK shows a
   **Permissions Requested** list, keep everything that's ticked.
3. **Redeploy the stack.** Changing the version alone does nothing.
4. Wait until the status shows `UPDATE_COMPLETE` (a few minutes).

✅ **Check:** two minutes later, **Deployment** → **Layer Runtime Logs** shows a new run –
`ok - sync … -> <Map ID>: …` and `ok - CalTopo -> TAK: sent N CalTopo objects` – with no
`not ok` lines after the redeploy.

## 3. Read the CHANGELOG

Some versions add settings (e.g. 5.19.0 added `MapEvents` on the Outgoing tab). The
[CHANGELOG](https://github.com/clptak/etl-caltopo/blob/main/CHANGELOG.md) says what changed and
whether anything needs setting.

!!! tip "Using the CalTopo Sync plugin?"
    Update the plugin on the CloudTAK server too – see
    [With the CalTopo Sync plugin](plugin.md#updating-the-plugin).
