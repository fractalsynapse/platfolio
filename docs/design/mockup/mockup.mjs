import { startingPerson, otherPeople, startingTeams, startingInvitations, deploymentSnapshots } from "./fixtures.mjs";
import { createActivityFeed } from "./activity-feed.mjs";
import { createNotifications } from "./notifications.mjs";
import { createAppStatus } from "./app-status.mjs";
import { createTeamActivity } from "./team-activity.mjs";
import { createTeamManagement, invitationStatus } from "./team-management.mjs";
import { createTemplateCatalog } from "./template-catalog.mjs";
import { createTemplatePublisher } from "./template-publishing.mjs";
import { appManagementTitle, createInstanceLifecycle, lifecycleStatus } from "./instance-lifecycle.mjs";
import { createEnvironmentManagement, environmentSections } from "./environment-management.mjs";
import { createInstanceSetup, isSetupStep } from "./instance-setup.mjs";
import { createInstallationSetup } from "./installation-setup.mjs";

const app = document.querySelector("#app");
const state = {
  personId: startingPerson.id,
  people: structuredClone([startingPerson, ...otherPeople]),
  teams: structuredClone(startingTeams),
  invitations: structuredClone(startingInvitations),
  publishedTemplates: [],
  teamSlug: startingTeams[0].slug,
  verification: null,
  resetRequest: null,
  removingEmail: null,
  notice: "",
};

const dashboard = "/dashboard";
const signIn = "/sign-in";
const accountPath = "/dashboard/account";
const notificationsPath = "/dashboard/notifications";
const accountSections = ["Profile", "Emails", "Password", "Notifications"];
const accountSectionPath = section => section === "profile" ? accountPath : `${accountPath}?section=${section}`;
const teamPath = slug => `${dashboard}/teams/${slug}`;
const instancePath = (team, instance) => `${teamPath(team)}/instances/${instance}`;
const statusPath = (team, instance) => `${instancePath(team, instance)}/status`;
const publicStatusPath = (team, instance) => `/status/${team}/${instance}`;
const lifecyclePath = (team, instance) => `${instancePath(team, instance)}/lifecycle`;
function environmentPath(team, instance, env, section = "overview", detail) {
  const base = `${instancePath(team, instance)}/environments/${env}`;
  if (section === "overview") return base;
  return detail ? `${base}/${section}/${detail}` : `${base}/${section}`;
}
const initialPath = teamPath("fractalsynapse");
const createInstancePath = team => `${teamPath(team.slug)}/create-instance`;
const teamActivityPath = team => `${teamPath(team.slug)}/activity`;
const teamConnectionsPath = team => `${teamPath(team.slug)}/connections`;
const publishTemplatePath = team => `${teamPath(team.slug)}/publish-template`;
const withTemplate = (path, template) => template ? `${path}?template=${template.id}` : path;
const selectedTemplate = () => findTemplate(new URLSearchParams(location.search).get("template"));
const templateCatalog = createTemplateCatalog({
  heading, teamHeading, panel, link, escape, breadcrumb, publishedTemplates: state.publishedTemplates,
});
const { findTemplate } = templateCatalog;
const instanceSetup = createInstanceSetup({
  heading: teamHeading, panel, link, escape, authError, go, teamPath, createInstancePath,
});
const installationSetup = createInstallationSetup({ heading: teamHeading, escape, link });
const person = () => state.people.find(item => item.id === state.personId);
const teams = () => state.teams.filter(team => person() && Object.hasOwn(team.memberships, state.personId));
const invites = () => {
  const current = person();
  if (!current?.emails.some(entry => entry.address === current.primaryEmail && entry.verified)) return [];
  return state.invitations.filter(invite => invite.address === current.primaryEmail && invitationStatus(invite) === "Pending");
};
const activeTeam = () => teams().find(team => team.slug === state.teamSlug) ?? teams()[0];
const teamManagement = createTeamManagement({
  state, person, teamPath, heading: teamHeading, panel, link, button, navLink, badge, avatar, escape, authError, go, update: accountNotice, signOut, recordActivity,
});
const activityFeed = createActivityFeed({ badge, escape, link });
const teamActivity = createTeamActivity({ panel, link, badge, escape, environmentPath, feed: activityFeed });

function recordActivity(team, event) {
  teamActivity.record(team, person().name, event);
}

const environmentManagement = createEnvironmentManagement({
  heading: teamHeading, panel, link, navLink, badge, escape, authError, go,
  path: environmentPath, lifecyclePath, canManage: teamManagement.isOwner, recordActivity,
});
const notifications = createNotifications({
  person, teams, activeTeam, heading, panel, link, badge, escape, authError, update: accountNotice,
  emailSettingsPath: accountSectionPath("notifications"),
});
const appStatus = createAppStatus({
  heading, teamHeading, panel, link, badge, escape, authError, go,
  path: statusPath, publicPath: publicStatusPath, isOwner: teamManagement.isOwner, feed: activityFeed,
});
const instanceLifecycle = createInstanceLifecycle({
  heading: teamHeading, panel, link, badge, escape, authError, go,
  path: lifecyclePath, teamPath, isOwner: teamManagement.isOwner, recordActivity, unpublishStatus: appStatus.unpublish,
});
const templatePublisher = createTemplatePublisher({
  heading: teamHeading, panel, escape, authError, cardHeader: templateCatalog.cardHeader,
  publishedTemplates: state.publishedTemplates, isOwner: teamManagement.isOwner, save: publishTemplate,
});

function escape(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function nextDestination() {
  const next = new URLSearchParams(location.search).get("next") ?? "";
  const dashboardRoute = /^\/dashboard(?:\/[a-z0-9-]+)*$/;
  const [path, query, extra] = next.split("?");
  const validAccountTab = path === accountPath && /^section=(emails|password|notifications)$/.test(query);
  const validTeamTab = /^\/dashboard\/teams\/[a-z0-9-]+\/members$/.test(path) &&
    /^section=invitations(&view=history)?$/.test(query);
  const templateQuery = query?.match(/^template=([a-z0-9-]+)(?:&step=([a-z-]+))?$/);
  const instanceCreation = /^\/dashboard\/teams\/[a-z0-9-]+\/create-instance$/.test(path);
  const validTemplate = templateQuery && findTemplate(templateQuery[1]) &&
    (templateQuery[2] ? instanceCreation && isSetupStep(templateQuery[2]) : path === dashboard || instanceCreation);
  return dashboardRoute.test(path) && extra === undefined && (!query || validAccountTab || validTeamTab || validTemplate) ? next : initialPath;
}

function signInPath(next) {
  return `${signIn}?next=${encodeURIComponent(next)}`;
}

function go(url, { replace = false, focus = true } = {}) {
  history[replace ? "replaceState" : "pushState"](null, "", url);
  render();
  if (focus) {
    document.querySelector("h1")?.focus();
    window.scrollTo(0, 0);
  }
}

function link(path, label, classes = "") {
  return `<a href="${escape(path)}" data-route class="${classes}">${escape(label)}</a>`;
}

function button(label, action, classes = "button secondary") {
  return `<button class="${classes}" type="button" data-action="${action}">${escape(label)}</button>`;
}

function heading(title, description = "", navigation = "") {
  return `<header class="page-heading">
    <h1 tabindex="-1">${escape(title)}</h1>
    ${description ? `<p>${escape(description)}</p>` : ""}
  </header>${navigation}${state.notice ? `<p class="notice" role="status">${escape(state.notice)}</p>` : ""}`;
}

function teamHeading(team, title, description) {
  const pages = [
    [teamPath(team.slug), "Team workspace"],
    [createInstancePath(team), "Choose template"],
    [teamActivityPath(team), "Activity"],
    [teamManagement.membersPath(team), "Members"],
    [teamManagement.settingsPath(team), "Team settings"],
  ];
  if (teamManagement.isOwner(team)) pages.push([teamConnectionsPath(team), "Connections"], [publishTemplatePath(team), "Publish template"]);
  const path = location.pathname.replace(/\/$/, "");
  const navigation = `<nav class="team-tabs" aria-label="Team workspace pages">
    ${pages.map(([href, label]) => navLink(href, label, path === href)).join("")}
  </nav>`;
  return heading(title, description, navigation);
}

function breadcrumb(current, ...parents) {
  return `<nav class="breadcrumb" aria-label="Breadcrumb"><ol>
    ${parents.map(([title, path]) => `<li>${link(path, title)}</li>`).join("")}
    ${current ? `<li aria-current="page">${escape(current)}</li>` : ""}
  </ol></nav>`;
}

function panel(title, content, classes = "") {
  return `<section class="panel ${classes}"><h2>${escape(title)}</h2>${content}</section>`;
}

function badge(label, tone = "neutral") {
  return `<span class="badge" data-tone="${tone}">${escape(label)}</span>`;
}

function avatar(name, photo) {
  if (photo) return `<img class="avatar" src="${escape(photo)}" alt="">`;
  const initials = name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("");
  return `<span class="avatar" aria-hidden="true">${escape(initials.toUpperCase())}</span>`;
}

function logoNavigation(mark, team) {
  const instanceSlug = location.pathname.match(/^\/dashboard\/teams\/[^/]+\/instances\/([^/]+)/)?.[1];
  const instance = team?.instances.find(item => item.slug === instanceSlug && item.lifecycle !== "removed");
  return `<details class="header-menu logo-menu">
    <summary class="wordmark" aria-label="Platfolio navigation">${mark}</summary>
    <nav class="header-popup" aria-label="Platfolio navigation">
      ${navLink("/", "Home")}
      ${navLink("/templates", "Templates")}
      ${team ? `<div class="popup-section">
        ${navLink(teamPath(team.slug), "Team workspace")}
        ${navLink(teamActivityPath(team), "Activity")}
        ${navLink(teamManagement.membersPath(team), "Members")}
        ${navLink(teamManagement.settingsPath(team), "Team settings")}
        ${instance ? navLink(instancePath(team.slug, instance.slug), instance.name) : ""}
      </div>` : ""}
    </nav>
  </details>`;
}

function header(authentication = false) {
  const current = authentication ? undefined : person();
  const team = current ? activeTeam() : undefined;
  const invitationCount = current ? invites().length : 0;
  const mark = '<span class="brand-mark" aria-hidden="true">P</span>Platfolio';
  const teamOptions = current ? teams().map(item =>
    `<option value="${item.slug}"${item.slug === team?.slug ? " selected" : ""}>${escape(item.name)}</option>`).join("") : "";
  return `<header class="site-header">
    <div class="header-inner">
      ${current ? logoNavigation(mark, team) : `<a class="wordmark" href="/" data-route>${mark}</a>`}
      ${current ? `<label class="header-team">
        <span class="visually-hidden">Team</span>
        <select id="header-team"${team ? "" : " disabled"}>
          ${teamOptions || '<option value="">No team</option>'}
        </select>
      </label>
      <details class="header-menu profile-menu">
        <summary aria-label="User menu">${avatar(current.name, current.photo)}</summary>
        <nav class="header-popup" aria-label="User menu">
          ${navLink(accountPath, "Account")}
          ${navLink(notificationsPath, "Notifications")}
          ${navLink(dashboard, "Your teams")}
          ${navLink("/dashboard/invitations", invitationCount ? `Invitations (${invitationCount})` : "Invitations")}
          ${button("Log out", "sign-out", "nav-link")}
        </nav>
      </details>` : authentication ? "" : link(signIn, "Sign in", "button secondary header-sign-in")}
    </div>
  </header>`;
}

function landing() {
  const team = activeTeam();
  return `<div class="layout"><main id="main" class="public-shell">
    <div class="welcome">
      <section class="welcome-intro">
        ${heading("Put your app online", "Launch your app from GitHub on hosting your team owns. Keep control of your code and data, and pay your hosting provider directly.")}
        <div class="actions">${person() ? link(team ? teamPath(team.slug) : dashboard, "Open workspace", "button primary") : link(signIn, "Sign in", "button primary")}
          ${link("/templates", "Browse templates", "button secondary")}</div>
      </section>
      ${panel("How hosting works", `<ol class="hosting-steps">
        <li><strong>Connect your code and hosting</strong><p>Choose where your code lives in GitHub and where it will run in Railway.</p></li>
        <li><strong>Review the setup before launch</strong><p>See what you’ll run and approve the setup changes in GitHub.</p></li>
        <li><strong>Check your app after launch</strong><p>See what’s running and whether it passed its checks. Pause the app when you don’t need it.</p></li>
      </ol>`, "hosting-panel")}
    </div>
  </main></div>`;
}

function authPage(title, description, content) {
  return `<main id="main" class="public-shell auth-shell">
    <section class="panel auth-panel">
      ${heading(title, description)}
      ${content}
    </section>
  </main>`;
}

function authLink(path) {
  return `${path}?next=${encodeURIComponent(nextDestination())}`;
}

function authError() {
  return '<p class="form-error" role="status"></p>';
}

function passwordFields(prefix) {
  return `<label for="${prefix}-password">New password</label>
    <input id="${prefix}-password" name="password" type="password" autocomplete="new-password" minlength="8" required>
    <label for="${prefix}-confirmation">Confirm new password</label>
    <input id="${prefix}-confirmation" name="confirmation" type="password" autocomplete="new-password" minlength="8" required>`;
}

function signInPage() {
  return authPage("Sign in to Platfolio", "Use demo values to review the authentication flow.", `
    <form data-form="sign-in" class="form">
      <label for="sign-in-user">Username or primary email</label>
      <input id="sign-in-user" name="identifier" autocomplete="username" autocapitalize="none" required>
      <label for="sign-in-password">Password</label>
      <input id="sign-in-password" name="password" type="password" autocomplete="current-password" required>
      ${authError()}
      <div class="actions"><button class="button primary" type="submit">Sign in</button>
      ${link(authLink("/forgot-password"), "Forgot password?", "button quiet")}</div>
    </form>
    <div class="auth-links">
      ${button("Continue as Adrian Webb", "sign-in")}
      ${link(authLink("/sign-up"), "Create an account", "button quiet")}
    </div>`);
}

function signUpPage() {
  return authPage("Create an account", "Use a test email and password for this walkthrough.", `
    <form data-form="signup" class="form">
      <label for="signup-username">Username</label>
      <input id="signup-username" name="username" autocomplete="username" maxlength="60" required>
      <label for="signup-name">Display name</label>
      <input id="signup-name" name="name" autocomplete="name" maxlength="60" required>
      <label for="signup-email">Email</label>
      <input id="signup-email" name="email" type="email" autocomplete="email" maxlength="120" required>
      ${passwordFields("signup")}
      ${authError()}
      <div class="actions"><button class="button primary" type="submit">Create demo account</button>
      ${link(authLink(signIn), "Back to sign in", "button secondary")}</div>
    </form>`);
}

function forgotPasswordPage() {
  return authPage("Reset your password", "Enter your primary email.", `
    ${state.resetRequest ? `<p>If the address matches an account, a reset link will be sent. The inbox step is simulated here.</p>
      <div class="actions">${state.resetRequest.personId ? link(authLink("/reset-password"), "Open demo reset link", "button primary") : ""}
      ${button("Try another address", "retry-reset")}
      ${link(authLink(signIn), "Back to sign in", "button secondary")}</div>` : `
      <form data-form="request-reset" class="form">
        <label for="reset-email">Email</label>
        <input id="reset-email" name="email" type="email" autocomplete="email" required>
        <div class="actions"><button class="button primary" type="submit">Request reset link</button>
        ${link(authLink(signIn), "Back to sign in", "button secondary")}</div>
      </form>`}`);
}

function resetPasswordPage() {
  if (!state.resetRequest?.personId) {
    return authPage("Reset link unavailable", "", link(authLink("/forgot-password"), "Request a new link", "button primary"));
  }
  return authPage("Choose a new password", "Use test values for this preview.", `
    <form data-form="reset-password" class="form">
      ${passwordFields("reset")}
      ${authError()}
      <div class="actions"><button class="button primary" type="submit">Save new password</button>
      ${link(authLink(signIn), "Cancel", "button secondary")}</div>
    </form>`);
}

function verifyEmailPage() {
  const request = state.verification;
  if (!request || (request.source === "account" && request.personId !== state.personId)) {
    return authPage("Verification link unavailable", "", link(person() ? accountPath : signIn, person() ? "Back to Account" : "Back to sign in", "button primary"));
  }
  return authPage("Verify your email", "", `<p>Confirm this address by opening the simulated verification link.</p>
    <p class="auth-address"><strong>${escape(request.address)}</strong></p>
    <div class="actions">${button("Verify email", "complete-verification", "button primary")}
    ${link(request.source === "account" ? accountSectionPath("emails") : authLink(signIn), request.source === "account" ? "Back to Account" : "Back to sign in", "button secondary")}</div>`);
}

function navLink(path, title, current = location.pathname === path) {
  return `<a class="nav-link" href="${escape(path)}" data-route${current ? ' aria-current="page"' : ""}>${escape(title)}</a>`;
}

function workspace(content, trail = "") {
  return `<div class="layout"><main class="workspace" id="main">${trail}${content}</main></div>`;
}

function teamCards() {
  const template = selectedTemplate();
  const invitationCount = invites().length;
  const rows = teams().map(team => `<li>
    <a href="${template ? withTemplate(createInstancePath(team), template) : teamPath(team.slug)}" data-route class="list-link">
      ${avatar(team.name)} <span class="item-text"><strong>${escape(team.name)}</strong>
      <span>${escape(team.memberships[state.personId])} · ${team.instances.length} ${team.instances.length === 1 ? "instance" : "instances"}</span></span>
      <span class="chevron" aria-hidden="true">›</span>
    </a>
  </li>`).join("");
  return `${heading("Your teams", template ? `Choose a team for ${template.title}.` : "Choose a team to view its platform instances.")}
    <div class="actions">${link(withTemplate("/dashboard/create-team", template), "Create team", "button primary")}
      ${template ? link("/templates", "Change template", "button secondary") : ""}</div>
    <div class="${invitationCount ? "page-columns" : "form-panel"}">
      ${panel("Teams", rows ? `<ul class="resource-list">${rows}</ul>` : '<p class="empty-state">You don’t belong to a team yet.</p>')}
      ${invitationCount ? panel("Pending invitations", `<p>${invitationCount} ${invitationCount === 1 ? "invitation" : "invitations"} for your verified email.</p>
        ${link("/dashboard/invitations", "View invitations", "button secondary")}`, "context-panel") : ""}
    </div>`;
}

function createTeam() {
  return `${heading("Create team", "Choose a name and a unique URL slug. You’ll become the team owner.")}
    ${panel("Team details", `<form data-form="team" class="form">
      <label for="team-name">Team name</label>
      <input id="team-name" name="name" maxlength="60" required>
      <label for="team-slug">Team slug</label>
      <input id="team-slug" name="slug" maxlength="60" aria-describedby="slug-help" required>
      <p class="input-help" id="slug-help">Lowercase letters, numbers, and hyphens.</p>
      <p class="form-error" aria-live="polite"></p>
      <div class="actions"><button class="button primary" type="submit">Create team</button>
      ${link(withTemplate(dashboard, selectedTemplate()), "Cancel", "button secondary")}</div>
    </form>`, "form-panel")}`;
}

function invitationsPage() {
  const rows = invites().map(invite => {
    const team = state.teams.find(item => item.slug === invite.slug);
    return `<li class="resource-row">
      ${avatar(team.name)} <div class="item-text"><strong>${escape(team.name)}</strong>
      <span>${escape(invite.role)}</span></div>
      <button class="button secondary" type="button" data-accept="${escape(invite.id)}">Accept invitation</button>
    </li>`;
  }).join("");
  return `${heading("Invitations", "Invitations are matched to your verified primary email.")}
    ${panel("Pending invitations", rows ? `<ul class="resource-list">${rows}</ul>` : '<p class="empty-state">No pending invitations for this address.</p>', "form-panel")}`;
}

function emailAction(label, action, address) {
  return `<button class="button secondary" type="button" data-action="${action}" data-address="${escape(address)}" aria-label="${escape(`${label} ${address}`)}">${label}</button>`;
}

function emailsPanel() {
  const current = person();
  const rows = current.emails.map(({ address, verified }) => {
    const isPrimary = current.primaryEmail === address;
    const isDefault = current.defaultEmail === address;
    const removable = !isPrimary && !isDefault;
    return `<li class="email-entry">
      <div class="item-text">
        <strong>${escape(address)}</strong>
        <div class="badge-list">
          ${verified ? badge("Verified", "success") : badge("Unverified", "attention")}
          ${isPrimary ? badge("Primary") : ""}
          ${isDefault ? badge("Default notifications") : ""}
        </div>
      </div>
      <div class="actions">
        ${verified ? "" : emailAction("Verify", "verify-address", address)}
        ${removable ? emailAction("Remove", "review-remove", address) : ""}
      </div>
      ${state.removingEmail === address && removable ? `<div class="email-review">
        <p>Remove this address? Notifications will use the team or account default instead.</p>
        <div class="actions">${emailAction("Confirm removal", "remove-address", address)}
        ${button("Cancel removal", "cancel-remove")}</div>
      </div>` : ""}
    </li>`;
  }).join("");
  const primaryOptions = current.emails.filter(item => item.verified).map(({ address }) =>
    `<option value="${escape(address)}"${address === current.primaryEmail ? " selected" : ""}>${escape(address)}</option>`).join("");
  return `<div class="page-columns account-columns">
    <div>
      ${panel("Email addresses", `<ul class="resource-list">${rows}</ul>
        <form data-form="add-email" class="form">
          <label for="add-address">Add email address</label>
          <input id="add-address" name="email" type="email" autocomplete="off" maxlength="120" required>
          ${authError()}
          <div class="actions"><button class="button primary" type="submit">Add email</button></div>
        </form>`)}
    </div>
    ${panel("Sign-in address", `<p>Your primary email can be used to sign in and receive password reset links.</p>
      <form data-form="primary-email" class="form">
        <label for="primary-email">Primary email</label>
        <select id="primary-email" name="email">${primaryOptions}</select>
        <div class="actions"><button class="button secondary" type="submit">Save primary email</button></div>
      </form>`, "context-panel")}
  </div>`;
}

function notificationPanel() {
  const current = person();
  const verified = current.emails.filter(item => item.verified);
  const rows = teams().map(team => {
    const routing = current.teamEmails[team.slug] ?? "";
    return `<div class="notification-route"><label for="notify-${team.slug}">${escape(team.name)}</label>
      <select name="${team.slug}" id="notify-${team.slug}">
        <option value="">Use default</option>
        ${verified.map(({ address }) => `<option value="${escape(address)}"${routing === address ? " selected" : ""}>${escape(address)}</option>`).join("")}
      </select></div>`;
  }).join("");
  const defaults = verified.map(({ address }) =>
    `<option value="${escape(address)}"${current.defaultEmail === address ? " selected" : ""}>${escape(address)}</option>`).join("");
  return panel("Notification routing", `<p>Teams use the default unless you choose a different verified address.</p>
    <form class="form" data-form="notifications">
      <label for="default-email">Default notification email</label>
      <select id="default-email" name="defaultAddress">${defaults}</select>
      ${rows ? `<fieldset class="form-group"><legend>Team destinations</legend>${rows}</fieldset>` : ""}
      <div class="actions"><button class="button primary" type="submit">Save notification routing</button>
        ${link(notificationsPath, "Manage notification rules", "button secondary")}</div>
    </form>`, "form-panel");
}

function profilePanel() {
  const { username, name, photo } = person();
  return `<div class="page-columns account-columns">${panel("Profile", `<form data-form="profile" class="form">
    <label for="profile-username">Username</label>
    <input id="profile-username" name="username" value="${escape(username)}" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="60" required>
    <label for="profile-name">Display name</label>
    <input id="profile-name" name="name" value="${escape(name)}" autocomplete="name" maxlength="60" required>
    ${authError()}
    <div class="actions"><button class="button primary" type="submit">Save profile</button></div>
  </form>`)}${panel("Profile photo", `<div class="photo-preview">${avatar(name, photo)}</div>
    <form class="form" data-form="photo">
      <label for="profile-photo">Choose a profile photo</label>
      <input id="profile-photo" type="file" name="photo" accept="image/png,image/jpeg,image/webp" aria-describedby="photo-help" required>
      <p id="photo-help" class="input-help">PNG, JPEG, or WebP up to 2 MB.</p>
      ${authError()}
      <div class="actions"><button class="button secondary" type="submit">Save photo</button>
      ${photo ? button("Use initials", "remove-photo") : ""}</div>
    </form>`, "context-panel")}</div>`;
}

function passwordPanel() {
  return panel("Change password", `<p class="notice" id="password-status" role="status"></p>
    <form data-form="password" class="form">
      <p class="input-help">Use test values in this mockup.</p>
      <label for="current-password">Current password</label>
      <input id="current-password" name="current" type="password" autocomplete="current-password" required>
      ${passwordFields("account")}
      ${authError()}
      <div class="actions"><button class="button primary" type="submit">Save password</button>
      ${button("Cancel", "cancel-password")}</div>
    </form>`, "form-panel");
}

function accountPage() {
  const requested = new URLSearchParams(location.search).get("section");
  const pages = { profile: profilePanel, emails: emailsPanel, password: passwordPanel, notifications: notificationPanel };
  const selected = Object.hasOwn(pages, requested) ? requested : "profile";
  const tabs = accountSections.map(title => {
    const key = title.toLowerCase();
    return navLink(accountSectionPath(key), title, key === selected);
  }).join("");
  return `${heading("Account")}
    <div class="account-settings">
      <nav class="account-tabs" aria-label="Account sections">${tabs}</nav>
      ${pages[selected]()}
    </div>`;
}

function teamPage(team) {
  const activeInstances = team.instances.filter(item => item.lifecycle !== "removed");
  const removed = team.instances.filter(item => item.lifecycle === "removed");
  const instances = panel("Apps", activeInstances.length ? `<ul class="resource-list">${activeInstances.map(item =>
    `<li><a href="${instancePath(team.slug, item.slug)}" data-route class="list-link">
      <span class="instance-symbol" aria-hidden="true">P</span>
      <span class="item-text"><strong>${escape(item.name)}</strong><span>${escape(item.repository)}</span></span>
      ${item.lifecycle ? badge(lifecycleStatus(item), item.lifecycle === "suspended" ? "attention" : "neutral") : ""}
      <span class="chevron" aria-hidden="true">›</span>
    </a></li>`).join("")}</ul>` : '<p class="empty-state">This team has no apps yet.</p>');
  const count = Object.keys(team.memberships).length;
  const title = teamHeading(team, "Team workspace", `${count} ${count === 1 ? "member" : "members"} · ${team.memberships[state.personId]} access`);
  const handoff = removed.length && teamManagement.isOwner(team)
    ? panel("Removed apps", `<ul class="source-links env-quick-links">${removed.map(item =>
      `<li>${link(lifecyclePath(team.slug, item.slug), `${item.name} · Export and next steps`)}</li>`).join("")}</ul>`, "context-panel") : "";
  return `${title}<div class="team-profile-grid">
    <div>${instances}${activeInstances.length ? "" : `<div class="actions">${link(createInstancePath(team), "Choose a template", "button primary")}</div>`}${handoff}</div>
    <div>${teamActivity.profile(team, teamActivityPath(team))}</div>
  </div>`;
}

function instancePage(team, instance) {
  return `${teamHeading(team, instance.name, "Hosted app")}
    <div class="page-columns">
      ${panel("Environments", environmentManagement.list(team, instance))}
      ${panel("App details", `<dl class="facts"><div><dt>GitHub repository</dt><dd>${escape(instance.repository)}</dd></div>
      <div><dt>Team</dt><dd>${escape(team.name)}</dd></div></dl>
      ${instance.lifecycle ? `<p>${badge(lifecycleStatus(instance), instance.lifecycle === "suspended" ? "attention" : "neutral")}</p>` : ""}
      <div class="actions">${link(statusPath(team.slug, instance.slug), "Status", "button secondary")}
        ${link(lifecyclePath(team.slug, instance.slug), appManagementTitle, "button secondary")}</div>`, "context-panel")}
    </div>`;
}

function workspacePage(path) {
  const connections = teams().find(team => teamConnectionsPath(team) === path && teamManagement.isOwner(team));
  if (connections) {
    state.teamSlug = connections.slug;
    return workspace(installationSetup.page(connections));
  }
  const yourTeams = ["Your teams", dashboard];
  const pages = {
    [dashboard]: ["Your teams", teamCards],
    "/dashboard/create-team": ["Create team", createTeam],
    "/dashboard/invitations": ["Invitations", invitationsPage],
    [accountPath]: ["Account", accountPage],
    [notificationsPath]: ["Notifications", notifications.page],
  };
  if (Object.hasOwn(pages, path)) {
    const [title, page] = pages[path];
    return workspace(page(), breadcrumb(title, path === "/dashboard/create-team" ? yourTeams : ["Home", "/"]));
  }

  const match = path.match(/^\/dashboard\/teams\/([a-z0-9-]+)(?:\/(members|settings|create-instance|publish-template|activity)|\/instances\/([a-z0-9-]+)(?:\/(lifecycle|status)|\/environments\/(production|staging)(?:\/(deployments|configuration|domains)(?:\/([a-z0-9-]+))?)?)?)?$/);
  const [, teamSlug, teamSection, instanceSlug, appSection, environment, section = "overview", detail] = match ?? [];
  const team = teams().find(item => item.slug === teamSlug);
  const instance = team?.instances.find(item => item.slug === instanceSlug);
  if (!team || (instanceSlug && !instance) || (detail && section !== "deployments") ||
      (instance?.lifecycle === "removed" && !teamManagement.isOwner(team))) {
    return workspace(`${heading("Page unavailable", "This demo account can open the teams and instances listed in its workspace.")}
      <div class="actions">${link(dashboard, "Back to teams", "button secondary")}</div>`, breadcrumb("Page unavailable", yourTeams));
  }
  state.teamSlug = team.slug;
  if (teamSection === "members") return workspace(teamManagement.members(team));
  if (teamSection === "settings") return workspace(teamManagement.settings(team));
  if (teamSection === "activity") return workspace(teamHeading(team, "Team activity") + teamActivity.log(team));
  if (teamSection === "create-instance") {
    const template = selectedTemplate();
    const step = new URLSearchParams(location.search).get("step");
    if (template && isSetupStep(step)) return workspace(instanceSetup.page(team, template, step));
    return workspace(templateCatalog.setup(team, template, createInstancePath,
      selected => instanceSetup.path(team, selected, "connections"),
      template && instanceSetup.progress(team, template, "template")));
  }
  if (teamSection === "publish-template") return workspace(templatePublisher.publish(team));
  if (appSection === "lifecycle" || instance?.lifecycle === "removed") {
    const parent = instance.lifecycle === "removed" ? ["Team workspace", teamPath(team.slug)]
      : [instance.name, instancePath(team.slug, instance.slug)];
    return workspace(instanceLifecycle.page(team, instance), breadcrumb(appManagementTitle, parent));
  }
  if (appSection === "status") return workspace(appStatus.page(team, instance),
    breadcrumb("Status", [instance.name, instancePath(team.slug, instance.slug)]));
  if (environment) {
    const parents = [[instance.name, instancePath(team.slug, instance.slug)]];
    if (section !== "overview") parents.push([deploymentSnapshots[environment].label, environmentPath(team.slug, instance.slug, environment)]);
    if (detail) parents.push(["Deployments", environmentPath(team.slug, instance.slug, environment, section)]);
    const current = detail ? "Deployment details" : section === "overview" ? "" : environmentSections[section];
    return workspace(environmentManagement.page(team, instance, environment, section, detail), breadcrumb(current, ...parents));
  }
  if (instance) return workspace(instancePage(team, instance));
  return workspace(teamPage(team));
}

function render() {
  const path = location.pathname.replace(/\/$/, "") || "/";
  if (path === "/callback") {
    go(person() ? nextDestination() : signInPath(nextDestination()), { replace: true });
    return;
  }
  if (path.startsWith(dashboard) && !person()) {
    go(signInPath(path + location.search), { replace: true });
    return;
  }
  const statusRoute = path.match(/^\/status\/([a-z0-9-]+)\/([a-z0-9-]+)$/);
  if (statusRoute) {
    document.title = "Public app status";
    app.innerHTML = appStatus.publicPage(statusRoute[1], statusRoute[2]);
    return;
  }
  const publicPages = {
    "/": landing,
    "/templates": templateCatalog.catalog,
    [signIn]: signInPage,
    "/sign-up": signUpPage,
    "/forgot-password": forgotPasswordPage,
    "/reset-password": resetPasswordPage,
    "/verify-email": verifyEmailPage,
  };
  const detailPath = path.match(/^\/templates\/([a-z0-9-]+)$/);
  let page;
  if (detailPath) {
    const template = findTemplate(detailPath[1]);
    const current = person();
    const team = current && activeTeam();
    const destination = team && template ? instanceSetup.path(team, template, "connections") : withTemplate(dashboard, template);
    page = templateCatalog.detail(template, current ? destination : signInPath(destination), team?.name);
  } else {
    page = Object.hasOwn(publicPages, path) ? publicPages[path]() : workspacePage(path);
  }
  const authentication = !["/", "/templates"].includes(path) && Object.hasOwn(publicPages, path);
  document.title = "Platfolio workspace mockup";
  app.innerHTML = header(authentication) + page;
  connectHeaderMenus();
  templateCatalog.connect(app);
  templatePublisher.connect(app, activeTeam());
  instanceSetup.connect(app, activeTeam(), selectedTemplate());
  installationSetup.connect(app, activeTeam(), render);
  environmentManagement.connect(app);
  instanceLifecycle.connect(app);
  appStatus.connect(app);
  notifications.connect(app);
}

window.addEventListener("storage", () => {
  if (location.pathname.startsWith("/status/")) render();
});

function publishTemplate(team, platform, details) {
  const index = state.publishedTemplates.findIndex(template => template.publisherTeam === team.slug && template.platformSlug === platform.slug);
  const previous = state.publishedTemplates[index];
  const id = previous?.id ?? `demo-listing-${state.publishedTemplates.length + 1}`;
  const listing = {
    ...platform.templateSource, ...details, id, platformSlug: platform.slug,
    publisherTeam: team.slug, publisherName: team.name, repository: platform.repository, updatedAt: new Date().toISOString(),
  };
  if (index === -1) state.publishedTemplates.push(listing);
  else state.publishedTemplates[index] = listing;
  if (previous?.coverImage && previous.coverImage !== listing.coverImage) URL.revokeObjectURL(previous.coverImage);
  const href = `/templates/${id}`;
  recordActivity(team, { kind: "template", label: previous ? "Template updated" : "Template published", detail: listing.title, href });
  state.notice = "Demo listing published.";
  go(href);
}

function completeSignIn(id, destination, message = "") {
  if (state.personId !== id) {
    instanceSetup.clear();
    installationSetup.clear();
    environmentManagement.clear();
    teamActivity.clear();
  }
  state.personId = id;
  state.notice = message;
  go(`/callback?next=${encodeURIComponent(destination)}`);
}

function connectHeaderMenus() {
  const menus = [...document.querySelectorAll(".header-menu")];
  for (const menu of menus) {
    const summary = menu.querySelector("summary");
    let openedByHover = false;

    menu.addEventListener("toggle", () => {
      if (menu.open) {
        for (const other of menus) if (other !== menu) other.open = false;
      } else {
        openedByHover = false;
      }
    });
    if (menu.matches(".profile-menu")) {
      menu.addEventListener("pointerenter", event => {
        if (event.pointerType === "mouse" && !menu.open) {
          openedByHover = true;
          menu.open = true;
        }
      });
      menu.addEventListener("pointerleave", event => {
        if (event.pointerType === "mouse" && !menu.contains(document.activeElement)) menu.open = false;
      });
      summary.addEventListener("click", event => {
        if (openedByHover && menu.open) event.preventDefault();
        openedByHover = false;
      });
    }
    menu.addEventListener("focusout", event => {
      if (!menu.contains(event.relatedTarget)) menu.open = false;
    });
    menu.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !menu.open) return;
      menu.open = false;
      summary.focus();
    });
  }
}

function finishPasswordEdit(form, message = "") {
  form.reset();
  form.querySelector(".form-error").textContent = "";
  document.querySelector("#password-status").textContent = message;
  form.querySelector("#current-password").focus();
}

function setPhoto(photo) {
  const current = person();
  if (current.photo) URL.revokeObjectURL(current.photo);
  current.photo = photo;
  accountNotice(photo ? "Profile photo saved for this session." : "Using your initials.");
}

function saveProfile(data, name, error) {
  const username = String(data.get("username")).trim();
  if (!username || /[\s@]/.test(username)) {
    error.textContent = "Enter a username without spaces or @.";
    return;
  }
  const current = person();
  if (state.people.some(item => item.id !== current.id && item.username.toLowerCase() === username.toLowerCase())) {
    error.textContent = "That username is already in use.";
    return;
  }
  current.name = name;
  current.username = username;
  state.notice = "Profile saved for this session.";
  render();
  document.querySelector("#profile-username").focus();
}

function accountNotice(message) {
  state.notice = message;
  render();
}

function completeVerification() {
  const request = state.verification;
  if (!request || (request.source === "account" && request.personId !== state.personId)) return;
  const owner = state.people.find(item => item.id === request.personId);
  const entry = owner?.emails.find(item => item.address === request.address);
  if (!entry) return;
  entry.verified = true;
  state.verification = null;

  if (request.source === "signup") {
    completeSignIn(owner.id, request.destination, "Email verified. Your account is ready.");
  } else {
    state.notice = "Email verified for this demo session.";
    go(accountSectionPath("emails"));
  }
}

function manageAddress(action, address) {
  const current = person();
  const entry = current?.emails.find(item => item.address === address);
  if (!entry) return;
  if (action === "verify-address" && !entry.verified) {
    state.verification = { personId: current.id, address, source: "account" };
    state.notice = "";
    go("/verify-email");
  } else if (address !== current.primaryEmail && address !== current.defaultEmail) {
    if (action === "review-remove") {
      state.removingEmail = address;
      render();
      document.querySelector('[data-action="remove-address"]')?.focus();
    } else if (action === "remove-address" && state.removingEmail === address) {
      state.removingEmail = null;
      current.emails = current.emails.filter(item => item.address !== address);
      notifications.removeAddress(current, address);
      for (const [slug, saved] of Object.entries(current.teamEmails)) {
        if (saved === address) delete current.teamEmails[slug];
      }
      accountNotice("Email address removed.");
      document.querySelector("#add-address")?.focus();
    }
  }
}

function accountWithEmail(address) {
  return state.people.find(item => item.emails.some(entry => entry.address === address));
}

function readEmail(data) {
  return String(data.get("email")).trim().toLowerCase();
}

function confirmPassword(data, error) {
  if (data.get("password") !== data.get("confirmation")) {
    error.textContent = "The new passwords don’t match.";
    return false;
  }
  return true;
}

function submitAccountWorkflow(kind, data, error) {
  if (kind === "sign-in") {
    const identifier = String(data.get("identifier")).trim().toLowerCase();
    const owner = state.people.find(item =>
      (item.username.toLowerCase() === identifier || item.primaryEmail === identifier) &&
      item.emails.some(entry => entry.address === item.primaryEmail && entry.verified));
    if (!owner) error.textContent = "Use the username or primary email for a verified demo account.";
    else completeSignIn(owner.id, nextDestination());
  } else if (kind === "signup") {
    const username = String(data.get("username")).trim();
    const name = String(data.get("name")).trim();
    const address = readEmail(data);
    if (!name || !username || /[\s@]/.test(username)) {
      error.textContent = "Enter a display name and a username without spaces or @.";
    } else if (state.people.some(item => item.username.toLowerCase() === username.toLowerCase()) || accountWithEmail(address)) {
      error.textContent = "That username or email is already in use.";
    } else if (confirmPassword(data, error)) {
      const id = `demo-${state.people.length}`;
      state.people.push({ id, name, username, emails: [{ address, verified: false }], primaryEmail: address, defaultEmail: address, teamEmails: {} });
      state.personId = null;
      const destination = nextDestination();
      const pendingStart = destination === "/dashboard/invitations" || destination.startsWith("/dashboard?template=");
      state.verification = { personId: id, address, source: "signup", destination: pendingStart ? destination : dashboard };
      state.notice = "";
      go("/verify-email");
    }
  } else if (kind === "request-reset") {
    const address = readEmail(data);
    const owner = state.people.find(item => item.primaryEmail === address &&
      item.emails.some(entry => entry.address === address && entry.verified));
    state.resetRequest = { personId: owner?.id };
    render();
  } else if (kind === "reset-password") {
    if (state.resetRequest?.personId && confirmPassword(data, error)) {
      state.resetRequest = null;
      state.notice = "Password reset simulated. You can sign in again.";
      go(authLink(signIn));
    }
  } else if (kind === "add-email") {
    const address = readEmail(data);
    if (accountWithEmail(address)) error.textContent = "That email is already in use.";
    else {
      person().emails.push({ address, verified: false });
      accountNotice("Email added. Verify it to use it for sign-in or notifications.");
      document.querySelector("#add-address")?.focus();
    }
  } else if (kind === "primary-email") {
    const current = person();
    const address = readEmail(data);
    if (current.emails.some(entry => entry.address === address && entry.verified)) {
      current.primaryEmail = address;
      accountNotice("Primary email updated.");
    }
  } else if (kind === "photo") {
    const file = data.get("photo");
    if (!file.size || file.size > 2 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      error.textContent = "Choose a PNG, JPEG, or WebP image up to 2 MB.";
    } else {
      setPhoto(URL.createObjectURL(file));
    }
  } else if (kind === "notifications") {
    const current = person();
    const verified = new Set(current.emails.filter(item => item.verified).map(item => item.address));
    const defaultAddress = data.get("defaultAddress");
    if (verified.has(defaultAddress)) current.defaultEmail = defaultAddress;
    current.teamEmails = Object.fromEntries(teams().flatMap(team => {
      const address = data.get(team.slug);
      return verified.has(address) ? [[team.slug, address]] : [];
    }));
    accountNotice("Notification routing saved.");
  } else {
    return false;
  }
  return true;
}

function acceptInvitation(id) {
  const invite = invites().find(item => item.id === id);
  const team = invite && state.teams.find(item => item.slug === invite.slug);
  if (!team) return;
  if (!Object.hasOwn(team.memberships, state.personId)) team.memberships[state.personId] = invite.role;
  invite.status = "Accepted";
  recordActivity(team, {
    kind: "team", label: "Invitation accepted", detail: `${invite.role} access`, href: teamManagement.membersPath(team),
  });
  state.notice = `You joined ${team.name}.`;
  go(teamPath(team.slug));
}

function signOut(destination = location.pathname + location.search) {
  instanceSetup.clear();
  installationSetup.clear();
  environmentManagement.clear();
  teamActivity.clear();
  state.personId = null;
  state.teamSlug = null;
  state.verification = null;
  state.resetRequest = null;
  state.removingEmail = null;
  state.notice = "";
  go(signInPath(destination));
}

document.addEventListener("click", event => {
  for (const menu of document.querySelectorAll(".header-menu[open]")) {
    if (!menu.contains(event.target)) menu.open = false;
  }
  const target = event.target.closest("a[data-route],button[data-action],button[data-accept]");
  if (!target) return;
  if (target.matches("a")) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    state.notice = "";
    go(target.getAttribute("href"));
    return;
  }
  if (target.dataset.accept) {
    acceptInvitation(target.dataset.accept);
    return;
  }

  const action = target.dataset.action;
  if (teamManagement.handleAction(action, target.dataset.id)) return;
  if (action === "sign-out") {
    signOut();
  } else if (action === "sign-in") {
    completeSignIn(startingPerson.id, nextDestination());
  } else if (action === "retry-reset") {
    state.resetRequest = null;
    render();
    document.querySelector("#reset-email")?.focus();
  } else if (action === "complete-verification") {
    completeVerification();
  } else if (target.dataset.address) {
    manageAddress(action, target.dataset.address);
  } else if (action === "cancel-remove") {
    state.removingEmail = null;
    render();
  } else if (action === "remove-photo") {
    setPhoto(undefined);
  } else if (action === "cancel-password") {
    finishPasswordEdit(target.form);
  }
});

document.addEventListener("change", event => {
  if (event.target.id !== "header-team") return;
  const team = teams().find(item => item.slug === event.target.value);
  if (!team) return;
  state.notice = "";
  go(teamPath(team.slug));
});

function slugify(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

document.addEventListener("input", event => {
  const input = event.target;
  const slug = input.form?.elements.namedItem("slug");
  if (input.id === "team-slug") input.dataset.edited = "true";
  if (input.id === "team-name" && slug && !slug.dataset.edited) slug.value = slugify(input.value);
});



document.addEventListener("submit", event => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  const data = new FormData(form);
  const error = form.querySelector(".form-error");
  if (teamManagement.handleForm(form.dataset.form, data, form, error)) return;
  if (submitAccountWorkflow(form.dataset.form, data, error)) return;
  if (form.dataset.form === "password") {
    if (!confirmPassword(data, error)) return;
    if (data.get("password") === data.get("current")) {
      error.textContent = "Choose a new password that differs from the current one.";
      return;
    }
    finishPasswordEdit(form, "Password change simulated. Test values cleared.");
    return;
  }
  const name = String(data.get("name")).trim();
  if (!name) {
    error.textContent = "Enter a name.";
    return;
  }
  if (form.dataset.form === "profile") {
    saveProfile(data, name, error);
    return;
  }


  const slug = String(data.get("slug")).trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 60) {
    error.textContent = "Use lowercase letters, numbers, and single hyphens.";
    return;
  }
  if (state.teams.some(team => team.slug === slug) || state.invitations.some(invite => invite.slug === slug)) {
    error.textContent = "That team slug is already in use.";
    return;
  }
  state.teams.push({ slug, name, memberships: { [state.personId]: "Owner" }, instances: [] });
  state.notice = `Created ${name}. You’re the owner.`;
  const template = selectedTemplate();
  go(template ? withTemplate(createInstancePath({ slug }), template) : teamPath(slug));
});

window.addEventListener("popstate", () => {
  state.notice = "";
  render();
  document.querySelector("h1")?.focus();
});

render();
