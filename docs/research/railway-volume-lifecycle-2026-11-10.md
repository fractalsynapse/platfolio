# Volumes outlive services on Railway — measured (2026-11-10)

Prompted by the maintainer's requirement: destroy the compute, keep the state, let a later service mount it.
Probed against a live project with throwaway resources; **no deploys consumed**, everything created was removed
(see Cleanup).

## What the API does

| Question | Answer, with the observation |
| --- | --- |
| Does a volume survive its service being deleted? | **Yes.** `serviceDelete(hibernate-a)` returned true and `hibernate-a-volume` remained. Independently visible in `postgres-volume`, whose database service was deleted days earlier: `serviceId` is now null and the volume is still there. |
| Can a surviving volume be mounted by a *different* service? | **Yes.** `volumeInstanceUpdate(environmentId, volumeId, { serviceId, mountPath })` returned true **and changed what read-back reports** — the instance moved to the new service at `/persisted`. Verified by reading, because this API has a history of honest-looking `true`s that did nothing. |
| What identifies a volume? | **Neither the plan's name nor a stable handle.** Railway names volumes `<service>-volume` itself (`web-volume`, `hibernate-a-volume`), ignoring whatever label the plan used. `Volume` carries no service or mount; `VolumeInstance` does, per environment. So the mount path is the only identity both sides agree on. |
| Is deletion immediate? | **No.** `volumeDelete` returns true and *schedules*: the volume stays listed with `isPendingDeletion: true` and a `deletedAt` roughly two days out. "We asked" is not "it is gone". |
| Who may delete? | Workspace tier only — `volumeDelete` on a project token is `Not Authorized`, while `volumeCreate` on the same token **succeeds**. |

## The asymmetry that decides the architecture

Create-without-delete on the project token means a runner could provision storage it cannot release. Combined
with the retention requirement — where the *point* is that a volume can be kept and must be deletable later —
this puts creation, deletion and retention all in the workspace tier. Not because the API forces creation
there; because leaving deletion elsewhere would strand a tenant's state on a disk nobody can free.

## What changed in platfolio as a result

- **`retention?: 'instance' | 'survive'`** on the plan's volume entries, and on the manifest's
  `resources.volumes` so a Compose document can declare it. Optional rather than defaulted: `InfraPlan` is the
  schema's output type, and a `.default()` would force every builder and fixture to state it.
- **`provisionVolume` matches on the mount and re-attaches** instead of creating a second disk. My first
  version matched on the plan's `name` — looked right, passed review, and could never fire, because Railway
  names volumes itself. The double now names them the way the API does, so the bug cannot come back quietly.
- **`deleteInstance(instanceId, { retainMounts })`** skips and reports `retained`, expressed in **mounts**, and
  only when told: omission keeps today's behaviour, so retention stays a decision someone made.
- **Two archetypes added with rules, not just names** (`worker` refuses an exposed host; `shared-service`
  requires one so something can bind to it) — the template set is not describable without them.

## Corrections this forced

- **#107 was overstated.** I recorded "a volume blocks `serviceDelete`, therefore volumes go first." Measured
  today: an ordinary service deletes fine with its volume attached; only the template-created database refuses.
  The double enforced my over-generalisation (any attached volume → refuse), which would have kept the
  provider's blanket ordering looking mandatory. Now scoped to template services, and the volumes-first
  ordering stays as a caution rather than a requirement.
- **`volumeDelete: true` was being read as completion**, including in #111's clean-accounting claim. Retained
  and pending volumes are now reported as what they are.

## Cleanup

Probe tokens `tier-probe`, `tier-probe2` revoked; services `hibernate-a`, `hibernate-b`, `tier-probe-svc2`
deleted; volumes `web-volume`, `hibernate-a-volume`, `hibernate-probe-volume-*` and the leftover
`postgres-volume` all issued for deletion (`isPendingDeletion` confirmed). Project `platfolio-iac-sample`
left with its `web` service and no attached volumes.
