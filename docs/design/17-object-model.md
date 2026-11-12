# The object model: who, which team, what platform, and what they share

Plain-English by default, because this is the model a tenant has to hold in their head to use platfolio at all.
Every relationship below is either **implemented** (a table and a `Store` method exist), **contract-only** (typed
in `packages/contracts`, nothing persists it), or **absent** (the model cannot express it yet). That labelling is
the point of the page: extensibility claims that are not checked against the schema are vocabulary.

## The chain, in one line

> A **person** belongs to **teams**; a **team** owns **instances**; an **instance** is a running copy of a
> **template**, wired to **one repository** and **one provider project**; and instances may **provide**
> capabilities to or **require** them from each other.

Money, entitlements and limits attach to the **team** — the team is the account. Billing does not chase
instances, and a person is never a billing unit.

## Entities as they are now

| Entity | Key | Holds | State |
| --- | --- | --- | --- |
| Person | `id` | kind (`human` \| `service`), label hint | implemented (#177) |
| Identity (a proof) | `(issuer, subject)` | personId, verifiedAt | implemented (#177) |
| Team | `id` | name | implemented |
| Membership | `(teamId, personId)` | role: `owner` \| `member`, addedAt | implemented (#173, rekeyed #177) |
| Instance | `id` | teamId, name, `platform` (a template id), state, provider, desired/applied plan hashes | implemented |
| Repository connection | `instanceId` | repo, default branch, pinned action SHA, installedAt | implemented |
| Provider connection | `instanceId` | tier (`managed`/`self-custody`), workspace/project hints, secret **names** | implemented |
| Plan | `instanceId` | the desired state + its digest | implemented |
| Dispatch | `id` | nonce, plan hash, action, environment, expiry, consumedAt | implemented |
| Attestation | `dispatchId` | result, resources, release, actor kind | implemented |
| Audit | `id` | actor kind + ref, action, target, detail | implemented |
| Capability offer | `(instanceId, capability)` | outputs as names + kinds + placement state | implemented (#176) |
| Capability share | `(instanceId, capability, toTeamId)` | cross-team grant; `*` is recorded, never implied | implemented (D42) |
| Binding | `(consumerInstanceId, capability)` | provider instance, destinations, bound/stale | implemented (#176) |
| Environment state | — | per-environment health (staging vs production) | **absent** |
| Entitlement / plan limits | — | seats, instance caps, features | **absent** |

## "Shared" means three different things, and only one of them is a noun

The word "platform" is currently overloaded three ways, and the confusion is not academic — it has already
produced a field named `platform` that stores a template identifier.

1. **Template** — the source of a kind of thing. Lives in `templates/`, published to
   `fractalsynapse/platfolio-*` repositories. A tenant never edits it; they copy it.
2. **Instance** — a running copy of a template, owned by exactly one team, deployed in that team's provider
   project. This is the unit platfolio manages, bills for, and reports status on.
3. **Shared service** — an *instance whose declared job is to serve other instances*: the identity case
   (`shared-identity`, a Keycloak that issues the realm other apps log in against). It is not a third kind of
   object. It is an instance that `provides:` a capability.

So "how do platforms relate to shared platforms?" has a short answer: **the same way an app relates to a
database someone else runs** — through a capability, not through a class of thing. `starter-web` declares
`capabilities: [identity]`; `shared-identity` declares `provides: identity` with outputs (`issuer`,
`jwks_uri`, `client_id`, `client_secret` marked secret). Contracts for that already exist and are typed:
`CapabilitySchema`, `RequiredCapabilitySchema`, `ProvidedOutputSchema`, `BindingSchema`, `BoundValueSchema`,
plus the output-state machine (`not-issued` → `issued-and-placed` → `re-issue-required`). What does **not**
exist is storage: platfolio can render the wiring into a manifest and cannot record that team A's web app is
bound to team A's Keycloak. Consequences of leaving that in the manifest only:

- no revocation path when a provider instance is removed (a consumer would keep pointing at a dead issuer);
- no way to answer "what breaks if I delete this?" -- which is exactly the question a tenant asks before a
  teardown, and the one #106/#107 exist to answer;
- no cross-instance visibility in the binding panel (it renders from a manifest, not from records);
- and no path to sharing across teams, which is the interesting case for a per-tenant identity host.

## The five places the model will not stretch, and what each needs

Ordered by how much damage they do if we build the CLI and API on top of them as they are.

**1. Bindings are not records.** → **Done (#176).** `capability_offers`, `capability_shares` and
  `capability_bindings` exist (migration `006`), one `checkBindingPolicy` shared by both drivers, and eight
  operations on the API. The provider side answers "what breaks if I remove this?" -- which is what D43's
  destroy consults before it refuses. Cross-team sharing is a grant, and revoking ages bindings to `stale`
  instead of deleting them.


**2. `Instance.platform` is a template id in a field called platform.** → **Done (#180, D45).** The field is
   `template`, and `templateRef: { repo, commitSha }` records the origin -- `commitSha` constrained to a full
   lowercase hex commit by schema *and* database CHECK, because a movable tag must not be stored as a fixed
   anchor (D30 law 3). Names are slugs, unique per team (`instances (team_id, name)`), enforced in both drivers,
   and an old payload carrying `platform` is refused rather than ignored. Same collision fixed in
   `InfraPlan.manifestRef`, which the provider is written against.

**3. Membership is keyed on a bare `sub` from a single issuer.** → **Done (#177).** `persons` and
  `identities (issuer, subject) → person_id` exist (migration `007`), membership references the person, and the
  request guard resolves a person from the **verified** claims before any handler runs. Two realms that mint the
  same `sub` are now provably two people -- asserted in the conformance suite, not argued. A person may hold
  several proofs; removing one does not touch their teams. `kind: 'service'` exists so a machine client can be
  a member through the same path as a human, because a parallel authorization scheme for tokens is how
  platforms grow a back door with different rules. `GET /api/v1/me` answers the question the CLI asks first:
  who does the platform think I am, and which teams does that person belong to.


**4. Roles are an enum with no policy in front of them.** → **Done (#178).** `packages/contracts/src/policy.ts`
  holds one table, `POLICY[action] = minimumRole`, and one function, `decide({ action, membership })`. Handlers
  no longer compare roles; they name an action and ask. Two answers, deliberately different: a non-member gets
  **404** (existence is not for them to learn), an under-roled member gets **403** with the role that would
  suffice -- they can already see the resource, so honest advice beats a mystery. `capability.share` and
  `instance.destroy` are owner-only (D42, D43); the destroy route does not exist yet, and the test asserts the
  decision anyway so the route cannot ship looser than the policy.
  A registry populated at **build** time lets a test walk the routes and assert that every one names an
  action, and that every action in the table is exercised by something -- the coverage is over the surface that
  exists, not over a hand-maintained list that drifts.


**5. State is per instance; reality is per environment.** → **Done (#179).** `instance_environments
   (`(instance_id, environment)` → state, applied plan hash, last attestation, migration `009`) is written by
   the controller from each attestation's own environment, and `Instance.state` is now a rollup with a stated
   rule: production's state when a production row exists, otherwise the worst environment, `pending` when there
   are none -- absence is not health. `rollupState()` lives in contracts, not in whichever driver noticed it
   first, and its severity order is total (`degraded` outranks `live`, not `failed`; `removed` is terminal, not
   merely bad). Instance responses carry `environments`, so no client has to guess which truth it is reading.

Absent but not a defect: entitlements and limits (M4), members' invitations, and the transfer/export path
(MVP item 9). Listed so nobody mistakes "not built yet" for "the model forbids it".

## How this serves the first functional release (API + CLI)

The CLI's first verbs are the model's nouns, which is why the vocabulary is worth getting right before it is
public:

```
platfolio login                                  # person (device flow, Keycloak)
platfolio team create|list                       # the account boundary
platfolio platform create --template starter-web # instance, from a template
platfolio platform status [<id>]                 # per-environment state (gap 5)
platfolio platform connect repo <org/repo>       # repository connection + pinned action ref
platfolio platform connect provider              # provider connection + tier (D24)
platfolio platform secrets <id>                  # names and presence only, never values (D4)
platfolio platform bind <consumer> --from <provider-instance>   # gap 1
platfolio platform dispatch <id>                 # returns the dispatch reference; never claims completion
```

Three properties the CLI inherits from the decisions above, and the reason to fix the model now:

- **A reference, not a claim.** `create` and `dispatch` return ids. "It's live" comes from an attestation the
  controller reconciled against the provider (D30 law 1), never from the request that started it.
- **Nothing secret in a flag.** No command accepts a secret value; secrets are named, and the tenant places
  them (D4). The CLI can show presence and health, and cannot show or store the value.
- **One language, two surfaces.** Every CLI verb is an HTTP call against
  [api/control-plane.openapi.yaml](../../api/control-plane.openapi.yaml) (D41). If a CLI action cannot be built on
  the published API, the API is missing an operation -- that is a defect in the API, not an excuse for a
  private back door.

## The four decisions, answered (D42-D45)

Recorded in [01](01-product-and-decisions.md) after this page was written; the answers shape what got built:

1. **Teams may share services with each other** -- but via an explicit `capability_shares` grant, not because a
   capability happens to be reachable. Revoking ages bindings to `stale` rather than deleting them: a running
   app keeps working, the intent is withdrawn, and the gap stays visible.
2. **`destroy` is owner-only and destroys the managed service only** -- never the repository (D36), never their
   workflow. Safety is structural: a destroy that would strand a consumer is refused with the consumer named,
   which is why `/consumers` exists before the destroy route does.
3. **Open SaaS needs invitations and self-service team creation** (#178 territory): an invited person is an
   *intent* to become a member, so invitations need their own states and must be claimed against a verified
   identity -- not an email someone typed.
4. **Instances are addressed `team/name`**, unique per team, repository-style slugs (#181) -- enforced in the
   schema and the database and exercised through the conformance suite, because an application-layer check would
   be a second rule the in-memory double would not reproduce.

**Team naming (#195, D45):** the team half of `team/name` is a slug, normalised on write and
unique across the platform -- enforced in the schema, in Postgres (`011`) and in the shared suite. Destroying an
instance (#196) consults `consumers` (#176) and refuses 409 while anything depends on it; it records
`deprovisioning` rather than claiming teardown, which remains execution-plane work.
