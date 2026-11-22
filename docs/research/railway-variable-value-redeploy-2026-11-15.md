# Does Railway redeploy when a variable's value changes? (measured, 2026-11-15)

The maintainer's question, verbatim:

> "We need the ability to refresh / reload / reboot services when secrets and environment configurations change
> (the values). Changes in the composition of variables should automatically be handled as regular software
> deployments, however updating secret values should update the services as well. I do not know if Railway
> handles this currently."

**Answer, by arm.** Railway DOES redeploy on a value change — but only when the write is not suppressed, and our
own provider suppresses every write. The composition half was already handled; the secret half was not.

| arm | write | value | new deployment? |
| --- | --- | --- | --- |
| A | `variableUpsert` with `skipDeploys: true` (what `applyPlan`/`putSecretValue` did) | changed | **none in 120s of polling** |
| B | `variableUpsert` with `skipDeploys` omitted (Railway's default) | changed | **yes — Railway started one on its own** |
| C | explicit `serviceInstanceDeploy` | — | yes (the control: proves the detector sees real deploys) |
| D | `variableUpsert`, `skipDeploys` omitted | **identical** value re-written | **none in 120s** |

Arms B and D together are the finding: **the provider compares the arriving value with the one it holds and only
restarts on a genuine difference.** That is the change-detection mechanism, and it lives on the side that has the
value — which, under D4, is the only side allowed to have it.

## Method

Target: `api-staging` in environment `staging` of project `6cd60aab-1959-43d9-b8fd-d2d65d9a5c09`. Never production.
The variable was a probe name no service reads, so the experiment could not alter application behaviour — only the
deployment lifecycle was observed. Evidence is `deployments(input: DeploymentListInput)` id/createdAt/status
captured before each write and polled after, with the write's own wall-clock timestamp printed beside it. Arm C
exists because a negative result from a detector nobody validated is not evidence.

```
=== BASELINE ===   newest: 2026-11-14T21:21:48.084Z SUCCESS ede0c785
A  WRITE 2026-11-15T04:49:01.044Z skipDeploys=true   -> no new deployment through +120s
B  WRITE 2026-11-15T04:51:03.802Z skipDeploys=(omitted), value changed
   >>> NEW deployment fb0abae7 2026-11-15T04:51:04.953Z SUCCESS      (1.1s after the write)
C  explicit deploy 2026-11-15T04:51:25.347Z
   >>> NEW deployment 53ea197d 2026-11-15T04:51:25.192Z SUCCESS      (detector works)
D  WRITE probe-B-2 again, identical, skipDeploys omitted
   -> no new deployment through +120s
cleanup: probe variable deleted; staging-api /readyz 200
```

Corroborating prior evidence: `api-staging` booted with an empty `PLATFOLIO_DB_URL` because the reference
expanded to nothing at write time, and only a manual redeploy fixed it (#242). That is the same property seen
from the other side — a container's environment is a snapshot taken when it was deployed, not a live view of the
variable store.

## What was already true

Composition changes (a variable NAME added or removed) flow through `applyPlan` and deploy, because the plan hash
covers the environments and `applyPlan` deploys every service deliberately, under `deployBudget`. Asserted, not
assumed, in `packages/contracts/test/railway-redeploy.test.ts` ("composition changes reach the provider through
applyPlan, and a plan-identical re-apply does not redeploy"). Note the test harness detail: `samplePlan()` carries
a CONSTANT `planHash`, so a fixture that mutates content without recomputing it describes a plan that changed
while claiming not to have — the assertion would then be checking the fixture's arithmetic. The test derives the
hash from the content, the way `buildPlan` does.

## What was missing, and what was deliberately NOT built

Missing: a verb. `applyPlan` is idempotent BY DESIGN, so asking it for a refresh either does nothing or forces
the issue by perturbing the plan hash — faking a configuration change to obtain a restart. Two changes:

1. **`InfraProvider.redeploy` (D48)** — `POST /api/v1/instances/{instanceId}/redeploy {environment, service?}`
   → 202. Provider-advertised, policy-tabled (`instance.redeploy` = member: a restart is a deploy, and members
   may already deploy), budgeted, audited. `verified` is an OBSERVATION of a changed deployment id, never the
   mutation's boolean — a test injects a provider that accepts the deploy and starts nothing, and the result must
   say `deployment-unchanged` rather than claim a restart.
2. **`putSecretValue({ refresh: 'auto' })`** — the write is sent WITHOUT `skipDeploys`, and the provider's own
   comparison (arms B/D) decides. The answer is one of three observed states: `redeployed`, `unchanged`, or
   `unknown` when the read-back could not be made. The default stays `suppress`, which is every caller's existing
   behaviour.

NOT built: a digest of each delivered value stored in a variable we own, or in platfolio's database. That was the
obvious design for "detect the change without reading it back", and it was rejected on the measurement: the
provider already diffs, so our digest would buy nothing while putting secret-derived material into a platfolio
store. A truncated digest of a low-entropy secret is dictionary-testable by anyone who can read the row, which
makes D4 a footnote rather than a rule. **The tradeoff accepted instead:** with `refresh: 'auto'` a restart is
requested by the caller's knowledge, not by our detection — an identical value costs nothing (arm D), but a
needless `auto` on a value that did change costs a container bounce, and `unknown` is a real answer when the
observation read fails. That is cheaper than a credential shadow.

## Connection to the credential-default defect (#248)

Same class, one sentence: **the platform reported a plausible outcome instead of refusing an unanswerable
question.** `identity:smoke` sent its loopback `platfolio-dev-only` default to the hosted issuer, received
`400 invalid_grant`, and the report said production's admin credential had been lost — it had not been supplied.
Here, `applyPlan` writes configuration with the provider's change-detection switched off and reports
"configured", while the running container keeps the old value. Both are cases where the information needed to
say "I cannot know this" existed and was not used. The fixes share a shape: make the silent assumption either an
explicit request or a refusal with a named remedy (`scripts/identity-credentials.ts`; `RedeployResult.refused`).

## Side finding: our own root registry cannot be merged into our own plan (measured)

While diffing platfolio's composition against the published `shared-identity` template, the same measurement
surfaced why the two platforms carry the SAME obligation in DIFFERENT files:

| | how `KC_BOOTSTRAP_ADMIN_PASSWORD` reaches the plan | who applies it |
| --- | --- | --- |
| template | `environment.yaml` row (`kind: secret, service: keycloak, required: true`) | `open-install-pr.ts` → `applyInventory` merges registry rows into the manifest |
| platfolio | `compose.yaml` → `x-platfolio.secrets` | `platform-deploy.ts` renders the composition; it **never** calls `applyInventory` |

That is not stylistic. Measured (`applyInventory(our manifest, our registry rows)`):

```
registry rows with no `service:` field: 83 of 86
secrets per service BEFORE (composition only): {"api":3, "identity":1}
secrets per service AFTER  (registry merged):  {"api":18, "identity":17}
identity's 17 include: CR_PAT, DATABASE_URL, KC_ADMIN_PASSWORD, RAILWAY_TOKEN,
                       STRIPE_WEBHOOK_SECRET, PLATFOLIO_DISPATCH_TOKEN, OIDC_CLIENT_SECRET …
```

`applyInventory` treats a service-less secret row as an obligation on **every** service
(`const targets = secret.service ? [secret.service] : Object.keys(services)`). Our root registry is a
*repository* registry — it carries CI tokens, host-shell script credentials and template placeholders
together with deployment values, which is what D52 asked for — so merging it into a plan would demand
`STRIPE_WEBHOOK_SECRET` from Keycloak. `platform-deploy.ts` therefore cannot follow the D58 sentence
("it is an input, not documentation") for our own platform without breaking the deploy, and today it does not.

Consequence to keep in view: **the template's registry-as-plan-input path and platfolio's own deploy path are
not the same path.** The dogfooding claim ("platfolio is deployed by the code path a tenant uses") holds for
the composition, not for the registry. Either the root registry gains `service:` on every deployment row (and
CI/host rows move to a separate scope), or `applyInventory` stops broadcasting a service-less secret to every
service. Not fixed here: it is a design decision with a tenant-facing shape, and the answer changes what a
fork inherits.

## Follow-up defect found while checking the retired names (measured, not fixed here)

`scripts/platform-deploy.ts --prune-vars` takes the **logical** service name and looks it up against the
provider's **physical** rows, so after D57 it cannot find anything it is asked to prune:

```
$ tsx scripts/platform-deploy.ts --prune-vars=identity.KEYCLOAK_ADMIN
  no service named "identity" in this project          # the row is `identity-production`
```

Two other rough edges in the same path, both observed while reading it: the branch re-implements the project
lookup instead of calling `maintenanceTarget()` like `--redeploy` does, and its error text ("run the apply
first") is wrong for this case — the apply had run and succeeded. Not fixed here because pruning the retired
`KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` variables is a deletion on a live production service and the
brief's boundary says deletions are not mine to make unilaterally. They are inert (26.8 does not read either
name), so leaving them costs nothing but tidiness; `--prune-vars=identity-production.KEYCLOAK_ADMIN,...` with
the name spelled as the provider holds it is the workaround until the flag resolves names the way the plan does.
