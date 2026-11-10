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
