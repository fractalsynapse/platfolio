# platfolio — billing, entitlements and tenant lifecycle

Implements D1 (sell management, not compute) and D3 (team subscribes, hosts many platforms).
Stripe facts verified in [research](../research/billing-oss-feasibility-2025-11-06.md); Railway
lifecycle facts in [feasibility](../platfolio-feasibility.md). Status: proposed.

## Commercial shape

| Layer | Object | Unit |
| --- | --- | --- |
| Plan | Stripe Product + flat Price → `entitlements.feature` lookup keys | per team |
| Capacity | `limit` rows keyed by entitlement lookup key | max instances, max services/instance, RAM ceiling, seats, environments |
| Instance | platfolio `instance` row; Railway project + GitHub repo | counted against `max_instances` |
| Infra | **not a platfolio line item** | the tenant's Railway bill (or Stripe APP line, OD1) |

Because D1 removes infra pass-through, billing is flat SKUs on `billing_mode=classic`. No meters,
no Metronome, no `usage`-based invoice lines in v1 — usage data is pulled only for internal margin
visibility and abuse detection ([06 § Telemetry](#telemetry-and-abuse)).

**Adding platforms over time (D9)** is priced as plan capacity, not as per-instance subscription
items: a Checkout session in `mode=subscription` supports at most 20 recurring line items, so a team
that adds instances must not grow an unbounded item list. One `additional_instances` quantity item
per plan, with the number enforced locally against `max_instances`.

## Entitlement source of truth

Stripe Entitlements for **capability flags**, a local table for **numbers**:

- `entitlements.feature` + `lookup_key` (≤80 chars) created in the Dashboard, attached to products;
  active state read via `GET /v1/entitlements/active_entitlements?customer=…`; changes pushed as
  `entitlements.active_entitlement_summary.updated`. There is **no POST** — only Stripe mints
  entitlements.
- Known edge: existing subscriptions pick up new product→feature mappings **only at the next billing
  period**. So any plan change that must take effect immediately (raising `max_instances`) is applied
  from the local `limit` table, with the entitlement event as confirmation rather than trigger.
- Enforcement happens in the API layer, on every mutation, from server-side state — never from a
  client-supplied plan name.

## Lifecycle state machine

Provisioning is a **controller loop** driven by these states, not a webhook handler
([02](02-architecture.md)).

```
pending_checkout
  → provisioning      checkout.session.completed (client_reference_id = team instance id)
  → pending_connect   waiting on GitHub App install + Railway connect + secrets set
  → active            invoice.paid AND entitlement active AND first healthy deployment
  → deploy_locked     past_due: no new releases, no scaling, everything else intact
  → suspended         unpaid / subscription.deleted: scale-to-zero, domains kept, data kept
  → exporting         tenant-initiated export window
  → archived          platfolio-side only: config retained, zero infra cost (no provider archive exists)
  → deleted           provider resources removed by the tenant's final job or left with the tenant
```

Numbers that must drive timers (verified from Stripe docs):

| Fact | Value | Design consequence |
| --- | --- | --- |
| First-payment window | **23 h**, else `incomplete_expired` + invoice voided | recovery creates a **new** subscription; checkout-abandonment UX must handle it; Smart Retries never retry the first payment |
| Default dunning on new accounts | Smart Retries, **up to 8 attempts within 2 weeks** | `deploy_locked` grace ≈ 14 days, customer-visible countdown |
| After the final attempt | Stripe stops; post-recovery outcome (`cancel`/`unpaid`/`past_due`/`pause`) is your Dashboard choice | platfolio decides explicitly; document it in the ToS |
| Stripe's instruction | "Revoke access to your product when the subscription is `unpaid`" | suspend at `unpaid`, not at `canceled` |
| Tax location missing | `invoice.finalization_failed` + `automatic_tax.status=requires_location_inputs` | blocks provisioning; treat as a visible gate, enable `tax_id_collection` (also yields `reverse_charge` for EU B2B) |
| Webhooks | no ordering guarantee; dedupe on `event.id`; ack 2xx then async; live retries up to 3 days | idempotent, out-of-order-tolerant ingest; reconcile against the API, not the payload |
| Proration | `proration_behavior` enum; `create_preview` + `proration_date` for honest mid-period changes; cancelling without prorating discards metered usage | N/A while flat-priced; keep the door open deliberately |
| Trial Offer API | requires `billing_mode=flexible` + API version `2026-09-30.endive`; no metered items; not on Payment Links | defer; legacy `trial_end` (≤2 years from `billing_cycle_anchor`) is enough for MVP |

Events to ingest at minimum: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
`invoice.finalized`, `invoice.finalization_failed`, `invoice.upcoming`,
`customer.subscription.created|updated|deleted|paused|resumed|trial_will_end`,
`entitlements.active_entitlement_summary.updated`, `customer.updated`, `charge.dispute.created`,
`charge.refunded`, `radar.early_fraud_warning.created`.

## Provisioning gates

An instance may not go `active` until: subscription state is `active`/`trialing` **and** an
entitlement covers the capability **and** the instance count is within `max_instances` **and** the
execution plane attests a healthy deployment **and** required secrets are all behaviorally verified
**and** (if custom domains) DNS records verify and the certificate is `ISSUED`. Partial success
stays in a named sub-state with a human-readable reason — never silently "live".

## Suspend, delete, eject — and why "transfer" is now mostly unnecessary

Under D1/D2 the tenant already owns the Railway project and the repo. Cancellation therefore is not
a transfer of infrastructure; it is **revocation of platfolio's ability to act**:

1. scale to zero via a final attested job (never `projectDelete`),
2. remove the installed workflow PR and revoke the GitHub App install,
3. revoke/rotate anything platfolio touched: platform OIDC client secrets platfolio *knows the name
   of* get rotated **by the tenant**, IdP admin credentials stay theirs,
4. stop all control-plane access; keep their export available for the documented window,
5. delete platfolio-side tenant data on the published schedule.

The harder case is a tenant who wants to **keep paying Railway but stop paying platfolio** while
keeping everything running: that is the eject flow, and it must be boringly good, because it is the
argument for buying platfolio in the first place. Contents (see also
[03 lifecycle.onEject](03-manifest-spec.md)):

- `.railway/railway.ts` at the applied revision, plus the manifest and renderer version,
- the workflow file(s) and a note on removing them,
- `railway config pull` output for drift truth,
- realm export with credentials redacted (P1 identity),
- secret **inventory** with names, sources and rotation notes — never values,
- data export steps (DB dump, bucket manifest, volume archives + checksums),
- `restore.md` written so a competent engineer succeeds without platfolio,
- an importable-elsewhere promise: the same stack must come up in plain Docker Compose.

### If a provider-side handover is ever needed

Railway's user→user **Transfer Ownership** (`projectTransferInitiate` → `projectTransferConfirm`)
requires the recipient to already be a project member, sends an email with **24 hours** to accept,
needs an active Hobby/Pro plan on both ends and 2FA on platfolio's account, and staff note that
**buckets block the transfer** ("delete them before you start"); workspace→workspace
`projectTransfer` needs membership too, and Hobby's 3-members-per-project cap sits on top. Treat any
such handover as a transaction with named failure modes, and prefer designs that never need it.

## Telemetry and abuse

- Per-instance usage is read from `projectServiceUsage` / `usage` / `estimatedUsage` (groupBy
  PROJECT_ID / SERVICE_ID / ENVIRONMENT_ID / BILLABLE / REGION) for **internal** cost awareness,
  quota enforcement and proactive notices — not invoicing (D1).
- Because the tenant pays the meter, runaway-cost risk mostly transfers to them — which changes the
  conversation from "protect platfolio's card" to "don't let a tenant torch their own bill by
  accident." Ship guardrails as a *feature*: resource ceilings from the plan's `limit` rows,
  `replicas` caps, alerts before their Railway usage limit (their own soft/hard limit), and an
  obvious "what changed" view.
- Abuse handling is now mostly delegated upstream (Railway's own AUP/DMCA, GitHub's), but platfolio
  still needs: an AUP at least as strict as upstream, a published abuse contact + response SLA, a
  DMCA designated agent with notice/counter-notice steps, a repeat-infringer policy, and a runbook
  for "Railway suspended a tenant project" (status surfaced in-app, appeal path pointed at
  Workspace Settings → Standing, no promise platfolio can fix it).
- Note Railway's workspace-level blast radius ("This workspace cannot create new resources or
  deploy…") — under the tenant-owned model this lands on the tenant, which is another argument for
  the model, and a thing to say plainly on the site.

## Merchant of record and tax (OD1)

- **Platfolio as MoR:** standard Stripe Billing; Stripe Tax does calculation + registrations
  (`oss_union`, `oss_non_union`, `ioss`, US state/local types) + filing options (automated filing US,
  Ireland non-Union OSS, Canada; EU partners Taxually/Marosa; global filing in private preview);
  "Stripe Tax only collects tax in jurisdictions where you have an active registration," and
  "Register for me" is US-only. You own registrations, filings, refunds and disputes.
- **Stripe Managed Payments as MoR:** Stripe handles tax in 80+ countries, explicitly supports
  website-hosting/IaaS tax codes, +3.5% on top of payment fees — but incompatible with Connect and
  no ad-hoc invoice items/one-off invoices. Harmless under D1 (no infra lines), attractive for a
  small team selling globally.
- **Connect is not needed** unless platfolio must move a third party's money (agencies paying out,
  or collecting-and-remiting infra bills). If a future tier needs it: `controller` replaces the
  deprecated `type`, and platform-priced Connect costs $2 per monthly-active-account + 0.25%+25¢ per
  payout.
- Decide before building the invoice pipeline: entitlement-driven feature flags look identical in
  both modes, but Managed Payments constrains invoice construction and Payment Links usage.

## Data-protection posture (platfolio as processor)

Because platfolio holds tenant metadata and (under `byo-oidc`/`hosted-realm`) may shape a tenant's
identity config, but **never** holds P1 credentials under I4:

- GDPR Art 28(2) sub-processor authorization + notice duty; Art 28(3)(g) delete-or-return at end of
  service; Art 28(3)(h) audit support; Art 17(1) erasure "without undue delay"; Art 12(3) one month
  (extendable by two with notice); Art 20 structured, machine-readable export "without hindrance";
  Art 32 security of processing.
- Backups may outlive a record only if put "beyond use" on a **published** schedule (ICO guidance) —
  so state live-deletion days and backup age-out days explicitly.
- Model the DPA on [Stripe's](https://stripe.com/legal/dpa) (30-day sub-processor notice, 30-day
  objection) and [Railway's](https://railway.com/legal/dpa) (10-day notice, "purges or anonymizes"
  on account deletion, deletion certificate on request); publish a sub-processor list (Stripe,
  Railway, GitHub, Sentry/observability, any email provider) and an EU representative contact.
- Keep billing records under a stated legal basis and disclose that they survive tenant deletion.
- Per-tenant audit log of export/suspend/delete actions, tenant-visible.

## ToS/AUP content owed by platfolio

Tenant-facing AUP no looser than upstream; flow-down clause for provider policies; acceptable-use
enforcement steps; resource limits and what happens at the ceiling; dunning/suspension/deletion
numbers; refund and dispute terms; upstream-suspension carve-out in any SLA; 16+ age requirement;
export/sanctions clause; trademark usage rules cross-linked from
[08](08-distribution-and-licensing.md).
