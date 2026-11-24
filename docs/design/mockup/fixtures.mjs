const productionCommit = "4942dd9bda8385573e97835ec1c20a758c8cd3e5";

export const startingPerson = {
  id: "adrian",
  username: "adrianwebb",
  name: "Adrian Webb",
  emails: [
    { address: "adrian@example.test", verified: true },
    { address: "adrian-work@example.test", verified: true },
  ],
  primaryEmail: "adrian@example.test",
  defaultEmail: "adrian@example.test",
  teamEmails: { fractalsynapse: "adrian-work@example.test" },
};

// Team membership and account operations are fixtures for reviewing the interface.
export const otherPeople = [
  {
    id: "review-owner",
    name: "Morgan Lee",
    username: "morgan",
    emails: [{ address: "morgan@example.test", verified: true }],
    primaryEmail: "morgan@example.test",
    defaultEmail: "morgan@example.test",
    teamEmails: {},
  },
  {
    id: "jamie",
    name: "Jamie Chen",
    username: "jamie",
    emails: [{ address: "jamie@example.test", verified: true }],
    primaryEmail: "jamie@example.test",
    defaultEmail: "jamie@example.test",
    teamEmails: {},
  },
];

export const recordedChecksId = "checks";

// Recorded results from the two deployment checks against Railway.
export const deploymentSnapshots = {
  production: {
    label: "Production",
    issuer: "https://auth.platfolio.dev/realms/platfolio",
    hosts: { site: "platfolio.dev", api: "api.platfolio.dev" },
    release: "0.5.0",
    commit: productionCommit.slice(0, 7),
    observedAt: "2026-11-22T08:43:05Z",
    protocolChecks: 6,
  },
  staging: {
    label: "Staging",
    issuer: "https://auth.platfolio.dev/realms/platfolio-staging",
    hosts: { site: "preview.platfolio.dev", api: "staging-api.platfolio.dev" },
    release: null,
    commit: "36442bc",
    observedAt: "2026-11-22T06:48:40Z",
    protocolChecks: 6,
  },
};

export const startingTeams = [
  {
    slug: "fractalsynapse",
    name: "fractalsynapse",
    memberships: { adrian: "Owner", "review-owner": "Member", jamie: "Member" },
    instances: [{
      slug: "platfolio", name: "platfolio", repository: "fractalsynapse/platfolio",
      recordedEnvironments: deploymentSnapshots,
      templateSource: {
        commit: productionCommit,
        category: "web-apps", kind: "Web", mode: "Development",
        service: "Site, control plane API, and Keycloak",
        ingress: "Public site, API, and OIDC endpoints",
        resource: "PostgreSQL", production: "main", staging: "staging", developmentOverlay: true,
        highlights: ["Control plane API", "Keycloak", "PostgreSQL"],
        summary: "Run the Platfolio control plane, site, and identity service on your own infrastructure.",
      },
    }],
  },
  { slug: "design-review", name: "Design review", memberships: { "review-owner": "Owner" }, instances: [] },
];

const day = 24 * 60 * 60 * 1000;
const today = Date.now();
const invitationExpiry = today + 14 * day;
export const startingInvitations = [
  { id: "review", address: "adrian@example.test", slug: "design-review", role: "Member", status: "Pending", createdAt: today, expiresAt: invitationExpiry, emailPrepared: true },
  { id: "guest", address: "alex@example.test", slug: "fractalsynapse", role: "Member", status: "Pending", createdAt: today, expiresAt: invitationExpiry, emailPrepared: true },
  { id: "prior", address: "previous@example.test", slug: "fractalsynapse", role: "Member", status: "Revoked", createdAt: today - day, expiresAt: today + 13 * day, emailPrepared: false },
  { id: "expired", address: "expired@example.test", slug: "fractalsynapse", role: "Member", status: "Pending", createdAt: today - 15 * day, expiresAt: today - day, emailPrepared: true },
];

// Secret names and obligations shown in the self-host walkthrough.
export const environmentSecretNames = {
  KC_BOOTSTRAP_ADMIN_PASSWORD: "Keycloak administrator password · Needed for first-time setup",
  PLATFOLIO_GITHUB_PRIVATE_KEY: "Private key · Lets the app connect to GitHub",
};
