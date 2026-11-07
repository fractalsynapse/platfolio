# Distribution feasibility review — "open source + binaries for every CPU arch and OS"

Date: 2026-11-07. Research question for the planned platfolio control plane (Astro/React UI,
Node/Bun server, Postgres, Keycloak OIDC, Docker Compose local dev, Railway prod). The author also
wants to "distribute it as open source and provide binaries you can run locally on different CPU
architectures and operating systems." This report assesses that goal against primary sources.
Every claim is tagged **[V]** (verified against the cited primary doc/repo), **[P]** (partially
verified — cited but statement incomplete or inferred), or **[U]** (unverified).

---

## 1. Single-binary distribution options for a TS/Node/Bun stack

### 1a. Node.js Single Executable Applications (SEA)

- Status: **Stability 1.1 – Active development**; feature added v19.7.0/v18.16.0; first-party CLI
  generation (`node --build-sea sea-config.json`) only added in v25.5.0. [V]
  <https://nodejs.org/api/single-executable-applications.html>
- Mechanism: inject a "preparation blob" (bundled script + optional assets/snapshot) into a `node`
  binary. "The version of the Node.js binary used to produce the blob must be the same as the one to
  which the blob will be injected." [V] — so you download per-target node binaries and inject per platform.
- Cross-platform limitation (verbatim): "When generating cross-platform SEAs (e.g., generating a SEA
  for `linux-x64` on `darwin-arm64`), `useCodeCache` and `useSnapshot` must be set to false to avoid
  generating incompatible executables." Startup performance features must be dropped for any
  cross-built artifact. [V]
- Native addons: "Native addons (`.node` files) cannot be loaded directly from the VFS because
  `process.dlopen()` requires files on the real file system. To use native addons in a SEA with VFS,
  write the asset to a temporary file first." The VFS itself is "Early development" (added v26.9.0)
  and cannot combine with snapshot/code-cache. [V]
- Platform support (verbatim): "Single-executable support is tested regularly on CI only on the
  following platforms: Windows; macOS (arm64 only; x64 is not currently supported and is skipped in
  the tests); Linux (all distributions supported by Node.js except Alpine and all architectures
  supported by Node.js except s390x)." [V]
  <https://raw.githubusercontent.com/nodejs/node/main/doc/api/single-executable-applications.md>
- Signing: docs require `codesign --sign -` on macOS after build; Windows signing optional and
  "the unsigned binary would still be runnable." [V]
- Module loading: in the injected main script, `require()`/`import` only see built-ins; you must
  bundle the whole app (e.g. esbuild) or use the new VFS. [V]
- Startup size: a SEA is a full Node binary + app (tens of MB). Exact sizes not documented — [U].

**Verdict on SEA:** workable for a CLI, weakest option for a 5-target server matrix: per-platform
injection, snapshot/code-cache disabled when cross-building, macOS-x64 not even CI-tested, Alpine
unsupported, addon friction (a Node-postgres stack using `pg` is pure JS and survives bundling; any
`better-sqlite3`/`@node-rs` dependency does not — [P]).

### 1b. `bun build --compile`

- Docs: <https://bun.com/docs/compiler/executables>. Cross-compilation via `--target`; documented
  supported targets (verbatim table): `bun-linux-x64`, `bun-linux-arm64` (glibc),
  `bun-linux-x64-musl`, `bun-linux-arm64-musl`, `bun-windows-x64`, `bun-windows-arm64`,
  `bun-darwin-x64`, `bun-darwin-arm64`. [V] — this covers all five requested combos × (musl
  variants extra).
- Full-stack executables (Bun ≥ v1.2.17): "When you import an HTML file in your server code, Bun
  bundles the frontend assets (JavaScript, CSS, and so on) and embeds them into the executable …
  a single file you can deploy anywhere without installing Node.js, Bun, or any dependencies." [V]
  This is exactly the "binary embeds the web UI" story (works for an Astro static client + Bun
  server routes; a full Astro SSR integration is not documented — [U]).
- SQLite: `bun:sqlite` works in compiled executables; embedded DBs are possible but "the embedded
  database is read-write. Because the database is stored in memory, all changes are lost when the
  executable exits" unless you use the on-disk (non-embedded) form. [V]
- New experimental AOT compiler (`bun compile`): "Ahead-of-time compilation is experimental" and
  "`bun compile` only builds for the platform it runs on … add `--no-aot` to build for another one."
  [V] <https://bun.com/docs/compiler/aot> — i.e. the AOT path *cannot* cross-compile today.
- Code signing: documented macOS guide — "To codesign a standalone executable on macOS (which fixes
  Gatekeeper warnings), use the `codesign` command … We recommend including an `entitlements.plist`
  file with JIT permissions." [V] Windows: only `hideConsole`-type flags documented; those "can't be
  used when cross-compiling because they depend on Windows APIs." [V]
- Native modules: the AOT compatibility page states "The language, every `node:` and `bun:` module,
  Workers, native addons, macros, `Bun.build` plugins and nearly all npm packages work." [V] No
  documented restriction on which host OS may target which platform for `bun build --compile`;
  historically darwin targets required care (signing must happen on a macOS host) — host→target
  matrix beyond the table is **not documented** [U]. Postgres drivers (`pg`, `postgres` npm) are
  pure JS — no known blocker [P].
- Note (signal, not a doc claim): Bun is "now part of Anthropic" per bun.com footer — long-term
  governance of the compiler is a bet, not a certainty. [V for the statement itself]

### 1c. `deno compile`

- Docs: <https://docs.deno.com/runtime/reference/cli/compile/>. "Deno supports cross compiling to
  all targets regardless of the host platform." Documented `--target` list: `x86_64-pc-windows-msvc`,
  `aarch64-pc-windows-msvc` (≥ Deno 2.9.3), `x86_64-apple-darwin`, `aarch64-apple-darwin`,
  `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`. [V]
- **Framework detection (Deno 2.8+): `deno compile .` detects Astro** (also Next.js, Fresh,
  Remix, React Router, SvelteKit, Nuxt, SolidStart, TanStack Start, Vite SSR/SPA) and runs the
  build so "the compiled binary always contains a fresh build." Directly relevant to platfolio's
  Astro front end. [V]
- Native addons: `--self-extracting` "extracts all embedded files to disk on first run … useful for
  scenarios where code needs real files on disk, such as native addons", with documented trade-offs
  (first-run cost, disk use, higher memory, "Users or other code can modify the extracted files on
  disk" tamper risk). [V]
- Signing: macOS compiled binaries are ad-hoc signed by default; "Refer to the official
  documentation for more information on codesigning and notarization on macOS"; Windows via
  `signtool`. [V]
- No musl target (Linux builds are `unknown-linux-gnu` only) — Alpine hosts are not covered. [V]
- Deno also has `deno desktop` (Deno 2.9+) with the same 5-triple matrix, pure-Rust MSI/AppImage/
  deb/rpm packaging, cross-compile from any host, and documented CI matrix; only the macOS `.dmg`
  "must be built on a macOS host." [V] <https://docs.deno.com/runtime/desktop/distribution/>

### 1d. Go wrapper that shells out to Docker/Podman

- Category precedent: this is effectively what every comparable control plane actually ships — a
  small installer (bash script today) that installs Docker and runs a compose stack (§3). A Go/Rust
  CLI doing `docker compose up` is low-risk and cross-compiles trivially **because the application
  itself stays in containers**; the binary is a thin installer, not the product runtime. [V for the
  installers; the "Go wrapper" framing itself is my synthesis]
- GoReleaser (the standard tooling for such multi-target Go CLIs, <https://goreleaser.com>) has, in
  v2, "Builders" for **Go, Bun, Node.js, Rust, Zig, Deno, Python** plus "Import pre-built binaries"
  — i.e. first-class support for releasing JS-runtime artifacts alongside Go ones, with checksums,
  SBOMs (some artifact types Pro), Docker manifests, attestations, and "Publish to … Homebrew …
  Winget AUR … Chocolatey". [V]
- GoReleaser Pro is "a **paid, closed-source distribution** of GoReleaser" whose pitch is literally
  "teams that ship macOS and Windows installers, **sign and notarize natively** …" — i.e. native
  sign/notarize is a paid feature; OSS sign relies on external signers (cosign/Azure Key Vault etc.).
  [V] <https://goreleaser.com/pro/>

### 1e. Realistic verdict for the 5-target matrix

- **Can one CI job produce a binary for linux/{amd64,arm64}, darwin/{arm64,x64}, windows/{x64,arm64}?
  Build-wise, yes** — Bun (`bun build --compile --target`, 8 documented targets) or Deno
  (`deno compile --target`, 6 documented targets, any-host cross-compile, Astro-aware) both do it
  from one Linux job. Node SEA is the weakest (per-platform injection, cross-built artifacts must
  disable snapshot/code-cache, macOS x64 untested upstream). [V]
- **The "trustworthy, self-contained" part fails on platfolio's own architecture, not the runtime:**
  the control plane cannot run without Postgres (or a substitute) and, as scoped, without Keycloak —
  a JVM service (≥750 MB–2 GB, §2). No JS single-binary embeds those. So the binary would be
  "self-contained" only for the app layer; every local install still needs external DB + IdP unless
  you build option (c) (§3). This is the core feasibility finding.
- **Windows is the second-class citizen everywhere:** all three runtimes sign Windows binaries only
  via external `signtool` with a purchased certificate; Bun even auto-appends `.exe` and warns about
  Windows-API-dependent flags under cross-compile. Expect the most unknowns here. [P]
- **Maintenance cost (estimate, [U]):** 5–8 release artifacts per version; smoke tests must run on
  real macOS and Windows CI hosts (GitHub is retiring Intel macOS images on the N-1 policy —
  macOS 13 retired Dec 2025, macOS 14 retired Nov 2026; Apple-Silicon runners still "support Intel
  (x64)" per the macos-26 changelog, but the Intel pool is shrinking); per-runtime churn (Bun AOT
  experimental, Deno 2.9 desktop/quickjs engine experimental "does not receive the same security
  updates"); signing pipelines per OS; and a support matrix where users' bug reports are OS-specific.
  This is realistically a recurring part-time job *per release train*, on top of the product.
- **Reproducibility / SBOM / signing:**
  - Docker images: buildx multi-platform via QEMU emulation ("Emulation with QEMU can be much slower
    than native builds, especially for compute-heavy tasks like compilation"; docs recommend native
    nodes or cross-compilation instead) with manifest lists pushed to a registry; SBOM/provenance
    attestations exist in BuildKit. <https://docs.docker.com/build/building/multi-platform/> [V;
    attestations page not re-fetched — P]
  - GoReleaser: checksums + SBOMs in OSS; some SBOM sources and installer types Pro; native
    sign/notarize Pro. [V]
  - JS-runtime SEAs: no documented reproducible-build story from Node/Bun/Deno for end-user
    binaries [U — absence of documentation, verified by review of the cited pages].
  - **macOS:** "Beginning in macOS 10.15, all software built after June 1, 2019, and distributed
    with Developer ID must be notarized." Notarization requires a Developer ID identity from the
    Apple Developer Program — "99 USD per membership year."
    <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>,
    <https://developer.apple.com/programs/enroll/> [V]
  - **Windows:** <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options>
    documents: Azure (Trusted) Artifact Signing "Basic Plan: $9.99/month … Premium $99.99/month",
    limited to "USA, Canada, EU, UK" and consumer apps (not drivers); traditional OV Authenticode
    certs "$150–300/year depending on the CA and certificate tier"; EV "$400+/year" and no longer
    grants instant SmartScreen bypass ("Same as OV since 2024"); unsigned builds trip SmartScreen
    reputation friction until trust accrues. [V]

---

## 2. What the "local" variant actually needs — the IdP problem

### Keycloak in a binary? No.

- Keycloak is a Quarkus/JVM server. Container docs: heap is sized from the container limit
  (`-XX:MaxRAMPercentage=70`, `-XX:InitialRAMPercentage=50`); "you should **always set the memory
  limit** for the container … you should set the memory limit to **at least 750 MB**. For smaller
  production-ready deployments, the **recommended memory limit is 2 GB**."
  <https://www.keycloak.org/server/containers> [V]
- HA sizing guide: "The base memory usage for a Pod including caches of Realm data and 10,000 cached
  sessions is 1250 MB of RAM … approximately 300 MB of non-heap … For each 15 password-based user
  logins per second, allocate 1 vCPU." <https://www.keycloak.org/high-availability/single-cluster/concepts-memory-and-cpu-sizing> [V]
- It requires an external relational DB for anything real (`--db=postgres`; "In production mode the
  default value of `dev-file` is deprecated"), plus HTTPS/hostname config, plus a pre-built
  container image (`kc.sh build` in a Containerfile). `start-dev` "should be strictly avoided in
  production environments because it has insecure defaults." [V]
- **Verdict:** embedding Keycloak "in a binary" is meaningless — the minimum honest local stack is
  Keycloak (JVM, ~1–2 GB, needs its own Postgres schema) + Postgres + platfolio, i.e. a compose
  file, which is precisely what a "binary" was supposed to obviate.

### Lighter OIDC alternatives (same central-identity goal)

| Option | Language / form | Footprint (documented) | Standalone OIDC provider? | License | Maturity |
|---|---|---|---|---|---|
| **Keycloak 26.x** | Java/Quarkus, server | ≥750 MB limit; 2 GB recommended for small prod [V] | Yes (full IdP + admin UI) | Apache-2.0 [V, GitHub API] | Very mature; heavy; upgrade pain (§5) |
| **Authentik** | Python/Django server (+ worker, Postgres, Redis) via docker-compose | "A host with at least 2 CPU cores and 2 GB of RAM"; compose method "for test setups and small-scale production setups" [V, docs.goauthentik.io/install-config/install/docker-compose] | Yes (OIDC + SAML, proxy provider) | repo license shows NOASSERTION on GitHub API (MIT core + enterprise parts) [P] | Mature, popular (~26k★) |
| **Zitadel** | Go binary/server + CockroachDB/Postgres | "ZITADEL itself requires approximately 512MB of RAM and can operate with less than one CPU core"; test env "1 CPU and 512MB memory are more than enough" [V, zitadel.com/docs] | Yes (OIDC + more; own UI) | **AGPL-3.0** per GitHub API [V] | Mature (~15k★, active); AGPL is a real constraint if platfolio bundles/distributes it |
| **Ory Hydra** | Go, "Internet-scale OpenID Certified™ OpenID Connect and OAuth2.1 provider … integrates with your user management through **headless APIs**" [V, repo description] | Small (Go + Postgres); Ory also ships a "single binary" enterprise build [P] | **OAuth2/OIDC provider only — NOT a full IdP**: no login UI, no user store; you must run Kratos or your own login/consent app [V by description] | Apache-2.0 [V, GitHub API] | Mature; integration cost is the point (it's a component, not a product) |
| **oidc-provider (npm `panva/node-oidc-provider`)** | TypeScript **library** you mount in your server | ~zero extra process; needs a storage adapter (memory/Redis/Postgres) | Implements OIDC Core/Discovery/DynReg/PKCE/etc. — a real, certified-spec authorization server **but embedded, and you must build the login flow** [V, README feature list] | MIT, active (pushed Nov 2026, ~3.8k★) [V, GitHub API] | Long-standing, widely used |
| **Better Auth (+ OAuth/OIDC Provider plugin)** | TypeScript framework/library inside your app | No separate process | Plugin "turns your Better Auth server into an authorization server that implements OAuth 2.1, OpenID Connect Core, and RFC 8414 metadata" [V, better-auth.com/docs/plugins/oauth-provider] | MIT, very active (~30k★) [V, GitHub API] | The provider plugin is new; no OpenID certification claim found [U]; session-auth product first, IdP second |
| **Lucia** | TS session library | n/a | **Not an OIDC provider, ever.** Officially deprecated: "Lucia was deprecated in March 2025." [V, lucia-auth.com] | MIT | Dead end for new work |
| **Keystone** | TS GraphQL CMS | n/a | **Not an OIDC provider** (app framework w/ auth plugin) | — | Wrong category |

**Flags:** Lucia and Keystone are not real OIDC providers (the question anticipated this). Hydra and
oidc-provider are genuine OIDC authorization servers but "not a central-identity product out of the
box" — you build users/login UX yourself. The only drop-in *server* replacements for Keycloak are
Authentik and Zitadel, and Zitadel carries AGPL.

---

## 3. The realistic distribution architectures — pick one

### What the comparable PaaS control planes actually ship (all [V], cited above)

- **Coolify**: install = `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash` ("Docker
  Engine using the official Docker method or let the install script handle it automatically").
  "Coolify only runs on Linux-based operating systems." Min 2 CPU / 2 GB / 10 GB, amd64 or arm64.
  Codebase: PHP (Laravel) + Docker images; Apache-2.0; self-hosted "Free forever … Full access to
  all features", paid offering is **Coolify Cloud $5/mo (2 servers) + $3/server**.
  <https://coolify.io/docs/start-with-self-hosted>, <https://coolify.io/pricing>
- **Dokploy**: install = `curl -sSL https://dokploy.com/install.sh | sh`; supported OS list is
  Ubuntu 18.04–24.04 / Debian 10–12 / Fedora 40 / CentOS 8–9 (Linux only); "at least 2GB of RAM and
  30GB of disk space". Docker + Traefik based; TypeScript server; Apache-2.0-style license file
  (GitHub API reports NOASSERTION; repo LICENSE text is Apache per fetched header) [P]; paid
  Enterprise add-ons (SSO etc. documented in its own docs tree).
  <https://docs.dokploy.com/docs/core/installation>
- **CapRover**: "Install CapRover on a fresh Ubuntu 24.04 server… AMD64 or ARM64 server, public
  IPv4, sudo/root access. At least 1 GiB RAM and 5 GiB free disk space"; install via
  `curl -fsSL https://get.caprover.com -o caprover-install.sh && sudo bash caprover-install.sh`;
  Docker/Swarm based; TypeScript, Apache-2.0. <https://caprover.com/docs/get-started>

**Nobody in this product category ships a cross-OS single binary.** All three are Linux-server +
Docker, distributed as container images plus a one-line install script; Coolify monetizes with a
hosted control plane, not binaries.

### The options

- **(a) Container images + tiny installer CLI (`docker compose pull/up`).** Matches every precedent;
  one code path with Railway (which deploys the same images); local dev = the same compose file the
  user runs. Cost: users must have Docker/Podman; "binary" dream becomes an installer (Go/Bun/Node
  via GoReleaser, trivial to cross-compile). **Lowest total cost, highest parity.**
- **(b) Self-contained binary + external Postgres + external IdP.** Technically buildable (Bun/Deno
  matrix §1), but the binary only removes the runtime install, not the setup work — a user still
  provisions Postgres and Keycloak. It is a convenience wrapper, and every bug now has an extra axis
  (embedded vs installed runtime behavior). **Cost ≈ whole §1 maintenance tax for ≈ zero reduction
  in the user's actual friction.**
- **(c) Binary + embedded DB (SQLite/PGlite/libsql) + embedded auth.** This is a *different
  product*: parity with hosted/Railway Postgres behavior breaks (SQL dialect, JSONB, concurrency,
  WAL-mode file locking on network shares; PGlite is a WASM build of Postgres still badged
  "status-alpha" [V, repo README]). Embedded auth means platfolio itself becomes the IdP (oidc-provider
  or Better Auth plugin per §2) — extra security surface you now own. Windows + file-DB +
  always-on-server is a long tail of filesystem-permission and AV/signing problems. **[Reframe or
  drop.]**
- **(d) Helm chart / Railway template / Terraform.** Railway templates are native, documented, and
  monetizable: "Creating a template allows you to capture your infrastructure in a reusable and
  distributable format… earn kickbacks from usage, up to 25% for open source templates"; template
  updates ("Learn how template updates work for authors and consumers") are a built-in distribution
  channel. <https://docs.railway.com/templates/create.md>, <https://docs.railway.com/templates/updates.md> [V]
  A Helm chart is optional for k8s users (Coolify/Dokploy/CapRover don't ship one for *themselves*).

### Pick

**(a) as the primary "open source distribution" + (d) as the two one-click paths (Railway template;
optional Helm). Fold the "binary" wish into the installer CLI of (a): a small GoReleaser-published
CLI (Go, or Bun/Deno-compiled) that does `platfolio up` → pulls pinned images and runs compose.**
That is the pattern the category has converged on and it keeps a single build artifact (the image)
per component.

---

## 4. Config drift across compose / Railway / binary

- **One manifest, generated views.** Keep `compose.yaml` canonical (it is also your dev environment).
  Publish images per release with immutable digests; the Railway template and any Helm chart should
  reference the **same image tags/digests**, never rebuild.
- **Railway templates as generated artifact:** the template format captures "services, environment
  configuration, network settings"; reference variables use `${{NAMESPACE.VAR}}` syntax and
  "Template variable functions allow you to dynamically generate variables … on demand when the
  template is deployed." [V]
  <https://docs.railway.com/variables/reference>, <https://docs.railway.com/templates/create.md>
  Practical approach: script that reads a single `platform.yaml` (your source of truth) and emits
  (i) compose, (ii) Railway template JSON via Railway's API/template update flow, (iii) env
  validation in the server at boot. Verify the emitted Railway template by deploying it in CI.
- **compose → k8s via Kompose:** exists today — "Kompose – Convert your Docker Compose file to
  Kubernetes or OpenShift" <https://kompose.io/> [V]. Caveat [U]: conversion tools lag Compose spec
  features; treat the Helm chart as a maintained artifact, not a cron-job output of Kompose.
- **Terraform provider for Railway:** there is **no official provider**. Railway's own docs index
  (docs.railway.com/llms.txt, fetched 2026-11-07) contains no Terraform/Pulumi page — its documented
  automation surfaces are the GraphQL API ("railway api — Query the Railway public GraphQL API"),
  CLI, and templates. [V by inspection] The registry entry is
  `terraform-community-providers/railway` (<https://registry.terraform.io/providers/terraform-community-providers/railway/latest/docs>),
  repo <https://github.com/terraform-community-providers/terraform-provider-railway> — community
  maintained, minimal README, requires a Railway API token [V]. Pulumi has no Railway provider; only
  the generic "Any Terraform Provider" bridge, which would wrap that community provider [V].
  Earlier `agilp94/terraform-provider-railway` now 404s [V].
  **Answer: raw GraphQL + templates + official CLI remain the better substrate today.** A community
  TF provider is riskier than the GraphQL API you control the versioning of; revisit if Railway
  ever publishes first-party IaC. Crossplane exists ("Crossplane is a control plane framework for
  platform engineering", docs.crossplane.io [V]) — relevant only if platfolio's *own users* want
  k8s-native self-service, not for platfolio's distribution.
- **Binary adds a third config axis** (env + file paths + platform services like keychain/networking
  firewalls). This is an argument *against* option (b)/(c) that is easy to underestimate: every fix
  must be validated on 5 OS targets, not 1 image.

---

## 5. Versioning & update path for self-hosted installs

- **Knowing it's outdated (minimum practical):** build version into the artifact (Bun
  `--define BUILD_VERSION` is documented [V]); serve `/api/version`; on boot query GitHub Releases
  (or the registry for image tags) and show a banner with the changelog URL. Coolify's model —
  "Automated or self-managed updates" for self-hosted [V] — is the honest framing: you are only
  obligated to make updates easy, not automatic.
- **Postgres schema:** run migrations at startup behind a lock, with backup-before-migrate warnings.
  Study Keycloak's own documented behavior as the bar you must meet: "Keycloak can automatically
  migrate the database schema … By default, the database is automatically migrated when you start the
  new installation for the first time. Before you migrate the database, shut down all Keycloak nodes
  … **Migration is not supported with the default H2 based dev-file database type** … By default
  Keycloak sets a migration timeout of 30 minutes." And: "creating an index on tables with millions
  of records can be time-consuming and cause a major service outage" → manual-migration path exists.
  <https://www.keycloak.org/docs/latest/upgrading/> [V] Ory even documents "Revert database
  migrations" — schema rollback is a top-asked capability. [V, docs nav]
  For platfolio: Flyway or node-pg-migrate/Drizzle/Kysely migrations; keep each release one
  migration hop (refuse to start across >1 minor with unverified migration path); never auto-migrate
  on an unverified backup.
- **Keycloak realm upgrades are a documented pain, and platfolio inherits it.** The Keycloak
  Upgrading Guide is a wall of per-version "Breaking changes / Notable changes / Deprecated
  features"; "Starting with Keycloak 26.6.0 rolling updates of **patch** releases are supported…
  Shut down Keycloak if no rolling update is supported, for example if you perform a minor or major
  upgrade." Admins must "Review the migration changes from the previous version" before every
  bump. [V] If platfolio ships a managed realm, every Keycloak CVE/breaking change becomes your
  release and your users' maintenance event. This is the strongest argument for swapping IdP choice
  per deployment (a compose parameter) rather than promising Keycloak-specific realm semantics in a
  "binary."
- **Backwards-compat promises + support window (recommendation):** follow the Keycloak-cadence model
  but shorter: state "self-hosted supported versions = latest minor + 1"; security fixes
  cherry-picked to the previous minor for ~6 months; DB migrations guaranteed forward-only for
  consecutive minors; breaking changes only in minors with a documented migration (major every few
  years). Rationale: you cannot test 5 OS × N versions; comparable projects monetize exactly this
  gap — **Coolify: self-hosted free forever, paid Cloud/enterprise hosting; Zitadel: support plans
  tied to enterprise purchase orders for self-hosting ("With ZITADEL Enterprise you become eligible
  for support plans … for self-hosting ZITADEL", zitadel.com/docs/legal/service-description/support-services
  [V]); Ory: OEL images/private registry for paying customers; Red Hat sells the support policy for
  its Keycloak build (minor ~every 6 months, releases supported ~12 months,
  access.redhat.com/support/policy/updates/red_hat_build_of_keycloak_notes [V]).** Free =
  latest-only + community support; money = older-version support. Set that expectation in the
  README on day 1.

---

## Recommendation (for the author)

1. **Primary distribution = OCI images + one compose file + a tiny installer CLI** (GoReleaser-
   built Go or Bun-compiled binary doing `docker compose up`; all targets, cheap, no app-parity
   problem) **and a published Railway template** (built-in update channel and up-to-25% kickbacks
   for open-source templates). Helm chart only if k8s users actually ask.
2. **Keep Keycloak as one option, not a requirement.** For the "runs locally" story, make the IdP
   pluggable: Keycloak (parity with hosted) and a lightweight embedded path (oidc-provider inside the
   server, MIT/TS, or Better Auth's OAuth-2.1/OIDC provider plugin if you accept its youth) —
   Zitadel only if you accept AGPL; Authentik if the user will run a 2 CPU/2 GB compose stack anyway.
   Never ship Keycloak "inside the binary"; it is a JVM + DB dependency, ≥750 MB–2 GB by docs.
3. **DROP: the promise of "a self-contained binary that runs the whole control plane on any OS/CPU."**
   The runtime matrix (Bun 8 targets / Deno 6 targets) is solved; the *dependency* matrix (Postgres,
   JVM IdP, native addons, Windows AV/SmartScreen) is not, and no category leader ships it.
   **REFRAME: "one command anywhere on Linux; binary installer for Mac/Windows that manages Docker +
   compose."** Same user-facing sentence ("run platfolio locally"), ~10× lower cost, full parity.
4. **Budget, if they insist on the 5-target binary anyway:** Apple Developer Program $99/yr +
   notarization per release; Windows signing $9.99/mo (Azure Artifact Signing, region-limited) or
   $150–300/yr OV cert; macOS + Windows CI hosts (GitHub Intel macOS images are on retirement
   cadence); native-addon self-extraction (Deno) or VFS temp-file hacks (Node); plus an implicit
   promise to reproduce every OS-specific bug report. Also note `bun compile` AOT is explicitly
   experimental and cannot cross-compile; Deno's QuickJS engine "does not receive the same security
   updates"; Node SEA is Stability 1.1. None of the three is a foundation you can stand still on.

## Verification notes / limits

- All [V] items were fetched from the cited primary URLs during this session (curl/web_fetch),
  2026-11-07; quotes above are verbatim from those pages/repos. GitHub API metadata (license,
  language, pushed_at, stars) fetched for keycloak, authentik, zitadel, hydra, better-auth,
  lucia, oidc-provider, coolify, dokploy, caprover.
- The GUI's `web_fetch` proxy intermittently returned 403 (cache-signature errors); those fetches
  were re-run via direct `curl` — same URLs, content read directly.
- [U] items (startup-size numbers, Bun host→target undocumented restrictions, reproducibility of
  JS SEA binaries, Kompose feature fidelity, Better Auth OIDC certification) were searched for and
  **not found** in primary docs; they are explicitly not claimed.
- This file lives in the scaffold repo's `docs/` as a research record; it is not a project decision —
  record the accepted decision in the project's canonical location per AGENTS.md.
