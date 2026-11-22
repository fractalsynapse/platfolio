# Environments, reviewers and repository creation, measured (2026-11-10)

Run against the live org after the installation approved `administration: write`. Every line below is a
response, not an inference.

## What works

```
PUT /repos/fractalsynapse/platfolio/environments/production   {wait_timer:0}         -> 200
PUT /repos/fractalsynapse/platfolio/environments/staging      {wait_timer:0}         -> 200
PUT .../environments/staging {reviewers:[{type:"User",id:121749}]}                    -> 200
PUT .../environments/staging {reviewers:[{type:"App",id:…}]}                          -> 422 "App is not a possible value"
POST /orgs/fractalsynapse/repos {name:"platfolio-probe-template", private:true, ...}  -> 201
```

**Required reviewers are settable through the API.** The open question in #126 — "maybe that gate is UI-only,
which would be a real exception to everything-in-platfolio" — is answered in the useful direction: a
`User` or `Team` reviewer attaches to the environment, and only `App` is refused, which is correct since an
app must not approve its own deployments. So platfolio can create a production environment **with** its human
gate rather than handing the tenant a half-configured object. `PUT` is a full replacement, not a patch:
omitting `reviewers` leaves the gate alone, while `reviewers: []` removes it — and the response says 200
either way, so the caller cannot tell from status whether anything changed.

## What does not work, and why it is a single named cause

```
PATCH /repos/fractalsynapse/platfolio-probe-template  {is_template:true}  -> 404
POST  /repos/.../platfolio-probe-template/generate                         -> 404
DELETE /repos/fractalsynapse/platfolio-probe-generated                      -> 404
```

404 on all of them, **including with an unscoped token**. The repository was created (201) but the app cannot
see it afterwards: `fractalsynapse/platfolio` is the installation's entire repository selection, and a
repository the app creates is **not added to it**. `administration: write` opens org-level creation and nothing
else — so the template capability, and any lifecycle operation on a platfolio-created repository, is blocked by
installation scope rather than by an endpoint that forbids apps.

This is precisely the problem GitHub's **`repository_creation`** permission exists to solve:

> This more limited permission lets your app create repositories without granting access to other repository
> administration features. **Your app is automatically given access to repositories it creates.**

That sentence is now the whole reason #125 matters, and it is evidence rather than speculation: we have
measured that the alternative leaves the app unable to touch what it made. Note also that "the repository is
not visible" and "the repository does not exist" produce the **same 404**, which is how a scoping fact gets
mistaken for a missing capability.

Repository **deletion** by a user token additionally needs the `delete_repo` OAuth scope, so my own cleanup was
blocked too — see the debt below.

## Debt I created, and did not hide

The probe left **`fractalsynapse/platfolio-probe-template`** in the organization. The app cannot delete it
(outside its selection) and `gh` lacked the `delete_repo` scope, so it is still there and the maintainer must
delete it or grant that scope. Creating disposable resources carries an obligation to remove them; this time
the removal path required a credential I did not have, and that should have been anticipated before the first
`POST` rather than discovered at cleanup.
