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
                recordType: DNS_RECORD_TYPE_CNAME, requiredValue: "1ggsepht.up.railway.app",
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
   `1ggsepht.up.railway.app`, while the service domain for that environment is a different host
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
