# First tenant-shaped live run (2026-11-10)

**What ran.** A real platform description — the generic two-service reference template — through
`parse → buildPlan → RailwayInfraProvider.applyPlan` against Railway's API. Images were the one substitution:
both services use platfolio's own published image (`ghcr.io/fractalsynapse/platfolio-status-api:staging@sha256:deacbaaa…`),
because the platform images a template documents are placeholders on purpose. So this proves the *hosting
mechanism*, not that a real platform boots — stated so the difference survives the summary.

```
plan: production services=api+worker db=app-db buckets=1 volumes=1
40s verified=false  services=[api:live, worker:live]
    failures=[secret-unavailable@environments.production.services.api.secrets.APP_API_SIGNING_KEY]
    domains=[["api-production-3c177.up.railway.app","issued"]]
    notes=[database-provisioning-started, volume-mount-unobservable, bucket-region-ignored]
41s readState: api live, worker live, app-db live
```

Three things this settles rather than demonstrates:

- **`verified=false` is the correct answer.** The single failure is the tenant's unmet obligation, named with
  its environment and service — the reporting fix from #82 earning its keep on the first case it described.
  A green here would have meant the platform deployed without its signing key.
- **Managed database, volume and bucket all came up from one plan**, with the database through the template
  path and its volume created by Railway alongside it.
- **The certificate state is read, not inferred** — `issued` came from `syncStatus ACTIVE` on the generated host.

**Teardown, and what it exposed:**

```
removed:  service:production/api, service:production/worker,
          volume:app-db-volume, volume:worker-volume, project:platfolio-tenant-run
orphans:  bucket:4c75f785-62d2-42c9-a6f0-77c83ed42fab
failures: service-delete-failed@service:production/app-db -- "Problem processing request"
state after delete: Project not found
```

The project and everything in it is gone, so the two reports above are about *how* it went, not whether:
`serviceDelete` refuses a template-created database that has just acquired a volume, and the delete pass never
removes buckets. Both filed (#106 buckets never deleted, #107 `serviceDelete` refuses a database that owns a volume). An orphan list that reads `[]` here would have been a lie in a
different way — the bucket really was not deleted by us — which is the same honesty rule that kept `verified`
false above.

Deploys consumed by the run: three (two services and one database provisioning). No quota rejection.
