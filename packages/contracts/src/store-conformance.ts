import { AttestationSchema, type Attestation } from './attestation.ts';
import { RepoConnectionSchema, reasonOf, type DispatchRecord, type Store, type StoreError, type StoreResult } from './persistence.ts';
import { checkBindingPolicy } from './binding-policy.ts';

/**
 * The Store conformance suite -- the same cases for the memory double and Postgres (docs/design/10 OD8).
 *
 * Cases are written against the *interface*, so a driver-specific shortcut (a Postgres-only constraint the
 * memory double fakes, or an in-memory object leak no database would have) shows up as a failure here rather
 * than as a production surprise. The last few cases are the ones that earn this file its keep: they exist
 * because a naive in-memory store passes round-trips and fails isolation.
 */
export interface StoreCaseResult { name: string; status: 'pass' | 'fail' | 'not-implemented'; detail: string }
export interface StoreReport {
  driver: string;
  results: StoreCaseResult[];
  passed: number;
  failed: number;
  unimplemented: number;
  ok: boolean;
}

const nonce = 'a'.repeat(32);
const planHash = 'b'.repeat(64);

function attestationFor(dispatch: DispatchRecord, overrides: Partial<Attestation> = {}): Attestation {
  return AttestationSchema.parse({
    dispatchId: dispatch.id,
    instanceId: dispatch.instanceId,
    nonce: dispatch.nonce,
    planHash: dispatch.planHash,
    action: dispatch.action,
    environment: dispatch.environment,
    result: 'ok',
    resources: [{ kind: 'service', name: 'api', externalId: 'svc-1', status: 'live' }],
    release: { version: '0.1.0', commitSha: 'c'.repeat(40), imageDigest: `sha256:${'d'.repeat(64)}` },
    durationMs: 1_000,
    finishedAt: new Date().toISOString(),
    ...overrides,
  });
}

export async function runStoreConformance(make: () => Promise<Store> | Store): Promise<StoreReport> {
  const results: StoreCaseResult[] = [];
  const add = async (name: string, run: () => Promise<{ status: StoreCaseResult['status']; detail: string }>): Promise<void> => {
    try {
      const outcome = await run();
      // Field-by-field, so a case body cannot overwrite the title it is reported under (same mistake the
      // identity suite made, and it silently disabled name-matched assertions there).
      results.push({ name, status: outcome.status, detail: outcome.detail });
    } catch (error) {
      results.push({ name, status: 'fail', detail: `threw: ${(error as Error).message.slice(0, 200)}` });
    }
  };
  const fresh = async () => await make();
  /** Unwrap a StoreResult in a case body: a refused setup step is a failure with a reason, not a null. */
let teamSeq = 0;
/**
 * Team names are platform-unique now (#195), and the Postgres suite runs every case inside ONE scratch
 * schema -- so a literal name reused across cases collides with the previous case's row. A counter keeps each
 * case independent, which is what the memory driver already had for free from a fresh store per case. Without
 * this the two drivers would disagree about isolation itself, not about the rule under test.
 */
function tName(base: string): string { return `${base}-${String(++teamSeq)}`; }

function mustOk<T>(result: StoreResult<T>, label: string): T {
  if (result.ok) return result.value;
  throw new Error(`${label} refused: ${reasonOf(result)}`);
}

const expectErr = (result: { ok: boolean; value?: unknown } & Partial<StoreError>, code: StoreError['code'], label: string) =>
    result.ok ? { status: 'fail' as const, detail: `${label}: expected ${code}, got acceptance` }
      : result.code !== code ? { status: 'fail' as const, detail: `${label}: expected ${code}, got ${String(result.code)}` }
        : { status: 'pass' as const, detail: `${label} refused as ${code}` };

  const seed = async () => {
    const store = await fresh();
    const team = await store.createTeam({ name: tName('seed-team') });
    if (!team.ok) throw new Error('seed team create failed');
    const instance = await store.createInstance({ teamId: team.value.id, name: 'seed-app', template: 'starter-web' });
    if (!instance.ok) throw new Error('seed instance create failed');
    return { store, team: team.value, instance: instance.value };
  };

  await add('describe: names the driver and its readiness', async () => {
    const store = await fresh();
    const info = store.describe();
    return info.driver.length > 0 && typeof info.schemaReady === 'boolean'
      ? { status: 'pass', detail: `${info.driver}, schemaReady=${String(info.schemaReady)}` }
      : { status: 'fail', detail: `unhelpful describe(): ${JSON.stringify(info)}` };
  });

  await add('team and instance round-trip, ids assigned by the store', async () => {
    const { store, team, instance } = await seed();
    const readBack = await store.getInstance(instance.id);
    if (!readBack.ok) return { status: 'fail', detail: 'instance not found after create' };
    const teams = await store.listTeams();
    return teams.some((t) => t.id === team.id)
      ? { status: 'pass', detail: `${instance.id}, ${teams.length} team(s)` }
      : { status: 'fail', detail: 'listTeams did not include the created team' };
  });

  await add('team names are normalised, slugged and platform-unique (D45, #195)', async () => {
    const { store } = await seed();
    const suffix = String(++teamSeq);   // both spellings must land on the same name, so they share a suffix
    const made = mustOk(await store.createTeam({ name: `  Acme-Corp-${suffix} ` }), 'createTeam');
    if (made.name !== `acme-corp-${suffix}`) return { status: 'fail', detail: `not normalised: "${made.name}"` };
    const dupe = await store.createTeam({ name: `ACME-CORP-${suffix}` });
    const dupeVerdict = expectErr(dupe, 'conflict', 'a second team whose normalised name collides');
    if (dupeVerdict.status === 'fail') return dupeVerdict;
    // The address test: `team/name` is a URL segment, so these are not style preferences.
    // Names that stay invalid AFTER normalisation and suffixing. `UPPER` is not one of them: uppercase input
    // is normalised, not refused -- which is the friendlier reading of D45 and the one the pair above asserts.
    // My first version listed it here and the suite correctly refused to pass.
    for (const bad of ['Has Space', '-lead', 'trail-', 'a'.repeat(41), 'with/slash', 'under_score']) {
      // No suffix here: a refused name never persists, so there is nothing to collide with. Suffixing it was
      // my own error twice over -- it turned `-lead` into a valid slug by giving it a body, and `trail-` into a
      // valid one by giving it something to stop trailing. A fixture can defeat the thing it means to test.
      const refused = await store.createTeam({ name: bad });
      if (refused.ok) return { status: 'fail', detail: `accepted the team name "${bad}"` };
    }
    const readBack = mustOk(await store.getTeam(made.id), 'getTeam');
    // Compared against what was stored, not against a literal -- my first version hard-coded 'acme-corp' and
    // then failed on its own suffix, which is the same class of mistake as a snapshot that has to be edited.
    if (readBack.name !== made.name) return { status: 'fail', detail: `round-trip lost the name: ${readBack.name} != ${made.name}` };
    return { status: 'pass', detail: 'normalised, refused non-slugs, collides case-insensitively' };
  });

  await add('instance names are unique per team and reusable across teams (D45)', async () => {
    const { store, team, instance } = await seed();
    const dupe = await store.createInstance({ teamId: team.id, name: instance.name, template: 'starter-web' });
    const verdict = expectErr(dupe, 'conflict', 'a second instance with the same name in the same team');
    if (verdict.status === 'fail') return verdict;
    const other = mustOk(await store.createTeam({ name: tName('other-team') }), 'other team');
    const reused = await store.createInstance({ teamId: other.id, name: instance.name, template: 'starter-web' });
    // Two teams naming their own `marketing` is normal; a team having two is the collision. If both were
    // refused, `team/name` addressing would be over-constrained and users would invent suffixes.
    if (!reused.ok) return { status: 'fail', detail: `the same name in another team was refused: ${reasonOf(reused)}` };
    const badName = await store.createInstance({ teamId: team.id, name: 'Has Space', template: 'starter-web' });
    return expectErr(badName, 'conflict', 'a non-slug instance name');
  });

  await add('unknown ids answer with typed errors, never exceptions', async () => {
    const store = await fresh();
    const team = await store.getTeam('team-does-not-exist');
    const inst = await store.getInstance('inst-does-not-exist');
    const disp = await store.getDispatch('disp-nope');
    const allNotFound = [team, inst, disp].every((r) => !r.ok && r.code === 'not-found');
    return allNotFound ? { status: 'pass', detail: 'three lookups, three not-found' } : { status: 'fail', detail: JSON.stringify([team, inst, disp].map((r) => (r.ok ? 'ok' : r.code))) };
  });

  await add('referential guards: no instance without a team, no connection without an instance', async () => {
    const store = await fresh();
    const orphan = await store.createInstance({ teamId: 'team-missing', name: 'x', template: 'starter-web' });
    const a = expectErr(orphan, 'not-found', 'instance with unknown team');
    if (a.status === 'fail') return a;
    const conn = await store.putRepoConnection({ instanceId: 'inst-missing', repo: 'acme/app', defaultBranch: 'main', actionRef: 'e'.repeat(40), installedAt: new Date().toISOString() });
    return expectErr(conn, 'not-found', 'repo connection for unknown instance');
  });

  await add('persons and identities: the same subject in two realms is two people (#177)', async () => {
    const store = await fresh();
    const first = mustOk(await store.resolvePerson({ issuer: 'https://idp-a.test/realms/t', subject: 'shared-subject' }), 'resolve A');
    const again = mustOk(await store.resolvePerson({ issuer: 'https://idp-a.test/realms/t', subject: 'shared-subject' }), 'resolve A again');
    if (again.created || again.person.id !== first.person.id) {
      return { status: 'fail', detail: `re-resolving the same identity made a new person (created=${String(again.created)})` };
    }
    const twin = mustOk(await store.resolvePerson({ issuer: 'https://idp-b.test/realms/t', subject: 'shared-subject' }), 'resolve B');
    if (twin.person.id === first.person.id) {
      return { status: 'fail', detail: 'two issuers that mint the same sub were collapsed into one person -- the exact defect this change removes' };
    }
    const identitiesA = await store.listIdentities(first.person.id);
    if (identitiesA.length !== 1) return { status: 'fail', detail: `person A lists ${String(identitiesA.length)} identities` };

    const team = mustOk(await store.createTeam({ name: tName('identity-team') }), 'createTeam');
    mustOk(await store.putTeamMember({ teamId: team.id, personId: first.person.id, role: 'owner' }), 'putTeamMember');
    const byA = await store.teamsForPerson(first.person.id);
    const byB = await store.teamsForPerson(twin.person.id);
    if (byA.length !== 1 || byB.length !== 0) {
      return { status: 'fail', detail: `membership leaked across people who share a subject string: A=${JSON.stringify(byA)} B=${JSON.stringify(byB)}` };
    }
    return { status: 'pass', detail: 'idempotent per (issuer, subject); two realms, two people, two memberships' };
  });

  await add('persons may hold several proofs, and dropping one does not revoke access', async () => {
    const store = await fresh();
    const team = mustOk(await store.createTeam({ name: tName('multi-proof') }), 'createTeam');
    const person = mustOk(await store.resolvePerson({ issuer: 'https://first.test', subject: 'p1' }), 'first proof');
    mustOk(await store.putTeamMember({ teamId: team.id, personId: person.person.id, role: 'member' }), 'member');
    mustOk(await store.linkIdentity({ personId: person.person.id, issuer: 'https://second.test', subject: 'p1' }), 'second proof');

    const viaSecond = mustOk(await store.getPersonByIdentity('https://second.test', 'p1'), 'resolve by second proof');
    if (viaSecond.id !== person.person.id) return { status: 'fail', detail: 'the second proof resolved to a different person' };
    mustOk(await store.unlinkIdentity('https://first.test', 'p1'), 'unlink first proof');
    const teams = await store.teamsForPerson(person.person.id);
    if (teams.length !== 1) {
      return { status: 'fail', detail: `removing one proof changed membership to ${JSON.stringify(teams)} -- the person still has a valid proof` };
    }
    const afterUnlink = await store.getPersonByIdentity('https://first.test', 'p1');
    if (afterUnlink.ok) return { status: 'fail', detail: 'the unlinked proof still resolves' };
    return { status: 'pass', detail: 'several proofs, one membership; a dropped proof costs nothing' };
  });

  await add('membership requires a real person and answers with typed not-found otherwise', async () => {
    const { store, team } = await seed();
    const ghost = await store.putTeamMember({ teamId: team.id, personId: 'person-never-created', role: 'member' });
    const verdict = expectErr(ghost, 'not-found', 'membership for an unknown person');
    if (verdict.status === 'fail') return verdict;
    const teamless = await store.putTeamMember({ teamId: 'team-does-not-exist', personId: mustOk(await store.resolvePerson({ issuer: 'https://x.test', subject: 's' }), 'resolve').person.id, role: 'member' });
    return expectErr(teamless, 'not-found', 'membership in an unknown team');
  });

  await add('a refused write leaves no row readable afterwards', async () => {
    // The two drivers differ here on purpose: Postgres enforces the foreign key, the double checks by hand.
    // Both must refuse, because an orphaned membership would grant access to a team that does not exist.
    const { store } = await seed();
    const ghost = mustOk(await store.resolvePerson({ issuer: 'https://ghost.test', subject: 'sub-y' }), 'resolve ghost person');
    const rejected = await store.putTeamMember({ teamId: 'team-does-not-exist', personId: ghost.person.id, role: 'owner' });
    if (rejected.ok) return { status: 'fail', detail: 'the write was accepted' };
    const listed = await store.teamsForPerson(ghost.person.id);
    return listed.length === 0
      ? { status: 'pass', detail: `refused as ${rejected.code} and nothing readable` }
      : { status: 'fail', detail: `refused but granted: ${JSON.stringify(listed)}` };
  });

  await add('bindings: same team binds, and both directions are queryable', async () => {
    const { store, team } = await seed();
    const providerInst = mustOk(await store.createInstance({ teamId: team.id, name: 'identity', template: 'shared-identity' }), 'provider instance');
    const consumerInst = mustOk(await store.createInstance({ teamId: team.id, name: 'app', template: 'starter-web' }), 'consumer instance');
    const offer = mustOk(await store.publishCapability({
      instanceId: providerInst.id, teamId: team.id, capability: 'identity',
      outputs: [{ output: 'issuer', kind: 'url', state: 'issued-and-placed' }, { output: 'client_secret', kind: 'secret', state: 'not-issued' }],
    }), 'publishCapability');
    mustOk(await store.bindCapability({
      consumerInstanceId: consumerInst.id, capability: 'identity', providerInstanceId: offer.instanceId,
      destinations: [{ output: 'issuer', into: ['OIDC_ISSUER'] }, { output: 'client_secret', into: ['OIDC_CLIENT_SECRET'] }],
      boundBy: 'person-test',
    }), 'bindCapability');
    const consumers = await store.listConsumers(providerInst.id);
    if (consumers.length !== 1 || consumers[0]?.consumerInstanceId !== consumerInst.id) {
      return { status: 'fail', detail: `listConsumers gave ${JSON.stringify(consumers.map((c) => c.consumerInstanceId))}` };
    }
    const mine = await store.listBindings(consumerInst.id);
    if (mine.length !== 1 || mine[0]?.state !== 'bound') return { status: 'fail', detail: `consumer side: ${JSON.stringify(mine)}` };
    const available = await store.availableOffersForTeam(team.id, 'identity');
    if (available.length !== 1) return { status: 'fail', detail: `in-team discovery gave ${String(available.length)} offers` };
    const republished = mustOk(await store.publishCapability({ instanceId: offer.instanceId, teamId: team.id, capability: 'identity', outputs: [{ output: 'issuer', kind: 'url', state: 'issued-and-placed' }] }), 'republish');
    if (republished.instanceId !== offer.instanceId || republished.capability !== offer.capability) {
      return { status: 'fail', detail: `republish returned a different offer: ${JSON.stringify(republished)}` };
    }
    const offers = await store.listCapabilityOffers(team.id);
    if (offers.length !== 1) return { status: 'fail', detail: `republish accumulated ${String(offers.length)} offers` };
    return { status: 'pass', detail: 'bound, both directions listed, in-team discovery works, republish is idempotent' };
  });

  await add('bindings: self-binding is refused by the shared policy', async () => {
    const { store, team, instance } = await seed();
    const offer = mustOk(await store.publishCapability({ instanceId: instance.id, teamId: team.id, capability: 'identity', outputs: [{ output: 'issuer', kind: 'url', state: 'issued-and-placed' }] }), 'publish');
    const verdict = checkBindingPolicy({
      consumer: instance, provider: instance, offer,
      required: [{ output: 'issuer', into: ['OIDC_ISSUER'] }], shares: [],
    });
    if (verdict.ok) return { status: 'fail', detail: 'policy allowed an instance to bind to its own capability' };
    return { status: 'pass', detail: `refused: ${reasonOf(verdict.error)}` };
  });

  await add('bindings: cross-team needs a live share, and revoke ages rather than deletes (D42)', async () => {
    const store = await fresh();
    const teamA = mustOk(await store.createTeam({ name: 'team-a' }), 'teamA');
    const teamB = mustOk(await store.createTeam({ name: 'team-b' }), 'teamB');
    const providerInst = mustOk(await store.createInstance({ teamId: teamA.id, name: 'idp', template: 'shared-identity' }), 'provider');
    const consumerInst = mustOk(await store.createInstance({ teamId: teamB.id, name: 'app', template: 'starter-web' }), 'consumer');
    mustOk(await store.publishCapability({ instanceId: providerInst.id, teamId: teamA.id, capability: 'identity', outputs: [{ output: 'issuer', kind: 'url', state: 'issued-and-placed' }] }), 'publish');

    const offerRead = await store.getCapabilityOffer(providerInst.id, 'identity');
    if (!offerRead.ok) return { status: 'fail', detail: 'offer unreadable' };
    const denied = checkBindingPolicy({ consumer: consumerInst, provider: providerInst, offer: offerRead.value, required: [{ output: 'issuer', into: ['OIDC_ISSUER'] }], shares: [] });
    if (denied.ok) return { status: 'fail', detail: 'cross-team bind allowed with no share' };

    mustOk(await store.shareCapability({ instanceId: providerInst.id, capability: 'identity', toTeamId: teamB.id, sharedBy: 'sub-a' }), 'share');
    const shares = await store.listCapabilityShares(providerInst.id, 'identity');
    const allowed = checkBindingPolicy({ consumer: consumerInst, provider: providerInst, offer: offerRead.value, required: [{ output: 'issuer', into: ['OIDC_ISSUER'] }], shares });
    if (!allowed.ok) return { status: 'fail', detail: `share granted, policy still refuses: ${reasonOf(allowed.error)}` };
    const discoverable = await store.availableOffersForTeam(teamB.id, 'identity');
    if (discoverable.length !== 1) return { status: 'fail', detail: `shared offer not discoverable by team B (${String(discoverable.length)})` };

    mustOk(await store.bindCapability({ consumerInstanceId: consumerInst.id, capability: 'identity', providerInstanceId: providerInst.id, destinations: [{ output: 'issuer', into: ['OIDC_ISSUER'] }], boundBy: 'person-b' }), 'bind');
    mustOk(await store.revokeCapabilityShare(providerInst.id, 'identity', teamB.id), 'revoke');
    const after = await store.getBinding(consumerInst.id, 'identity');
    if (!after.ok) return { status: 'fail', detail: 'revoking the share DELETED the binding -- the app loses its record of what it points at' };
    if (after.value.state !== 'stale') return { status: 'fail', detail: `state after revoke is ${after.value.state}, expected stale` };
    const hidden = await store.availableOffersForTeam(teamB.id, 'identity');
    return hidden.length === 0
      ? { status: 'pass', detail: 'share gates the bind; revoke ages to stale and withdraws discovery' }
      : { status: 'fail', detail: 'the revoked offer is still discoverable to the former consumer' };
  });

  await add('invitations: pending is not a membership, and one address one pending row (D44)', async () => {
    const { store, team } = await seed();
    const owner = mustOk(await store.resolvePerson({ issuer: 'https://inviter.test', subject: 'inviter' }), 'inviter person');
    mustOk(await store.putTeamMember({ teamId: team.id, personId: owner.person.id, role: 'owner' }), 'owner member');
    // Counted against the fixture's own baseline rather than an absolute: `seed()` creates what it creates,
    // and an assertion of `1` would have been a claim about the suite rather than about invitations.
    const personsBefore = (await store.listPersons()).length;
    const invitation = mustOk(await store.createInvitation({ teamId: team.id, email: '  New-Hire@Example.TEST ', role: 'member', invitedBy: owner.person.id }), 'create');
    if (invitation.email !== 'new-hire@example.test') return { status: 'fail', detail: `address not normalised: ${invitation.email}` };

    // Inviting a stranger must not create a person, an identity, or a membership -- the three ways a naive
    // implementation leaks an unauthorised role into the authorization table.
    const members = await store.listTeamMembers(team.id);
    if (members.length !== 1) return { status: 'fail', detail: `an invitation created a membership: ${String(members.length)} members` };
    const persons = await store.listPersons();
    if (persons.length !== personsBefore) return { status: 'fail', detail: `an invitation created ${String(persons.length - personsBefore)} person row(s) for someone who has not proven anything yet` };

    const dupe = await store.createInvitation({ teamId: team.id, email: 'new-hire@example.test', role: 'owner', invitedBy: owner.person.id });
    const verdict = expectErr(dupe, 'conflict', 'a second pending invitation for the same address');
    if (verdict.status === 'fail') return verdict;
    // Different casing is the same person -- otherwise two pending rows with different roles is a real state.
    const dupeCase = await store.createInvitation({ teamId: team.id, email: 'NEW-HIRE@example.test', role: 'member', invitedBy: owner.person.id });
    if (dupeCase.ok) return { status: 'fail', detail: 'case-only difference produced a second pending invitation' };

    const listed = await store.listInvitations(team.id);
    if (listed.length !== 1) return { status: 'fail', detail: `team listing gave ${String(listed.length)} rows` };
    const noTeam = await store.createInvitation({ teamId: 'team-missing', email: 'x@example.test', role: 'member', invitedBy: owner.person.id });
    return expectErr(noTeam, 'not-found', 'an invitation into a team that does not exist');
  });

  await add('invitations: acceptance is atomic and grants exactly the invited role', async () => {
    const { store, team } = await seed();
    const inviter = mustOk(await store.resolvePerson({ issuer: 'https://inviter.test', subject: 'inviter' }), 'inviter');
    mustOk(await store.putTeamMember({ teamId: team.id, personId: inviter.person.id, role: 'owner' }), 'owner');
    const invitation = mustOk(await store.createInvitation({ teamId: team.id, email: 'hire@example.test', role: 'member', invitedBy: inviter.person.id }), 'create');
    const invitee = mustOk(await store.resolvePerson({ issuer: 'https://idp-b.test', subject: 'hire-1' }), 'invitee person');

    const accepted = mustOk(await store.acceptInvitation(invitation.id, invitee.person.id), 'accept');
    if (accepted.invitation.state !== 'accepted' || accepted.invitation.acceptedBy !== invitee.person.id) {
      return { status: 'fail', detail: `invitation state: ${JSON.stringify(accepted.invitation)}` };
    }
    const member = mustOk(await store.getTeamMember(team.id, invitee.person.id), 'read membership');
    if (member.role !== 'member') return { status: 'fail', detail: `granted ${member.role} instead of the invited role` };
    const teams = await store.teamsForPerson(invitee.person.id);
    if (!teams.includes(team.id)) return { status: 'fail', detail: `accepted but not a member of anything: ${JSON.stringify(teams)}` };

    const again = await store.acceptInvitation(invitation.id, invitee.person.id);
    const secondVerdict = expectErr(again, 'conflict', 'a second acceptance of the same invitation');
    if (secondVerdict.status === 'fail') return secondVerdict;
    const ghost = await store.acceptInvitation('inv-does-not-exist', invitee.person.id);
    return expectErr(ghost, 'not-found', 'acceptance of an unknown invitation');
  });

  await add('invitations: expiry and revocation are observed, and a receipt is a field', async () => {
    const { store, team } = await seed();
    const inviter = mustOk(await store.resolvePerson({ issuer: 'https://inviter.test', subject: 'inviter' }), 'inviter');
    const live = mustOk(await store.createInvitation({ teamId: team.id, email: 'live@example.test', role: 'member', invitedBy: inviter.person.id }), 'live');
    const stale = mustOk(await store.createInvitation({ teamId: team.id, email: 'stale@example.test', role: 'member', invitedBy: inviter.person.id, ttlDays: -1 }), 'already expired');
    const aged = await store.findInvitationsForEmail('stale@example.test');
    if (aged[0]?.state !== 'expired') return { status: 'fail', detail: `expired row reads as ${String(aged[0]?.state)}` };
    const refused = await store.acceptInvitation(stale.id, inviter.person.id);
    const expiryVerdict = expectErr(refused, 'conflict', 'acceptance of an expired invitation');
    if (expiryVerdict.status === 'fail') return expiryVerdict;

    const withReceipt = mustOk(await store.setInvitationEmailResult(live.id, { receipt: 'mailpit-id-1' }), 'receipt');
    if (withReceipt.emailReceipt !== 'mailpit-id-1') return { status: 'fail', detail: 'the transport receipt did not stick' };
    // A later failed resend must not erase the earlier success, and vice versa: both are facts (D46).
    const afterError = mustOk(await store.setInvitationEmailResult(live.id, { error: 'relay 550' }), 'error');
    if (afterError.emailReceipt !== 'mailpit-id-1') return { status: 'fail', detail: 'a failure write erased the prior receipt' };
    const unknown = await store.setInvitationEmailResult('inv-nope', { receipt: 'x' });
    const unknownVerdict = expectErr(unknown, 'not-found', 'a receipt for an unknown invitation');
    if (unknownVerdict.status === 'fail') return unknownVerdict;

    const revoked = mustOk(await store.revokeInvitation(live.id), 'revoke');
    if (revoked.state !== 'revoked') return { status: 'fail', detail: `revoked row reads ${revoked.state}` };
    const acceptAfterRevoke = await store.acceptInvitation(live.id, inviter.person.id);
    return expectErr(acceptAfterRevoke, 'conflict', 'acceptance after revocation');
  });

  await add('per-environment state: two environments, two truthful rows (#179)', async () => {
    const { store, instance } = await seed();
    const missingInstance = await store.setInstanceEnvironment({ instanceId: 'inst-never', environment: 'production', state: 'live' });
    const guard = expectErr(missingInstance, 'not-found', 'state for an unknown instance');
    if (guard.status === 'fail') return guard;

    const production = mustOk(await store.setInstanceEnvironment({ instanceId: instance.id, environment: 'production', state: 'live', appliedPlanHash: 'a'.repeat(64) }), 'set production');
    const staging = mustOk(await store.setInstanceEnvironment({ instanceId: instance.id, environment: 'staging', state: 'degraded', attestationId: 'disp-1' }), 'set staging');
    if (production.state !== 'live' || staging.state !== 'degraded') return { status: 'fail', detail: 'rows did not round-trip their states' };

    const rows = await store.listInstanceEnvironments(instance.id);
    if (rows.length !== 2) return { status: 'fail', detail: `expected two environments, got ${String(rows.length)}` };

    // Upsert must not lose a value the second writer did not mention: the rollup would otherwise be computed
    // from rows that quietly shed their hashes.
    mustOk(await store.setInstanceEnvironment({ instanceId: instance.id, environment: 'staging', state: 'degraded', appliedPlanHash: 'b'.repeat(64) }), 'restaging');
    const after = mustOk(await store.getInstanceEnvironment(instance.id, 'staging'), 'read staging');
    if (after.appliedPlanHash !== 'b'.repeat(64)) return { status: 'fail', detail: `explicit hash not applied: ${String(after.appliedPlanHash)}` };
    mustOk(await store.setInstanceEnvironment({ instanceId: instance.id, environment: 'staging', state: 'degraded' }), 'touch staging again');
    const kept = await store.getInstanceEnvironment(instance.id, 'staging');
    if (!kept.ok) return { status: 'fail', detail: 'row lost on a no-op update' };
    const stillThere = kept.ok && (kept.value.attestationId === 'disp-1' || kept.value.appliedPlanHash !== undefined);
    const all = await store.listInstanceEnvironments('inst-none-exists');
    if (all.length !== 0) return { status: 'fail', detail: 'an unknown instance listed someone else\'s environments' };
    return stillThere
      ? { status: 'pass', detail: 'two states recorded independently, upsert preserves, isolation holds' }
      : { status: 'fail', detail: 'a re-write with fewer fields dropped the values it did not mention' };
  });

  await add('a plan is stored by its own digest, and a malformed hash is refused', async () => {
    const { store, instance } = await seed();
    const bad = await store.putPlan(instance.id, { instanceId: instance.id }, 'sha256:abc');
    if (bad.ok) return { status: 'fail', detail: 'a prefixed/non-hex plan hash was accepted -- the digest shape the runner compares is now ambiguous' };
    const missing = await store.putPlan('inst-nobody', { x: 1 }, planHash);
    if (missing.ok) return { status: 'fail', detail: 'a plan for an unknown instance was accepted' };
    const stored = await store.putPlan(instance.id, { instanceId: instance.id, environments: [] }, planHash);
    if (!stored.ok) return { status: 'fail', detail: `valid plan refused: ${JSON.stringify(stored)}` };
    const read = await store.getPlan(instance.id);
    if (!read.ok) return { status: 'fail', detail: 'plan not readable after write' };
    const tampered = read.ok ? structuredClone(read.value) : null;
    if (tampered) (tampered.plan as { injected?: string }).injected = 'caller mutation';
    const again = await store.getPlan(instance.id);
    return again.ok && JSON.stringify(again.value.plan) === JSON.stringify(read.ok ? read.value.plan : null)
      ? { status: 'pass', detail: 'stored, digest-checked, and immune to caller mutation' }
      : { status: 'fail', detail: 'mutating a read plan changed what the store returns' };
  });

  await add('the plan a dispatch authorises is the plan at issue time', async () => {
    // The reason plans are copied into the dispatch: desired state moving between issue and fetch must not
    // change what a runner is allowed to apply, or the plan hash comparison becomes a comparison against a
    // moving target and honest attestation becomes impossible.
    const { store, instance } = await seed();
    const firstHash = planHash;
    await store.putPlan(instance.id, { instanceId: instance.id, revision: 1 }, firstHash);
    const dispatch = await store.createDispatch({
      instanceId: instance.id, nonce, planHash: firstHash, action: 'apply', environment: 'production',
      issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(), plan: { instanceId: instance.id, revision: 1 },
    });
    if (!dispatch.ok) return { status: 'fail', detail: JSON.stringify(dispatch) };
    await store.putPlan(instance.id, { instanceId: instance.id, revision: 2 }, 'c'.repeat(64));
    const fetched = await store.getDispatch(dispatch.value.id);
    if (!fetched.ok) return { status: 'fail', detail: 'dispatch unreadable' };
    const planJson = JSON.stringify(fetched.value.plan);
    return planJson.includes('revision\":1') || planJson.includes('"revision":1')
      ? { status: 'pass', detail: 'the dispatch still carries revision 1' }
      : { status: 'fail', detail: `dispatch plan drifted after issuance: ${planJson.slice(0, 120)}` };
  });

  await add('a dispatch is single-use, and the second consume is a replay', async () => {
    const { store, instance } = await seed();
    const created = await store.createDispatch({
      instanceId: instance.id, nonce, planHash, action: 'apply', environment: 'production',
      issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(), plan: { instanceId: instance.id },
    });
    if (!created.ok) return { status: 'fail', detail: `dispatch create failed: ${JSON.stringify(created)}` };
    const first = await store.consumeDispatch(created.value.id);
    if (!first.ok) return { status: 'fail', detail: `first consume refused: ${JSON.stringify(first)}` };
    return expectErr(await store.consumeDispatch(created.value.id), 'consumed', 'second consume');
  });

  await add('an expired dispatch cannot be consumed', async () => {
    const { store, instance } = await seed();
    const created = await store.createDispatch({
      instanceId: instance.id, nonce, planHash, action: 'apply', environment: 'production',
      issuedAt: new Date(Date.now() - 7_200_000).toISOString(), expiresAt: new Date(Date.now() - 3_600_000).toISOString(), plan: {},
    });
    if (!created.ok) return { status: 'fail', detail: JSON.stringify(created) };
    return expectErr(await store.consumeDispatch(created.value.id), 'expired', 'expired consume');
  });

  await add('attestation policy: unknown dispatch, foreign nonce, moved hash, wrong environment', async () => {
    const { store, instance } = await seed();
    const created = await store.createDispatch({
      instanceId: instance.id, nonce, planHash, action: 'apply', environment: 'production',
      issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(), plan: {},
    });
    if (!created.ok) return { status: 'fail', detail: JSON.stringify(created) };
    const dispatch = created.value;
    const unknown = await store.recordAttestation(attestationFor(dispatch, { dispatchId: 'disp-other' }));
    const unknownVerdict = expectErr(unknown, 'not-found', 'attestation for an unknown dispatch');
    if (unknownVerdict.status === 'fail') return unknownVerdict;
    const foreignNonce = await store.recordAttestation(attestationFor(dispatch, { nonce: 'z'.repeat(32) }));
    const nonceVerdict = expectErr(foreignNonce, 'conflict', 'foreign nonce');
    if (nonceVerdict.status === 'fail') return nonceVerdict;
    const movedHash = await store.recordAttestation(attestationFor(dispatch, { planHash: 'f'.repeat(64) }));
    const hashVerdict = expectErr(movedHash, 'conflict', 'plan hash that does not match the dispatch');
    if (hashVerdict.status === 'fail') return hashVerdict;
    const wrongEnv = await store.recordAttestation(attestationFor(dispatch, { environment: 'staging' }));
    const envVerdict = expectErr(wrongEnv, 'conflict', 'attestation for a different environment');
    if (envVerdict.status === 'fail') return envVerdict;
    const accepted = await store.recordAttestation(attestationFor(dispatch));
    return accepted.ok ? { status: 'pass', detail: 'four refusals, then the honest one accepted' } : { status: 'fail', detail: `valid attestation refused: ${JSON.stringify(accepted)}` };
  });

  await add('one attestation per dispatch -- a retried job cannot rewrite history', async () => {
    const { store, instance } = await seed();
    const created = await store.createDispatch({
      instanceId: instance.id, nonce, planHash, action: 'apply', environment: 'production',
      issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(), plan: {},
    });
    if (!created.ok) return { status: 'fail', detail: JSON.stringify(created) };
    const first = await store.recordAttestation(attestationFor(created.value));
    if (!first.ok) return { status: 'fail', detail: `first attestation refused: ${JSON.stringify(first)}` };
    return expectErr(await store.recordAttestation(attestationFor(created.value)), 'conflict', 'duplicate attestation');
  });

  await add('latestAttestation is per instance, and ordered by completion not insertion', async () => {
    const store = await fresh();
    const t = await store.createTeam({ name: 'ordering' });
    if (!t.ok) return { status: 'fail', detail: 'team failed' };
    const a = await store.createInstance({ teamId: t.value.id, name: 'a', template: 'starter-web' });
    const b = await store.createInstance({ teamId: t.value.id, name: 'b', template: 'starter-web' });
    if (!a.ok || !b.ok) return { status: 'fail', detail: 'instances failed' };
    const mk = async (instanceId: string, id: string, finished: string) => {
      const d = await store.createDispatch({
        instanceId, nonce, planHash, action: 'apply', environment: 'production',
        // Expires far in the future: the case is about ordering, and a January 2026 dispatch would be
        // correctly refused as expired -- which is the mistake this fixture originally made.
        issuedAt: finished, expiresAt: '2999-01-01T00:00:00.000Z', plan: {}, id,
      });
      if (!d.ok) throw new Error(`dispatch ${id} failed: ${reasonOf(d)}`);
      const r = await store.recordAttestation(attestationFor(d.value, { finishedAt: finished }));
      if (!r.ok) throw new Error(`attestation for ${id} refused: ${reasonOf(r)}`);
    };
    await mk(a.value.id, 'disp-old', '2026-01-01T00:00:00.000Z');
    await mk(b.value.id, 'disp-other-instance', '2026-06-01T00:00:00.000Z');
    await mk(a.value.id, 'disp-new', '2026-03-01T00:00:00.000Z');
    const latest = await store.latestAttestation(a.value.id);
    if (!latest.ok) return { status: 'fail', detail: JSON.stringify(latest) };
    if (latest.value.dispatchId !== 'disp-new') return { status: 'fail', detail: `expected disp-new (latest by finishedAt), got ${latest.value.dispatchId}` };
    const wrong = await store.latestAttestation('inst-nobody');
    return wrong.ok ? { status: 'fail', detail: 'an unknown instance returned an attestation -- cross-instance leak' } : { status: 'pass', detail: 'ordered by finishedAt, isolated by instance' };
  });

  await add('returned records are copies: mutating a read cannot corrupt the store', async () => {
    // The case that separates a real store from a Map of live objects. A database hands back fresh rows; an
    // in-memory double that returns its internal reference lets one caller rewrite another's view, and the
    // only way to catch that is to try it.
    const { store, instance } = await seed();
    const before = await store.getInstance(instance.id);
    if (!before.ok) return { status: 'fail', detail: 'read failed' };
    const snapshot = JSON.stringify(before.value);
    (before.value as { name: string }).name = 'tampered-by-caller';
    (before.value as { state: string }).state = 'removed';
    const after = await store.getInstance(instance.id);
    if (!after.ok) return { status: 'fail', detail: 're-read failed' };
    return JSON.stringify(after.value) === snapshot
      ? { status: 'pass', detail: 'the store owns its data' }
      : { status: 'fail', detail: `mutation leaked into the store: ${JSON.stringify(after.value).slice(0, 120)}` };
  });

  await add('no field of a provider connection can hold a secret value (D4)', async () => {
    const { store, instance } = await seed();
    const smuggled = { instanceId: instance.id, tier: 'managed', secrets: [{ name: 'RAILWAY_TOKEN', source: 'preserve', value: 'rhS9Wj3rCZm6s543dQEEv3U3FQz78fUd' }], connectedAt: new Date().toISOString() };
    const result = await store.putProviderConnection(smuggled as never);
    if (result.ok) return { status: 'fail', detail: 'a connection carrying a secret VALUE was accepted -- the schema has a place for it, which is the bug' };
    const stored = await store.getProviderConnection(instance.id);
    const text = JSON.stringify(stored.ok ? stored.value : {});
    return text.includes('rhS9Wj3rCZm6s543dQEEv3U3FQz78fUd')
      ? { status: 'fail', detail: 'the value reached storage even though the write was refused' }
      : { status: 'pass', detail: 'refused at the boundary; nothing persisted' };
  });

  await add('a repository connection is replaced, not accumulated', async () => {
    const { store, instance } = await seed();
    const first = await store.putRepoConnection({ instanceId: instance.id, repo: 'acme/old', defaultBranch: 'main', actionRef: '1'.repeat(40), installedAt: '2026-01-01T00:00:00.000Z' });
    const second = await store.putRepoConnection({ instanceId: instance.id, repo: 'acme/new', defaultBranch: 'main', actionRef: '2'.repeat(40), installedAt: '2026-02-01T00:00:00.000Z' });
    if (!first.ok || !second.ok) return { status: 'fail', detail: JSON.stringify([first, second].map((r) => (r.ok ? 'ok' : r.code))) };
    const read = await store.getRepoConnection(instance.id);
    if (!read.ok) return { status: 'fail', detail: 'read failed' };
    const schemaCheck = RepoConnectionSchema.safeParse(read.value);
    return read.value.repo === 'acme/new' && schemaCheck.success ? { status: 'pass', detail: 'one live connection per instance' } : { status: 'fail', detail: JSON.stringify(read.value) };
  });

  await add('audit is append-only, ordered, and bounded', async () => {
    const store = await fresh();
    for (let i = 0; i < 3; i += 1) {
      const written = await store.appendAudit({ actorKind: 'controller', actorRef: 'reconcile', action: `sweep-${String(i)}`, target: 'instance/x', detail: { attempt: i } });
      if (!written.ok) return { status: 'fail', detail: `audit write refused: ${reasonOf(written)}` };
    }
    const recent = await store.recentAudit(2);
    const all = await store.recentAudit(50);
    if (all.length < 3) return { status: 'fail', detail: `expected at least 3 audit rows, got ${String(all.length)}` };
    // Newest first, asserted by position rather than by set membership: the ordering contract is the whole
    // reason a second driver cannot quietly answer in the other direction.
    if (recent.length !== 2) return { status: 'fail', detail: `limit returned ${String(recent.length)} of 3 rows` };
    if (recent[0]?.action !== 'sweep-2' || recent[1]?.action !== 'sweep-1') {
      return { status: 'fail', detail: `expected newest-first [sweep-2, sweep-1], got ${JSON.stringify(recent.map((r) => r.action))}` };
    }
    const oldFirst = await store.recentAudit(50);
    if (oldFirst[0]?.action !== 'sweep-2') return { status: 'fail', detail: `full listing not newest-first: ${String(oldFirst[0]?.action)}` };
    return { status: 'pass', detail: `${String(all.length)} recorded, newest-first, limit honoured` };
  });

  await add('rows sharing one timestamp keep insertion order', async () => {
    // The regression this file exists to catch, written as a case so it cannot come back: Postgres `now()` is
    // a statement-time constant, so a burst of writes ties, and `ORDER BY at DESC` between ties is a coin flip.
    // It passed on one machine and failed on another -- which is why the ordering rule is now in the interface
    // and asserted here rather than left to whichever index the database happens to choose.
    const store = await fresh();
    const stamp = new Date('2026-05-05T05:05:05.000Z').toISOString();
    const written: string[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const label = `burst-${String(i)}`;
      const result = await store.appendAudit({ actorKind: 'system', actorRef: 'regression', action: label, target: 'tie-test', at: stamp, detail: { i } });
      if (!result.ok) return { status: 'fail', detail: `audit write ${label} refused: ${reasonOf(result)}` };
      written.push(label);
    }
    const read = await store.recentAudit(50);
    const mine = read.filter((r) => r.target === 'tie-test').map((r) => r.action).slice(0, 5);
    const expected = [...written].reverse();
    return JSON.stringify(mine) === JSON.stringify(expected)
      ? { status: 'pass', detail: `five tied timestamps still read back newest-first: ${mine.join(', ')}` }
      : { status: 'fail', detail: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(mine)}` };
  });

  await add('audit detail refuses an oversized blob', async () => {
    const store = await fresh();
    const before = (await store.recentAudit(500)).length;
    const result = await store.appendAudit({ actorKind: 'system', actorRef: 'x', action: 'oversize', target: 't', detail: { reason: 'z'.repeat(400) } } as never);
    const after = (await store.recentAudit(500)).length;
    // Refused as a value: an audit overflow that throws would abort the very loop it is trying to record.
    if (result.ok) return { status: 'fail', detail: 'an oversized detail string was stored without a bound' };
    return after === before ? { status: 'pass', detail: `refused as ${result.code} and nothing persisted` } : { status: 'fail', detail: 'refused, yet the row reached the log' };
  });

  await add('lists are bounded by the limit argument', async () => {
    const { store, instance } = await seed();
    for (let i = 0; i < 4; i += 1) {
      await store.createDispatch({
        instanceId: instance.id, nonce: `${nonce.slice(0, 31)}${String(i)}`, planHash, action: 'apply', environment: 'production',
        issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(), plan: { i },
      });
    }
    const two = await store.listDispatches(instance.id, 2);
    return two.length === 2 ? { status: 'pass', detail: '2 of 4 returned' } : { status: 'fail', detail: `limit ignored: ${String(two.length)}` };
  });

  await add('close() makes the store unusable rather than silently empty', async () => {
    const { store } = await seed();
    await store.close();
    const pinged = await store.ping().catch(() => false);
    return pinged === false ? { status: 'pass', detail: 'ping reports unusable' } : { status: 'fail', detail: 'ping() still true after close()' };
  });

  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const unimplemented = results.filter((r) => r.status === 'not-implemented').length;
  const driver = (await fresh()).describe().driver;
  return { driver, results, passed, failed, unimplemented, ok: failed === 0 && unimplemented === 0 };
}
