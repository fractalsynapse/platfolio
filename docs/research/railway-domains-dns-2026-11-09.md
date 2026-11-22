# Railway domains and DNS — measured against a real zone (2026-11-09)

Workspace `82ba4aff-…66b2`, project `platfolio-iac-sample`, service `web` (created, never deployed), CLI 5.71.0 /
`railway@3.16.0` / GraphQL v2. **No deployment was consumed by anything in this document**: domain operations
are metadata, not deploys. The test domain is `probe.fractalsynapse.com`, supplied by the maintainer; project
tokens were minted and revoked inside the session (`projectTokens` is empty afterwards).

## Correction: attaching before the DNS exists is NOT refused

An earlier note concluded that `customDomainCreate` requires the records to exist first, from a call with
`probe.platfolio-does-not-exist.example`. That was wrong, and the reason matters: **the zone did not exist**.
Against a real zone (`fractalsynapse.com`, `ns-cloud-d1.googledomains.com`) with no record published at all,
creation succeeded immediately:

```
syncStatus: CREATING
verified: false
certificateStatus: CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP
verificationDnsHost: "_railway-verify.probe"
verificationToken: "railway-verify=<64 hex>"
dnsRecords: [ { fqdn: "probe.fractalsynapse.com", hostlabel: "probe", zone: "fractalsynapse.com",
                recordType: DNS_RECORD_TYPE_CNAME, requiredValue: "<generated-railway-host>",
                currentValue: "", status: DNS_RECORD_STATUS_REQUIRES_UPDATE,
                purpose: DNS_RECORD_PURPOSE_TRAFFIC_ROUTE } ]
```

So the order is **attach first, then read what DNS to publish** — which is the flow the provider should
implement, and the opposite of what the earlier note advised. The failed call for a nonexistent zone still
returns a useless message (`Failed to create custom domain, please try again`), so a pre-check is required
for anything other than a generic "the provider refused it".

## The pre-attach check exists and takes only the domain

```
customDomainAvailable(domain: "probe.fractalsynapse.com") -> { available: true, message: "Available" }
```

`DomainAvailable` is `{ available: Boolean!, message: String! }`. There is a matching
`serviceDomainAvailable(domain)`. Neither is project-scoped, and neither returns records — it answers
"can I claim this", which is exactly what a form needs before asking the tenant to edit DNS. This is what
turns the opaque create failure into a cause with a next action.

## Railway's own record vocabulary

| Enum | Values |
| --- | --- |
| `DNSRecordStatus` | `PROPAGATED`, `REQUIRES_UPDATE`, `UNSPECIFIED` |
| `DNSRecordPurpose` | `TRAFFIC_ROUTE`, `ACME_DNS01_CHALLENGE`, `UNSPECIFIED` |
| `DNSRecordType` | `A`, `CNAME`, `NS`, `TXT` |
| `CertificateStatus` | `VALID`, `ISSUING`, `VALIDATING_OWNERSHIP`, `ISSUE_FAILED`, `UNSPECIFIED` |

Three consequences for the checker:

1. **Per-record state is authoritative and observable.** `requiredValue` vs `currentValue` plus
   `PROPAGATED`/`REQUIRES_UPDATE` distinguishes "not published yet", "published but wrong", and
   "published and accepted" — states a UI must show separately, because their fixes differ.
2. **The record set is not fixed at attach time.** `ACME_DNS01_CHALLENGE` exists as a purpose, so a second
   record can appear later when certificate issuance needs it. A checklist rendered once from the attach
   response will go stale; it has to be re-read on every poll, which costs nothing.
3. **The routing target is Railway's, not derived from the service hostname.** The required value was
   `<generated-railway-host>`, while the service domain for that environment is a different host
   (`web-production-…up.railway.app`). Any implementation that synthesises the CNAME target from the
   service name — the obvious shortcut — produces a record that will never validate.

## What is and is not secret here

`verificationToken` (`railway-verify=<64 hex>`) and the CNAME target are **public DNS values**: anyone who
can query the zone can read them once published, and they are handed to the party that owns the zone. They
are not tenant secrets under D4 and may be rendered and cached. They must still never be written to a log
at info level or above, because a verification value that shows up in logs invites "why is this here" and
because the zero-secret invariant is easier to keep when the rule is "record *names and public values* in
state, nothing in logs".

## Other domain surface found, unused so far

`customDomainUpdate(environmentId, id, targetPort)`, `customDomainDelete(id)`,
`customDomainIssueCertificate(id)` (wired as `retryCertificate`), `serviceDomainCreate/Update/Delete`,
`domains(environmentId, projectId, serviceId) -> AllDomains { customDomains, serviceDomains }` (a single
read for both kinds — probably the right source for readState instead of descending through
`serviceInstances`), and a whole `railwayDomain*` family for domains *purchased through Railway*
(nameservers, DNS record CRUD, email forwarding), plus `trustedDomain*` for mTLS. None of these are needed
for "bring your own domain", and purchasing through platfolio is out of scope.

## Still unmeasured

- Whether `certificateStatus` reaches `VALID` on its own once the CNAME is published, how long it takes,
  and whether an `ACME_DNS01_CHALLENGE` record is required for the first certificate on a new domain.
  This needs the maintainer to publish one CNAME (the record above) and leave it for a poll cycle.
- Whether `REQUIRES_UPDATE` clears without our intervention or only after Railway's own check cadence.
- Zone-apex behaviour (`apexPolicy`: CNAME at a zone apex needs ALIAS/ANAME flattening from the tenant's
  provider) — unchanged from the earlier feasibility research, still not tested by us.
- `probe.fractalsynapse.com` remains attached to `platfolio-iac-sample` as `CREATING`; deleting it or
  publishing the CNAME is the maintainer's call.

## Live progression, measured after the maintainer published DNS

Timeline for `probe.fractalsynapse.com` on project `platfolio-iac-sample` (service created but **never
deployed**, so the routed host answers nothing — HTTP 000 — while the domain machinery still runs):

| When | Observed |
| --- | --- |
| attach, no DNS at all | `syncStatus: CREATING`, `verified: false`, `certificateStatus: VALIDATING_OWNERSHIP`, `dnsRecords[0] = CNAME required=<generated-railway-host> current="" REQUIRES_UPDATE TRAFFIC_ROUTE` |
| after the CNAME was published | `syncStatus: **ACTIVE**`, record `currentValue: <generated-railway-host>`, `status: **PROPAGATED**` — **but still `verified: false`, `VALIDATING_OWNERSHIP`** |

So the traffic route and the certificate are genuinely **two independent states**, which is what D25's
two-axis design is for: a tenant can have a working host pointing at nothing while ownership is pending,
and a UI that merged those into one green would be describing two different failures.

And the ownership check needs its own record, which is **not in `dnsRecords`**: Railway discloses
`verificationDnsHost: _railway-verify.probe` and `verificationToken: railway-verify=<64 hex>` separately,
and `verified` stays false until that TXT exists (`dig TXT _railway-verify.probe.fractalsynapse.com` is
empty). That is exactly the shape the provider now maps into the same record list with
`purpose: 'ownership'` — a checklist built only from `dnsRecords` would have told the tenant they were
done after the CNAME, and the certificate would never arrive.

**Open**: whether `VALIDATING_OWNERSHIP → ISSUING → VALID` completes unaided once the TXT is published,
and how long it takes. A watcher polls `domains(...)` every 60s for up to 45 minutes
(`.research/domain-watch.sh`, no deploys, logs each change) and its output goes here when it terminates.
Also unexplained and worth noting: through `domains(...)`, `CustomDomain.status.syncStatus` returned
`null` while `domains(...).customDomains[].syncStatus` returned `ACTIVE` — the *top-level* field is the
one that carries the value, so a provider that selected `status { syncStatus }` would silently lose it.

## The ownership TXT never appears in `dnsRecords`, even while it is the only thing blocking us

After the maintainer published the TXT, both our resolver and `1.1.1.1` returned it correctly:

```
_railway-verify.probe.fractalsynapse.com.  TXT  "railway-verify=962e6da0…b347"
```

Railway's response, nine consecutive polls over ten minutes:

```json
{ "verified": false, "certificateStatus": "CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP",
  "records": [ { "recordType": "CNAME", "currentValue": "<generated-railway-host>",
                 "status": "PROPAGATED", "purpose": "TRAFFIC_ROUTE" } ] }
```

Two separate facts in that payload.

**The record set is incomplete by design.** `dnsRecords` contains only the routing CNAME — the ownership
TXT, which is the *only* thing standing between this domain and a certificate, is disclosed exclusively as
the `verificationDnsHost`/`verificationToken` pair and never joins the array. So a checklist rendered from
`dnsRecords` alone is provably insufficient: it would have shown "1 of 1 records propagated" and left the
tenant staring at `VALIDATING_OWNERSHIP` forever with nothing left to do. The provider's synthetic
`purpose: 'ownership'` entry is therefore not a convenience, it is the only path to a complete instruction
list. (Timing of the state change is still being watched; see below.)

**Propagation was fast, verification cadence is not.** The CNAME went `REQUIRES_UPDATE` → `PROPAGATED` and
`syncStatus` went `CREATING` → `ACTIVE` between two reads minutes apart. The TXT has been correct at the
authoritative resolvers while `verified` stayed false across ten minutes of polling, so Railway re-checks on
its own schedule rather than per-read. That has a UI consequence worth stating: "we can see your record and
Railway hasn't looked yet" is a *different* state from "your record is missing", and only our own resolver
distinguishes them — which is the actual argument for the `dns.probe` seam I had written off as unnecessary.
It is unnecessary for *authority* (the provider decides) but necessary for *explanation*, and the two are not
the same requirement.

Watcher: `.research/domain-watch.sh`, one poll per 60 s, exact-match terminal conditions (see the note about
`*VALID*` matching `VALIDATING_OWNERSHIP`), zero deploys. Outcome appended below when it settles.

## Outcome: verified, issued, and served — with timings that belong in the UI copy

The maintainer published the TXT at ~23:24. Our resolver and `1.1.1.1` both returned it immediately;
Railway's state moved like this, one poll per 60 s:

```
23:35:36  verified=false  cert=VALIDATING_OWNERSHIP
23:36:37  verified=true   cert=VALID            <- TERMINAL, watcher exits
```

and the edge now serves a real leaf for the exact name:

```
subject=CN=probe.fractalsynapse.com
issuer=C=US, O=Let's Encrypt, CN=YE1
notBefore=Nov  9 03:37:40 2026 GMT   notAfter=Feb  7 03:37:39 2027 GMT   (90 days)
```

**Ownership verification took ~11–12 minutes after the record became publicly resolvable.** Not a TTL, not
an instant, not an hour — a cadence we control nothing about. That number is worth putting in the UI
("we can see your record; Railway typically checks within about ten minutes"), because the alternative is a
tenant refreshing a page at minute two concluding it is broken. It is also the measured justification for
the `dns.probe` seam: for those eleven minutes our resolver and the provider *legitimately disagree*, and
only a control plane that can say so has a useful thing to show.

**No challenge record was ever required.** The `ACME_DNS01_CHALLENGE` purpose exists in the enum and the
provider maps it to `purpose: 'challenge'`, but `dnsRecords` held exactly one entry — the routing CNAME —
from attach through `VALID`. Let's Encrypt validated over the routed host. So the mapping stays as
forward-compatible handling, not exercised behaviour, and should be described that way.

**`customDomainIssueCertificate` returned `true` inside the same minute as the automatic transition, so its
effect cannot be attributed.** Verification flipped and the status reached `VALID` in the ~60 s window that
also contained our re-issue call; the cert's `notBefore` lands ~1 minute after the watcher's last line. The
honest statement is that the mutation is accepted, is cheap, is the right lever to offer a tenant whose
certificate is stuck at `ISSUE_FAILED`, and that **this run did not establish it was needed or sufficient**.
A clean A/B would need a domain deliberately stuck in failure.

**The record set stayed incomplete as predicted.** Throughout, `dnsRecords` never contained the ownership
TXT — only `verificationDnsHost`/`verificationToken` disclosed it, and `verified` stayed false until it
existed. A checklist built from `dnsRecords` alone would have reported "1 of 1 propagated" while the
certificate could not proceed. Confirmed empirically now, not inferred from schema shape.

Everything above cost **zero deployments**: attach, poll, verify and issue are metadata operations. Full
timeline for `probe.fractalsynapse.com` — attach with no DNS at all → `CREATING`/`REQUIRES_UPDATE`; CNAME →
`ACTIVE`/`PROPAGATED`, still unverified; TXT → `verified: true` → `cert: VALID` → LE leaf served at the edge,
with the ownership record never appearing in the records array.

## Clean live pass: the provider provisions and deletes a managed database (2026-11-09)

Fresh instance (`pclean`, plan hash `deadbeefdeadbeef`), one environment, one service, one template database,
one volume. **Two deployments consumed.** No project or resource left behind.

| t | observation |
| --- | --- |
| 45s | `verified=true`, `failures=[]`, app service `api` at `live` |
| 45s | notes: `database-provisioning-started`, `volume-mount-unobservable` |
| 46s | `readState`: `clean-db live`, `api live` -- the **provider-created** database is live |
| 114s | `removed`: `service:production/clean-db`, `service:production/api`, `volume:api-volume`, `volume:clean-db-volume`, `project:platfolio-pclean` |
| 114s | `orphans=[]`, no delete failures |

Three claims that were previously only argued and are now measured:

1. **The provider creates managed databases.** Not a direct API probe any more: `applyPlan` ran the template
   path, waited for the asynchronous deploy, and read the service back as live.
2. **The provider can delete them** (#80). The template database is removed with the rest of the instance --
   after the retry and volumes-before-services ordering from #82. Railway creates a volume for it
   (`clean-db-volume`) and we delete that too.
3. **Volumes are created and attached live** (`volume:api-volume`), while mount state remains unobservable on
   this grant, which the `volume-mount-unobservable` note states rather than glossing.

On #79's queueing hypothesis: two deployments in one project settled inside 45s on the same day an earlier run
watched a service sit at `deploying` for 300s. So ceiling-queueing is **not** the normal condition; the stuck
case stands as an unreproduced observation, and the failure code that would report it honestly
(`database-provision-timeout`) exists and is tested in both directions.

Two self-inflicted errors worth keeping in the record because they cost nothing and taught something:
`projects: Not Authorized` was my probe passing `{kind, token}` to a constructor expecting
`{ workspaceToken }` -- an empty bearer, and a truthful answer from the API; and a plan rejected by schema
validation because I used `clean` as a hex hash (`l` and `n` are not hex). Both failed *before* spending a
deployment, which is the point of validating at the boundary.
