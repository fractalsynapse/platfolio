# Starter worker service

Background jobs with state on a volume that outlives the container. Nothing here accepts inbound
connections, and that absence is the archetype: platfolio refuses this template if a host is ever attached,
because "worker" is a promise about attack surface, not a label.

```sh
docker compose -f compose.yaml -f compose.dev.yaml up --build
docker compose logs -f queue        # watch jobs recover their history after a restart
```

## The part that costs money

`job-state` is declared with `retention: survive`. That means:

- platfolio may destroy the service — for scale, for cost, for an idle night — and **the disk stays**,
  attached to nothing;
- the next service mounts the same volume and reads `jobs.jsonl`, which is why the worker logs
  `state recovered: …` rather than trusting memory;
- deleting the instance does **not** delete the volume. Deletion is opt-in, because the default for
  something that holds state should not be destruction.

Two consequences you own, not platfolio:

1. An unattached volume bills and shows no symptom. platfolio reports volumes that belong to nothing for
   exactly this reason — the money-saving feature quietly spends money if nobody looks.
2. Only platfolio's workspace-tier operations can delete storage. The per-dispatch token can *create* a
   volume and cannot delete one, which is measured, not assumed.

## First changes worth making

1. Replace `tick()` with your queue client (SQS, Postgres `LISTEN`, Redis) and delete the disk journal.
2. Keep `/healthz` — it is the only inbound port, and it exists for the platform, not for users.
3. Set `WORKER_CONCURRENCY` from the environment rather than the default of 4.
