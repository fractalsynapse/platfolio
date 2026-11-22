# Platfolio Control Plane — managed by platfolio

Platform `platfolio-control-plane` `0.4.0` (`api-service`).

## What runs here

- `.github/workflows/platfolio-managed.yml` applies `.railway/railway.ts` using **this repository's** credentials. platfolio
  dispatches it and verifies the result; it never writes to your infrastructure itself.
- The provider credential is a per-environment project token stored as a GitHub environment
  secret. platfolio stores no infrastructure credential of any kind.
- Ordinary `git push` deploys still work, including when platfolio is offline.

## Secrets you must set

- `SESSION_SIGNING_KEY` (service `status`; resolved by `preserve`)

No secret value crosses platfolio. Set these in your own provider project or as environment
secrets here; platfolio learns they are filled only from a healthy deployment.

## Services

- `status`

## Removing platfolio

1. Delete `.github/workflows/platfolio-managed.yml`.
2. Revoke the platfolio GitHub App installation.
3. Nothing else changes. The stack keeps deploying from your pushes and the desired-state file
   remains yours.
