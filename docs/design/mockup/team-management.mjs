export function invitationStatus(invite) {
  return invite.status === "Pending" && invite.expiresAt <= Date.now() ? "Expired" : invite.status;
}

function emailStatus(invite) {
  return invite.emailPrepared ? "Demo email prepared" : "Delivery unavailable";
}

export function createTeamManagement({ state, person, teamPath, heading, panel, link, button, navLink, badge, avatar, escape, authError, go, update, signOut, recordActivity }) {
  const duration = 14 * 24 * 60 * 60 * 1000;
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
  const membersPath = team => `${teamPath(team.slug)}/members`;
  const invitesPath = team => `${membersPath(team)}?section=invitations`;
  const inviteHistoryPath = team => `${invitesPath(team)}&view=history`;
  const settingsPath = team => `${teamPath(team.slug)}/settings`;
  const roleFor = team => team.memberships[person()?.id];
  const isOwner = team => roleFor(team) === "Owner";
  const editableMember = (team, id) => team.memberships[id] === "Member" ||
    (team.memberships[id] === "Owner" && Object.values(team.memberships).filter(role => role === "Owner").length > 1);

  function routeTeam() {
    const slug = location.pathname.match(/^\/dashboard\/teams\/([a-z0-9-]+)\/(members|settings)$/)?.[1];
    return state.teams.find(team => team.slug === slug && roleFor(team));
  }

  function actionButton(label, action, id, subject) {
    return `<button type="button" class="button secondary" data-action="${action}" data-id="${escape(id)}" aria-label="${escape(label + " " + subject)}">${label}</button>`;
  }

  function memberList(team) {
    const owner = isOwner(team);
    const rows = Object.entries(team.memberships).map(([id, role]) => {
      const member = state.people.find(item => item.id === id);
      const name = member?.name ?? "Team member";
      return `<li class="management-row">
        <div class="member-identity">${avatar(name, member?.photo)}
          <div class="item-text"><strong>${escape(name)}${id === person().id ? " (you)" : ""}</strong>
            <span>${escape(member?.username ?? "")}</span>
          </div>
          ${badge(role)}
        </div>
        ${owner && editableMember(team, id) ? `<div class="actions">
          ${actionButton("Change role", "team-edit-role", id, name)}
          ${actionButton("Remove", "team-review-removal", id, name)}
        </div>` : owner && role === "Owner" ? '<span class="muted">At least one owner must remain.</span>' : ""}
      </li>`;
    }).join("");
    return panel("Team roster", `<ul class="resource-list">${rows}</ul>`);
  }

  function invitationList(team, history) {
    const invitations = state.invitations.filter(invite => invite.slug === team.slug);
    const rows = invitations.map(invite => ({ invite, status: invitationStatus(invite) }))
      .filter(({ status }) => (status === "Pending") !== history)
      .map(({ invite, status }) => `<li class="management-row">
          <div class="item-text">
            <div class="badge-list"><strong>${escape(invite.address)}</strong>${badge(status, status === "Pending" ? "attention" : "neutral")}</div>
            <span>${escape(invite.role)} · Created ${dateTime.format(invite.createdAt)}${status === "Pending" ? ` · Expires ${date.format(invite.expiresAt)}` : ""}</span>
            <span>${emailStatus(invite)}</span>
          </div>
          ${invite.emailPrepared || status === "Pending" ? `<div class="actions">
            ${invite.emailPrepared ? actionButton("Preview email", "team-preview-invite", invite.id, invite.address) : ""}
            ${status === "Pending" ? actionButton("Revoke", "team-review-revoke", invite.id, invite.address) : ""}
          </div>` : ""}
        </li>`).join("");
    const title = history ? "Invitation history" : "Active invitations";
    const content = rows ? `<ul class="resource-list">${rows}</ul>` : `<p class="empty-state">${history ? "No past invitations." : "No active invitations."}</p>`;
    return `<div class="invite-toolbar"><nav class="account-tabs invitation-tabs" aria-label="Invitation views">
        ${navLink(invitesPath(team), "Active", !history)}
        ${navLink(inviteHistoryPath(team), "History", history)}
      </nav>
      ${history ? "" : button("Invite member", "team-new-invite", "button primary")}</div>
      ${panel(title, content)}`;
  }

  function members(team) {
    const owner = isOwner(team);
    const query = new URLSearchParams(location.search);
    const requested = query.get("section") === "invitations";
    const showInvites = owner && requested;
    return `${heading(team, "Members")}
      <div class="account-settings">
        <nav class="account-tabs" aria-label="Team sections">
          ${navLink(membersPath(team), "Members", !showInvites)}
          ${owner ? navLink(invitesPath(team), "Invitations", showInvites) : ""}
        </nav>
        ${requested && !owner ? '<p class="notice">Team invitations are available to owners.</p>' : ""}
        ${showInvites ? invitationList(team, query.get("view") === "history") : memberList(team)}
      </div>
      <dialog class="team-dialog" id="team-dialog" aria-labelledby="team-dialog-title"></dialog>`;
  }

  function settings(team) {
    const owner = isOwner(team);
    return `${heading(team, "Team settings")}
      <div class="account-settings">
        ${panel("Team details", `<form data-form="team-settings" class="form">
          <label for="settings-team-slug">Name</label>
          <input id="settings-team-slug" value="${escape(team.slug)}" readonly aria-describedby="team-slug-help">
          <p id="team-slug-help" class="input-help">Used in your team and instance URLs.</p>
          <label for="settings-team-name">Display name</label>
          <input name="name" id="settings-team-name" value="${escape(team.name)}" required maxlength="60"${owner ? "" : " readonly"}>
          ${owner ? `${authError()}<div class="actions"><button type="submit" class="button primary">Save team details</button></div>` : ""}
        </form>`, "form-panel")}
      </div>`;
  }

  function openDialog(title, content) {
    const dialog = document.querySelector("#team-dialog");
    if (!dialog) return;
    dialog.innerHTML = `<h2 id="team-dialog-title">${escape(title)}</h2>${content}`;
    if (!dialog.open) dialog.showModal();
  }

  function form(kind, content, label, id = "") {
    const tone = kind === "team-revoke" || kind === "team-remove" ? "danger" : "primary";
    return `<form data-form="${kind}" data-id="${escape(id)}" class="form">${content}${authError()}
      <div class="actions"><button type="submit" class="button ${tone}">${escape(label)}</button>
      ${button("Cancel", "team-close-dialog")}</div></form>`;
  }

  function roles(selected = "Member") {
    return `<label for="team-dialog-role">Role</label><select id="team-dialog-role" name="role">
      <option${selected === "Member" ? " selected" : ""}>Member</option>
      <option${selected === "Owner" ? " selected" : ""}>Owner</option></select>`;
  }

  function previewEmail(team, invite) {
    openDialog("Invitation email preview", `
      <dl class="facts email-preview-facts">
        <div><dt>To</dt><dd>${escape(invite.address)}</dd></div>
        <div><dt>Subject</dt><dd>Invitation to ${escape(team.name)}</dd></div>
        <div><dt>Created</dt><dd>${dateTime.format(invite.createdAt)} · ${emailStatus(invite)}</dd></div>
      </dl>
      <p>You've been invited to join ${escape(team.name)} as ${invite.role.toLowerCase()}. Sign in or create an account with the addressed email, verify it, and accept under Invitations.</p>
      <div class="actions">${invitationStatus(invite) === "Pending" ? button("Open demo invitation", "team-open-recipient", "button primary") : ""}
      ${button("Done", "team-close-dialog")}</div>`);
  }

  function handleAction(action, id) {
    if (!action?.startsWith("team-")) return false;
    const team = routeTeam();
    if (!team || !isOwner(team)) return true;
    const invite = state.invitations.find(item => item.id === id && item.slug === team.slug);
    const target = state.people.find(item => item.id === id);
    if (action === "team-new-invite") {
      openDialog("Invite member", form("team-invite", `<label for="invite-email">Email address</label>
        <input id="invite-email" name="email" type="email" required autocomplete="off" maxlength="120">
        ${roles()}<p class="input-help">The recipient can create an account after receiving the invitation.</p>`, "Create invitation"));
    } else if (action === "team-close-dialog") {
      document.querySelector("#team-dialog")?.close();
    } else if (action === "team-open-recipient") {
      signOut("/dashboard/invitations");
    } else if (action === "team-preview-invite" && invite?.emailPrepared) {
      previewEmail(team, invite);
    } else if (invite && invitationStatus(invite) === "Pending") {
      if (action === "team-review-revoke") openDialog("Revoke invitation", form("team-revoke",
        `<p>${escape(invite.address)} will lose the ability to accept this invitation to ${escape(team.name)}.</p>`, "Revoke invitation", id));
    } else if (target && editableMember(team, id)) {
      if (action === "team-edit-role") openDialog("Change role", form("team-role",
        `<p>${escape(target.name)} on ${escape(team.name)}</p>${roles(team.memberships[id])}`, "Save role", id));
      if (action === "team-review-removal") openDialog("Remove member", form("team-remove",
        `<p>${escape(target.name)} will lose access to ${escape(team.name)}.</p>`, "Remove member", id));
    }
    return true;
  }

  function handleForm(kind, data, node, error) {
    if (!kind?.startsWith("team-")) return false;
    const team = routeTeam();
    if (!team || !isOwner(team)) return true;
    const id = node.dataset.id;
    if (kind === "team-settings") {
      const name = String(data.get("name")).trim();
      if (!name) error.textContent = "Enter a display name.";
      else {
        if (team.name !== name) recordActivity(team, {
          kind: "team", label: "Team display name updated", detail: name, href: settingsPath(team),
        });
        team.name = name;
        update("Team details saved.");
      }
    } else if (kind === "team-invite") {
      const address = String(data.get("email")).trim().toLowerCase();
      const existing = state.people.find(item => item.primaryEmail === address && team.memberships[item.id]);
      if (existing) error.textContent = "This person is already a team member.";
      else if (state.invitations.some(invite => invite.slug === team.slug && invite.address === address && invitationStatus(invite) === "Pending")) {
        error.textContent = "There is already a pending invitation for this address.";
      } else {
        const createdAt = Date.now();
        const invite = {
          id: `invite-${state.invitations.length + 1}`, address, slug: team.slug,
          role: data.get("role") === "Owner" ? "Owner" : "Member",
          status: "Pending", createdAt, expiresAt: createdAt + duration, emailPrepared: true,
        };
        state.invitations.unshift(invite);
        recordActivity(team, { kind: "team", label: "Invitation created", detail: `${invite.role} access`, href: membersPath(team) });
        update("Invitation created. The email is available for preview.");
        previewEmail(team, invite);
      }
    } else if (kind === "team-revoke") {
      const invite = state.invitations.find(item => item.id === id && item.slug === team.slug);
      if (invite && invitationStatus(invite) === "Pending") {
        invite.status = "Revoked";
        recordActivity(team, { kind: "team", label: "Invitation revoked", detail: `${invite.role} access`, href: membersPath(team) });
        update("Invitation revoked. You can find it in History.");
      }
    } else if (editableMember(team, id)) {
      if (kind === "team-role") {
        const previous = team.memberships[id];
        const role = data.get("role") === "Owner" ? "Owner" : "Member";
        team.memberships[id] = role;
        if (previous !== role) recordActivity(team, {
          kind: "team", label: "Team role updated", detail: `${previous} → ${role}`, href: membersPath(team),
        });
        update("Team role updated.");
      } else if (kind === "team-remove") {
        const role = team.memberships[id];
        delete team.memberships[id];
        recordActivity(team, { kind: "team", label: "Member removed", detail: `${role} access removed`, href: membersPath(team) });
        if (id === person().id) {
          state.notice = "You left the team.";
          go("/dashboard");
        } else update("Member removed.");
      }
    }
    return true;
  }

  return { members, settings, membersPath, settingsPath, isOwner, handleAction, handleForm };
}
