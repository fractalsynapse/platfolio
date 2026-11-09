# 12 — Domains and DNS

How a hosted instance gets its hostnames, and how the tenant finds out what to do about DNS. The measured
basis is [railway-domains-dns-2026-11-09](../research/railway-domains-dns-2026-11-09.md); read it before
changing anything here. Provider-neutral where it can be, because Railway is the first implementation and
not the only allowed one.

## Four principles

1. **Ask, never synthesise.** Railway returns the exact records a domain needs
   (`dnsRecords { fqdn hostlabel zone recordType requiredValue currentValue status purpose }`). Every field
   of the tenant-facing checklist comes from that response, re-read on every poll. Hardcoding a shape —
   "CNAME the host to the service domain" — is wrong twice over: the routing target is Railway's own host
   rather than the service hostname, and new record purposes (`ACME_DNS01_CHALLENGE`) can appear after
   attach.
2. **Bring your own DNS, always.** platfolio publishes *instructions* and reads *state*; it never needs the
   tenant's DNS-provider credentials, and no capability may require them. Provider integrations that create
   records on the tenant's behalf are a possible additive seam later, never a prerequisite for a tenant
   whose provider we have not heard of.
3. **Infrastructure health and domain health are separate axes.** A platform is live on
   `{service}-{environment}.up.railway.app` while its custom domain waits on DNS the tenant owns. Merging
   them into one green makes a working deploy look broken, and makes `verified` mean something the provider
   contract cannot guarantee.
4. **Domain operations are free.** They consume no deployment, so polling is cheap: check every status tick
   and offer an explicit "check now". This is the one part of provisioning where we can be generous.

## Where a domain is defined

Split by who owns the knowledge:

- **The platform manifest** says which services are reachable from outside, with what shape of hostname, and
  any apex/wildcard policy. It knows `web` needs a public host on port 3000 and that the admin UI should not
  be publicly reachable. It does **not** know any real domain — the same manifest serves two tenants with two
  domains, so a literal `app.treedx.example.com` in a manifest is a fixture that will be copied into a tenant.
  Today's `services[].domains` are literal hosts; migrating them to patterns is **OD12**.
- **The instance** supplies the root domain per environment at creation: `treedx.com` production,
  `staging.treedx.com` (or a prefix rule) for staging. This is tenant data, lives with the instance, and is
  the only place a real hostname appears before it reaches the provider.
- **The plan** resolves the two together into concrete hosts, which is what the provider already consumes.
  Staging derivation (`staging-` prefix) exists in the renderer and moves here unchanged.

One root domain per instance is the MVP; multi-domain (a second hostname pointing at the same service, or a
per-service domain) is a later addition and the state model below already supports it, since records are
keyed per host.

## The flow

```
   1. check availability        customDomainAvailable(domain) -> { available, message }
        |                          before touching DNS or the provider, and it is the only place we get a
        |                          human reason rather than "please try again"
   2. attach                    customDomainCreate(...) -> CREATING, verified=false, VALIDATING_OWNERSHIP
        |                        the records come back WITH the created object
   3. publish the checklist     from dnsRecords[] plus verificationDnsHost/verificationToken:
        |                        host label, type, value, and the zone it belongs to
        |                        rendered as "copy these two records" — never as our own derivation
   4. tenant publishes DNS      their provider, their console; TTL is theirs
   5. poll                      re-read status; per-record PROPAGATED/REQUIRES_UPDATE, certificateStatus
        |                        VALIDATING_OWNERSHIP -> ISSUING -> VALID, or ISSUE_FAILED
   6. live, or failed with      retry via customDomainIssueCertificate(id) (provider's retryCertificate)
      a next action
```

Steps 1–3 happen inside one apply; nothing waits for DNS to succeed. That is only possible because attaching
before the records exist works — see the correction in the research note, which is the reason this flow has
three steps before the tenant does anything rather than four.

## What the tenant sees

Per hostname, one row, always with the value they must set and what we currently observe:

| State | Shown | Cause and next action |
| --- | --- | --- |
| `checking` | "Waiting for DNS" | published but not yet visible to the provider; TTL-sized patience, "check now" |
| `record-missing` | expected value, observed empty | publish the CNAME `probe → 1ggsepht.up.railway.app` in zone `fractalsynapse.com` |
| `record-wrong` | expected vs observed | both values shown; the common cause is pointing at the service hostname instead of the routing host |
| `ownership-pending` | TXT not seen | publish `_railway-verify.<label>` TXT; some issuers need it, some do not |
| `issuing` | "Certificate in progress", elapsed | no action; do not re-publish |
| `live` | host, port, certificate valid | — |
| `failed` | reason, re-issue button | `ISSUE_FAILED` carries `certificateErrorType`/`certificateErrorMessage` when present |

Copy-paste block per record, labelled with the *short* host (`probe`) and the FQDN (`probe.fractalsynapse.com`)
**and** the zone, because consoles differ on which one they want — that single confusion generates most of the
support in this area.

The checklist is shown on the instance page, in the connect flow's final step, and in the export package, from
one source in `packages/page-schema` — not three renderings that can disagree.

## Apex and wildcards, the two places the tenant's provider matters

- **Zone apex.** No A record of ours to point at, so an apex needs ALIAS/ANAME/CNAME-flattening from the
  tenant's provider. `dns.apexPolicy` in the manifest already restricts apex assignment to
  `cname-flattening-only`; the UI must say so at domain-entry time, not after a failed attach, because the
  provider's generic error will not name the cause.
- **Wildcards.** A wildcard and a concrete subdomain on the same suffix cannot coexist; the renderer refuses
  the conflict per environment (E21). The domain step should surface the same rule when the tenant types a
  `*.` host, and must show which record the platform will actually need — which we can only know after
  attach.

## Verification independent of the provider

Railway's `currentValue`/`status` is the authority: the certificate issues only when Railway agrees, so our
agreement cannot make a domain live. A second, optional source is resolving the records ourselves
(`dns.resolveCname` / `dns.resolveTxt`) — genuinely useful for the gap between "the tenant published it" and
"the provider has looked", where the provider may report a stale `REQUIRES_UPDATE` while DNS is fine.

That belongs behind a seam (`dns.probe`), injectable and testable offline, **advisory only**: our resolver
may upgrade a row to "published, waiting on provider", never to `live`. If it ever becomes the source of
green, we have a control plane that disagrees with the thing issuing certificates.

## Contract surface

`StateSnapshot.domains[]` gains, additively (minor bump):

```
records: [{ host, fqdn, zone, type: 'A'|'CNAME'|'TXT', value, current?, status: 'missing'|'wrong'|'propagated',
            purpose: 'traffic'|'ownership'|'challenge' }]
```

`dnsStatus`/`certificateStatus` stay as they are so existing consumers are unaffected; `records` is the
detail that makes the table above renderable. Availability failures get code `domain-not-available` with the
provider's message, and the create call is skipped — an attempt we know will fail produces the opaque error
the check exists to avoid.

## Out of scope

Buying domains through platfolio (`railwayDomain*`, nameservers, email forwarding), DNS-provider record
creation, per-service separate domains, domain-level access control, mTLS `trustedDomain*`, and IPv6/AAAA.
The first two are a different product (registrar-ish) and would put platfolio in front of the tenant's money;
the rest have no demand signal yet.
