# platfolio writes to a tenant repository (2026-11-10) — runbook step 3

**Outcome:** platfolio opened its first install pull request against a tenant repository —
[#122](https://github.com/fractalsynapse/platfolio/pull/122), draft, one commit, two files, base `staging`:
`.github/workflows/platfolio-managed.yml` and `PLATFOLIO.md`, 84 additions, no deletions, no secret values.
The installation token was minted for the run and revoked at the end.

## Three 403s that were not the same problem

`Resource not accessible by integration` turned out to be a generic answer with three distinct causes. Each
was separated by experiment, because the message doesn't distinguish them:

| Call | Result | Cause |
| --- | --- | --- |
| `PUT /repos/{repo}/environments/{name}` with `environments: write` | **403** | creating an environment is a repository-administration act; the app is **not granted** `administration: write` and asking for it on a token answers **422 "The permissions requested are not granted to this installation."** |
| `POST /git/trees` with an empty tree | **422** `Invalid tree info` | body, not permission — authorization was fine, which is what proved the next row was different |
| `POST /git/trees` containing a path under `.github/workflows/` with `contents: write` only | **403** | workflow files need `workflows: write`. Adding it: same call → **201** |
| `POST /git/trees` for `PLATFOLIO.md` with `contents: write` | **201** | ordinary paths are unaffected |

The workflow-path finding is the one that mattered: an install PR *is* a workflow file, so a token without
`workflows: write` cannot open one, and the error text is identical to a permissions gap in the app's
configuration. `open-install-pr.ts` now requests `contents · workflows · pull_requests` — narrowed, and revoked
immediately after.

## A design decision that came out of the environments 403

**platfolio does not create repository environments.** It checks presence and reports the answer. The
permission that would allow creation (`administration: write`) also allows editing settings and branch
protection, so requesting it would trade D25's claim for a convenience. And the alternative is better anyway:
either the tenant creates `production` with required reviewers — so **the human who owns the production gate
configures it** — or the environment appears implicitly on the workflow's first run and the gate is added
after. `app:check`/`install:pr` print `environment production: ABSENT — create it, with required reviewers,
before merging` rather than silently making one.

## What was left behind

The probes created **unreferenced blobs and trees** in the repository (two trees with `201`, a few blobs). They
are not on any branch or commit and GitHub garbage-collects them; noted because a claim of "nothing was
written" would have been false. No commit was created by the probes — only by the real run.

## What blocks merging #122

The generated workflow pins the managed action by commit SHA, and **that action does not exist yet** — so #122
is a draft that proves the write path and must not be merged. Filed as #123.


## Update: publishing into an empty repository (same day)

Three template repositories were published with this path, and two assumptions died on contact.

**The Git data API cannot bootstrap an empty repository.** `POST /git/blobs` answers **409 "Git Repository is
empty"** — no blob, therefore no tree, commit or ref. My `createInitialCommit` was written against a fake that
happily accepted blobs on an empty repo, so its tests passed and it could never have run. The branch now comes
into existence through the contents endpoint (`PUT /contents/{path}`), which does permit a first write, and the
full file set follows as one commit — two commits, honestly labelled, rather than a publisher that cannot
publish.

**"No history" and "I could not read the history" looked identical.** `GET /repos/…/commits` returns a **bare
array**; reading `.commits` gave `undefined`, which fell through to "not platfolio's", which routed both real
publishes down the pull-request path — creating two PRs that should never have existed. The same class of bug
as the first one: a response-shape assumption that fails quietly. Both shapes are now read, a 403 throws
instead of returning an empty list, and the closed PRs carry the explanation.

What the policy is now, and why: an empty repo is seeded and committed onto its default branch; a repo whose
commits are all `chore(platfolio)` is republished the same way (a pull request against our own output would ask
a human to approve a no-op every time); anything with someone else's history gets a branch and a PR, which is
what the `pull_requests` grant is for.

Final state: `platfolio-starter-web` (6 files), `platfolio-starter-worker` (6), `platfolio-shared-identity` (4),
each private, empty at first, with the template content verified by reading the tree and the bytes back from
the API rather than trusting the commit succeeded.
