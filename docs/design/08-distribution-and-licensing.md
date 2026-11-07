# platfolio — distribution, packaging and licensing

Implements D11 and the reframed "open source + run locally on different CPU architectures and
operating systems" goal. Evidence in
[distribution review](../research/distribution-feasibility-review.md). Status: proposed.

## What ships as an artifact

| Artifact | Form | Audience |
| --- | --- | --- |
| Control plane | **multi-arch OCI images** (`linux/amd64`, `linux/arm64`), digest-pinned, published per release | hosted deploys, self-hosters |
| Local dev stack | one canonical `docker-compose.yml` generated from the manifest | every developer, including the platform authors |
| Per-platform integration | `.railway/railway.ts` + workflow files rendered from the manifest | the tenant's repo — this *is* the portability layer |
| Automation | `actions/platfolio@vN`, pinned by SHA, own release train | the tenant's CI |
| Installer | small cross-compiled CLI: `platfolio up` = bring up compose; `platfolio connect` = run onboarding | macOS/Windows/Linux users |
| Templates | Railway template (public for kickbacks; `HIDDEN`/`UNPUBLISHED` supported but kickback-ineligible) | one-click new tenant stacks |
| Optional | Helm chart, if/when Kubernetes tenants are a real request | — |

### Reframe of the "binaries" requirement

The compile problem is already solved; the dependency problem is not. Verified: `bun build --compile
--target=` documents eight targets (linux glibc+musl × x64/arm64, windows x64/arm64, darwin x64/arm64)
and full-stack executables embed the front end; `deno compile` cross-compiles to six targets from any
host and since 2.8 builds Astro itself; Node SEA is Stability 1.1, requires disabling
snapshot/code-cache for cross-builds, cannot load native addons from the VFS, and doesn't CI-test
macOS x64 or Alpine. But Postgres and a JVM IdP do not fit inside a binary — Keycloak's own docs ask
for "at least 750 MB" and its own Postgres — and distribution to macOS/Windows means Apple Developer
ID **notarization** ($99/yr, mandatory) and Windows code signing ($9.99/mo Artifact Signing or
$150–300/yr OV, with EV no longer granting instant SmartScreen bypass). Coolify, Dokploy and CapRover
— the closest comparables — all ship "curl script → Linux server + Docker," none ships a cross-OS
binary.

**So the promise becomes:** *"one command on any Linux; a signed installer on macOS and Windows that
manages Docker + Compose; multi-arch images for whatever CPU your workload needs."* Same user story,
roughly an order of magnitude less maintenance, and — importantly for D8 — the architecture requirement
that actually matters is **the hosted platforms'** architectures (`architectures: [amd64, arm64]` in
the manifest, honored by buildx and self-hosted runners), not the control plane's.

If a genuine "run the whole control plane on a laptop with no Docker" tier is ever wanted, the honest
scope change is `identity.mode: embedded` + a Postgres-compatible local store — and that variant must
be tested against the same manifests, or it is a second product with a second bug surface.

## Reproducibility and provenance

For every release: corresponding **source** available for each binary (tag + build instructions, and
a `--version` string carrying commit SHA + runtime version), **SBOM** published, image digests
recorded in the release attestation, GitHub Actions attestations/SLSA-style provenance where
available. macOS signing + notarization and Windows signing run in CI, with the signing identity
documented as an operator requirement in self-hosted builds (do not ship a private key in an
open-source repo).

## Licensing

Facts that anchor the choice ([research](../research/billing-oss-feasibility-2025-11-06.md)):
Coolify is **Apache-2.0** with self-hosted "free forever… no limitations" and monetizes its cloud
($5/mo + $3/server); Dokploy is Apache-2.0 core with a `/proprietary` directory under a "Dokploy
Source Available License"; GitLab is MIT with `ee/`; n8n uses a Sustainable Use License plus `.ee.`
files; Elastic's ELv2 says "You may not provide the software to third parties as a hosted or managed
service"; Redis is RSALv2/SSPLv1/**or** AGPLv3; HashiCorp BUSL-1.1 defines "competitive offering",
"Embedded", and makes internal use non-competitive; Sentry's FSL-1.1-Apache-2.0 has a two-year change
date and an explicit trademark clause; AWS renamed Elasticsearch Service to OpenSearch because the
**name**, not the code, was the scarce asset.

**OD2 options:**

| Option | Control plane | Customer-shipped artifacts | Tradeoff |
| --- | --- | --- | --- |
| **A — permissive core + `/proprietary`** (recommended) | Apache-2.0, with a documented `/proprietary` (or `.ee.`) directory for enterprise features (SSO/SCIM, audit export, white-label, multi-region) | Apache-2.0 | "open source" stays literally true, community-friendly, weakest anti-rebrand |
| B — BUSL/FSL with change date | source-available, e.g. 24 months → Apache-2.0, Additional Use Grant explicitly permitting internal use, self-hosting your own workloads, and agency work for client workloads | Apache-2.0 | strongest anti-hyperscaler; **not OSI open source**, so the README and marketing must say "source-available" |

Recommendation: **A**, because under D1/D2 the resale threat that restrictive licenses exist to fight
is already blocked by *provider policy* — Railway's AUP forbids reselling compute, and platfolio's
value is the catalog plus operations, not the right to forbid self-hosting. Revisit only if someone
actually rebrands it. Either way, non-negotiables:

- Everything a **customer ships** (templates, `railway.ts`, workflow files, SDK, their realm exports) is
  Apache-2.0/MIT, directory-declared, so an ejected stack carries no encumbrance.
- Redistribution permission for binaries stated in the license/README: copy/publish/redistribute
  unmodified copies including compiled artifacts, with license text and notices retained, no
  rebranding, and not as a competing managed offering.
- A **trademark policy** in the GitLab idiom: "platfolio" and the logo are reserved for the hosted
  service; descriptive and interoperability use permitted ("managed service for platfolio",
  "compatible with platfolio"); the mark may not be the first word of a fork or plugin name; logos
  reserved; explicit safe harbor for package managers and distros; naming rules for forks.
- A **security disclosure** path (bug bounty or documented `security@`) — mandatory posture for a
  product that provisions other people's infrastructure.
- `ENTERPRISE.md` describing what is in `/proprietary` and why, if option A is chosen; candid README
  wording about the license either way.

## Self-hosted support policy

- Supported window: latest minor **and** the one before; security cherry-picks to the previous minor
  for ~6 months; breaking changes only in minors with forward-only migrations; major roughly every
  2–3 years (mirrors Keycloak's published cadence, and the Coolify/Zitadel/Ory/Red Hat pattern of
  monetizing older-version support rather than withholding features).
- Migrations run at startup behind a lock, with an explicit "back up first" warning and a documented
  rollback story for the schema.
- Self-hosted and hosted share CI: the same manifests are rendered and validated against both the
  compose stack and `railway config plan`, so "works on our cloud" and "works in your laptop" are the
  same claim.
- Version visibility: build version compiled in, `/api/version`, update-check banner, and a published
  support matrix (platfolio version × manifest `apiVersion` × platform versions) — this is the
  mechanism that makes D9 ("platforms added over time") survivable operationally.
- **Feature-gating rule:** never gate security-relevant capability (authentication, SSO, encryption,
  audit, export) behind the paid tier. Gate convenience: managed upgrades, backups, monitoring,
  support SLAs, white-label, team features in `/proprietary`.
